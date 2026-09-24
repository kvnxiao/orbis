import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";

import { projectEntrySchema, referencesIn, revisionReferenceSchema } from "../src/pi/lineage.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { SourceRegistry } from "../src/storage/sources.ts";
import { fixtureModel } from "./pi-fixture.mts";
import type { Fixture } from "./pi-fixture.mts";
import {
  baseProposal,
  committedId,
  forkOnDisk,
  noteContent,
  rejectionPaths,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  test,
} from "./store-fixture.mts";

const revisionEntry = "orbis-tiered-memory-revision";

function selected(runtime: MemoryRuntime) {
  return storageOf(runtime).lineage.selected;
}

function pending(runtime: MemoryRuntime) {
  return storageOf(runtime).lineage.pending;
}

interface Started {
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
}

async function started(f: Fixture): Promise<Started> {
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  return { runtime, ctx };
}

async function commitNote(
  f: Fixture,
  runtime: MemoryRuntime,
  text: string,
  notes: Record<string, string>,
): Promise<string> {
  const ctx = f.session.extensionRunner.createContext();
  const source = await sourceReference(f, text);
  return committedId(
    await runtime.commitProposal(ctx, runtime.captureProposal(ctx, noteContent(notes), [source])),
  );
}

function references(f: Fixture): number {
  return f.session.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType === revisionEntry).length;
}

const projectEntry = { version: 1, root: "/project", projectId: "a".repeat(64), sessionId: "s" };
const reference = { version: 1, projectId: "a".repeat(64), sessionId: "s", revisionId: "r" };

test("a project entry with an unsupported version fails the schema at /version", () => {
  expect(rejectionPaths(projectEntrySchema, { ...projectEntry, version: 2 })).toContain("/version");
});

test("a project entry missing its root fails the schema at /root", () => {
  const { root: _removed, ...rest } = projectEntry;
  expect(rejectionPaths(projectEntrySchema, rest)).toContain("/root");
});

test("a project entry with a wrong-typed projectId fails the schema at /projectId", () => {
  expect(rejectionPaths(projectEntrySchema, { ...projectEntry, projectId: 1 })).toContain(
    "/projectId",
  );
});

test("a revision reference with an unsupported version fails the schema at /version and is skipped", async ({
  createFixture,
}) => {
  const f = await createFixture();
  expect(rejectionPaths(revisionReferenceSchema, { ...reference, version: 2 })).toContain(
    "/version",
  );
  f.session.sessionManager.appendCustomEntry(revisionEntry, { ...reference, version: 2 });
  expect(referencesIn(f.session.sessionManager.getBranch(), reference.projectId)).toEqual([]);
});

test("a revision reference missing its revisionId fails the schema at /revisionId", () => {
  const { revisionId: _removed, ...rest } = reference;
  expect(rejectionPaths(revisionReferenceSchema, rest)).toContain("/revisionId");
});

test("a revision reference with a wrong-typed sessionId fails the schema at /sessionId", () => {
  expect(rejectionPaths(revisionReferenceSchema, { ...reference, sessionId: 5 })).toContain(
    "/sessionId",
  );
});

test("start selects the newest branch reference confirmed in the session file", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Remember the first state.");
  const { runtime } = await started(f);
  const first = await commitNote(f, runtime, "Remember the first state.", {
    "current-work.md": "First\n",
  });
  const second = await commitNote(f, runtime, "Remember the first state.", {
    "current-work.md": "Second\n",
  });
  expect(first).not.toBe(second);
  const { runtime: replacement } = await started(f);
  expect(selected(replacement)).toMatchObject({ state: "selected", revisionId: second });
});

test("a deferred session file keeps the committed revision appended until the first assistant turn", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx } = await started(f);
  const result = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Initial\n" }), []),
    ),
  );
  expect(pending(runtime)).toEqual({ state: "appended", revisionId: result });
  expect(selected(runtime)).toEqual({ state: "none" });
  await f.session.prompt("Write the first persisted turn.");
  await runtime.start(ctx);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: result });
  expect(pending(runtime)).toEqual({ state: "none" });
});

test("an appended reference stays pending across a configuration change until its entry is confirmed", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx } = await started(f);
  const result = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Initial\n" }), []),
    ),
  );
  const changed = { ...ctx, model: { ...fixtureModel, id: "another-model" } };
  await runtime.start(changed);
  expect(pending(runtime)).toEqual({ state: "appended", revisionId: result });
  await f.session.prompt("Write the first persisted turn.");
  await runtime.start(changed);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: result });
});

