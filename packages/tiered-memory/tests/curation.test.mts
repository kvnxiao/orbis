import { link, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { Value } from "typebox/value";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { CommitResult, MemoryProposal } from "../src/domain/proposal.ts";
import { encodeReference } from "../src/domain/references.ts";
import { curationSchema, inspectCuration } from "../src/storage/curation.ts";
import { writeDurable } from "../src/storage/files.ts";
import {
  learningConflict,
  projectCurationSchema,
  publishProjectGenerated,
  readProjectCuration,
} from "../src/storage/learning-curation.ts";
import { readHead, revisionSchema } from "../src/storage/revisions.ts";
import type { StorageServices } from "../src/storage/services.ts";
import { runStorage } from "./storage-harness.mts";
import type { TestWrite } from "./storage-harness.mts";
import {
  baseProposal,
  committedId,
  interruptingWriter,
  openStore,
  readOptional,
  rejectionPaths,
  test,
} from "./store-fixture.mts";
import type { TestStore } from "./store-fixture.mts";

async function commit(store: TestStore, overrides: Partial<MemoryProposal>): Promise<CommitResult> {
  return await store.commit(baseProposal(store, overrides), { validate: () => undefined });
}

function view(store: TestStore, name = "current-work.md"): string {
  return join(store.sessionDir, "current", name);
}

function reference(store: TestStore, sessionId: string, entryId = "entry-1"): string {
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
  await writeFile(view(store), "user correction\n");
  expect(
    await commit(store, { expectedRevision: first, notes: { "current-work.md": "stale\n" } }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  expect(await readFile(view(store), "utf8")).toBe("user correction\n");
  expect((await store.inspectCuration(null)).notes["current-work.md"]).toMatchObject({
    kind: "edited",
    consumedSourceIds: ["source-1"],
  });
});

test("a deletion records an exclusion that survives reopening the store", async ({ makeRoot }) => {
  const root = await makeRoot();
  const store = await openStore(root);
  committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(view(store));
  await store.inspectCuration(null);
  const reopened = await openStore(root);
  expect((await reopened.inspectCuration(null)).notes["current-work.md"]).toEqual({
    kind: "deleted",
    consumedSourceIds: ["source-1"],
  });
});

test("deleting an edited note that a later commit excluded records the deletion with its consumed evidence", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await writeFile(view(store), "user correction\n");
  await store.inspectCuration(null);
  const second = committedId(
    await commit(store, {
      expectedRevision: first,
      sourceIds: ["source-2"],
      curatedNotes: ["current-work.md"],
      notes: {},
    }),
  );
  expect((await store.readRevision(second))?.notes).toEqual({});
  await rm(view(store));
  expect((await store.inspectCuration(null)).notes["current-work.md"]).toEqual({
    kind: "deleted",
    consumedSourceIds: ["source-1"],
  });
});

test("a deleted note is recreated only from evidence it did not consume", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(view(store));
  const recreate = { expectedRevision: first, notes: { "current-work.md": "again\n" } };
  expect(await commit(store, recreate)).toMatchObject({ kind: "conflict", reason: "curation" });
  committedId(
    await commit(store, {
      ...recreate,
      sourceIds: ["source-2"],
      curatedNotes: ["current-work.md"],
    }),
  );
  expect(await readFile(view(store), "utf8")).toBe("again\n");
});

test.for(["deleted", "edited"] as const)(
  "a proposal captured before its note was %s conflicts on curation even with new evidence",
  async (change, { makeRoot }) => {
    const store = await openStore(await makeRoot());
    const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
    expect(store.store.curatedNotes).toEqual({});
    if (change === "deleted") {
      await rm(view(store));
    } else {
      await writeFile(view(store), "user note\n");
    }
    expect(
      await commit(store, {
        expectedRevision: first,
        sourceIds: ["source-2"],
        notes: { "current-work.md": "stale\n" },
      }),
    ).toMatchObject({ kind: "conflict", reason: "curation" });
    expect(store.store.curatedNotes).toEqual({
      "current-work.md":
        change === "deleted"
          ? { kind: "deleted" }
          : { kind: "edited", digest: digest("user note\n") },
    });
    expect(await readOptional(view(store))).toBe(change === "deleted" ? undefined : "user note\n");
  },
);

test("a proposal that knew a deletion recreates its note from new evidence", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(view(store));
  await store.inspectCuration(null);
  const curatedNotes = Object.keys(store.store.curatedNotes);
  expect(curatedNotes).toEqual(["current-work.md"]);
  committedId(
    await commit(store, {
      expectedRevision: first,
      sourceIds: ["source-2"],
      notes: { "current-work.md": "recreated\n" },
      curatedNotes,
    }),
  );
  expect(await readFile(view(store), "utf8")).toBe("recreated\n");
});

