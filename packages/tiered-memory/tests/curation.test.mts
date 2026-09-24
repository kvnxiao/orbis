import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import type { CommitResult, MemoryProposal } from "../src/domain/proposal.ts";
import { encodeReference } from "../src/domain/references.ts";
import { curationSchema, projectCurationSchema } from "../src/storage/curation.ts";
import type { MemoryStore } from "../src/storage/store.ts";
import {
  baseProposal,
  committedId,
  interruptingWriter,
  openStore,
  rejectionPaths,
  test,
} from "./store-fixture.mts";

async function commit(
  store: MemoryStore,
  overrides: Partial<MemoryProposal>,
): Promise<CommitResult> {
  return await store.commit(baseProposal(store, overrides), { validate: () => undefined });
}

function note(store: MemoryStore): string {
  return join(store.sessionDir, "current", "current-work.md");
}

function reference(store: MemoryStore, sessionId: string, entryId = "entry-1"): string {
  return encodeReference({ projectId: store.projectId, sessionId, entryId, span: 0 });
}

const learning = {
  notes: {},
  learnings: { "index.md": "Learning\n" },
  expectedLearnings: { "index.md": { digest: null, sequence: null } },
};

test("an external edit records edited with the note's consumed evidence and survives a stale proposal", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await writeFile(note(store), "user correction\n");
  expect(
    await commit(store, { expectedRevision: first, notes: { "current-work.md": "stale\n" } }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  expect(await readFile(note(store), "utf8")).toBe("user correction\n");
  expect((await store.inspectCuration(null)).notes["current-work.md"]).toMatchObject({
    kind: "edited",
    consumedSourceIds: ["source-1"],
  });
});

test("a deletion records an exclusion that survives reopening the store", async ({ makeRoot }) => {
  const root = await makeRoot();
  const store = await openStore(root);
  committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(note(store));
  await store.inspectCuration(null);
  const reopened = await openStore(root);
  expect((await reopened.inspectCuration(null)).notes["current-work.md"]).toEqual({
    kind: "deleted",
    consumedSourceIds: ["source-1"],
  });
});

test("a deleted note is recreated only from evidence it did not consume", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(note(store));
  const recreate = { expectedRevision: first, notes: { "current-work.md": "again\n" } };
  expect(await commit(store, recreate)).toMatchObject({ kind: "conflict", reason: "curation" });
  committedId(await commit(store, { ...recreate, sourceIds: ["source-2"] }));
  expect(await readFile(note(store), "utf8")).toBe("again\n");
});

test("a deleted note's old evidence stays excluded after new evidence regenerates it", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(note(store));
  const second = committedId(
    await commit(store, {
      expectedRevision: first,
      sourceIds: ["source-2"],
      notes: { "current-work.md": "regenerated\n" },
    }),
  );
  await rm(note(store));
  expect((await store.inspectCuration(null)).notes["current-work.md"]?.consumedSourceIds).toEqual(
    expect.arrayContaining(["source-1", "source-2"]),
  );
  expect(
    await commit(store, {
      expectedRevision: second,
      notes: { "current-work.md": "old evidence\n" },
    }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
});

test("a project learning deletion excludes regeneration by another session", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = await openStore(root, { sessionId: "session-1" });
  committedId(await commit(first, learning));
  await rm(join(first.baseDir, "learnings", "index.md"));
  const second = await openStore(root, { sessionId: "session-2" });
  const regenerate = {
    ...learning,
    expectedLearnings: { "index.md": { digest: null, sequence: 1 } },
  };
  expect(await commit(second, regenerate)).toMatchObject({ kind: "conflict", reason: "curation" });
  committedId(await commit(second, { ...regenerate, sourceIds: ["source-2"] }));
});

test("inspectCuration writes curation.json only when a record changes", async ({ makeRoot }) => {
  const recorder = interruptingWriter(() => false);
  const store = await openStore(await makeRoot(), { write: recorder.write });
  committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await writeFile(note(store), "user edit\n");
  await store.inspectCuration(null);
  await store.inspectCuration(null);
  expect(recorder.writes.filter((path) => path.endsWith("curation.json"))).toHaveLength(1);
});

async function forkedParent(
  root: string,
  change: "edited" | "deleted",
): Promise<{ parent: MemoryStore; revisionId: string }> {
  const parent = await openStore(root, { sessionId: "parent" });
  const revisionId = committedId(
    await commit(parent, {
      sourceIds: [reference(parent, "parent")],
      notes: { "current-work.md": "generated\n" },
    }),
  );
  if (change === "edited") {
    await writeFile(note(parent), "user correction\n");
  } else {
    await rm(note(parent));
  }
  return { parent, revisionId };
}