test("tree navigation to an earlier branch selects its revision without rewriting live files", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Remember the first state.");
  const { runtime, ctx } = await started(f);
  const first = await commitNote(f, runtime, "Remember the first state.", {
    "current-work.md": "First\n",
  });
  const firstReference = f.session.sessionManager.getLeafId();
  if (firstReference === null) {
    throw new Error("Missing first reference.");
  }
  await f.session.prompt("The second state supersedes the first.");
  await runtime.start(ctx);
  await commitNote(f, runtime, "Remember the first state.", { "current-work.md": "Second\n" });
  const store = await storeFor(f);
  await f.session.navigateTree(firstReference, { summarize: false });
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toMatchObject({
    state: "selected",
    revisionId: first,
    invalidNotes: [],
  });
  expect(await readFile(join(store.sessionDir, "current", "current-work.md"), "utf8")).toBe(
    "Second\n",
  );
});

test("an external edit followed by branch navigation keeps the edit and marks the note invalid", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Evidence before the edit.");
  const { runtime, ctx } = await started(f);
  const first = await commitNote(f, runtime, "Evidence before the edit.", {
    "current-work.md": "Generated\n",
  });
  const firstReference = f.session.sessionManager.getLeafId();
  if (firstReference === null) {
    throw new Error("Missing reference.");
  }
  const store = await storeFor(f);
  const note = join(store.sessionDir, "current", "current-work.md");
  await writeFile(note, "User correction\n");
  await f.session.prompt("A later turn.");
  await f.session.navigateTree(firstReference, { summarize: false });
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toMatchObject({
    state: "selected",
    revisionId: first,
    invalidNotes: ["current-work.md"],
    invalidReason: "curation",
  });
  expect(await readFile(note, "utf8")).toBe("User correction\n");
});

test("start drops an appended reference whose revision is unreadable", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const store = await storeFor(f);
  f.session.sessionManager.appendCustomEntry(revisionEntry, {
    version: 1,
    projectId: store.projectId,
    sessionId: store.sessionId,
    revisionId: "missing-revision",
  });
  const { runtime } = await started(f);
  expect(pending(runtime)).toEqual({ state: "none" });
  expect(selected(runtime)).toEqual({ state: "none" });
});

test("reconciliation drops a pending reference when the head no longer matches", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx } = await started(f);
  const first = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "A\n" }), []),
    ),
  );
  const store = await storeFor(f);
  runtime.stop();
  const moved = baseProposal(store, { expectedRevision: first, notes: { "journey.md": "B\n" } });
  committedId(await store.commit(moved, { validate: () => undefined }));
  await runtime.start(ctx);
  expect(pending(runtime)).toEqual({ state: "none" });
}, 20_000);

async function orphanHead(
  f: Fixture,
  runtime: MemoryRuntime,
  overrides: { anchorId?: string } = {},
): Promise<string> {
  const ctx = f.session.extensionRunner.createContext();
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Orphan\n" }), [
    await sourceReference(f, "Orphan evidence."),
  ]);
  runtime.stop();
  const store = await storeFor(f);
  return committedId(
    await store.commit({ ...proposal, ...overrides }, { validate: () => undefined }),
  );
}

test("reconciliation drops a pending reference when the anchor no longer matches", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  await orphanHead(f, runtime, { anchorId: "not-on-branch" });
  await runtime.start(ctx);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(references(f)).toBe(0);
});

test("reconciliation drops a pending reference when the evidence no longer matches", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  await orphanHead(f, runtime);
  f.session.sessionManager.appendContextEdit(sourceEntry(f, "Orphan evidence.").id, {
    content: "Edited evidence.",
  });
  await runtime.start(ctx);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(references(f)).toBe(0);
});

test("reconciliation drops a pending reference when the curation no longer matches", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  await orphanHead(f, runtime);
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "User edit\n");
  await runtime.start(ctx);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(references(f)).toBe(0);
});

test("startup attaches an unreferenced head revision whose lineage and evidence match", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  const orphan = await orphanHead(f, runtime);
  await runtime.start(ctx);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: orphan });
  expect(references(f)).toBe(1);
});

