import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect, vi } from "vitest";

import { evidenceMatches } from "../src/domain/evidence.ts";
import { dependencyFingerprint } from "../src/domain/proposal.ts";
import type { MemoryProposal } from "../src/domain/proposal.ts";
import { refreshLineage, selectedAs } from "../src/pi/lineage.ts";
import type { LineageState, ProposalBinding, SelectedRevision } from "../src/pi/lineage.ts";
import {
  attachCommitted,
  captureProposal as captureStorageProposal,
  commitProposal as commitStorageProposal,
} from "../src/pi/proposals.ts";
import { blockingReferences, referencesIn } from "../src/pi/revision-references.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { buildStatus, renderStatus } from "../src/pi/status.ts";
import { projectEntrySchema, openStorageSession } from "../src/pi/storage-session.ts";
import { writeDurable } from "../src/storage/files.ts";
import { SourceRegistry } from "../src/storage/sources.ts";
import { fixtureModel } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import { storageRuntime } from "./storage-harness.mts";
import {
  baseProposal,
  blockedLine,
  committedId,
  customEntry,
  forkOnDisk,
  noteContent,
  openRegistry,
  referenceDroppingRuntime,
  rejectionPaths,
  revisionEntryType,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  test,
  unresolvedLine,
  validReferences,
} from "./store-fixture.mts";

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
    .filter((entry) => entry.type === "custom" && entry.customType === revisionEntryType).length;
}

const projectEntry = { version: 1, root: "/project", projectId: "a".repeat(64), sessionId: "s" };

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

const boundaryProject = "a".repeat(64);
const selectedData = { version: 1, projectId: boundaryProject, sessionId: "s", revisionId: "r0" };
const selectedR0 = selectedAs("r0", "s");

function damagedAt(id: string): SessionEntry {
  return customEntry(id, { ...selectedData, version: 2 });
}

test("blockingReferences returns no entries when every damaged reference precedes the last reference to the selected revision", () => {
  const branch = [damagedAt("d1"), customEntry("v1", selectedData)];
  expect(blockingReferences(branch, boundaryProject, selectedR0)).toEqual([]);
});

test("blockingReferences returns the damaged references after the last reference to the selected revision", () => {
  const branch = [
    damagedAt("d5"),
    customEntry("v1", selectedData),
    damagedAt("d9"),
    customEntry("v2", { ...selectedData, revisionId: "r1" }),
    damagedAt("d1"),
  ];
  expect(blockingReferences(branch, boundaryProject, selectedR0)).toEqual([
    { entryId: "d9", path: "/version" },
    { entryId: "d1", path: "/version" },
  ]);
});

test("blockingReferences returns every damaged reference when no reference matches the selected revision", () => {
  const branch = [damagedAt("d1"), customEntry("v1", { ...selectedData, sessionId: "other" })];
  expect(blockingReferences(branch, boundaryProject, selectedR0)).toEqual([
    { entryId: "d1", path: "/version" },
  ]);
});

test.for([
  { label: "none", selection: { state: "none" } },
  {
    label: "unavailable",
    selection: { state: "unavailable", revisionId: "r0", sessionId: "s", reason: "Missing." },
  },
] satisfies { label: string; selection: SelectedRevision }[])(
  "blockingReferences returns every damaged reference while the selection is $label",
  ({ selection }) => {
    const branch = [damagedAt("d9"), customEntry("v1", selectedData), damagedAt("d1")];
    expect(blockingReferences(branch, boundaryProject, selection)).toEqual([
      { entryId: "d9", path: "/version" },
      { entryId: "d1", path: "/version" },
    ]);
  },
);

test("blockingReferences keeps the damage blocking when a later valid reference to the selected session and revision names another project", () => {
  const branch = [
    customEntry("v1", selectedData),
    damagedAt("d1"),
    customEntry("v2", { ...selectedData, projectId: "b".repeat(64) }),
  ];
  expect(blockingReferences(branch, boundaryProject, selectedR0)).toEqual([
    { entryId: "d1", path: "/version" },
  ]);
});

test("captureProposal refuses when a later valid reference to the selected session and revision names another project", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Foreign boundary evidence.");
  const { manager, storage } = await openedStorage(f);
  const { projectId, sessionId } = storage.store;
  const data = { version: 1, projectId, sessionId, revisionId: "r0" };
  manager.appendCustomEntry(revisionEntryType, data);
  manager.appendCustomEntry(revisionEntryType, { ...data, version: 2 });
  const damagedId = manager.getLeafId();
  manager.appendCustomEntry(revisionEntryType, { ...data, projectId: "b".repeat(64) });
  const binding = storageBinding(
    { selected: selectedAs("r0", sessionId), pending: { state: "none" } },
    "d".repeat(64),
  );
  expect(() =>
    captureStorageProposal(storage, { sessionManager: manager }, binding, noteContent({}), []),
  ).toThrow(`entry ${String(damagedId)}`);
});

function storageBinding(lineage: LineageState, fingerprint: string | undefined) {
  return {
    configurationRevision: 1,
    dependencyFingerprint: fingerprint,
    lineage,
    latestRevision: null,
    reconciliation: "current" as const,
  };
}

async function openedStorage(f: Fixture) {
  const manager = f.session.sessionManager;
  const runtime = storageRuntime();
  const storage = await runtime.runPromise(
    openStorageSession({ cwd: f.cwd, sessionManager: manager }),
  );
  await runtime.runPromise(storage.sources.register(manager));
  return { manager, runtime, storage };
}