test.for(["reference-first", "entry-first"] as const)(
  "a deleted note cannot be recreated through its %s source alias",
  async (order, { makeRoot }) => {
    const store = await openStore(await makeRoot());
    const encoded = reference(store, store.sessionId);
    const initial = order === "reference-first" ? encoded : "entry-1";
    const alias = order === "reference-first" ? "entry-1" : encoded;
    const first = committedId(
      await commit(store, { sourceIds: [initial], notes: { "current-work.md": "generated\n" } }),
    );
    await rm(view(store));
    expect(
      await commit(store, {
        expectedRevision: first,
        sourceIds: [alias],
        notes: { "current-work.md": "same evidence\n" },
      }),
    ).toMatchObject({ kind: "conflict", reason: "curation" });
  },
);

test("a deleted note's old evidence stays excluded after new evidence regenerates it", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await rm(view(store));
  const second = committedId(
    await commit(store, {
      expectedRevision: first,
      sourceIds: ["source-2"],
      notes: { "current-work.md": "regenerated\n" },
      curatedNotes: ["current-work.md"],
    }),
  );
  await rm(view(store));
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

test("a learning check without foreign exclusions does not traverse ancestry", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const proposal = baseProposal(store, {
    ...learning,
    baseRevision: { sessionId: "unavailable", revisionId: "missing" },
  });
  expect(
    await store.run(
      learningConflict(store.baseDir, proposal, () =>
        Effect.fail(new Error("Unexpected ancestor read.")),
      ),
    ),
  ).toBeUndefined();
});

test("a deleted project learning cannot be recreated through a source alias", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(
    await commit(store, { ...learning, sourceIds: [reference(store, store.sessionId)] }),
  );
  await rm(join(store.baseDir, "learnings", "index.md"));
  expect(
    await commit(store, {
      ...learning,
      expectedRevision: first,
      sourceIds: ["entry-1"],
      expectedLearnings: { "index.md": { digest: null, sequence: 1 } },
    }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
});

test("a deleted project learning allows an independent session with the same entry id", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const first = await openStore(root, { sessionId: "first" });
  committedId(await commit(first, { ...learning, sourceIds: [reference(first, "first")] }));
  await rm(join(first.baseDir, "learnings", "index.md"));
  const second = await openStore(root, { sessionId: "second" });
  expect(
    await commit(second, {
      ...learning,
      sourceIds: [reference(second, "second")],
      expectedLearnings: { "index.md": { digest: null, sequence: 1 } },
    }),
  ).toMatchObject({ kind: "committed" });
});

test("a fork cannot recreate a deleted project learning from its inherited entry", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const parentRevision = committedId(
    await commit(parent, { ...learning, sourceIds: [reference(parent, "parent")] }),
  );
  await rm(join(parent.baseDir, "learnings", "index.md"));
  const child = await openStore(root, { sessionId: "child" });
  expect(
    await commit(child, {
      ...learning,
      baseRevision: { sessionId: "parent", revisionId: parentRevision },
      sourceIds: [reference(child, "child")],
      expectedLearnings: { "index.md": { digest: null, sequence: 1 } },
    }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
});

test("learning provenance advances for matching views when another committed view changed", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  committedId(
    await commit(store, {
      learnings: { "index.md": "first\n", "guide.md": "guide\n" },
      expectedLearnings: {
        "index.md": { digest: null, sequence: null },
        "guide.md": { digest: null, sequence: null },
      },
    }),
  );
  await writeFile(join(store.baseDir, "learnings", "index.md"), "external edit\n");
  await store.run(
    publishProjectGenerated(store.baseDir, {
      learnings: { "index.md": "first\n", "guide.md": "guide\n" },
      sourceIds: ["entry-2"],
      sequence: 2,
    }),
  );
  const state = await store.run(readProjectCuration(store.baseDir));
  expect(state.generated["index.md"]?.sequence).toBe(1);
  expect(state.generated["guide.md"]).toMatchObject({
    sequence: 2,
    consumedSourceIds: ["entry-2"],
  });
  expect(state.curated).toEqual({});
});

test("inspectCuration writes curation.json only when a record changes", async ({ makeRoot }) => {
  const recorder = interruptingWriter(() => false);
  const store = await openStore(await makeRoot(), { write: recorder.write });
  committedId(await commit(store, { notes: { "current-work.md": "generated\n" } }));
  await writeFile(view(store), "user edit\n");
  await store.inspectCuration(null);
  await store.inspectCuration(null);
  expect(recorder.writes.filter((path) => path.endsWith("curation.json"))).toHaveLength(1);
});

