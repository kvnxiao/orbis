import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { CurationEvent } from "../src/domain/evidence.ts";
import type { CanonicalMemory } from "../src/pi/canonical-memory.ts";
import { curationCorrectedOn, NoteFreshness } from "../src/pi/note-freshness.ts";
import type { FreshnessView } from "../src/pi/note-freshness.ts";
import { inspectNoteFile, noteInspectionTimeoutMs } from "../src/pi/note-inspection.ts";
import type { NoteInspection } from "../src/pi/note-inspection.ts";
import { noteValidity } from "../src/pi/note-validity.ts";
import { presentationMessageType } from "../src/presentation/entries.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import { readText } from "../src/storage/files.ts";
import { runStorage } from "./storage-harness.mts";
import type { TestServices } from "./storage-harness.mts";
import {
  baseProposal,
  committedId,
  openRegistry,
  openStore,
  readOptional,
  test,
} from "./store-fixture.mts";
import { advance, controlledClock } from "./worker-fixture.mts";

const note = "current-work.md";

async function sessionDir(root: string, head: unknown, file: string | undefined): Promise<string> {
  const directory = join(root, "session");
  await mkdir(join(directory, "current"), { recursive: true });
  if (head !== undefined) {
    await writeFile(join(directory, "head.json"), JSON.stringify(head));
  }
  if (file !== undefined) {
    await writeFile(join(directory, "current", note), file);
  }
  return directory;
}

function headWith(view: string | undefined, materialized = true) {
  return {
    version: 1,
    revisionId: "r1",
    views: { notes: view === undefined ? {} : { [note]: digest(view) }, learnings: {} },
    materialized,
  };
}

async function inspect(
  directory: string,
  services: TestServices = {},
  curated?: CurationEvent,
): Promise<NoteInspection> {
  return await runStorage(inspectNoteFile(directory, note, curated), services);
}

test.for([
  ["no head", undefined, undefined, { kind: "verified", headRevisionId: null }],
  ["a matching file", headWith("Note."), "Note.", { kind: "verified", headRevisionId: "r1" }],
  [
    "a head without the note's view",
    headWith(undefined),
    "Other.",
    { kind: "verified", headRevisionId: "r1" },
  ],
  [
    "an unmaterialized head",
    headWith("Note.", false),
    "Older.",
    { kind: "pending", headRevisionId: "r1", unfinished: true },
  ],
  [
    "an edited file",
    headWith("Note."),
    "Edited.",
    { kind: "curated", headRevisionId: "r1", event: { kind: "edited", digest: digest("Edited.") } },
  ],
  [
    "a deleted file",
    headWith("Note."),
    undefined,
    { kind: "curated", headRevisionId: "r1", event: { kind: "deleted" } },
  ],
] as const)("inspectNoteFile reports %s", async ([, head, file, expected], { makeRoot }) => {
  expect(await inspect(await sessionDir(await makeRoot(), head, file))).toEqual(expected);
});

test.for([
  ["an edited record whose file is unchanged", "Mine.", { kind: "verified", headRevisionId: "r1" }],
  [
    "an edited record whose file is now deleted",
    undefined,
    { kind: "recurated", headRevisionId: "r1", event: { kind: "deleted" } },
  ],
  [
    "an edited record whose file has other bytes",
    "Mine, changed.",
    {
      kind: "recurated",
      headRevisionId: "r1",
      event: { kind: "edited", digest: digest("Mine, changed.") },
    },
  ],
] as const)(
  "inspectNoteFile checks a curated note without a head view against its record: %s",
  async ([, file, expected], { makeRoot }) => {
    const directory = await sessionDir(await makeRoot(), headWith(undefined), file);
    const record = { kind: "edited", digest: digest("Mine.") } as const;
    expect(await inspect(directory, {}, record)).toEqual(expected);
  },
);

test("inspectNoteFile reports pending, not unknown, when its head reads straddle the materialization marker", async ({
  makeRoot,
}) => {
  const directory = await sessionDir(await makeRoot(), headWith("Note.", false), "Note.");
  let heads = 0;
  expect(
    await inspect(directory, {
      async read(path) {
        if (path.endsWith("head.json")) {
          heads++;
          return JSON.stringify(headWith("Note.", heads > 1));
        }
        return await Effect.runPromise(readText(path));
      },
    }),
  ).toEqual({ kind: "pending", headRevisionId: "r1", unfinished: false });
});