test.for([
  {
    label: "an unavailable selection",
    lineage: {
      selected: {
        state: "unavailable",
        revisionId: "r0",
        sessionId: "s",
        reason: "Selected revision r0 is unavailable.",
      },
      pending: { state: "none" },
    },
    fingerprint: "d".repeat(64),
  },
  {
    label: "a pending reference",
    lineage: { selected: { state: "none" }, pending: { state: "appended", revisionId: "r1" } },
    fingerprint: "d".repeat(64),
  },
  {
    label: "no current configuration",
    lineage: { selected: { state: "none" }, pending: { state: "none" } },
    fingerprint: undefined,
  },
] satisfies {
  label: string;
  lineage: LineageState;
  fingerprint: string | undefined;
}[])(
  "captureProposal with $label and a damaged reference names the blocking entry",
  async ({ lineage, fingerprint }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Ordered refusal evidence.");
    const { manager, storage } = await openedStorage(f);
    manager.appendCustomEntry(revisionEntryType, { junk: true });
    const damagedId = manager.getLeafId();
    expect(() =>
      captureStorageProposal(
        storage,
        { sessionManager: manager },
        storageBinding(lineage, fingerprint),
        noteContent({}),
        [],
      ),
    ).toThrow(`Memory lineage is ambiguous: damaged revision reference entry ${String(damagedId)}`);
  },
);

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
  expect(renderStatus(buildStatus(runtime, ctx)).split("\n")).toContain(
    `Memory commits: blocked until the branch reference to revision ${result} is saved in the session file. Pi saves a new session file after its first assistant response.`,
  );
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
  f.session.sessionManager.appendCustomEntry(revisionEntryType, {
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

async function expectUnresolvedEvidence(
  f: Fixture,
  runtime: MemoryRuntime,
  ctx: ExtensionContext,
  orphan: string,
): Promise<void> {
  const anchorId = String((await (await storeFor(f)).readRevision(orphan))?.anchorId);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(pending(runtime)).toEqual({
    state: "unresolved",
    revisionId: orphan,
    anchorId,
    reason: "evidence",
  });
  expect(references(f)).toBe(0);
  expect(renderStatus(buildStatus(runtime, ctx)).split("\n")).toContain(
    unresolvedLine(
      orphan,
      anchorId,
      "its evidence or curated notes changed after it was committed",
    ),
  );
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(
    `Memory revision ${orphan} is not recorded on this branch`,
  );
}

test("reconciliation leaves an orphan head unresolved for evidence when its evidence no longer matches, which status reports and capture refuses", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  const orphan = await orphanHead(f, runtime);
  f.session.sessionManager.appendContextEdit(sourceEntry(f, "Orphan evidence.").id, {
    content: "Edited evidence.",
  });
  await runtime.start(ctx);
  await expectUnresolvedEvidence(f, runtime, ctx, orphan);
});

test("reconciliation leaves an orphan head unresolved for evidence when its curation no longer matches, which status reports and capture refuses", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  const orphan = await orphanHead(f, runtime);
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "User edit\n");
  await runtime.start(ctx);
  await expectUnresolvedEvidence(f, runtime, ctx, orphan);
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

test("startup does not attach a revision already referenced on an abandoned branch, and an ordinary capture there commits", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Orphan evidence.");
  const { runtime, ctx } = await started(f);
  const anchor = f.session.sessionManager.getLeafId();
  const orphan = await orphanHead(f, runtime);
  const store = await storeFor(f);
  f.session.sessionManager.appendCustomEntry(revisionEntryType, {
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
  const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Here\n" }), [
    await sourceReference(f, "Orphan evidence."),
  ]);
  expect(proposal).toMatchObject({ baseRevision: null, expectedRevision: orphan });
  const committed = committedId(await runtime.commitProposal(ctx, proposal));
  expect((await store.readRevision(committed))?.notes).toEqual({ "journey.md": "Here\n" });
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
  f.session.sessionManager.appendCustomEntry(revisionEntryType, {
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

test("captureProposal stores a canonical reference for a registered bare entry id", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Bare entry evidence.");
  const { runtime, ctx } = await started(f);
  const entryId = sourceEntry(f, "Bare entry evidence.").id;
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
    entryId,
  ]);
  const registeredReference = await sourceReference(f, "Bare entry evidence.");
  expect(proposal.sourceIds).toEqual([registeredReference]);
  expect(proposal.noteDependencies["current-work.md"]?.sourceIds).toEqual([registeredReference]);
});

test.for(["waiting for lock", "before head publication"] as const)(
  "a context edit $0 rejects a pending proposal without another source registration",
  async (stage, { createFixture, onTestFinished }) => {
    const f = await createFixture();
    await f.session.prompt("Captured evidence.");
    const manager = f.session.sessionManager;
    let armed = false;
    let edited = false;
    const runtime = storageRuntime({
      write: async (path, content) => {
        await writeDurable(path, content);
        const timing =
          stage === "waiting for lock"
            ? path.includes(`${sep}private${sep}`)
            : path.includes(`${sep}revisions${sep}`);
        if (armed && !edited && timing) {
          edited = true;
          f.session.sessionManager.appendContextEdit(sourceEntry(f, "Captured evidence.").id, {
            content: "Replacement evidence.",
          });
        }
      },
    });
    const storage = await runtime.runPromise(
      openStorageSession({ cwd: f.cwd, sessionManager: manager }),
    );
    await runtime.runPromise(storage.sources.register(manager));
    const binding = {
      configurationRevision: 1,
      dependencyFingerprint: "d".repeat(64),
      lineage: { selected: { state: "none" as const }, pending: { state: "none" as const } },
      latestRevision: null,
      reconciliation: "current" as const,
    };
    const proposal = captureStorageProposal(
      storage,
      { sessionManager: manager },
      binding,
      noteContent({ "current-work.md": "Old\n" }),
      [await sourceReference(f, "Captured evidence.")],
    );
    const register = vi.spyOn(SourceRegistry.prototype, "register");
    onTestFinished(() => {
      register.mockRestore();
    });
    armed = true;
    const result = await runtime.runPromise(
      commitStorageProposal(
        storage,
        { sessionManager: manager },
        () => binding,
        proposal,
        () => undefined,
      ),
    );
    expect(result).toMatchObject({ kind: "conflict", reason: "evidence" });
    expect(edited).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(await runtime.runPromise(storage.store.currentHead())).toBeNull();
  },
);

test("a configuration change during the final source check rejects the proposal", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Stable evidence.");
  const manager = f.session.sessionManager;
  const runtime = storageRuntime();
  const storage = await runtime.runPromise(
    openStorageSession({ cwd: f.cwd, sessionManager: manager }),
  );
  await runtime.runPromise(storage.sources.register(manager));
  let binding = {
    configurationRevision: 1,
    dependencyFingerprint: "d".repeat(64),
    lineage: { selected: { state: "none" as const }, pending: { state: "none" as const } },
    latestRevision: null,
    reconciliation: "current" as const,
  };
  const proposal = captureStorageProposal(
    storage,
    { sessionManager: manager },
    binding,
    noteContent({ "current-work.md": "Old\n" }),
    [await sourceReference(f, "Stable evidence.")],
  );
  const project = storage.sources.current.bind(storage.sources);
  let checks = 0;
  storage.sources.current = (session) =>
    project(session).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          checks++;
          if (checks === 2) {
            binding = { ...binding, configurationRevision: 2 };
          }
        }),
      ),
    );
  const result = await runtime.runPromise(
    commitStorageProposal(
      storage,
      { sessionManager: manager },
      () => binding,
      proposal,
      () => undefined,
    ),
  );
  expect(result).toMatchObject({ kind: "conflict", reason: "configuration" });
  expect(checks).toBe(2);
  expect(await runtime.runPromise(storage.store.currentHead())).toBeNull();
});

const chainEvidence = "Chain evidence.";

interface Chain {
  revisions: string[];
  references: string[];
}

async function commitChain(f: Fixture, views: readonly string[]): Promise<Chain> {
  await f.session.prompt(chainEvidence);
  const { runtime } = await started(f);
  const chain: Chain = { revisions: [], references: [] };
  for (const view of views) {
    // oxlint-disable-next-line no-await-in-loop -- Each revision builds on the previous head.
    chain.revisions.push(await commitNote(f, runtime, chainEvidence, { "current-work.md": view }));
    chain.references.push(leafOf(f));
  }
  return chain;
}

function leafOf(f: Fixture): string {
  const leaf = f.session.sessionManager.getLeafId();
  if (leaf === null) {
    throw new Error("Missing leaf.");
  }
  return leaf;
}

function sessionFileOf(f: Fixture): string {
  const file = f.session.sessionManager.getSessionFile();
  if (file === undefined) {
    throw new Error("Missing session file.");
  }
  return file;
}

async function sessionLine(file: string, entryId: string): Promise<string | undefined> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .find((line) => line.includes(`"id":"${entryId}"`));
}