async function forkedParent(
  root: string,
  change: "edited" | "deleted",
): Promise<{ parent: TestStore; revisionId: string }> {
  const parent = await openStore(root, { sessionId: "parent" });
  const revisionId = committedId(
    await commit(parent, {
      sourceIds: [reference(parent, "parent")],
      notes: { "current-work.md": "generated\n" },
    }),
  );
  if (change === "edited") {
    await writeFile(view(parent), "user correction\n");
  } else {
    await rm(view(parent));
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
    await commit(child, {
      ...recreate,
      sourceIds: [reference(parent, "child", "entry-2")],
      curatedNotes: ["current-work.md"],
    }),
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

test("a fork can inherit curation after 130 ordinary parent revisions", async ({ makeRoot }) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  let revisionId: string | null = null;
  for (let index = 0; index < 130; index++) {
    revisionId = committedId(
      // oxlint-disable-next-line no-await-in-loop -- Each commit uses the previous revision as its base.
      await commit(parent, {
        expectedRevision: revisionId,
        baseRevision: revisionId === null ? null : { sessionId: "parent", revisionId },
      }),
    );
  }
  if (revisionId === null) {
    throw new Error("Missing parent revision.");
  }
  await rm(view(parent));
  const child = await openStore(root, { sessionId: "child" });
  expect(
    (await child.inspectCuration({ sessionId: "parent", revisionId })).notes["current-work.md"],
  ).toMatchObject({
    kind: "deleted",
  });
}, 60_000);

test("a fork rejects a cycle in ancestor revision pointers", async ({ makeRoot }) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const revisionId = committedId(await commit(parent, {}));
  const path = join(parent.sessionDir, "revisions", `${revisionId}.json`);
  const revision: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Value.Check(revisionSchema, revision)) {
    throw new Error("Invalid revision fixture.");
  }
  revision.baseRevision = { sessionId: "parent", revisionId };
  await writeFile(path, `${JSON.stringify(revision)}\n`);
  const child = await openStore(root, { sessionId: "child" });
  await expect(child.inspectCuration({ sessionId: "parent", revisionId })).rejects.toThrow(
    "Damaged ancestor memory lineage",
  );
});

test("a fork rejects a missing ancestor revision instead of losing curation ancestry", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const parent = await openStore(root, { sessionId: "parent" });
  const revisionId = committedId(await commit(parent, {}));
  const path = join(parent.sessionDir, "revisions", `${revisionId}.json`);
  const revision: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Value.Check(revisionSchema, revision)) {
    throw new Error("Invalid revision fixture.");
  }
  revision.baseRevision = { sessionId: "parent", revisionId: "missing" };
  await writeFile(path, `${JSON.stringify(revision)}\n`);
  const child = await openStore(root, { sessionId: "child" });
  await expect(child.inspectCuration({ sessionId: "parent", revisionId })).rejects.toThrow(
    "Damaged ancestor memory lineage",
  );
});

function curationFile(store: TestStore): string {
  return join(store.sessionDir, "curation.json");
}

async function pendingAncestor(
  root: string,
  options: {
    r1Notes?: Record<string, string>;
    beforeR2?: (ancestor: TestStore) => Promise<void>;
    r2?: Partial<MemoryProposal>;
  } = {},
): Promise<{ ancestor: TestStore; r1: string; r2: string }> {
  const ancestor = await openStore(root, { sessionId: "ancestor" });
  const evidence = { sourceIds: [reference(ancestor, "ancestor")] };
  const r1 = committedId(
    await commit(ancestor, {
      ...evidence,
      notes: { "current-work.md": "one\n", ...options.r1Notes },
    }),
  );
  await options.beforeR2?.(ancestor);
  const failing = await openStore(root, {
    sessionId: "ancestor",
    write: interruptingWriter((path) => path.includes(`${sep}current${sep}`)).write,
  });
  await expect(
    commit(failing, {
      ...evidence,
      expectedRevision: r1,
      baseRevision: { sessionId: "ancestor", revisionId: r1 },
      notes: { "current-work.md": "two\n", "journey.md": "journey\n" },
      ...options.r2,
    }),
  ).rejects.toThrow("Injected interruption");
  const head = await Effect.runPromise(readHead(ancestor.sessionDir));
  if (head === undefined || head.materialized || head.revisionId === r1) {
    throw new Error("Expected a pending ancestor head after R1.");
  }
  expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe("one\n");
  expect(await readOptional(view(ancestor, "journey.md"))).toBeUndefined();
  return { ancestor, r1, r2: head.revisionId };
}

