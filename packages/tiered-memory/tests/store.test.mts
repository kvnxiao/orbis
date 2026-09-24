import { mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { CommitResult, ConflictReason, MemoryProposal } from "../src/domain/proposal.ts";
import { writeDurable } from "../src/storage/files.ts";
import type { DurableWriter } from "../src/storage/files.ts";
import { withProjectLock } from "../src/storage/lock.ts";
import { readHead } from "../src/storage/revisions.ts";
import { canonicalProjectRoot } from "../src/storage/store.ts";
import type { MemoryStore } from "../src/storage/store.ts";
import {
  baseProposal,
  committedId,
  interruptingWriter,
  openStore,
  test,
} from "./store-fixture.mts";

async function commit(
  store: MemoryStore,
  overrides: Partial<MemoryProposal> = {},
  validate: () => ConflictReason | undefined = () => undefined,
): Promise<CommitResult> {
  return await store.commit(baseProposal(store, overrides), { validate });
}

function view(store: MemoryStore, name = "current-work.md"): string {
  return join(store.sessionDir, "current", name);
}

async function revisionFiles(store: MemoryStore): Promise<string[]> {
  return (await readdir(join(store.sessionDir, "revisions"))).filter((name) =>
    name.endsWith(".json"),
  );
}

test("commit writes the sequence, revision, head, note views, and a materialized head in order", async ({
  makeRoot,
}) => {
  const recorder = interruptingWriter(() => false);
  const store = await openStore(await makeRoot(), { write: recorder.write });
  recorder.writes.length = 0;
  const id = committedId(await commit(store, { notes: { "current-work.md": "one\n" } }));
  const written = recorder.writes
    .map((path) => relative(store.baseDir, path).split(sep).join("/"))
    .filter((path) => !path.endsWith("owner.json"));
  expect(written).toEqual([
    "sessions/_project/sequence.json",
    `sessions/session-1/revisions/${id}.json`,
    "sessions/session-1/head.json",
    "sessions/session-1/current/current-work.md",
    "sessions/session-1/head.json",
  ]);
});

test("an interruption before the head leaves the previous head current and the revision unreferenced", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = committedId(
    await commit(await openStore(root), { notes: { "current-work.md": "one\n" } }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("head.json")).write,
  });
  await expect(
    commit(interrupted, { expectedRevision: first, notes: { "current-work.md": "two\n" } }),
  ).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  expect(await reopened.currentHead()).toBe(first);
  expect(await revisionFiles(reopened)).toHaveLength(2);
  expect(await readFile(view(reopened), "utf8")).toBe("one\n");
});

test("an interruption after the head rewrites absent views on the next open", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const store = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("current-work.md")).write,
  });
  await expect(commit(store, { notes: { "current-work.md": "one\n" } })).rejects.toThrow(
    "Injected interruption",
  );
  expect((await readHead(store.sessionDir, store.access.signal))?.materialized).toBe(false);
  const reopened = await openStore(root);
  expect(await readFile(view(reopened), "utf8")).toBe("one\n");
  expect((await readHead(reopened.sessionDir, reopened.access.signal))?.materialized).toBe(true);
});

test("open rewrites a view whose bytes equal the parent revision's rendering of the same note", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = committedId(
    await commit(await openStore(root), { notes: { "current-work.md": "one\n" } }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("current-work.md")).write,
  });
  await expect(
    commit(interrupted, { expectedRevision: first, notes: { "current-work.md": "two\n" } }),
  ).rejects.toThrow("Injected interruption");
  expect(await readFile(view(interrupted), "utf8")).toBe("one\n");
  expect(await readFile(view(await openStore(root)), "utf8")).toBe("two\n");
});

test("open keeps a view that differs from the head and the parent rendering as an external edit", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = committedId(
    await commit(await openStore(root), { notes: { "current-work.md": "one\n" } }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("current-work.md")).write,
  });
  await expect(
    commit(interrupted, { expectedRevision: first, notes: { "current-work.md": "two\n" } }),
  ).rejects.toThrow("Injected interruption");
  await writeFile(view(interrupted), "user edit\n");
  const reopened = await openStore(root);
  expect(await readFile(view(reopened), "utf8")).toBe("user edit\n");
  expect((await reopened.inspectCuration(null)).notes["current-work.md"]).toMatchObject({
    kind: "edited",
  });
});

test("open leaves a view whose digest matches the head untouched", async ({ makeRoot }) => {
  const root = await makeRoot();
  const store = await openStore(root, {
    write: interruptingWriter(
      (path, contents) => path.endsWith("head.json") && contents.includes('"materialized":true'),
    ).write,
  });
  await expect(commit(store, { notes: { "current-work.md": "one\n" } })).rejects.toThrow(
    "Injected interruption",
  );
  const recorder = interruptingWriter(() => false);
  await openStore(root, { write: recorder.write });
  expect(recorder.writes.some((path) => path.endsWith("current-work.md"))).toBe(false);
  expect(recorder.writes.some((path) => path.endsWith("head.json"))).toBe(true);
});