test("inspectNoteFile reports unknown for a damaged head, a failed read, and reads that differ", async ({
  makeRoot,
}) => {
  const damaged = await sessionDir(await makeRoot(), undefined, "Note.");
  await writeFile(join(damaged, "head.json"), "{");
  expect(await inspect(damaged)).toEqual({
    kind: "unknown",
    reason: `the note file could not be inspected: Invalid JSON at ${join(damaged, "head.json")}.`,
  });
  const directory = await sessionDir(await makeRoot(), headWith("Note."), "Note.");
  expect(
    await inspect(directory, {
      async read(path) {
        if (path.endsWith(note)) {
          throw new Error("EIO: read failed");
        }
        return await Effect.runPromise(readText(path));
      },
    }),
  ).toEqual({ kind: "unknown", reason: "the note file could not be inspected: EIO: read failed" });
  let reads = 0;
  expect(
    await inspect(directory, {
      async read(path) {
        if (path.endsWith(note)) {
          reads++;
          return `Version ${String(reads)}.`;
        }
        return await Effect.runPromise(readText(path));
      },
    }),
  ).toEqual({
    kind: "unknown",
    reason: "the note file or its memory head changed while it was read",
  });
});

test("inspectNoteFile reports unknown when its reads exceed the inspection bound", async ({
  makeRoot,
}) => {
  const directory = await sessionDir(await makeRoot(), headWith("Note."), "Note.");
  const clock = await controlledClock();
  const reading = runStorage(inspectNoteFile(directory, note, undefined), {
    clock,
    read: async () => await new Promise<string | undefined>(() => undefined),
  });
  await advance(clock, noteInspectionTimeoutMs);
  expect(await reading).toEqual({
    kind: "unknown",
    reason: "the inspection did not finish within 2000 ms",
  });
});

const context = { sessionDir: "/s", revision: null, current: true, latest: "r1", at: 5 };
const edited = {
  kind: "curated",
  headRevisionId: "r1",
  event: { kind: "edited", digest: "f".repeat(64) },
} as const;

test("NoteFreshness discards an inspection that started before the generation advanced", () => {
  const freshness = new NoteFreshness();
  const started = freshness.current;
  freshness.advance();
  expect(freshness.apply(started, edited, { ...context, latest: "r2" })).toBe(false);
  expect(freshness.apply(started, { kind: "unknown", reason: "it was unreadable" }, context)).toBe(
    false,
  );
  expect(freshness.view).toEqual({ observation: undefined, detection: undefined });
});

test("NoteFreshness keeps a detected change of the latest head's note after the generation advanced", () => {
  const freshness = new NoteFreshness();
  const started = freshness.current;
  freshness.advance();
  expect(freshness.apply(started, edited, context)).toBe(true);
  expect(freshness.view).toEqual({
    observation: undefined,
    detection: {
      sessionDir: "/s",
      event: edited.event,
      revision: null,
      persistence: "pending",
      error: undefined,
    },
  } satisfies FreshnessView);
});

test("NoteFreshness keeps an unknown observation that applied after a reconciliation started", () => {
  const freshness = new NoteFreshness();
  const started = { recorded: freshness.recorded, observed: freshness.observed };
  freshness.apply(freshness.current, { kind: "unknown", reason: "it was unreadable" }, context);
  freshness.reconciled(started, 9);
  expect(freshness.view.observation).toEqual({
    state: "unknown",
    reason: "it was unreadable",
    at: 5,
  });
  freshness.reconciled({ recorded: freshness.recorded, observed: freshness.observed }, 11);
  expect(freshness.view.observation).toEqual({ state: "verified", at: 11 });
});