async function expectRepairedAncestor(ancestor: TestStore, r2: string): Promise<void> {
  expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe("two\n");
  expect(await readFile(view(ancestor, "journey.md"), "utf8")).toBe("journey\n");
  expect(await Effect.runPromise(readHead(ancestor.sessionDir))).toMatchObject({
    revisionId: r2,
    materialized: true,
  });
}

test("a child inspection based on R1 repairs the ancestor's pending R2 first, so neither curation records its unwritten views", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor, r1, r2 } = await pendingAncestor(root);
  const child = await openStore(root, { sessionId: "child" });
  expect(await child.inspectCuration({ sessionId: "ancestor", revisionId: r1 })).toEqual({
    version: 1,
    notes: {},
  });
  expect(await readOptional(curationFile(child))).toBeUndefined();
  expect(await readOptional(curationFile(ancestor))).toBeUndefined();
  await expectRepairedAncestor(ancestor, r2);
  expect((await child.inheritRevision({ sessionId: "ancestor", revisionId: r1 }))?.notes).toEqual({
    "current-work.md": "one\n",
  });
});

test("a child commit based on R1 repairs the ancestor's pending R2 first and commits its explicit work note with R1's inheritance", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor, r1, r2 } = await pendingAncestor(root);
  const child = await openStore(root, { sessionId: "child" });
  const base = { sessionId: "ancestor", revisionId: r1 };
  const committed = committedId(
    await commit(child, {
      baseRevision: base,
      sourceIds: [reference(ancestor, "child")],
      notes: { "current-work.md": "child work\n" },
    }),
  );
  const revision = await child.readRevision(committed);
  expect(revision?.baseRevision).toEqual(base);
  expect(revision?.notes).toEqual({ "current-work.md": "child work\n" });
  expect(await readFile(view(child, "current-work.md"), "utf8")).toBe("child work\n");
  expect(await readOptional(curationFile(child))).toBeUndefined();
  expect(await readOptional(curationFile(ancestor))).toBeUndefined();
  await expectRepairedAncestor(ancestor, r2);
});

function curationWrites(writes: readonly string[]): string[] {
  return writes.filter((path) => path.endsWith("curation.json"));
}

test("a pending ancestor view that differs from R1 and R2 stays an external edit that both curations record once and an overwrite conflicts on", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor, r1, r2 } = await pendingAncestor(root);
  await writeFile(view(ancestor, "current-work.md"), "user edit\n");
  const recorder = interruptingWriter(() => false);
  const child = await openStore(root, { sessionId: "child", write: recorder.write });
  const base = { sessionId: "ancestor", revisionId: r1 };
  expect((await child.inspectCuration(base)).notes).toEqual({
    "current-work.md": {
      kind: "edited",
      digest: digest("user edit\n"),
      consumedSourceIds: [reference(ancestor, "ancestor"), reference(ancestor, "child")],
    },
  });
  expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe("user edit\n");
  expect(await readFile(view(ancestor, "journey.md"), "utf8")).toBe("journey\n");
  expect(JSON.parse(await readFile(curationFile(ancestor), "utf8"))).toEqual({
    version: 1,
    notes: {
      "current-work.md": {
        kind: "edited",
        digest: digest("user edit\n"),
        consumedSourceIds: [reference(ancestor, "ancestor")],
      },
    },
  });
  expect(curationWrites(recorder.writes)).toHaveLength(2);
  await child.inspectCuration(base);
  expect(curationWrites(recorder.writes)).toHaveLength(2);
  expect(
    await commit(child, {
      baseRevision: base,
      sourceIds: [reference(ancestor, "child", "entry-2")],
      notes: { "current-work.md": "child overwrite\n" },
    }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  expect(
    await commit(ancestor, {
      expectedRevision: r2,
      sourceIds: [reference(ancestor, "ancestor", "entry-2")],
      notes: { "current-work.md": "ancestor overwrite\n" },
    }),
  ).toMatchObject({ kind: "conflict", reason: "curation" });
  expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe("user edit\n");
});

