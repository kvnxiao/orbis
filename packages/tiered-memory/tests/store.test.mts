import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { CommitResult, ConflictReason, MemoryProposal } from "../src/domain/proposal.ts";
import { readText, writeDurable } from "../src/storage/files.ts";
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

async function pendingLearningHead(
  store: MemoryStore,
  sequence: number,
  learnings: Record<string, string>,
  expectedLearnings: MemoryProposal["expectedLearnings"],
): Promise<void> {
  const { expectedRevision, ...fields } = baseProposal(store, {
    notes: {},
    learnings,
    expectedLearnings,
  });
  const id = randomUUID();
  await mkdir(join(store.sessionDir, "revisions"), { recursive: true });
  await writeFile(
    join(store.sessionDir, "revisions", `${id}.json`),
    JSON.stringify({ version: 1, id, parentRevisionId: expectedRevision, sequence, ...fields }),
  );
  await writeFile(
    join(store.sessionDir, "head.json"),
    JSON.stringify({
      version: 1,
      revisionId: id,
      views: {
        notes: {},
        learnings: Object.fromEntries(
          Object.entries(learnings).map(([name, content]) => [name, digest(content)]),
        ),
      },
      materialized: false,
    }),
  );
  await writeFile(
    join(store.baseDir, "sessions", "_project", "sequence.json"),
    JSON.stringify({ version: 1, value: sequence }),
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
    .filter((path) => !path.startsWith("sessions/.lock/"));
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

test("a failed note write keeps the project lock until sibling writes finish", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const gate = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const failure = new Error("note write failed");
  const store = await openStore(root, {
    write: async (path, contents) => {
      if (path.endsWith("journey.md")) {
        started.resolve(undefined);
        await gate.promise;
      }
      if (path.endsWith("current-work.md")) {
        await started.promise;
        throw failure;
      }
      await writeDurable(path, contents);
    },
  });
  const pending = commit(store, {
    notes: { "current-work.md": "work", "journey.md": "old writer" },
  });
  await started.promise;
  const later = withProjectLock(
    join(store.baseDir, "sessions"),
    { signal: new AbortController().signal, write: writeDurable },
    async () => {
      await mkdir(join(store.sessionDir, "current"), { recursive: true });
      await writeFile(view(store, "journey.md"), "later edit");
    },
  );
  const completedBeforeRelease = await Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 50);
    }),
  ]);
  gate.resolve(undefined);
  expect(completedBeforeRelease).toBe(false);
  await expect(pending).rejects.toBe(failure);
  await later;
  expect(await readFile(view(store, "journey.md"), "utf8")).toBe("later edit");
});

test("a failed repair write keeps the project lock until sibling repairs finish", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith("current-work.md")).write,
  });
  await expect(
    commit(interrupted, { notes: { "current-work.md": "work", "journey.md": "journey" } }),
  ).rejects.toThrow("Injected interruption");
  await rm(view(interrupted, "journey.md"));
  const gate = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const failure = new Error("repair write failed");
  const pending = openStore(root, {
    write: async (path, contents) => {
      if (path.endsWith("journey.md")) {
        started.resolve(undefined);
        await gate.promise;
      }
      if (path.endsWith("current-work.md")) {
        await started.promise;
        throw failure;
      }
      await writeDurable(path, contents);
    },
  });
  await started.promise;
  const completedBeforeRelease = await Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 50);
    }),
  ]);
  gate.resolve(undefined);
  expect(completedBeforeRelease).toBe(false);
  await expect(pending).rejects.toBe(failure);
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