test("startup does not attach a revision already referenced on an abandoned branch", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  const anchor = f.session.sessionManager.getLeafId();
  const orphan = await orphanHead(f, runtime);
  const store = await storeFor(f);
  f.session.sessionManager.appendCustomEntry(revisionEntry, {
    version: 1,
    projectId: store.projectId,
    sessionId: store.sessionId,
    revisionId: orphan,
  });
  if (anchor === null) {
    throw new Error("Missing anchor.");
  }
  f.session.sessionManager.branch(anchor);
  await runtime.start(ctx);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(references(f)).toBe(1);
});

test("resuming a recorded session under another root rejects the previous project's memory", async ({
  createFixture,
  onTestFinished,
}) => {
  const first = await createFixture();
  await first.session.prompt("Original project source.");
  const file = first.session.sessionManager.getSessionFile();
  if (file === undefined) {
    throw new Error("Missing session file.");
  }
  const otherRoot = await mkdtemp(join(tmpdir(), "orbis-tiered-foreign-"));
  onTestFinished(async () => {
    await rm(otherRoot, { recursive: true, force: true });
  });
  const resumed = await createFixture({ cwd: otherRoot, sessionFile: file });
  await resumed.command("status");
  expect(resumed.report()).toContain(
    "Storage error: Session memory belongs to a different project root.",
  );
});

test("a Pi disk fork selects its parent revision and preserves it in a child commit", async ({
  createFixture,
}) => {
  const parent = await createFixture();
  await parent.session.prompt("Remember the parent state.");
  const { runtime } = await started(parent);
  const committed = await commitNote(parent, runtime, "Remember the parent state.", {
    "current-work.md": "Parent state\n",
  });
  const child = await forkOnDisk(parent, createFixture);
  const { runtime: childRuntime } = await started(child);
  expect(selected(childRuntime)).toMatchObject({ state: "selected", revisionId: committed });
  const childCommit = await commitNote(child, childRuntime, "Remember the parent state.", {
    "journey.md": "Child journey\n",
  });
  expect((await (await storeFor(child)).readRevision(childCommit))?.notes).toEqual({
    "current-work.md": "Parent state\n",
    "journey.md": "Child journey\n",
  });
});

test("a fork excludes its parent's externally edited note from a metadata-only child revision", async ({
  createFixture,
}) => {
  const parent = await createFixture();
  await parent.session.prompt("Parent procedure evidence.");
  const { runtime } = await started(parent);
  await commitNote(parent, runtime, "Parent procedure evidence.", {
    "current-work.md": "Generated parent\n",
  });
  const parentStore = await storeFor(parent);
  const parentNote = join(parentStore.sessionDir, "current", "current-work.md");
  await writeFile(parentNote, "User corrected parent\n");
  await parentStore.inspectCuration(null);
  const child = await forkOnDisk(parent, createFixture);
  const { runtime: childRuntime, ctx } = await started(child);
  expect(selected(childRuntime)).toMatchObject({ invalidReason: "curation" });
  const proposal = childRuntime.captureProposal(ctx, noteContent({}), []);
  expect(proposal.excludedInheritedNotes).toEqual(["current-work.md"]);
  const result = committedId(await childRuntime.commitProposal(ctx, proposal));
  expect((await (await storeFor(child)).readRevision(result))?.notes).toEqual({});
  expect(await readFile(parentNote, "utf8")).toBe("User corrected parent\n");
});

test("a fork keeps its parent's deletion exclusion across reencoded and new child evidence", async ({
  createFixture,
}) => {
  const parent = await createFixture();
  await parent.session.prompt("Parent deletion evidence.");
  const { runtime } = await started(parent);
  await commitNote(parent, runtime, "Parent deletion evidence.", {
    "current-work.md": "Generated parent\n",
  });
  const parentStore = await storeFor(parent);
  await rm(join(parentStore.sessionDir, "current", "current-work.md"));
  await parentStore.inspectCuration(null);
  const child = await forkOnDisk(parent, createFixture);
  const { runtime: childRuntime, ctx } = await started(child);
  committedId(
    await childRuntime.commitProposal(ctx, childRuntime.captureProposal(ctx, noteContent({}), [])),
  );
  const inherited = await sourceReference(child, "Parent deletion evidence.");
  expect(
    await childRuntime.commitProposal(
      ctx,
      childRuntime.captureProposal(ctx, noteContent({ "current-work.md": "Repeated\n" }), [
        inherited,
      ]),
    ),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  await child.session.prompt("New child evidence after deletion.");
  await childRuntime.start(ctx);
  const fresh = await commitNote(child, childRuntime, "New child evidence after deletion.", {
    "current-work.md": "New child note\n",
  });
  expect((await (await storeFor(child)).readRevision(fresh))?.notes["current-work.md"]).toBe(
    "New child note\n",
  );
});

test("captureProposal refuses while a reference is pending", async ({ createFixture }) => {
  const f = await createFixture();
  const { runtime, ctx } = await started(f);
  committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "A\n" }), []),
    ),
  );
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(
    "awaits its branch reference",
  );
});