test.for(["note", "current directory"] as const)(
  "a deleted %s of a materialized ancestor head is not recreated, both curations record the deletion, and its consumed evidence cannot recreate the note",
  async (removed, { makeRoot }) => {
    const root = await makeRoot();
    const ancestor = await openStore(root, { sessionId: "ancestor" });
    const r1 = committedId(
      await commit(ancestor, {
        sourceIds: [reference(ancestor, "ancestor")],
        notes: { "current-work.md": "one\n" },
      }),
    );
    await rm(
      removed === "note" ? view(ancestor, "current-work.md") : join(ancestor.sessionDir, "current"),
      { recursive: true },
    );
    const child = await openStore(root, { sessionId: "child" });
    const base = { sessionId: "ancestor", revisionId: r1 };
    expect((await child.inspectCuration(base)).notes).toEqual({
      "current-work.md": {
        kind: "deleted",
        consumedSourceIds: [reference(ancestor, "ancestor"), reference(ancestor, "child")],
      },
    });
    expect(JSON.parse(await readFile(curationFile(ancestor), "utf8"))).toEqual({
      version: 1,
      notes: {
        "current-work.md": {
          kind: "deleted",
          consumedSourceIds: [reference(ancestor, "ancestor")],
        },
      },
    });
    expect(
      await commit(child, {
        baseRevision: base,
        sourceIds: [reference(ancestor, "child")],
        notes: { "current-work.md": "recreated\n" },
      }),
    ).toMatchObject({ kind: "conflict", reason: "curation" });
    expect(await readOptional(view(ancestor, "current-work.md"))).toBeUndefined();
    expect(await readOptional(view(child, "current-work.md"))).toBeUndefined();
  },
);

test("an ancestor reopened after a child inspection repaired it keeps R2's views, and neither session gains curation or rewrites curation.json on repeated inspection", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { r1, r2 } = await pendingAncestor(root);
  const recorder = interruptingWriter(() => false);
  const child = await openStore(root, { sessionId: "child", write: recorder.write });
  const base = { sessionId: "ancestor", revisionId: r1 };
  await child.inspectCuration(base);
  const repaired = recorder.writes.length;
  const reopened = await openStore(root, { sessionId: "ancestor", write: recorder.write });
  await expectRepairedAncestor(reopened, r2);
  expect(await reopened.inspectCuration(null)).toEqual({ version: 1, notes: {} });
  expect(await child.inspectCuration(base)).toEqual({ version: 1, notes: {} });
  expect(curationWrites(recorder.writes)).toEqual([]);
  expect(
    recorder.writes.slice(repaired).filter((path) => path.startsWith(reopened.sessionDir)),
  ).toEqual([]);
});

interface RepairFault {
  armed: boolean;
  matches: (path: string) => boolean;
  failure: Error;
}

function faultingWriter(fault: RepairFault): TestWrite {
  return async (path, contents) => {
    if (fault.armed && fault.matches(path)) {
      throw fault.failure;
    }
    await writeDurable(path, contents);
  };
}