const learning = {
  notes: {},
  learnings: { "index.md": "Learning\n" },
  expectedLearnings: { "index.md": { digest: null, sequence: null } },
};

test("open rewrites an absent learning view from the head's revision", async ({ makeRoot }) => {
  const root = await makeRoot();
  const store = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(commit(store, learning)).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  expect(await readFile(join(reopened.baseDir, "learnings", "index.md"), "utf8")).toBe(
    "Learning\n",
  );
});

test("open records the provenance of a learning written before an interrupted state.json write", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("state.json")).write,
  });
  await expect(commit(interrupted, learning)).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  committedId(
    await commit(reopened, {
      notes: {},
      expectedRevision: await reopened.currentHead(),
      learnings: { "index.md": "Updated learning\n" },
      expectedLearnings: { "index.md": { digest: digest("Learning\n"), sequence: 1 } },
    }),
  );
});

test("open keeps a present learning file for the next commit's curation inspection", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const store = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(commit(store, learning)).rejects.toThrow("Injected interruption");
  const path = join(store.baseDir, "learnings", "index.md");
  await mkdir(join(store.baseDir, "learnings"), { recursive: true });
  await writeFile(path, "User learning\n");
  await openStore(root);
  expect(await readFile(path, "utf8")).toBe("User learning\n");
});

test("a note deleted after its commit completed stays deleted when the store reopens", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const store = await openStore(root);
  committedId(await commit(store, { notes: { "current-work.md": "one\n" } }));
  await rm(view(store));
  const reopened = await openStore(root);
  await expect(readFile(view(reopened), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  expect((await reopened.inspectCuration(null)).notes["current-work.md"]).toMatchObject({
    kind: "deleted",
  });
});

test("a commit whose expectedRevision is stale conflicts on head with both revisions", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store));
  expect(await commit(store, { expectedRevision: null })).toEqual({
    kind: "conflict",
    expectedRevision: null,
    actualRevision: first,
    reason: "head",
  });
});

test("a commit writing an externally edited note conflicts on curation", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "one\n" } }));
  await writeFile(view(store), "user edit\n");
  expect(
    await commit(store, { expectedRevision: first, notes: { "current-work.md": "two\n" } }),
  ).toMatchObject({ kind: "conflict", reason: "curation", actualRevision: first });
  expect(await readFile(view(store), "utf8")).toBe("user edit\n");
});

test("a commit with a stale learning digest or sequence conflicts on learning", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const stale = {
    ...learning,
    expectedLearnings: { "index.md": { digest: "f".repeat(64), sequence: null } },
  };
  expect(await commit(store, stale)).toMatchObject({ kind: "conflict", reason: "learning" });
  await expect(readFile(join(store.baseDir, "learnings", "index.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("a commit whose validate callback returns a reason conflicts with that reason without writing", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store));
  for (const reason of ["evidence", "configuration"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Each rejected commit must finish before the head is checked.
    expect(await commit(store, { expectedRevision: first }, () => reason)).toMatchObject({
      kind: "conflict",
      reason,
    });
  }
  expect(await store.currentHead()).toBe(first);
  expect(await revisionFiles(store)).toHaveLength(1);
});

test("a head conflict is reported before the validate callback's reason", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  committedId(await commit(store));
  expect(await commit(store, { expectedRevision: null }, () => "configuration")).toMatchObject({
    reason: "head",
  });
});

function abortingWriter(controller: AbortController, reason: Error, at: string): DurableWriter {
  return async (path, contents) => {
    await writeDurable(path, contents);
    if (path.includes(at)) {
      controller.abort(reason);
    }
  };
}

test("an abort before the head is written returns cancelled with the signal's reason", async ({
  makeRoot,
}) => {
  const controller = new AbortController();
  const reason = new Error("session stopped");
  const store = await openStore(await makeRoot(), {
    signal: controller.signal,
    write: abortingWriter(controller, reason, `${sep}revisions${sep}`),
  });
  expect(await commit(store)).toEqual({ kind: "cancelled", reason });
  expect(
    (await readHead(store.sessionDir, new AbortController().signal))?.revisionId,
  ).toBeUndefined();
});

test("an abort after the head is durable returns committed and finishes the views", async ({
  makeRoot,
}) => {
  const controller = new AbortController();
  const store = await openStore(await makeRoot(), {
    signal: controller.signal,
    write: abortingWriter(controller, new Error("session stopped"), "head.json"),
  });
  const result = await commit(store, { notes: { "current-work.md": "kept\n" } });
  expect(result.kind).toBe("committed");
  expect(await readFile(view(store), "utf8")).toBe("kept\n");
});

test("two sessions writing the same learning serialize under the lock and the loser conflicts on learning", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const [first, second] = await Promise.all([
    openStore(root, { sessionId: "session-1" }),
    openStore(root, { sessionId: "session-2" }),
  ]);
  const results = await Promise.all([
    commit(first, { ...learning, learnings: { "index.md": "First\n" } }),
    commit(second, { ...learning, learnings: { "index.md": "Second\n" } }),
  ]);
  expect(results.map((result) => result.kind).toSorted()).toEqual(["committed", "conflict"]);
  expect(results.find((result) => result.kind === "conflict")).toMatchObject({
    reason: "learning",
  });
});

test("recommitting a proposal after its revision became the head conflicts instead of duplicating it", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const proposal = baseProposal(store);
  committedId(await store.commit(proposal, { validate: () => undefined }));
  expect(await store.commit(proposal, { validate: () => undefined })).toMatchObject({
    kind: "conflict",
    reason: "head",
  });
  expect(await revisionFiles(store)).toHaveLength(1);
});