async function damageReferences(f: Fixture, revisionIds: readonly string[]): Promise<string[]> {
  const file = sessionFileOf(f);
  const text = await readFile(file, "utf8");
  const damaged = parseSessionEntries(text).flatMap((entry) =>
    entry.type === "custom" &&
    entry.customType === revisionEntryType &&
    typeof entry.data === "object" &&
    entry.data !== null &&
    "revisionId" in entry.data &&
    typeof entry.data.revisionId === "string" &&
    revisionIds.includes(entry.data.revisionId)
      ? [entry.id]
      : [],
  );
  const lines = text
    .split("\n")
    .map((line) =>
      damaged.some((id) => line.includes(`"id":"${id}"`))
        ? line.replace('"version":1', '"version":2')
        : line,
    );
  await writeFile(file, lines.join("\n"));
  return damaged;
}

async function reopen(
  f: Fixture,
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options: FixtureOptions = {},
): Promise<Fixture> {
  return await createFixture({ ...options, cwd: f.cwd, sessionFile: sessionFileOf(f) });
}

async function viewOf(f: Fixture): Promise<string> {
  return await readFile(join((await storeFor(f)).sessionDir, "current", "current-work.md"), "utf8");
}

test.for([
  { label: "lineage and evidence", configurationChanges: false, expected: "lineage" },
  { label: "configuration and lineage", configurationChanges: true, expected: "configuration" },
] as const)(
  "a commit whose $label checks both fail returns $expected",
  async ({ configurationChanges, expected }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Ranked evidence.");
    const { manager, runtime, storage } = await openedStorage(f);
    let binding = storageBinding(
      { selected: { state: "none" }, pending: { state: "none" } },
      "d".repeat(64),
    );
    const proposal = captureStorageProposal(
      storage,
      { sessionManager: manager },
      binding,
      noteContent({ "current-work.md": "Ranked\n" }),
      [await sourceReference(f, "Ranked evidence.")],
    );
    manager.appendCustomEntry(revisionEntryType, { junk: true });
    if (configurationChanges) {
      binding = { ...binding, configurationRevision: 2 };
    } else {
      manager.appendContextEdit(sourceEntry(f, "Ranked evidence.").id, {
        content: "Edited evidence.",
      });
    }
    const result = await runtime.runPromise(
      commitStorageProposal(
        storage,
        { sessionManager: manager },
        () => binding,
        proposal,
        () => undefined,
      ),
    );
    expect(result).toMatchObject({ kind: "conflict", reason: expected });
    expect(await runtime.runPromise(storage.store.currentHead())).toBeNull();
  },
);

test("damaging the two newest references selects the oldest revision with uncertain validity, refuses capture naming the first damaged entry, and keeps the head and its views until navigation before the damage", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const chain = await commitChain(f, ["R0\n", "R1\n", "R2\n"]);
  const [first] = await damageReferences(f, chain.revisions.slice(1));
  const g = await reopen(f, createFixture);
  const { runtime, ctx } = await started(g);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: chain.revisions[0] });
  expect(renderStatus(buildStatus(runtime, ctx)).split("\n")).toContain(
    "Selected memory validity: uncertain: damaged revision references follow the selected revision",
  );
  expect(() =>
    runtime.captureProposal(ctx, noteContent({ "current-work.md": "Rollback\n" }), []),
  ).toThrow(`entry ${String(first)}`);
  expect(await (await storeFor(g)).currentHead()).toBe(chain.revisions[2]);
  expect(await viewOf(g)).toBe("R2\n");
  await g.session.navigateTree(String(chain.references[0]), { summarize: false });
  await runtime.selectBranch(ctx);
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).not.toThrow();
}, 20_000);

test("a proposal captured before tree navigation onto damaged references keeps its anchor, configuration, and evidence and returns a lineage conflict that keeps the head and its views", async ({
  createFixture,
}) => {
  const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
  const chain = await commitChain(f, ["R0\n", "R1\n", "R2\n"]);
  await damageReferences(f, chain.revisions.slice(1));
  await writeFile(join(f.cwd, ".pi", "tiered-memory", "settings.json"), "{not json");
  const g = await reopen(f, createFixture);
  const damagedLeaf = leafOf(g);
  g.session.sessionManager.branch(String(chain.references[0]));
  const { runtime, ctx } = await started(g);
  expect(runtime.snapshot.error).toContain("Invalid JSON");
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Rollback\n" }), [
    await sourceReference(g, chainEvidence),
  ]);
  g.session.sessionManager.branch(damagedLeaf);
  await runtime.selectBranch(ctx);
  await expectRetainedDependencies(g, runtime, proposal);
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
    kind: "conflict",
    reason: "lineage",
  });
  expect(await (await storeFor(g)).currentHead()).toBe(chain.revisions[2]);
  expect(await viewOf(g)).toBe("R2\n");
}, 20_000);

async function expectRetainedDependencies(
  g: Fixture,
  runtime: MemoryRuntime,
  proposal: MemoryProposal,
): Promise<void> {
  const { configuration, roles, configurationRevision } = runtime.snapshot;
  const store = await storeFor(g);
  const current = await (await openRegistry(store)).current(g.session.sessionManager);
  expect(g.session.sessionManager.getBranch().some((entry) => entry.id === proposal.anchorId)).toBe(
    true,
  );
  expect(configurationRevision).toBe(proposal.configurationRevision);
  expect(
    configuration === undefined
      ? undefined
      : dependencyFingerprint({
          settings: configuration.settings,
          roles,
          projectRoot: store.projectRoot,
        }),
  ).toBe(proposal.dependencyFingerprint);
  expect(evidenceMatches(current, proposal, store.projectId)).toBe(true);
}

async function reopenWithFailedSettings(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
): Promise<{ g: Fixture; chain: Chain }> {
  const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
  const chain = await commitChain(f, ["R0\n", "R1\n", "R2\n"]);
  await writeFile(join(f.cwd, ".pi", "tiered-memory", "settings.json"), "{not json");
  return { g: await reopen(f, createFixture), chain };
}

test("a proposal captured on an older revision before tree navigation onto the head's reference keeps its anchor, configuration, and evidence and returns a lineage conflict that keeps the head and its views", async ({
  createFixture,
}) => {
  const { g, chain } = await reopenWithFailedSettings(createFixture);
  const [oldest, , head] = chain.revisions;
  g.session.sessionManager.branch(String(chain.references[0]));
  const { runtime, ctx } = await started(g);
  expect(runtime.snapshot.error).toContain("Invalid JSON");
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: oldest });
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Rollback\n" }), [
    await sourceReference(g, chainEvidence),
  ]);
  expect(proposal).toMatchObject({
    baseRevision: { revisionId: oldest },
    expectedRevision: head,
  });
  g.session.sessionManager.branch(String(chain.references[2]));
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: head });
  await expectRetainedDependencies(g, runtime, proposal);
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
    kind: "conflict",
    reason: "lineage",
  });
  expect(await (await storeFor(g)).currentHead()).toBe(head);
  expect(await viewOf(g)).toBe("R2\n");
}, 20_000);