async function revisionCount(store: TestStore): Promise<number> {
  try {
    return (await readdir(join(store.sessionDir, "revisions"))).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function curatedPendingFixture(
  root: string,
  write: TestWrite,
): Promise<{ ancestor: TestStore; child: TestStore; r1: string; r2: string; c1: string }> {
  const { ancestor, r1, r2 } = await pendingAncestor(root, {
    r1Notes: { "topic-a.md": "topic\n" },
    async beforeR2(store) {
      await rm(view(store, "topic-a.md"));
      await store.inspectCuration(null);
    },
    r2: {
      notes: { "current-work.md": "two\n", "journey.md": "journey\n" },
      learnings: { "index.md": "Learned\n" },
      expectedLearnings: { "index.md": { digest: null, sequence: null } },
    },
  });
  const child = await openStore(root, { sessionId: "child", write });
  const c1 = committedId(
    await commit(child, {
      sourceIds: [reference(child, "child", "entry-2")],
      notes: { "topic-child.md": "child\n", "topic-old.md": "old\n" },
    }),
  );
  await rm(view(child, "topic-old.md"));
  await child.inspectCuration(null);
  await writeFile(view(child, "topic-child.md"), "child edit\n");
  return { ancestor, child, r1, r2, c1 };
}

const repairFaults = [
  {
    label: "note repair",
    matches: (ancestor: TestStore, path: string) =>
      path.startsWith(join(ancestor.sessionDir, "current")),
  },
  {
    label: "learning repair",
    matches: (_ancestor: TestStore, path: string) => path.endsWith(`learnings${sep}index.md`),
  },
  {
    label: "materialized-head",
    matches: (ancestor: TestStore, path: string) => path === join(ancestor.sessionDir, "head.json"),
  },
] as const;

const entryPaths = ["inspection", "commit"] as const;

function childEntry(
  child: TestStore,
  entry: (typeof entryPaths)[number],
  overrides: Partial<MemoryProposal>,
): Effect.Effect<string, unknown, StorageServices> {
  return entry === "inspection"
    ? child.store.inspectCuration(overrides.baseRevision ?? null).pipe(Effect.as("inspected"))
    : child
        .commitEffect(
          baseProposal(child, {
            sourceIds: [reference(child, "child", "entry-3")],
            notes: { "current-work.md": "child work\n" },
            ...overrides,
          }),
        )
        .pipe(Effect.map((result) => result.kind));
}

const retriedOutcomes = { inspection: "inspected", commit: "committed" } satisfies Record<
  (typeof entryPaths)[number],
  string
>;

test.for(repairFaults.flatMap((fault) => entryPaths.map((entry) => ({ fault, entry }))))(
  "a failed ancestor $fault.label write rejects the child $entry with the original error, keeps both curation files' bytes, publishes no child revision, and a retry recovers without false curation",
  async ({ fault: { matches }, entry }, { makeRoot }) => {
    const root = await makeRoot();
    const fault: RepairFault = {
      armed: false,
      matches: () => false,
      failure: new Error("Injected ancestor repair failure."),
    };
    const { ancestor, child, r1, r2, c1 } = await curatedPendingFixture(
      root,
      faultingWriter(fault),
    );
    const ancestorCuration = await readOptional(curationFile(ancestor));
    const childCuration = await readOptional(curationFile(child));
    expect(ancestorCuration).toContain("topic-a.md");
    expect(childCuration).toContain("topic-old.md");
    expect(childCuration).not.toContain("topic-child.md");
    fault.matches = (path) => matches(ancestor, path);
    fault.armed = true;
    const run = childEntry(child, entry, {
      expectedRevision: c1,
      baseRevision: { sessionId: "ancestor", revisionId: r1 },
    });
    await expect(child.run(run)).rejects.toBe(fault.failure);
    expect(await readOptional(curationFile(ancestor))).toBe(ancestorCuration);
    expect(await readOptional(curationFile(child))).toBe(childCuration);
    expect(await child.currentHead()).toBe(c1);
    expect(await revisionCount(child)).toBe(1);
    expect((await Effect.runPromise(readHead(ancestor.sessionDir)))?.materialized).toBe(false);
    fault.armed = false;
    expect(await child.run(run)).toBe(retriedOutcomes[entry]);
    await expectRepairedAncestor(ancestor, r2);
    expect(await readFile(join(ancestor.baseDir, "learnings", "index.md"), "utf8")).toBe(
      "Learned\n",
    );
    expect(await readOptional(curationFile(ancestor))).toBe(ancestorCuration);
    const evidence = [reference(child, "child", "entry-2")];
    expect(JSON.parse(await readFile(curationFile(child), "utf8"))).toEqual({
      version: 1,
      notes: {
        "topic-child.md": {
          kind: "edited",
          digest: digest("child edit\n"),
          consumedSourceIds: evidence,
        },
        "topic-old.md": { kind: "deleted", consumedSourceIds: evidence },
        "topic-a.md": {
          kind: "deleted",
          consumedSourceIds: [reference(ancestor, "ancestor"), reference(ancestor, "child")],
        },
      },
    });
    expect(await revisionCount(child)).toBe(entry === "commit" ? 2 : 1);
  },
);

function isAncestorView(path: string, name: string): boolean {
  return path.endsWith(join("sessions", "ancestor", "current", name));
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }
  return Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : Cause.squash(exit.cause);
}

function gatedJourneyRepair(failures: { journey?: Error; work?: Error }): {
  write: TestWrite;
  armed: { value: boolean };
  entered: Promise<undefined>;
  settled: { value: boolean };
  release: () => void;
} {
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const armed = { value: false };
  const settled = { value: false };
  return {
    armed,
    entered: entered.promise,
    settled,
    release: () => {
      gate.resolve(undefined);
    },
    write: async (path, contents) => {
      if (armed.value && isAncestorView(path, "journey.md")) {
        entered.resolve(undefined);
        await gate.promise;
        try {
          if (failures.journey !== undefined) {
            throw failures.journey;
          }
          await writeDurable(path, contents);
        } finally {
          settled.value = true;
        }
        return;
      }
      if (armed.value && isAncestorView(path, "current-work.md") && failures.work !== undefined) {
        await entered.promise;
        throw failures.work;
      }
      await writeDurable(path, contents);
    },
  };
}

async function contender(root: string): Promise<{
  queue: (read: () => boolean) => Promise<{ observed: Promise<boolean> }>;
}> {
  const queued = Promise.withResolvers<undefined>();
  const armed = { value: false };
  const store = await openStore(root, {
    sessionId: "contender",
    lock: {
      async publish(source, ticket) {
        await link(source, ticket);
        if (armed.value) {
          queued.resolve(undefined);
        }
      },
    },
  });
  return {
    async queue(read) {
      armed.value = true;
      const observed = store.lock(async () => await Promise.resolve(read()));
      await Promise.race([queued.promise, observed]);
      return { observed };
    },
  };
}

const partialRepairs = [
  {
    label: "a write fails beside a completed sibling",
    journey: false,
    work: true,
    interrupt: false,
  },
  { label: "interruption races a failing write", journey: true, work: false, interrupt: true },
  { label: "interruption alone", journey: false, work: false, interrupt: true },
] as const;

test.for(partialRepairs.flatMap((repair) => entryPaths.map((entry) => ({ repair, entry }))))(
  "when $repair.label during the ancestor repair of a child $entry, the lock outlives every started write and a retry completes recovery without false curation or a duplicate commit",
  async ({ repair: { journey, work, interrupt }, entry }, { makeRoot, onTestFinished }) => {
    const root = await makeRoot();
    const failure = new Error("Injected partial repair failure.");
    const gated = gatedJourneyRepair({
      ...(journey ? { journey: failure } : {}),
      ...(work ? { work: failure } : {}),
    });
    onTestFinished(gated.release);
    const { ancestor, r1, r2 } = await pendingAncestor(root);
    const child = await openStore(root, { sessionId: "child", write: gated.write });
    const waiting = await contender(root);
    gated.armed.value = true;
    const run = childEntry(child, entry, {
      baseRevision: { sessionId: "ancestor", revisionId: r1 },
    });
    const fiber = child.fork(run);
    const exited = Effect.runPromise(Fiber.await(fiber));
    expect(
      await Promise.race([gated.entered.then(() => "entered"), exited.then(() => "exited")]),
    ).toBe("entered");
    if (interrupt) {
      fiber.interruptUnsafe();
    }
    const { observed } = await waiting.queue(() => gated.settled.value);
    gated.release();
    const exit = await exited;
    expect(await observed).toBe(true);
    expect(failureOf(exit)).toBe(journey || work ? failure : "interrupted");
    expect(await readOptional(view(ancestor, "journey.md"))).toBe(
      journey ? undefined : "journey\n",
    );
    expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe(
      work ? "one\n" : "two\n",
    );
    expect((await Effect.runPromise(readHead(ancestor.sessionDir)))?.materialized).toBe(false);
    expect(await readOptional(curationFile(ancestor))).toBeUndefined();
    expect(await readOptional(curationFile(child))).toBeUndefined();
    expect(await child.currentHead()).toBeNull();
    gated.armed.value = false;
    expect(await child.run(run)).toBe(retriedOutcomes[entry]);
    await expectRepairedAncestor(ancestor, r2);
    expect(await readOptional(curationFile(ancestor))).toBeUndefined();
    expect(await readOptional(curationFile(child))).toBeUndefined();
    expect(await revisionCount(child)).toBe(entry === "commit" ? 1 : 0);
  },
);

test.for(entryPaths)(
  "a pending ancestor head naming a missing revision rejects the child %s with the ancestor's session directory and writes no curation",
  async (entry, { makeRoot }) => {
    const root = await makeRoot();
    const { ancestor, r1, r2 } = await pendingAncestor(root);
    await rm(join(ancestor.sessionDir, "revisions", `${r2}.json`));
    const child = await openStore(root, { sessionId: "child" });
    await expect(
      child.run(
        childEntry(child, entry, { baseRevision: { sessionId: "ancestor", revisionId: r1 } }),
      ),
    ).rejects.toThrow(
      `Memory head in ${ancestor.sessionDir} names missing revision ${r2}; files are preserved.`,
    );
    expect(await readOptional(curationFile(ancestor))).toBeUndefined();
    expect(await readOptional(curationFile(child))).toBeUndefined();
    expect(await child.currentHead()).toBeNull();
  },
);

test("a null or same-session base does not repair a pending fork ancestor", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor } = await pendingAncestor(root);
  const child = await openStore(root, { sessionId: "child" });
  expect(await child.inspectCuration(null)).toEqual({ version: 1, notes: {} });
  const own = committedId(await commit(child, { notes: { "topic-child.md": "child\n" } }));
  await child.inspectCuration({ sessionId: "child", revisionId: own });
  committedId(
    await commit(child, {
      expectedRevision: own,
      baseRevision: { sessionId: "child", revisionId: own },
      notes: { "topic-child.md": "again\n" },
    }),
  );
  expect((await Effect.runPromise(readHead(ancestor.sessionDir)))?.materialized).toBe(false);
  expect(await readOptional(view(ancestor, "journey.md"))).toBeUndefined();
  expect(await readOptional(curationFile(ancestor))).toBeUndefined();
});