test.for(["edited", "deleted"] as const)(
  "a fork carries a parent's %s exclusion into the child's curation record",
  async (change, { makeRoot }) => {
    const root = await makeRoot();
    const { parent, revisionId } = await forkedParent(root, change);
    const child = await openStore(root, { sessionId: "child" });
    const record = (await child.inspectCuration({ sessionId: "parent", revisionId })).notes[
      "current-work.md"
    ];
    expect(record).toMatchObject({ kind: change });
    expect(record?.consumedSourceIds).toEqual(
      expect.arrayContaining([reference(parent, "parent"), reference(parent, "child")]),
    );
    expect(
      JSON.parse(await readFile(join(child.sessionDir, "curation.json"), "utf8")),
    ).toMatchObject({ notes: { "current-work.md": { kind: change } } });
  },
);

test("fork inheritance keeps the exclusion against the child's reencoded evidence", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { parent, revisionId } = await forkedParent(root, "deleted");
  const child = await openStore(root, { sessionId: "child" });
  const base = { sessionId: "parent", revisionId };
  const recreate = { baseRevision: base, notes: { "current-work.md": "again\n" } };
  expect(
    await commit(child, { ...recreate, sourceIds: [reference(parent, "child")] }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  committedId(
    await commit(child, { ...recreate, sourceIds: [reference(parent, "child", "entry-2")] }),
  );
});

test("an absent ancestor tombstone carries through a second fork", async ({ makeRoot }) => {
  const root = await makeRoot();
  const { parent, revisionId } = await forkedParent(root, "deleted");
  const child = await openStore(root, { sessionId: "child" });
  const childRevision = committedId(
    await commit(child, {
      baseRevision: { sessionId: "parent", revisionId },
      notes: { "journey.md": "child journey\n" },
      excludedInheritedNotes: ["current-work.md"],
    }),
  );
  const grandchild = await openStore(root, { sessionId: "grandchild" });
  const record = (
    await grandchild.inspectCuration({ sessionId: "child", revisionId: childRevision })
  ).notes["current-work.md"];
  expect(record).toMatchObject({ kind: "deleted" });
  expect(record?.consumedSourceIds).toContain(reference(parent, "grandchild"));
});

test("an inherited regenerated note does not consume its new evidence", async ({ makeRoot }) => {
  const root = await makeRoot();
  const { parent, revisionId } = await forkedParent(root, "deleted");
  const regenerated = committedId(
    await commit(parent, {
      expectedRevision: revisionId,
      sourceIds: [reference(parent, "parent", "entry-2")],
      notes: { "current-work.md": "regenerated\n" },
    }),
  );
  const child = await openStore(root, { sessionId: "child" });
  const record = (await child.inspectCuration({ sessionId: "parent", revisionId: regenerated }))
    .notes["current-work.md"];
  expect(record?.consumedSourceIds).not.toContain(reference(parent, "parent", "entry-2"));
  expect(record?.consumedSourceIds).not.toContain(reference(parent, "child", "entry-2"));
});

const curation = {
  version: 1,
  notes: { "current-work.md": { kind: "deleted", consumedSourceIds: [] } },
};
const projectCuration = {
  version: 1,
  generated: { "index.md": { digest: "a".repeat(64), consumedSourceIds: [], sequence: 1 } },
  curated: {},
};

test("curation.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(curationSchema, { ...curation, version: 2 })).toContain("/version");
});

test("curation.json missing its notes is rejected at /notes", () => {
  expect(rejectionPaths(curationSchema, { version: 1 })).toContain("/notes");
});

test("curation.json with a wrong-typed record kind is rejected under /notes/current-work.md", () => {
  const damaged = { version: 1, notes: { "current-work.md": { kind: 3, consumedSourceIds: [] } } };
  expect(
    rejectionPaths(curationSchema, damaged).some((path) =>
      path.startsWith("/notes/current-work.md"),
    ),
  ).toBe(true);
});

test("state.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(projectCurationSchema, { ...projectCuration, version: 2 })).toContain(
    "/version",
  );
});

test("state.json missing its curated records is rejected at /curated", () => {
  const { curated: _removed, ...rest } = projectCuration;
  expect(rejectionPaths(projectCurationSchema, rest)).toContain("/curated");
});

test("state.json with a wrong-typed generated sequence is rejected at /generated/index.md/sequence", () => {
  const damaged = {
    ...projectCuration,
    generated: { "index.md": { digest: "a".repeat(64), consumedSourceIds: [], sequence: "1" } },
  };
  expect(rejectionPaths(projectCurationSchema, damaged)).toContain("/generated/index.md/sequence");
});

test("a damaged curation record's bytes are preserved after the read fails", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  const path = join(store.sessionDir, "curation.json");
  await writeFile(path, "{damaged");
  await expect(store.inspectCuration(null)).rejects.toThrow(`Invalid JSON at ${path}.`);
  expect(await readFile(path, "utf8")).toBe("{damaged");
});