test.for([
  { label: "file is missing, which makes the selection unavailable", removeRevision: true },
  { label: "file is intact, which selects it", removeRevision: false },
])(
  "a proposal with no base captured before every revision reference returns a lineage conflict after navigation onto a reference whose revision $label, adopts no orphan head, and keeps the head and its views",
  { timeout: 20_000 },
  async ({ removeRevision }, { createFixture }) => {
    const { g, chain } = await reopenWithFailedSettings(createFixture);
    const [, navigated, head] = chain.revisions;
    const manager = g.session.sessionManager;
    const beforeReferences = manager.getEntry(String(chain.references[0]))?.parentId;
    if (beforeReferences === undefined || beforeReferences === null) {
      throw new Error("Missing entry before the first reference.");
    }
    manager.branch(beforeReferences);
    const { runtime, ctx } = await started(g);
    expect(runtime.snapshot.error).toContain("Invalid JSON");
    expect(selected(runtime)).toEqual({ state: "none" });
    const proposal = runtime.captureProposal(
      ctx,
      noteContent({ "current-work.md": "Rollback\n" }),
      [await sourceReference(g, chainEvidence)],
    );
    expect(proposal).toMatchObject({ baseRevision: null, expectedRevision: head });
    const store = await storeFor(g);
    if (removeRevision) {
      await rm(join(store.sessionDir, "revisions", `${String(navigated)}.json`));
    }
    manager.branch(String(chain.references[1]));
    await runtime.selectBranch(ctx);
    expect(selected(runtime)).toMatchObject(
      removeRevision ? { state: "unavailable" } : { state: "selected", revisionId: navigated },
    );
    expect(pending(runtime)).toEqual({ state: "none" });
    expect(storageOf(runtime).latestRevision).toBe(head);
    expect(references(g)).toBe(3);
    await expectRetainedDependencies(g, runtime, proposal);
    expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
      kind: "conflict",
      reason: "lineage",
    });
    expect(references(g)).toBe(3);
    expect(await store.currentHead()).toBe(head);
    expect(await viewOf(g)).toBe("R2\n");
  },
);

test("a proposal with no base captured before the reference of a head that awaits its deferred session file returns a lineage conflict after navigation back onto that reference and keeps the head and its view", async ({
  createFixture,
}) => {
  const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
  const { runtime, ctx } = await started(f);
  const head = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "H1\n" }), []),
    ),
  );
  const manager = f.session.sessionManager;
  const reference = leafOf(f);
  const beforeReference = manager.getEntry(reference)?.parentId;
  if (beforeReference === undefined || beforeReference === null) {
    throw new Error("Missing entry before the head reference.");
  }
  await writeFile(join(f.cwd, ".pi", "tiered-memory", "settings.json"), "{not json");
  manager.branch(beforeReference);
  await runtime.start(ctx);
  expect(runtime.snapshot.error).toContain("Invalid JSON");
  expect(storageOf(runtime).lineage).toEqual({
    selected: { state: "none" },
    pending: { state: "none" },
  });
  const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Journey\n" }), []);
  expect(proposal).toMatchObject({ baseRevision: null, expectedRevision: head });
  manager.branch(reference);
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toEqual({ state: "none" });
  expect(pending(runtime)).toEqual({ state: "appended", revisionId: head });
  expect(storageOf(runtime).latestRevision).toBe(head);
  await expectRetainedDependencies(f, runtime, proposal);
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
    kind: "conflict",
    reason: "lineage",
  });
  const store = await storeFor(f);
  expect(await store.currentHead()).toBe(head);
  expect(await viewOf(f)).toBe("H1\n");
}, 20_000);

test("a proposal captured before later turns commits after tree navigation from the last turn back to an earlier one that keeps the selected revision", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt(chainEvidence);
  const { runtime, ctx } = await started(f);
  const base = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: base });
  const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Journey\n" }), [
    await sourceReference(f, chainEvidence),
  ]);
  await f.session.prompt("Turn B.");
  await f.session.prompt("Turn C.");
  f.session.sessionManager.branch(sourceEntry(f, "Turn B.").id);
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: base });
  await expectRetainedDependencies(f, runtime, proposal);
  const revisionId = committedId(await runtime.commitProposal(ctx, proposal));
  expect(await (await storeFor(f)).readRevision(revisionId)).toMatchObject({
    baseRevision: { revisionId: base },
    notes: { "current-work.md": "R0\n", "journey.md": "Journey\n" },
  });
}, 20_000);

test.for([
  { stage: "before the commit starts", armOnRevisionWrite: false, revisionFiles: 1 },
  { stage: "during the final evidence read", armOnRevisionWrite: true, revisionFiles: 2 },
])(
  "a malformed reference appended $stage returns a lineage conflict and keeps the head and its views",
  async ({ armOnRevisionWrite, revisionFiles }, { createFixture, onTestFinished }) => {
    const f = await createFixture();
    const [head] = (await commitChain(f, ["R0\n"])).revisions;
    let armed = false;
    const runtime = runtimeFor(f, {
      write: async (path, contents) => {
        await writeDurable(path, contents);
        if (armOnRevisionWrite && path.includes(`${sep}revisions${sep}`)) {
          armed = true;
        }
      },
    });
    const ctx = f.session.extensionRunner.createContext();
    await runtime.start(ctx);
    const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Late\n" }), [
      await sourceReference(f, chainEvidence),
    ]);
    const appendMalformed = () => {
      f.session.sessionManager.appendCustomEntry(revisionEntryType, { junk: true });
    };
    // oxlint-disable-next-line typescript/unbound-method -- The spy calls the original with its SourceRegistry receiver.
    const project = SourceRegistry.prototype.current;
    const current = vi.spyOn(SourceRegistry.prototype, "current").mockImplementation(function (
      this: SourceRegistry,
      manager,
    ) {
      return project.call(this, manager).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (armed) {
              armed = false;
              appendMalformed();
            }
          }),
        ),
      );
    });
    onTestFinished(() => {
      current.mockRestore();
    });
    if (!armOnRevisionWrite) {
      appendMalformed();
    }
    expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
      kind: "conflict",
      reason: "lineage",
    });
    const store = await storeFor(f);
    expect(await readdir(join(store.sessionDir, "revisions"))).toHaveLength(revisionFiles);
    expect(await store.currentHead()).toBe(head);
    expect(await viewOf(f)).toBe("R0\n");
  },
);

test("reconciliation after a damaged reference appends one valid reference to the head, selects it, unblocks commits, and keeps the damaged line byte-identical", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const chain = await commitChain(f, ["R0\n", "R1\n"]);
  const [damaged] = await damageReferences(f, [String(chain.revisions[1])]);
  const line = await sessionLine(sessionFileOf(f), String(damaged));
  const g = await reopen(f, createFixture);
  const { runtime, ctx } = await started(g);
  const store = await storeFor(g);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: chain.revisions[1] });
  expect(references(g)).toBe(3);
  expect(
    referencesIn(g.session.sessionManager.getEntries(), store.projectId).map(
      (reference) => reference.revisionId,
    ),
  ).toEqual(chain.revisions);
  committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "R2\n" }), []),
    ),
  );
  expect(await sessionLine(sessionFileOf(g), String(damaged))).toBe(line);
}, 20_000);