test("captureProposal refuses while the selected revision is unavailable", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const store = await storeFor(f);
  f.session.sessionManager.appendCustomEntry(revisionEntry, {
    version: 1,
    projectId: store.projectId,
    sessionId: store.sessionId,
    revisionId: "missing-revision",
  });
  await f.session.prompt("Persist the reference.");
  const { runtime, ctx } = await started(f);
  expect(selected(runtime)).toMatchObject({ state: "unavailable" });
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow("unavailable");
});

test("a context edit between capture and commit conflicts on evidence", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("The setting is blue.");
  const { runtime, ctx } = await started(f);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Blue\n" }), [
    await sourceReference(f, "The setting is blue."),
  ]);
  f.session.sessionManager.appendContextEdit(sourceEntry(f, "The setting is blue.").id, {
    content: "The setting is green.",
  });
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
    kind: "conflict",
    reason: "evidence",
  });
});

test("commitProposal registers sources once and its validate callback writes nothing", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Stable evidence.");
  const { runtime, ctx } = await started(f);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
    await sourceReference(f, "Stable evidence."),
  ]);
  const register = vi.spyOn(SourceRegistry.prototype, "register");
  onTestFinished(() => {
    register.mockRestore();
  });
  committedId(await runtime.commitProposal(ctx, proposal));
  expect(register).toHaveBeenCalledTimes(1);
});

test("a proposal captured before a configuration change is rejected without invalidating committed notes", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Stable evidence.");
  const { runtime, ctx } = await started(f);
  await commitNote(f, runtime, "Stable evidence.", { "current-work.md": "Stable\n" });
  const stale = runtime.captureProposal(ctx, noteContent({ "journey.md": "Old model\n" }), [
    await sourceReference(f, "Stable evidence."),
  ]);
  const changed = { ...ctx, model: { ...fixtureModel, id: "another-model" } };
  await runtime.refreshRoles(changed);
  expect(await runtime.commitProposal(changed, stale)).toMatchObject({
    kind: "conflict",
    reason: "configuration",
  });
  expect(selected(runtime)).toMatchObject({ state: "selected", invalidNotes: [] });
});

test("an abort of ctx.signal during commit returns cancelled with that reason, never a conflict", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Cancelled evidence.");
  const { runtime, ctx } = await started(f);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "No\n" }), [
    await sourceReference(f, "Cancelled evidence."),
  ]);
  const controller = new AbortController();
  const reason = new Error("tool call cancelled");
  const register = vi
    .spyOn(SourceRegistry.prototype, "register")
    .mockImplementationOnce(async function (this: SourceRegistry, manager, times) {
      controller.abort(reason);
      return await this.register(manager, times);
    });
  onTestFinished(() => {
    register.mockRestore();
  });
  expect(await runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal)).toEqual({
    kind: "cancelled",
    reason,
  });
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});

test("an abort of the storage session during commit returns cancelled with its reason", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Replaced evidence.");
  const { runtime, ctx } = await started(f);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "No\n" }), [
    await sourceReference(f, "Replaced evidence."),
  ]);
  const register = vi
    .spyOn(SourceRegistry.prototype, "register")
    .mockImplementationOnce(async function (this: SourceRegistry, manager, times) {
      const records = await this.register(manager, times);
      runtime.stop();
      return records;
    });
  onTestFinished(() => {
    register.mockRestore();
  });
  const result = await runtime.commitProposal(ctx, proposal);
  expect(result.kind === "cancelled" ? result.reason : result).toBeInstanceOf(Error);
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});