test("open finishes an interrupted learning update from the previous generated view", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const firstStore = await openStore(root);
  const first = committedId(await commit(firstStore, learning));
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(interrupted, {
      notes: {},
      expectedRevision: first,
      learnings: { "index.md": "Updated learning\n" },
      expectedLearnings: { "index.md": { digest: digest("Learning\n"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  expect(await readFile(join(reopened.baseDir, "learnings", "index.md"), "utf8")).toBe(
    "Updated learning\n",
  );
  const state: unknown = JSON.parse(
    await readFile(join(reopened.baseDir, "sessions", "_project", "state.json"), "utf8"),
  );
  expect(state).toMatchObject({
    generated: { "index.md": { sequence: 2, digest: digest("Updated learning\n") } },
  });
  expect((await readHead(reopened.sessionDir, reopened.access.signal))?.materialized).toBe(true);
});

test("open repairs and publishes each learning from a partially written revision", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const firstStore = await openStore(root);
  const first = committedId(
    await commit(firstStore, {
      notes: {},
      learnings: { "index.md": "Old index\n", "procedure.md": "Old procedure\n" },
      expectedLearnings: {
        "index.md": { digest: null, sequence: null },
        "procedure.md": { digest: null, sequence: null },
      },
    }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(interrupted, {
      notes: {},
      expectedRevision: first,
      learnings: { "index.md": "New index\n", "procedure.md": "New procedure\n" },
      expectedLearnings: {
        "index.md": { digest: digest("Old index\n"), sequence: 1 },
        "procedure.md": { digest: digest("Old procedure\n"), sequence: 1 },
      },
    }),
  ).rejects.toThrow("Injected interruption");
  const reopened = await openStore(root);
  const learnings = join(reopened.baseDir, "learnings");
  expect(await readFile(join(learnings, "index.md"), "utf8")).toBe("New index\n");
  expect(await readFile(join(learnings, "procedure.md"), "utf8")).toBe("New procedure\n");
  const state: unknown = JSON.parse(
    await readFile(join(reopened.baseDir, "sessions", "_project", "state.json"), "utf8"),
  );
  expect(state).toMatchObject({
    generated: { "index.md": { sequence: 2 }, "procedure.md": { sequence: 2 } },
  });
});

test("open publishes a repaired learning when a sibling learning was externally edited", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const firstStore = await openStore(root);
  const first = committedId(
    await commit(firstStore, {
      notes: {},
      learnings: { "index.md": "Old index\n", "procedure.md": "Old procedure\n" },
      expectedLearnings: {
        "index.md": { digest: null, sequence: null },
        "procedure.md": { digest: null, sequence: null },
      },
    }),
  );
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(interrupted, {
      notes: {},
      expectedRevision: first,
      learnings: { "index.md": "New index\n", "procedure.md": "New procedure\n" },
      expectedLearnings: {
        "index.md": { digest: digest("Old index\n"), sequence: 1 },
        "procedure.md": { digest: digest("Old procedure\n"), sequence: 1 },
      },
    }),
  ).rejects.toThrow("Injected interruption");
  const learnings = join(interrupted.baseDir, "learnings");
  await writeFile(join(learnings, "procedure.md"), "User procedure\n");
  await openStore(root);
  expect(await readFile(join(learnings, "index.md"), "utf8")).toBe("New index\n");
  expect(await readFile(join(learnings, "procedure.md"), "utf8")).toBe("User procedure\n");
  const state: unknown = JSON.parse(
    await readFile(join(interrupted.baseDir, "sessions", "_project", "state.json"), "utf8"),
  );
  expect(state).toMatchObject({
    generated: { "index.md": { sequence: 2 }, "procedure.md": { sequence: 1 } },
  });
});

test("open preserves an external learning edit after an interrupted update", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const firstStore = await openStore(root);
  const first = committedId(await commit(firstStore, learning));
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(interrupted, {
      notes: {},
      expectedRevision: first,
      learnings: { "index.md": "Pending\n" },
      expectedLearnings: { "index.md": { digest: digest("Learning\n"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const path = join(interrupted.baseDir, "learnings", "index.md");
  await writeFile(path, "User edit\n");
  await openStore(root);
  expect(await readFile(path, "utf8")).toBe("User edit\n");
});

test("an older interrupted head leaves a newer learning publication and its deletion untouched", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const firstStore = await openStore(root);
  const first = committedId(await commit(firstStore, learning));
  const interrupted = await openStore(root, {
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(interrupted, {
      notes: {},
      expectedRevision: first,
      learnings: { "index.md": "Old pending\n" },
      expectedLearnings: { "index.md": { digest: digest("Learning\n"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const path = join(interrupted.baseDir, "learnings", "index.md");
  await writeFile(path, "Newer learning\n");
  await writeFile(
    join(interrupted.baseDir, "sessions", "_project", "state.json"),
    JSON.stringify({
      version: 1,
      generated: {
        "index.md": {
          digest: digest("Newer learning\n"),
          consumedSourceIds: ["source-1"],
          sequence: 3,
        },
      },
      curated: {},
    }),
  );
  await rm(path);
  await openStore(root);
  await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("a new learning commit reconciles a prior accepted head before checking its predecessor", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const seed = await openStore(root, { sessionId: "seed" });
  committedId(
    await commit(seed, {
      notes: {},
      learnings: { "index.md": "old" },
      expectedLearnings: { "index.md": { digest: null, sequence: null } },
    }),
  );
  const older = await openStore(root, {
    sessionId: "older",
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
  });
  await expect(
    commit(older, {
      notes: {},
      learnings: { "index.md": "accepted older" },
      expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const newer = await openStore(root, { sessionId: "newer" });
  expect(
    await commit(newer, {
      notes: {},
      learnings: { "index.md": "stale newer" },
      expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
    }),
  ).toMatchObject({ kind: "conflict", reason: "learning" });
  expect(await readFile(join(newer.baseDir, "learnings", "index.md"), "utf8")).toBe(
    "accepted older",
  );
});

test("a new learning commit publishes bytes left before an interrupted provenance write", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const seed = await openStore(root, { sessionId: "seed" });
  committedId(
    await commit(seed, {
      notes: {},
      learnings: { "index.md": "old" },
      expectedLearnings: { "index.md": { digest: null, sequence: null } },
    }),
  );
  const older = await openStore(root, {
    sessionId: "older",
    write: interruptingWriter((path) => path.endsWith("state.json")).write,
  });
  await expect(
    commit(older, {
      notes: {},
      learnings: { "index.md": "accepted older" },
      expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const newer = await openStore(root, { sessionId: "newer" });
  expect(
    await commit(newer, {
      notes: {},
      learnings: { "index.md": "stale newer" },
      expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
    }),
  ).toMatchObject({ kind: "conflict", reason: "learning" });
});

test.for(["edited", "deleted"])(
  "a pending learning preserves an external $0 view before another commit",
  async (change, { makeRoot }) => {
    const root = await makeRoot();
    const seed = await openStore(root, { sessionId: "seed" });
    committedId(
      await commit(seed, {
        notes: {},
        learnings: { "index.md": "old" },
        expectedLearnings: { "index.md": { digest: null, sequence: null } },
      }),
    );
    const older = await openStore(root, {
      sessionId: "older",
      write: interruptingWriter((path) => path.endsWith(`learnings${sep}index.md`)).write,
    });
    await expect(
      commit(older, {
        notes: {},
        learnings: { "index.md": "pending" },
        expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
      }),
    ).rejects.toThrow("Injected interruption");
    const path = join(older.baseDir, "learnings", "index.md");
    if (change === "edited") {
      await writeFile(path, "user edit");
    } else {
      await rm(path);
    }
    const newer = await openStore(root, { sessionId: "newer" });
    expect(
      await commit(newer, {
        notes: {},
        learnings: { "index.md": "newer" },
        expectedLearnings: { "index.md": { digest: digest("old"), sequence: 1 } },
      }),
    ).toMatchObject({ kind: "conflict", reason: "curation" });
    expect(await readText(path, newer.access.signal)).toBe(
      change === "edited" ? "user edit" : undefined,
    );
  },
);

test("a pending learning in another session does not delay an unrelated learning commit", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const seed = await openStore(root, { sessionId: "seed" });
  committedId(
    await commit(seed, {
      notes: {},
      learnings: { "x.md": "old x", "y.md": "old y" },
      expectedLearnings: {
        "x.md": { digest: null, sequence: null },
        "y.md": { digest: null, sequence: null },
      },
    }),
  );
  const older = await openStore(root, {
    sessionId: "older",
    write: interruptingWriter((path) => path.endsWith(`learnings${sep}x.md`)).write,
  });
  await expect(
    commit(older, {
      notes: {},
      learnings: { "x.md": "pending x" },
      expectedLearnings: { "x.md": { digest: digest("old x"), sequence: 1 } },
    }),
  ).rejects.toThrow("Injected interruption");
  const newer = await openStore(root, { sessionId: "newer" });
  committedId(
    await commit(newer, {
      notes: {},
      learnings: { "y.md": "new y" },
      expectedLearnings: { "y.md": { digest: digest("old y"), sequence: 1 } },
    }),
  );
  expect((await readHead(older.sessionDir, older.access.signal))?.materialized).toBe(false);
  const learnings = join(seed.baseDir, "learnings");
  expect(await readFile(join(learnings, "x.md"), "utf8")).toBe("old x");
  expect(await readFile(join(learnings, "y.md"), "utf8")).toBe("new y");
});

test.for(["older", "newer"])(
  "pending overlapping learning heads recover in sequence order when $0 opens first",
  async (firstOpen, { makeRoot }) => {
    const root = await makeRoot();
    const seed = await openStore(root, { sessionId: "seed" });
    committedId(
      await commit(seed, {
        notes: {},
        learnings: { "x.md": "old x", "y.md": "old y", "z.md": "old z" },
        expectedLearnings: {
          "x.md": { digest: null, sequence: null },
          "y.md": { digest: null, sequence: null },
          "z.md": { digest: null, sequence: null },
        },
      }),
    );
    const older = await openStore(root, { sessionId: "older" });
    const newer = await openStore(root, { sessionId: "newer" });
    await pendingLearningHead(
      older,
      2,
      { "x.md": "older x", "y.md": "older y" },
      {
        "x.md": { digest: digest("old x"), sequence: 1 },
        "y.md": { digest: digest("old y"), sequence: 1 },
      },
    );
    await pendingLearningHead(
      newer,
      3,
      { "y.md": "newer y", "z.md": "newer z" },
      {
        "y.md": { digest: digest("old y"), sequence: 1 },
        "z.md": { digest: digest("old z"), sequence: 1 },
      },
    );
    await openStore(root, { sessionId: firstOpen });
    await openStore(root, { sessionId: firstOpen === "older" ? "newer" : "older" });
    const learnings = join(seed.baseDir, "learnings");
    expect(await readFile(join(learnings, "x.md"), "utf8")).toBe("older x");
    expect(await readFile(join(learnings, "y.md"), "utf8")).toBe("newer y");
    expect(await readFile(join(learnings, "z.md"), "utf8")).toBe("newer z");
  },
);

test("pending learning heads repair a three-head overlap chain from newest to oldest", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const seed = await openStore(root, { sessionId: "seed" });
  committedId(
    await commit(seed, {
      notes: {},
      learnings: { "x.md": "old x", "y.md": "old y", "z.md": "old z" },
      expectedLearnings: {
        "x.md": { digest: null, sequence: null },
        "y.md": { digest: null, sequence: null },
        "z.md": { digest: null, sequence: null },
      },
    }),
  );
  const older = await openStore(root, { sessionId: "older" });
  const middle = await openStore(root, { sessionId: "middle" });
  const newer = await openStore(root, { sessionId: "newer" });
  await pendingLearningHead(
    older,
    2,
    { "x.md": "older x", "y.md": "older y" },
    {
      "x.md": { digest: digest("old x"), sequence: 1 },
      "y.md": { digest: digest("old y"), sequence: 1 },
    },
  );
  await pendingLearningHead(
    middle,
    3,
    { "y.md": "middle y", "z.md": "middle z" },
    {
      "y.md": { digest: digest("old y"), sequence: 1 },
      "z.md": { digest: digest("old z"), sequence: 1 },
    },
  );
  await pendingLearningHead(
    newer,
    4,
    { "z.md": "newer z" },
    {
      "z.md": { digest: digest("old z"), sequence: 1 },
    },
  );
  await openStore(root, { sessionId: "older" });
  const learnings = join(seed.baseDir, "learnings");
  expect(await readFile(join(learnings, "x.md"), "utf8")).toBe("older x");
  expect(await readFile(join(learnings, "y.md"), "utf8")).toBe("middle y");
  expect(await readFile(join(learnings, "z.md"), "utf8")).toBe("newer z");
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

test("a changed validation result before head publication leaves only an unreferenced revision", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const first = committedId(await commit(store, { notes: { "current-work.md": "old" } }));
  const before = await revisionFiles(store);
  const result = await store.commit(
    baseProposal(store, { expectedRevision: first, notes: { "current-work.md": "new" } }),
    {
      async validate() {
        return (await revisionFiles(store)).length > before.length ? "evidence" : undefined;
      },
    },
  );
  expect(result).toMatchObject({ kind: "conflict", reason: "evidence", actualRevision: first });
  expect(await store.currentHead()).toBe(first);
  expect(await readFile(view(store), "utf8")).toBe("old");
  expect(await revisionFiles(store)).toHaveLength(before.length + 1);
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

test("opening and committing notes stay local when another session has a damaged head", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const damaged = await openStore(root, { sessionId: "damaged" });
  await writeFile(join(damaged.sessionDir, "head.json"), "{damaged");
  const healthy = await openStore(root, { sessionId: "healthy" });
  committedId(await commit(healthy, { notes: { "current-work.md": "healthy" } }));
  expect(await readFile(view(healthy), "utf8")).toBe("healthy");
  expect(await readFile(join(damaged.sessionDir, "head.json"), "utf8")).toBe("{damaged");
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

test("open rejects a managed ancestor symlink before writing a lock outside the project", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const outside = await makeRoot();
  const sentinel = join(outside, "sentinel.txt");
  await writeFile(sentinel, "keep");
  await symlink(outside, join(root, ".pi"), "dir");
  await expect(openStore(root)).rejects.toThrow("symlink");
  expect(await readFile(sentinel, "utf8")).toBe("keep");
  expect(await readdir(outside)).toEqual(["sentinel.txt"]);
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