test("NoteFreshness keeps a detected edit after a later inspection finds the file restored", () => {
  const freshness = new NoteFreshness();
  freshness.apply(freshness.current, edited, context);
  freshness.apply(
    freshness.current,
    { kind: "verified", headRevisionId: "r1" },
    { ...context, at: 9 },
  );
  expect(freshness.view).toEqual({
    observation: { state: "verified", at: 9 },
    detection: {
      sessionDir: "/s",
      event: edited.event,
      revision: null,
      persistence: "pending",
      error: undefined,
    },
  } satisfies FreshnessView);
  expect(freshness.blocksProposals).toBe(true);
});

test("NoteFreshness leaves a change to a note that canonical memory already excludes to reconciliation", () => {
  const freshness = new NoteFreshness();
  freshness.apply(freshness.current, edited, { ...context, current: false });
  expect(freshness.view.detection).toBeUndefined();
});

test("NoteFreshness records unknown freshness and ignores a pending materialization", () => {
  const freshness = new NoteFreshness();
  freshness.apply(freshness.current, { kind: "unknown", reason: "it was unreadable" }, context);
  freshness.apply(
    freshness.current,
    { kind: "pending", headRevisionId: "r2", unfinished: true },
    { ...context, at: 7 },
  );
  expect(freshness.view.observation).toEqual({
    state: "unknown",
    reason: "it was unreadable",
    at: 5,
  });
});

test("NoteFreshness clears a recorded detection only after a reconciliation that started after the recording", () => {
  const freshness = new NoteFreshness();
  freshness.apply(freshness.current, edited, context);
  const before = freshness.recorded;
  expect(freshness.startRecording()?.persistence).toBe("recording");
  freshness.finishRecording();
  expect(freshness.blocksProposals).toBe(false);
  freshness.reconciled({ recorded: before, observed: freshness.observed }, 10);
  expect(freshness.view.detection?.persistence).toBe("recorded");
  freshness.reconciled({ recorded: freshness.recorded, observed: freshness.observed }, 11);
  expect(freshness.view).toEqual({
    observation: { state: "verified", at: 11 },
    detection: undefined,
  });
});

test("NoteFreshness keeps a detection across a storage start of the same session and drops it for another", () => {
  const freshness = new NoteFreshness();
  freshness.apply(freshness.current, edited, context);
  freshness.startRecording();
  freshness.failRecording("disk full");
  expect(freshness.view.detection).toMatchObject({ persistence: "pending", error: "disk full" });
  freshness.startRecording();
  freshness.open("/s");
  expect(freshness.view.detection).toMatchObject({ persistence: "pending" });
  freshness.open("/other");
  expect(freshness.view).toEqual({ observation: undefined, detection: undefined });
});

function correctionEntry(id: string, entry: Partial<PresentationEntry>): SessionEntry {
  const details = {
    version: 1,
    kind: "correction",
    id,
    lineage: { projectId: "a".repeat(64), sessionId: "s" },
    anchorId: "anchor",
    component: "work-note",
    affectedRevision: { sessionId: "s", revisionId: "r1" },
    cause: { kind: "curation", event: { kind: "deleted" } },
    ...entry,
  };
  return {
    type: "custom_message",
    id: `entry-${id}`,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: presentationMessageType,
    content: "text",
    display: true,
    details,
  };
}

test("curationCorrectedOn returns the newest work-note curation correction of the session's own lineage", () => {
  const lineage = { projectId: "a".repeat(64), sessionId: "s" };
  const branch = [
    correctionEntry("c1", {}),
    correctionEntry("c2", {
      affectedRevision: { sessionId: "s", revisionId: "r2" },
      cause: { kind: "curation", event: { kind: "edited", digest: "e".repeat(64) } },
    }),
    correctionEntry("c3", { cause: { kind: "evidence" } }),
    correctionEntry("c4", { lineage: { projectId: "b".repeat(64), sessionId: "s" } }),
    correctionEntry("c5", {
      lineage: { projectId: "a".repeat(64), sessionId: "ancestor" },
      affectedRevision: { sessionId: "ancestor", revisionId: "r9" },
      cause: { kind: "curation", event: { kind: "deleted" } },
    }),
  ];
  expect(curationCorrectedOn(branch, lineage)).toEqual({
    event: { kind: "edited", digest: "e".repeat(64) },
    revision: { sessionId: "s", revisionId: "r2" },
  });
  expect(curationCorrectedOn([branch[2] ?? correctionEntry("x", {})], lineage)).toBeUndefined();
  expect(curationCorrectedOn([branch[4] ?? correctionEntry("x", {})], lineage)).toBeUndefined();
});