test("a configuration change keeps commits blocked after a damaged reference, keeps its bytes, and reports the navigation guidance", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const chain = await commitChain(f, ["R0\n", "R1\n"]);
  const [damaged] = await damageReferences(f, [String(chain.revisions[1])]);
  const line = await sessionLine(sessionFileOf(f), String(damaged));
  const g = await reopen(f, createFixture, { project: { limits: { queuedJobs: 3 } } });
  const { runtime, ctx } = await started(g);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: chain.revisions[0] });
  expect(renderStatus(buildStatus(runtime, ctx)).split("\n")).toContain(
    blockedLine(String(damaged)),
  );
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(
    `entry ${String(damaged)}`,
  );
  expect(references(g)).toBe(2);
  expect(await sessionLine(sessionFileOf(g), String(damaged))).toBe(line);
}, 20_000);

test("a fork ignores a damaged reference before the parent reference it selects and blocks capture on one after it", async ({
  createFixture,
}) => {
  const parent = await createFixture();
  const chain = await commitChain(parent, ["A\n", "R0\n"]);
  const [damaged] = await damageReferences(parent, [String(chain.revisions[0])]);
  const child = await forkOnDisk(parent, createFixture);
  const { runtime, ctx } = await started(child);
  expect(buildStatus(runtime, ctx).damagedReferences).toEqual([
    { entryId: damaged, path: "/version" },
  ]);
  expect(selected(runtime)).toMatchObject({
    state: "selected",
    revisionId: chain.revisions[1],
    sessionId: parent.session.sessionManager.getSessionId(),
  });
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).not.toThrow();
  child.session.sessionManager.appendCustomEntry(revisionEntryType, { junk: true });
  const junk = leafOf(child);
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(`entry ${junk}`);
}, 20_000);

test("a junk revision entry after the selected reference is listed at /version, keeps the selection, blocks capture, and keeps its session-file line byte-identical", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const [head] = (await commitChain(f, ["R0\n"])).revisions;
  f.session.sessionManager.appendCustomEntry(revisionEntryType, { junk: true });
  const junk = leafOf(f);
  const line = await sessionLine(sessionFileOf(f), junk);
  const { runtime, ctx } = await started(f);
  expect(buildStatus(runtime, ctx).damagedReferences).toEqual([
    { entryId: junk, path: "/version" },
  ]);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: head });
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(`entry ${junk}`);
  expect(line).toContain('"junk":true');
  expect(await sessionLine(sessionFileOf(f), junk)).toBe(line);
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
  const register = vi.spyOn(SourceRegistry.prototype, "register").mockImplementationOnce(function (
    this: SourceRegistry,
    manager,
    times,
    onRegistered,
  ) {
    controller.abort(reason);
    return this.register(manager, times, onRegistered);
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

test("shutdown right after a commit's source registration returns cancelled with the shutdown reason instead of rejecting", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Replaced evidence.");
  const { runtime, ctx } = await started(f);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "No\n" }), [
    await sourceReference(f, "Replaced evidence."),
  ]);
  // oxlint-disable-next-line typescript/unbound-method -- The spy calls the original with its SourceRegistry receiver.
  const register = SourceRegistry.prototype.register;
  let shutdown: Promise<void> | undefined;
  const spy = vi.spyOn(SourceRegistry.prototype, "register").mockImplementationOnce(function (
    this: SourceRegistry,
    manager,
    times,
    onRegistered,
  ) {
    return register.call(this, manager, times, onRegistered).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          shutdown = runtime.shutdown();
        }),
      ),
    );
  });
  onTestFinished(() => {
    spy.mockRestore();
  });
  const result = await runtime.commitProposal(ctx, proposal);
  await shutdown;
  expect(shutdown).toBeDefined();
  expect(result.kind).toBe("cancelled");
  const reason = result.kind === "cancelled" ? result.reason : undefined;
  expect(reason).toBeInstanceOf(Error);
  expect(reason instanceof Error && reason.message).toBe(
    "Tiered memory storage stopped for a session change or shutdown.",
  );
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});

const orphanVariants = ["lost", "damaged"] as const;

function unavailableLine(entryId: string): string {
  return `Memory commits: blocked because the selected revision is unavailable. Navigate with /tree to a point before entry ${entryId} to continue memory work without it.`;
}

type OrphanVariant = (typeof orphanVariants)[number];

const leafMarkerType = "orbis-tiered-memory-test-leaf";

function parentOf(f: Fixture, entryId: string): string {
  const parent = f.session.sessionManager.getEntry(entryId)?.parentId;
  if (parent === undefined || parent === null) {
    throw new Error(`Missing parent of entry ${entryId}.`);
  }
  return parent;
}

function settingsPath(f: Fixture): string {
  return join(f.cwd, ".pi", "tiered-memory", "settings.json");
}

async function sessionLines(
  file: string,
  entryIds: readonly string[],
): Promise<(string | undefined)[]> {
  return await Promise.all(entryIds.map(async (entryId) => await sessionLine(file, entryId)));
}

interface NullBaseSibling {
  older: string;
  olderReference: string;
  orphan: string;
  anchor: string;
  beforeAnchor: string;
}

async function commitNullBaseSibling(
  f: Fixture,
  variant: OrphanVariant,
  removeOlder: boolean,
): Promise<NullBaseSibling> {
  await f.session.prompt(chainEvidence);
  const { runtime, dropNextReference } = referenceDroppingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  await f.session.prompt("A turn before the first revision.");
  const older = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
  const olderReference = leafOf(f);
  const anchor = parentOf(f, olderReference);
  await writeFile(settingsPath(f), "{not json");
  f.session.sessionManager.branch(anchor);
  await runtime.start(ctx);
  expect(runtime.snapshot.error).toContain("Invalid JSON");
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "none" } },
    latestRevision: older,
  });
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "H\n" }), [
    await sourceReference(f, chainEvidence),
  ]);
  expect(proposal).toMatchObject({ baseRevision: null, expectedRevision: older, anchorId: anchor });
  if (variant === "lost") {
    dropNextReference();
  }
  const orphan = committedId(await runtime.commitProposal(ctx, proposal));
  f.session.sessionManager.branch(olderReference);
  // The reopened session starts at the last entry, where the shipped extension reconciles first.
  f.session.sessionManager.appendCustomEntry(leafMarkerType, {});
  if (variant === "damaged") {
    await damageReferences(f, [orphan]);
  }
  if (removeOlder) {
    const store = await storeFor(f);
    await rm(join(store.sessionDir, "revisions", `${older}.json`));
  }
  return { older, olderReference, orphan, anchor, beforeAnchor: parentOf(f, anchor) };
}