test.for(["missing revision", "foreign-project identity"] as const)(
  "a base with a %s does not repair the ancestor, inherits nothing, and a commit on it is rejected as unavailable",
  async (unavailable, { makeRoot }) => {
    const root = await makeRoot();
    const { ancestor, r1 } = await pendingAncestor(root);
    let base = { sessionId: "ancestor", revisionId: "missing" };
    if (unavailable === "foreign-project identity") {
      base = { sessionId: "ancestor", revisionId: r1 };
      await writeFile(
        join(ancestor.sessionDir, "identity.json"),
        JSON.stringify({
          version: 1,
          projectId: "f".repeat(64),
          projectRoot: ancestor.projectRoot,
          sessionId: "ancestor",
        }),
      );
    }
    const child = await openStore(root, { sessionId: "child" });
    expect(await child.inspectCuration(base)).toEqual({ version: 1, notes: {} });
    await expect(commit(child, { baseRevision: base })).rejects.toThrow(
      `The proposal's base revision ${base.revisionId} is unavailable.`,
    );
    expect((await Effect.runPromise(readHead(ancestor.sessionDir)))?.materialized).toBe(false);
    expect(await readFile(view(ancestor, "current-work.md"), "utf8")).toBe("one\n");
    expect(await readOptional(view(ancestor, "journey.md"))).toBeUndefined();
    expect(await readOptional(curationFile(ancestor))).toBeUndefined();
    expect(await readOptional(curationFile(child))).toBeUndefined();
  },
);