test("recordCuration records the observed edit without reading the restored file and keeps an earlier record that already excludes the note", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const revisionId = committedId(
    await store.commit(
      baseProposal(store, {
        sourceIds: ["source-1"],
        noteDependencies: {
          [note]: { sourceIds: ["source-1"], evidenceFingerprint: "e".repeat(64) },
        },
      }),
    ),
  );
  const pointer = { sessionId: store.sessionId, revisionId };
  const event = { kind: "edited", digest: digest("User edit.\n") } as const;
  await store.run(store.store.recordCuration(note, event, pointer));
  const path = join(store.sessionDir, "curation.json");
  const recorded = JSON.parse(await readFile(path, "utf8")) as unknown;
  expect(recorded).toEqual({
    version: 1,
    notes: {
      [note]: { kind: "edited", digest: digest("User edit.\n"), consumedSourceIds: ["source-1"] },
    },
  });
  expect(await readOptional(join(store.sessionDir, "current", note))).toBe("generated\n");
  await store.run(store.store.recordCuration(note, { kind: "deleted" }, pointer));
  expect(JSON.parse(await readFile(path, "utf8")) as unknown).toEqual(recorded);
  expect(store.store.curatedNotes).toEqual({ [note]: event });
  await rm(path);
});

function canonical(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  return {
    revision: { sessionId: "s", revisionId: "r1" },
    invalidNotes: [],
    invalidReason: undefined,
    coverage: {
      state: "available",
      processed: { entries: new Set(), ranges: new Map() },
      changed: new Set(),
    },
    curation: {},
    sourceBoundary: undefined,
    workNote: {
      body: "Note.",
      bodyDigest: digest("Note."),
      references: [],
      evidenceFingerprint: undefined,
      checkpointIds: [],
    },
    ...overrides,
  };
}

test("noteValidity ranks invalidation before unknown freshness and requires a verified inspection", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const session = { store: store.store, sources: (await openRegistry(store)).registry };
  const verified = { observation: { state: "verified", at: 1 }, detection: undefined } as const;
  const unknown = {
    observation: { state: "unknown", reason: "the file could not be read.", at: 1 },
    detection: undefined,
  } as const;
  const detected = {
    observation: unknown.observation,
    detection: {
      sessionDir: "/s",
      event: { kind: "deleted" },
      revision: null,
      persistence: "pending",
      error: undefined,
    },
  } as const;
  const curated = canonical({
    invalidNotes: [note],
    invalidReason: "curation",
    curation: { [note]: { kind: "edited", digest: "e".repeat(64) } },
    workNote: undefined,
  });
  expect(noteValidity({ session, canonical: curated, freshness: detected }, [])).toEqual({
    state: "invalid",
    cause: { kind: "curation", event: { kind: "edited", digest: "e".repeat(64) } },
  });
  expect(noteValidity({ session, canonical: canonical(), freshness: detected }, [])).toEqual({
    state: "invalid",
    cause: { kind: "curation", event: { kind: "deleted" } },
  });
  expect(noteValidity({ session, canonical: canonical(), freshness: unknown }, [])).toEqual({
    state: "unknown",
    reason: "the file could not be read",
    origin: "inspection",
  });
  expect(noteValidity({ session, canonical: canonical(), freshness: verified }, [])).toEqual({
    state: "valid",
  });
  expect(
    noteValidity(
      { session, canonical: canonical({ workNote: undefined }), freshness: verified },
      [],
    ),
  ).toEqual({ state: "absent" });
  const dropped = canonical({ workNote: undefined, curation: { [note]: { kind: "deleted" } } });
  expect(noteValidity({ session, canonical: dropped, freshness: verified }, [])).toEqual({
    state: "invalid",
    cause: { kind: "curation", event: { kind: "deleted" } },
  });
});