test.for(orphanVariants)(
  "a null-base sibling head whose reference is $0 does not attach over an unavailable selection, which keeps the unavailable diagnostic, the head and its notes, refuses capture, and returns a lineage conflict for a retained proposal",
  { timeout: 20_000 },
  async (variant, { createFixture }) => {
    const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
    const { older, olderReference, orphan, anchor, beforeAnchor } = await commitNullBaseSibling(
      f,
      variant,
      true,
    );
    const g = await reopen(f, createFixture);
    const { runtime, ctx } = await started(g);
    const store = await storeFor(g);
    expect(selected(runtime)).toMatchObject({ state: "unavailable" });
    expect(storageOf(runtime).latestRevision).toBe(orphan);
    expect(validReferences(g, store.projectId)).toEqual([older]);
    const lines = renderStatus(buildStatus(runtime, ctx)).split("\n");
    expect(lines).toContain(
      `Selected memory revision: unavailable (Selected revision ${older} is unavailable.)`,
    );
    expect(lines).toContain(`Latest durable revision: ${orphan}`);
    expect(lines).toContain(unavailableLine(olderReference));
    expect(lines.some((line) => line.startsWith("Selected memory validity:"))).toBe(false);
    expect(lines).toContain(
      unresolvedLine(
        orphan,
        anchor,
        "its lineage from the selected revision cannot be established",
      ),
    );
    expect(() => runtime.captureProposal(ctx, noteContent({ "journey.md": "Next\n" }), [])).toThrow(
      `Memory revision ${orphan} is not recorded on this branch`,
    );
    const destination = leafOf(g);
    g.session.sessionManager.branch(beforeAnchor);
    await runtime.start(ctx);
    const retained = runtime.captureProposal(ctx, noteContent({ "journey.md": "Retained\n" }), [
      await sourceReference(g, chainEvidence),
    ]);
    expect(retained).toMatchObject({ baseRevision: null, expectedRevision: orphan });
    g.session.sessionManager.branch(destination);
    await runtime.start(ctx);
    expect(await runtime.commitProposal(ctx, retained)).toMatchObject({
      kind: "conflict",
      reason: "lineage",
    });
    expect(selected(runtime)).toMatchObject({ state: "unavailable" });
    expect(validReferences(g, store.projectId)).toEqual([older]);
    expect(await store.currentHead()).toBe(orphan);
    expect((await store.readRevision(orphan))?.notes).toEqual({ "current-work.md": "H\n" });
    expect(await viewOf(g)).toBe("H\n");
  },
);

test.for(orphanVariants)(
  "a null-base sibling head whose reference is $0 does not attach over an intact selection, which stays selected and accepts a capture that expects the head",
  { timeout: 20_000 },
  async (variant, { createFixture }) => {
    const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
    const { older, orphan } = await commitNullBaseSibling(f, variant, false);
    const g = await reopen(f, createFixture);
    const { runtime, ctx } = await started(g);
    const store = await storeFor(g);
    expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: older });
    expect(storageOf(runtime).latestRevision).toBe(orphan);
    expect(validReferences(g, store.projectId)).toEqual([older]);
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Next\n" }), [
      await sourceReference(g, chainEvidence),
    ]);
    expect(proposal).toMatchObject({
      baseRevision: { revisionId: older },
      expectedRevision: orphan,
    });
    const committed = committedId(await runtime.commitProposal(ctx, proposal));
    expect((await store.readRevision(committed))?.notes).toEqual({
      "current-work.md": "R0\n",
      "journey.md": "Next\n",
    });
  },
);

interface SiblingAfterHistory {
  chain: Chain;
  orphan: string;
  damagedIds: [string, string];
  damagedLines: (string | undefined)[];
}

async function commitSiblingAfterHistory(
  f: Fixture,
  variant: OrphanVariant,
): Promise<SiblingAfterHistory> {
  const chain = await commitChain(f, ["R0\n", "R1\n", "R2\n"]);
  const [r0, r1, r2] = chain.revisions;
  const [r0Reference, r1Reference, r2Reference] = chain.references;
  if (
    r0 === undefined ||
    r1 === undefined ||
    r2 === undefined ||
    r0Reference === undefined ||
    r1Reference === undefined ||
    r2Reference === undefined
  ) {
    throw new Error("Missing chain revision.");
  }
  await writeFile(settingsPath(f), "{not json");
  const { runtime, dropNextReference } = referenceDroppingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  f.session.sessionManager.branch(r0Reference);
  await runtime.start(ctx);
  expect(runtime.snapshot.error).toContain("Invalid JSON");
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: r0 });
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "H\n" }), [
    await sourceReference(f, chainEvidence),
  ]);
  expect(proposal).toMatchObject({
    baseRevision: { revisionId: r0 },
    expectedRevision: r2,
    anchorId: r0Reference,
  });
  if (variant === "lost") {
    dropNextReference();
  }
  const orphan = committedId(await runtime.commitProposal(ctx, proposal));
  f.session.sessionManager.branch(r2Reference);
  // The reopened session starts at the last entry, where the shipped extension reconciles first.
  f.session.sessionManager.appendCustomEntry(leafMarkerType, {});
  await damageReferences(f, variant === "lost" ? [r1, r2] : [r1, r2, orphan]);
  const damagedIds: [string, string] = [r1Reference, r2Reference];
  return {
    chain,
    orphan,
    damagedIds,
    damagedLines: await sessionLines(sessionFileOf(f), damagedIds),
  };
}

test.for(orphanVariants)(
  "a sibling head based on R0 whose reference is $0 does not attach after damaged R1 and R2 references, which keep blocking commits with their bytes, revisions, and notes, and a retained proposal returns a lineage conflict",
  { timeout: 30_000 },
  async (variant, { createFixture }) => {
    const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
    const { chain, orphan, damagedIds, damagedLines } = await commitSiblingAfterHistory(f, variant);
    const [r0, r1, r2] = chain.revisions;
    const [r1Reference, r2Reference] = damagedIds;
    const g = await reopen(f, createFixture);
    const { runtime, ctx } = await started(g);
    const store = await storeFor(g);
    expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: r0 });
    expect(storageOf(runtime).latestRevision).toBe(orphan);
    expect(validReferences(g, store.projectId)).toEqual([r0]);
    const status = buildStatus(runtime, ctx);
    expect(status.damagedReferences).toEqual([
      { entryId: r1Reference, path: "/version" },
      { entryId: r2Reference, path: "/version" },
    ]);
    expect(status.storage).toMatchObject({
      blockingReference: { entryId: r1Reference, path: "/version" },
    });
    const lines = renderStatus(status).split("\n");
    expect(lines).toContain(blockedLine(r1Reference));
    expect(lines).toContain(
      "Selected memory validity: uncertain: damaged revision references follow the selected revision",
    );
    expect(lines).toContain(
      unresolvedLine(
        orphan,
        String(chain.references[0]),
        "its lineage from the selected revision cannot be established",
      ),
    );
    expect(() => runtime.captureProposal(ctx, noteContent({ "journey.md": "Next\n" }), [])).toThrow(
      `entry ${r1Reference}`,
    );
    const destination = leafOf(g);
    g.session.sessionManager.branch(parentOf(g, String(chain.references[0])));
    await runtime.start(ctx);
    const retained = runtime.captureProposal(ctx, noteContent({ "journey.md": "Retained\n" }), [
      await sourceReference(g, chainEvidence),
    ]);
    expect(retained).toMatchObject({ baseRevision: null, expectedRevision: orphan });
    g.session.sessionManager.branch(destination);
    await runtime.start(ctx);
    expect(await runtime.commitProposal(ctx, retained)).toMatchObject({
      kind: "conflict",
      reason: "lineage",
    });
    expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: r0 });
    expect(validReferences(g, store.projectId)).toEqual([r0]);
    expect(await sessionLines(sessionFileOf(g), damagedIds)).toEqual(damagedLines);
    expect(await store.currentHead()).toBe(orphan);
    expect((await store.readRevision(String(r1)))?.notes).toEqual({ "current-work.md": "R1\n" });
    expect((await store.readRevision(String(r2)))?.notes).toEqual({ "current-work.md": "R2\n" });
    expect((await store.readRevision(orphan))?.notes).toEqual({ "current-work.md": "H\n" });
    expect(await viewOf(g)).toBe("H\n");
  },
);