test("a child inspection rejects a pending ancestor's symlinked current directory before repairing through it", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor, r1 } = await pendingAncestor(root);
  const outside = await makeRoot();
  const current = join(ancestor.sessionDir, "current");
  await rm(current, { recursive: true });
  await symlink(outside, current, "dir");
  const child = await openStore(root, { sessionId: "child" });
  await expect(child.inspectCuration({ sessionId: "ancestor", revisionId: r1 })).rejects.toThrow(
    "symlink",
  );
  expect(await readdir(outside)).toEqual([]);
  expect((await Effect.runPromise(readHead(ancestor.sessionDir)))?.materialized).toBe(false);
  expect(await readOptional(curationFile(child))).toBeUndefined();
});

test("a child inspection rejects a damaged ancestor head, keeps its bytes, and writes no curation", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const { ancestor, r1 } = await pendingAncestor(root);
  const head = join(ancestor.sessionDir, "head.json");
  await writeFile(head, "{damaged");
  const child = await openStore(root, { sessionId: "child" });
  await expect(child.inspectCuration({ sessionId: "ancestor", revisionId: r1 })).rejects.toThrow(
    `Invalid JSON at ${head}.`,
  );
  expect(await readFile(head, "utf8")).toBe("{damaged");
  expect(await readOptional(curationFile(child))).toBeUndefined();
  expect(await readOptional(curationFile(ancestor))).toBeUndefined();
});

test("an inherited regenerated note does not consume its new evidence", async ({ makeRoot }) => {
  const root = await makeRoot();
  const { parent, revisionId } = await forkedParent(root, "deleted");
  const regenerated = committedId(
    await commit(parent, {
      expectedRevision: revisionId,
      sourceIds: [reference(parent, "parent", "entry-2")],
      notes: { "current-work.md": "regenerated\n" },
      curatedNotes: ["current-work.md"],
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

test("inspectCuration reads the revision chain only for a curated note without a view whose file no longer matches its record", async ({
  makeRoot,
}) => {
  const sessionDir = join(await makeRoot(), "session");
  await mkdir(join(sessionDir, "current"), { recursive: true });
  const edited = { kind: "edited", digest: digest("Mine.\n"), consumedSourceIds: ["s1"] } as const;
  await writeFile(
    join(sessionDir, "curation.json"),
    JSON.stringify({ version: 1, notes: { "current-work.md": edited, "journey.md": edited } }),
  );
  await writeFile(join(sessionDir, "current", "current-work.md"), "Mine.\n");
  const asked: string[][] = [];
  const earlier = (names: ReadonlySet<string>) => {
    asked.push([...names]);
    return Effect.succeed(names);
  };
  const state = await runStorage(inspectCuration(sessionDir, {}, {}, earlier));
  expect(asked).toEqual([["journey.md"]]);
  expect(state.notes).toEqual({
    "current-work.md": edited,
    "journey.md": { kind: "deleted", consumedSourceIds: ["s1"] },
  });
  asked.length = 0;
  await runStorage(inspectCuration(sessionDir, {}, {}, earlier));
  expect(asked).toEqual([]);
});