test("commit uses the proposal captured at the call when the caller mutates it while waiting for the lock", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const held = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  const holder = withProjectLock(join(store.baseDir, "sessions"), store.access, async () => {
    entered.resolve(undefined);
    await held.promise;
  });
  await entered.promise;
  const proposal = baseProposal(store, { notes: { "current-work.md": "original\n" } });
  const pending = store.commit(proposal, { validate: () => undefined });
  proposal.notes["current-work.md"] = "mutated\n";
  held.resolve(undefined);
  await holder;
  const id = committedId(await pending);
  expect((await store.readRevision(id))?.notes).toEqual({ "current-work.md": "original\n" });
});

test("an earlier revision stays readable after later commits", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "one\n" } }));
  committedId(
    await commit(store, { expectedRevision: first, notes: { "current-work.md": "two\n" } }),
  );
  expect((await store.readRevision(first))?.notes).toEqual({ "current-work.md": "one\n" });
});

test("carried notes keep their own dependencies when a later revision writes another note", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const dependency = { sourceIds: ["source-a"], evidenceFingerprint: "a".repeat(64) };
  const first = committedId(
    await commit(store, {
      notes: { "current-work.md": "one\n" },
      noteDependencies: { "current-work.md": dependency },
    }),
  );
  const second = committedId(
    await commit(store, {
      expectedRevision: first,
      baseRevision: { sessionId: store.sessionId, revisionId: first },
      sourceIds: ["source-b"],
      evidenceFingerprint: "b".repeat(64),
      notes: { "journey.md": "journey\n" },
    }),
  );
  const revision = await store.readRevision(second);
  expect(revision?.notes).toEqual({ "current-work.md": "one\n", "journey.md": "journey\n" });
  expect(revision?.noteDependencies).toEqual({
    "current-work.md": dependency,
    "journey.md": { sourceIds: ["source-b"], evidenceFingerprint: "b".repeat(64) },
  });
});

test("excludedInheritedNotes drops invalid carried notes from the snapshot", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "one\n" } }));
  const second = committedId(
    await commit(store, {
      expectedRevision: first,
      baseRevision: { sessionId: store.sessionId, revisionId: first },
      notes: { "journey.md": "journey\n" },
      excludedInheritedNotes: ["current-work.md"],
    }),
  );
  expect((await store.readRevision(second))?.notes).toEqual({ "journey.md": "journey\n" });
});

test("a new note is created after an earlier revision and a multi-note interruption recovers", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = committedId(
    await commit(await openStore(root), { notes: { "current-work.md": "one\n" } }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("topics-index.md")).write,
  });
  await expect(
    commit(interrupted, {
      expectedRevision: first,
      baseRevision: { sessionId: interrupted.sessionId, revisionId: first },
      notes: { "journey.md": "journey\n", "topics-index.md": "topics\n" },
    }),
  ).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  expect(await readFile(view(reopened, "journey.md"), "utf8")).toBe("journey\n");
  expect(await readFile(view(reopened, "topics-index.md"), "utf8")).toBe("topics\n");
  expect(await readFile(view(reopened), "utf8")).toBe("one\n");
});