test.for(orphanVariants)(
  "a head based on and published after R0 whose own reference is $0 attaches, clears the commit block, and becomes the next capture's base",
  { timeout: 20_000 },
  async (variant, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt(chainEvidence);
    const { runtime, dropNextReference } = referenceDroppingRuntime(f);
    await runtime.start(f.session.extensionRunner.createContext());
    const r0 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
    if (variant === "lost") {
      dropNextReference();
    }
    const r1 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R1\n" });
    const damaged = variant === "damaged" ? await damageReferences(f, [r1]) : [];
    const damagedLines = await sessionLines(sessionFileOf(f), damaged);
    const g = await reopen(f, createFixture);
    const { runtime: recovered, ctx } = await started(g);
    const store = await storeFor(g);
    expect(selected(recovered)).toMatchObject({ state: "selected", revisionId: r1 });
    expect(validReferences(g, store.projectId)).toEqual([r0, r1]);
    expect(buildStatus(recovered, ctx).storage).toMatchObject({ blockingReference: undefined });
    expect(await sessionLines(sessionFileOf(g), damaged)).toEqual(damagedLines);
    expect(
      recovered.captureProposal(ctx, noteContent({ "journey.md": "Next\n" }), [
        await sourceReference(g, chainEvidence),
      ]),
    ).toMatchObject({ baseRevision: { revisionId: r1 }, expectedRevision: r1 });
  },
);

async function droppingRuntime(f: Fixture): Promise<{
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  dropNextReference: () => void;
}> {
  const { runtime, dropNextReference } = referenceDroppingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  return { runtime, ctx, dropNextReference };
}

test.for([
  { label: "two damaged references to the head", duplicate: true },
  { label: "two junk entries after its lost reference", duplicate: false },
])(
  "a head based on and published after R0 stays unresolved behind $label, which stay listed with their bytes and keep blocking capture",
  { timeout: 20_000 },
  async ({ duplicate }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt(chainEvidence);
    const { runtime, dropNextReference } = await droppingRuntime(f);
    const r0 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
    const anchor = leafOf(f);
    const store = await storeFor(f);
    let damaged: string[];
    let head: string;
    if (duplicate) {
      head = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R1\n" });
      f.session.sessionManager.appendCustomEntry(revisionEntryType, {
        version: 1,
        projectId: store.projectId,
        sessionId: store.sessionId,
        revisionId: head,
      });
      damaged = await damageReferences(f, [head]);
    } else {
      dropNextReference();
      head = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R1\n" });
      f.session.sessionManager.appendCustomEntry(revisionEntryType, { junk: true });
      const first = leafOf(f);
      f.session.sessionManager.appendCustomEntry(revisionEntryType, { junk: true });
      damaged = [first, leafOf(f)];
    }
    const lines = await sessionLines(sessionFileOf(f), damaged);
    const g = await reopen(f, createFixture);
    const { runtime: recovered, ctx } = await started(g);
    expect(selected(recovered)).toMatchObject({ state: "selected", revisionId: r0 });
    expect(pending(recovered)).toEqual({
      state: "unresolved",
      revisionId: head,
      anchorId: anchor,
      reason: "lineage",
    });
    expect(validReferences(g, store.projectId)).toEqual([r0]);
    const status = buildStatus(recovered, ctx);
    expect(status.damagedReferences.map((reference) => reference.entryId)).toEqual(damaged);
    const rendered = renderStatus(status).split("\n");
    expect(rendered).toContain(blockedLine(String(damaged[0])));
    expect(rendered).toContain(
      unresolvedLine(head, anchor, "its lineage from the selected revision cannot be established"),
    );
    expect(() => recovered.captureProposal(ctx, noteContent({}), [])).toThrow(
      `entry ${String(damaged[0])}`,
    );
    expect(await sessionLines(sessionFileOf(g), damaged)).toEqual(lines);
    expect((await store.readRevision(head))?.notes).toEqual({ "current-work.md": "R1\n" });
  },
);

test("a first session commit whose reference is lost attaches with no base and no parent, and becomes the next capture's base", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt(chainEvidence);
  const { runtime, ctx, dropNextReference } = await droppingRuntime(f);
  dropNextReference();
  const head = await commitNote(f, runtime, chainEvidence, { "current-work.md": "First\n" });
  const store = await storeFor(f);
  expect(await store.readRevision(head)).toMatchObject({
    baseRevision: null,
    parentRevisionId: null,
  });
  await runtime.start(ctx);
  expect(selected(runtime)).toMatchObject({ state: "selected", revisionId: head });
  expect(pending(runtime)).toEqual({ state: "none" });
  expect(validReferences(f, store.projectId)).toEqual([head]);
  expect(runtime.captureProposal(ctx, noteContent({}), [])).toMatchObject({
    baseRevision: { revisionId: head },
  });
});

test("a first child commit inheriting its fork base whose reference is lost attaches with no parent and keeps the inherited notes", async ({
  createFixture,
}) => {
  const parent = await createFixture();
  await parent.session.prompt("Remember the parent state.");
  const { runtime } = await started(parent);
  const inherited = await commitNote(parent, runtime, "Remember the parent state.", {
    "current-work.md": "Parent state\n",
  });
  const child = await forkOnDisk(parent, createFixture);
  const { runtime: childRuntime, ctx, dropNextReference } = await droppingRuntime(child);
  expect(selected(childRuntime)).toMatchObject({
    revisionId: inherited,
    sessionId: parent.session.sessionManager.getSessionId(),
  });
  dropNextReference();
  const childHead = await commitNote(child, childRuntime, "Remember the parent state.", {
    "journey.md": "Child journey\n",
  });
  const store = await storeFor(child);
  expect(await store.readRevision(childHead)).toMatchObject({
    baseRevision: { revisionId: inherited },
    parentRevisionId: null,
    notes: { "current-work.md": "Parent state\n", "journey.md": "Child journey\n" },
  });
  await childRuntime.start(ctx);
  expect(selected(childRuntime)).toMatchObject({
    state: "selected",
    revisionId: childHead,
    sessionId: store.sessionId,
  });
  expect(pending(childRuntime)).toEqual({ state: "none" });
  expect(childRuntime.captureProposal(ctx, noteContent({}), [])).toMatchObject({
    baseRevision: { revisionId: childHead },
  });
}, 20_000);

test("a head based on an unavailable R0 stays unresolved, R0 stays unavailable and missing, and capture refuses", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt(chainEvidence);
  const { runtime, dropNextReference } = await droppingRuntime(f);
  const r0 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
  const anchor = leafOf(f);
  dropNextReference();
  const head = await commitNote(f, runtime, chainEvidence, { "current-work.md": "H\n" });
  const store = await storeFor(f);
  const r0File = join(store.sessionDir, "revisions", `${r0}.json`);
  await rm(r0File);
  const g = await reopen(f, createFixture);
  const { runtime: recovered, ctx } = await started(g);
  expect(storageOf(recovered).lineage).toEqual({
    selected: {
      state: "unavailable",
      revisionId: r0,
      sessionId: store.sessionId,
      reason: `Selected revision ${r0} is unavailable.`,
    },
    pending: { state: "unresolved", revisionId: head, anchorId: anchor, reason: "lineage" },
  });
  expect(validReferences(g, store.projectId)).toEqual([r0]);
  expect(renderStatus(buildStatus(recovered, ctx)).split("\n")).toEqual(
    expect.arrayContaining([
      `Selected memory revision: unavailable (Selected revision ${r0} is unavailable.)`,
      unavailableLine(anchor),
      unresolvedLine(head, anchor, "its lineage from the selected revision cannot be established"),
    ]),
  );
  expect(() => recovered.captureProposal(ctx, noteContent({}), [])).toThrow(
    `Memory revision ${head} is not recorded on this branch`,
  );
  await expect(readFile(r0File, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  expect((await store.readRevision(head))?.notes).toEqual({ "current-work.md": "H\n" });
}, 20_000);

test("a head committed after tree navigation whose reference is lost stays unresolved, and navigation before its anchor clears the block for an ordinary commit", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt(chainEvidence);
  const { runtime, ctx, dropNextReference } = await droppingRuntime(f);
  const r0 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R0\n" });
  const r0Reference = leafOf(f);
  const r1 = await commitNote(f, runtime, chainEvidence, { "current-work.md": "R1\n" });
  f.session.sessionManager.branch(r0Reference);
  await runtime.selectBranch(ctx);
  expect(selected(runtime)).toMatchObject({ revisionId: r0 });
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "H\n" }), [
    await sourceReference(f, chainEvidence),
  ]);
  expect(proposal).toMatchObject({ baseRevision: { revisionId: r0 }, expectedRevision: r1 });
  dropNextReference();
  const head = committedId(await runtime.commitProposal(ctx, proposal));
  await runtime.start(ctx);
  expect(pending(runtime)).toEqual({
    state: "unresolved",
    revisionId: head,
    anchorId: proposal.anchorId,
    reason: "lineage",
  });
  expect(selected(runtime)).toMatchObject({ revisionId: r0 });
  expect(renderStatus(buildStatus(runtime, ctx)).split("\n")).toContain(
    unresolvedLine(
      head,
      proposal.anchorId,
      "its lineage from the selected revision cannot be established",
    ),
  );
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow(
    `Memory revision ${head} is not recorded on this branch`,
  );
  f.session.sessionManager.branch(r0Reference);
  await runtime.selectBranch(ctx);
  expect(pending(runtime)).toEqual({ state: "none" });
  const ordinary = runtime.captureProposal(ctx, noteContent({ "journey.md": "Journey\n" }), [
    await sourceReference(f, chainEvidence),
  ]);
  expect(ordinary).toMatchObject({ baseRevision: { revisionId: r0 }, expectedRevision: head });
  const committed = committedId(await runtime.commitProposal(ctx, ordinary));
  const store = await storeFor(f);
  expect((await store.readRevision(committed))?.notes).toEqual({
    "current-work.md": "R0\n",
    "journey.md": "Journey\n",
  });
  expect((await store.readRevision(head))?.notes).toEqual({ "current-work.md": "H\n" });
}, 20_000);

test.for([
  { label: "storage becomes unready", change: { reconciliation: "reconciling" } },
  {
    label: "an orphan head becomes unresolved",
    change: {
      lineage: {
        selected: { state: "none" },
        pending: { state: "unresolved", revisionId: "r9", anchorId: "a9", reason: "lineage" },
      },
    },
  },
  {
    label: "another revision becomes selected",
    change: {
      lineage: { selected: selectedAs("r9", "s9"), pending: { state: "none" } },
    },
  },
] satisfies { label: string; change: Partial<ProposalBinding> }[])(
  "a binding change in which $label between the commit's two validations returns a lineage conflict and writes no head",
  async ({ change }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Stable evidence.");
    const manager = f.session.sessionManager;
    let binding: ProposalBinding = storageBinding(
      { selected: { state: "none" }, pending: { state: "none" } },
      "d".repeat(64),
    );
    const runtime = storageRuntime({
      write: async (path, contents) => {
        await writeDurable(path, contents);
        if (path.includes(`${sep}revisions${sep}`)) {
          binding = { ...binding, ...change };
        }
      },
    });
    const storage = await runtime.runPromise(
      openStorageSession({ cwd: f.cwd, sessionManager: manager }),
    );
    await runtime.runPromise(storage.sources.register(manager));
    const proposal = captureStorageProposal(
      storage,
      { sessionManager: manager },
      binding,
      noteContent({ "current-work.md": "Old\n" }),
      [await sourceReference(f, "Stable evidence.")],
    );
    const result = await runtime.runPromise(
      commitStorageProposal(
        storage,
        { sessionManager: manager },
        () => binding,
        proposal,
        () => undefined,
      ),
    );
    expect(result).toMatchObject({ kind: "conflict", reason: "lineage" });
    expect(await runtime.runPromise(storage.store.currentHead())).toBeNull();
  },
);

test("a refresh that attaches a committed head before its commit applies lineage leaves that head one reference entry", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Adopted head.");
  const { manager, runtime, storage } = await openedStorage(f);
  const host = {
    appendEntry(type: string, data: unknown) {
      manager.appendCustomEntry(type, data);
    },
  };
  const ctx = { sessionManager: manager };
  const binding = storageBinding(
    { selected: { state: "none" }, pending: { state: "none" } },
    "d".repeat(64),
  );
  const proposal = captureStorageProposal(
    storage,
    ctx,
    binding,
    noteContent({ "current-work.md": "One\n" }),
    [await sourceReference(f, "Adopted head.")],
  );
  const committed = await runtime.runPromise(
    commitStorageProposal(
      storage,
      ctx,
      () => binding,
      proposal,
      () => undefined,
    ),
  );
  if (committed.kind !== "committed") {
    throw new Error(`Expected a committed revision, received ${committed.kind}.`);
  }
  const head = committed.revisionId;
  const update = { sources: storage.sources.sources, event: "commit" as const };
  const lineage: LineageState = {
    selected: { state: "none" },
    pending: { state: "unappended", revisionId: head },
  };
  const refreshed = await runtime.runPromise(
    refreshLineage(host, storage.store, ctx, { ...binding, lineage }, update, () => true),
  );
  const attachedLineage = {
    selected: selectedAs(head, storage.store.sessionId),
    pending: { state: "none" },
  };
  expect(refreshed.lineage).toEqual(attachedLineage);
  expect(
    await runtime.runPromise(attachCommitted(host, storage, ctx, refreshed.lineage, head)),
  ).toEqual(attachedLineage);
  expect(validReferences(f, storage.store.projectId)).toEqual([head]);
});