test("the project sequence orders generated learnings written by different sessions", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = await openStore(root, { sessionId: "session-1" });
  const second = await openStore(root, { sessionId: "session-2" });
  committedId(await commit(first, { ...learning, learnings: { "index.md": "First\n" } }));
  committedId(
    await commit(second, {
      ...learning,
      learnings: { "index.md": "Second\n" },
      expectedLearnings: { "index.md": { digest: digest("First\n"), sequence: 1 } },
    }),
  );
  const state: unknown = JSON.parse(
    await readFile(
      join(root, ".pi", "tiered-memory", "sessions", "_project", "state.json"),
      "utf8",
    ),
  );
  expect(state).toMatchObject({
    generated: { "index.md": { digest: digest("Second\n"), sequence: 2 } },
  });
});

test("inheritRevision reads a same-project ancestor revision", async ({ makeRoot }) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const id = committedId(await commit(parent, { notes: { "current-work.md": "parent\n" } }));
  const child = await openStore(root, { sessionId: "child" });
  expect((await child.inheritRevision({ sessionId: "parent", revisionId: id }))?.notes).toEqual({
    "current-work.md": "parent\n",
  });
});

test("inheritRevision returns undefined when the ancestor identity names another project", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const id = committedId(await commit(parent));
  await writeFile(
    join(parent.sessionDir, "identity.json"),
    JSON.stringify({
      version: 1,
      projectId: "b".repeat(64),
      projectRoot: "/elsewhere",
      sessionId: "parent",
    }),
  );
  const child = await openStore(root, { sessionId: "child" });
  expect(await child.inheritRevision({ sessionId: "parent", revisionId: id })).toBeUndefined();
});

test("open rejects an identity record that names another project or session", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const store = await openStore(root);
  await writeFile(
    join(store.sessionDir, "identity.json"),
    JSON.stringify({
      version: 1,
      projectId: store.projectId,
      projectRoot: store.projectRoot,
      sessionId: "session-2",
    }),
  );
  await expect(openStore(root)).rejects.toThrow("Session identity mismatch");
});

test("unrelated roots with the same basename and session id keep separate project ids", async ({
  makeRoot,
}) => {
  const first = join(await makeRoot(), "project");
  const second = join(await makeRoot(), "project");
  await mkdir(first);
  await mkdir(second);
  const firstStore = await openStore(first);
  const secondStore = await openStore(second);
  expect(firstStore.projectId).not.toBe(secondStore.projectId);
  committedId(await commit(firstStore));
  expect(await secondStore.currentHead()).toBeNull();
});

test("canonicalProjectRoot resolves a symlinked working directory", async ({ makeRoot }) => {
  const real = await makeRoot();
  const link = join(await makeRoot(), "link");
  await symlink(real, link, "dir");
  expect(await canonicalProjectRoot(link)).toBe(await realpath(real));
});

test("a damaged head is rejected on open and its bytes are preserved", async ({ makeRoot }) => {
  const root = await makeRoot();
  const store = await openStore(root);
  const path = join(store.sessionDir, "head.json");
  await writeFile(path, "{damaged");
  await expect(openStore(root)).rejects.toThrow(`Invalid JSON at ${path}.`);
  expect(await readFile(path, "utf8")).toBe("{damaged");
});

test.for([
  [".pi"],
  [".pi", "tiered-memory"],
  [".pi", "tiered-memory", "sessions"],
  [".pi", "tiered-memory", "sessions", "_project"],
  [".pi", "tiered-memory", "learnings"],
  [".pi", "tiered-memory", "sessions", "session-1"],
  [".pi", "tiered-memory", "sessions", "session-1", "current"],
  [".pi", "tiered-memory", "sessions", "session-1", "revisions"],
])("open rejects a symlinked %s directory", async (parts, { makeRoot }) => {
  const root = await makeRoot();
  const outside = await makeRoot();
  const target = join(root, ...parts);
  await mkdir(join(target, ".."), { recursive: true });
  await symlink(outside, target, "dir");
  await expect(openStore(root)).rejects.toThrow("symlink");
});

test("open ignores a symlinked directory of another session", async ({ makeRoot }) => {
  const root = await makeRoot();
  const sessions = join(root, ".pi", "tiered-memory", "sessions");
  await mkdir(sessions, { recursive: true });
  await symlink(await makeRoot(), join(sessions, "other-session"), "dir");
  await expect(openStore(root)).resolves.toMatchObject({ sessionId: "session-1" });
});

test("a commit based on a fork ancestor rejects the ancestor's symlinked current directory", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const id = committedId(await commit(parent, { notes: { "current-work.md": "parent\n" } }));
  const child = await openStore(root, { sessionId: "child" });
  const current = join(parent.sessionDir, "current");
  await rm(current, { recursive: true });
  await symlink(await makeRoot(), current, "dir");
  await expect(
    commit(child, { baseRevision: { sessionId: "parent", revisionId: id }, notes: {} }),
  ).rejects.toThrow("symlink");
});
