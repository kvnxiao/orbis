import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";

import { digest } from "../domain/canonical.ts";
import { curationRecordSchema, mayUseNote } from "../domain/evidence.ts";
import type { CurationRecord } from "../domain/evidence.ts";
import type { MemoryProposal, NoteDependency, RevisionPointer } from "../domain/proposal.ts";
import {
  decodeReference,
  digestSchema,
  learningNameSchema,
  noteNameSchema,
  rebindReference,
  sourceIdSchema,
} from "../domain/references.ts";
import { readText } from "./files.ts";
import { parseRecord } from "./records.ts";
import { readHead } from "./revisions.ts";
import type { Head, Revision } from "./revisions.ts";
import type { DurableWrites } from "./services.ts";
import { writeRecord } from "./services.ts";

/** Validate a session curation record, keyed by note name. */
export const curationSchema = Type.Object(
  {
    version: Type.Literal(1),
    notes: Type.Record(noteNameSchema, curationRecordSchema, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/**
 * Validate a generated learning's provenance: the digest it was written with, the evidence it
 * consumed, and the sequence that wrote it.
 */
export const generatedLearningSchema = Type.Object(
  {
    digest: digestSchema,
    consumedSourceIds: Type.Array(sourceIdSchema),
    sequence: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Validate project curation: generated-learning provenance and exclusions for externally edited or
 * deleted learnings.
 */
export const projectCurationSchema = Type.Object(
  {
    version: Type.Literal(1),
    generated: Type.Record(learningNameSchema, generatedLearningSchema, {
      additionalProperties: false,
    }),
    curated: Type.Record(learningNameSchema, curationRecordSchema, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/** Define the `sessions/<session-id>/curation.json` payload. */
export type CurationState = Static<typeof curationSchema>;
/** Define one `generated` entry of the `sessions/_project/state.json` payload. */
export type GeneratedLearning = Static<typeof generatedLearningSchema>;
/** Define the `sessions/_project/state.json` payload. */
export type ProjectCurationState = Static<typeof projectCurationSchema>;

/**
 * Read a revision by pointer, or `undefined` when it is unavailable.
 *
 * Implementations return a revision only when its session belongs to the caller's project.
 */
export type RevisionReader = (
  pointer: RevisionPointer,
) => Effect.Effect<Revision | undefined, unknown>;

function curationPath(sessionDir: string): string {
  return join(sessionDir, "curation.json");
}

function projectStatePath(baseDir: string): string {
  return join(baseDir, "sessions", "_project", "state.json");
}

const loadCuration = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<CurationState, unknown> {
  const text = yield* readText(path);
  return text === undefined ? { version: 1, notes: {} } : parseRecord(curationSchema, text, path);
});

const loadProjectCuration = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<ProjectCurationState, unknown> {
  const text = yield* readText(path);
  return text === undefined
    ? { version: 1, generated: {}, curated: {} }
    : parseRecord(projectCurationSchema, text, path);
});

function readAll(paths: readonly string[]): Effect.Effect<(string | undefined)[], unknown> {
  return Effect.forEach(paths, readText, { concurrency: "unbounded" });
}

/**
 * Read validated project learning provenance without reconciling disk views.
 *
 * @throws Error naming the path when `state.json` is not JSON or fails `projectCurationSchema`.
 * @throws The original read error other than `ENOENT`.
 */
export function readProjectCuration(baseDir: string): Effect.Effect<ProjectCurationState, unknown> {
  return loadProjectCuration(projectStatePath(baseDir));
}

function recordFor(
  content: string | undefined,
  consumed: readonly string[],
  previous: CurationRecord | undefined,
): CurationRecord {
  const consumedSourceIds = [...new Set([...consumed, ...(previous?.consumedSourceIds ?? [])])];
  return content === undefined
    ? { kind: "deleted", consumedSourceIds }
    : { kind: "edited", digest: digest(content), consumedSourceIds };
}

const reconcileRecords = Effect.fnUntraced(function* (
  records: Record<string, CurationRecord>,
  generated: readonly { name: string; path: string; digest: string; consumed: readonly string[] }[],
): Effect.fn.Return<boolean, unknown> {
  const contents = yield* readAll(generated.map(({ path }) => path));
  let changed = false;
  for (const [index, { name, digest: expected, consumed }] of generated.entries()) {
    const content = contents[index];
    if (content !== undefined && digest(content) === expected) {
      continue;
    }
    const previous = records[name];
    const record = recordFor(content, consumed, previous);
    if (!isDeepStrictEqual(previous, record)) {
      records[name] = record;
      changed = true;
    }
  }
  return changed;
});

/**
 * Record external edits and deletions of a session's generated notes and return the session's
 * curation.
 *
 * Compares each note digest in `views` with the file under `current/`: a different digest records
 * `edited` and a missing file records `deleted`, each consuming the note's dependency sources
 * together with any earlier record's. Writes `curation.json` only when a record changes. Must run
 * under the project lock.
 *
 * @throws Error naming the path when `curation.json` is not JSON or fails `curationSchema`; its
 *   bytes are preserved.
 * @throws The original read or write error.
 */
export const inspectCuration = Effect.fnUntraced(function* (
  sessionDir: string,
  views: Head["views"]["notes"],
  noteDependencies: Readonly<Record<string, NoteDependency>>,
): Effect.fn.Return<CurationState, unknown, DurableWrites> {
  const path = curationPath(sessionDir);
  const state = yield* loadCuration(path);
  const generated = Object.entries(views).map(([name, viewDigest]) => ({
    name,
    path: join(sessionDir, "current", name),
    digest: viewDigest,
    consumed: noteDependencies[name]?.sourceIds ?? [],
  }));
  if (yield* reconcileRecords(state.notes, generated)) {
    yield* writeRecord(path, state);
  }
  return state;
});

/**
 * Record external edits and deletions of generated learnings and return the project curation.
 *
 * Writes `sessions/_project/state.json` only when a record changes. Must run under the project
 * lock.
 *
 * @throws Error naming the path when `state.json` is not JSON or fails `projectCurationSchema`; its
 *   bytes are preserved.
 * @throws The original read or write error.
 */
export const inspectProjectCuration = Effect.fnUntraced(function* (
  baseDir: string,
): Effect.fn.Return<ProjectCurationState, unknown, DurableWrites> {
  const path = projectStatePath(baseDir);
  const state = yield* loadProjectCuration(path);
  const generated = Object.entries(state.generated).map(([name, learning]) => ({
    name,
    path: join(baseDir, "learnings", name),
    digest: learning.digest,
    consumed: learning.consumedSourceIds,
  }));
  if (yield* reconcileRecords(state.curated, generated)) {
    yield* writeRecord(path, state);
  }
  return state;
});

/**
 * Record provenance for the learnings a committed revision wrote.
 *
 * Records provenance for each learning whose file still has the committed content, and keeps an
 * entry whose sequence is newer than `sequence`. Must run under the project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 * @throws The original read or write error.
 */
export const publishProjectGenerated = Effect.fnUntraced(function* (
  baseDir: string,
  committed: {
    learnings: Readonly<Record<string, string>>;
    sourceIds: readonly string[];
    sequence: number;
  },
): Effect.fn.Return<void, unknown, DurableWrites> {
  const learnings = Object.entries(committed.learnings);
  if (learnings.length === 0) {
    return;
  }
  const path = projectStatePath(baseDir);
  const state = yield* loadProjectCuration(path);
  const contents = yield* readAll(learnings.map(([name]) => join(baseDir, "learnings", name)));
  let changed = false;
  for (const [index, [name, content]] of learnings.entries()) {
    if (
      contents[index] === content &&
      (state.generated[name]?.sequence ?? 0) <= committed.sequence
    ) {
      state.generated[name] = {
        digest: digest(content),
        consumedSourceIds: [...committed.sourceIds],
        sequence: committed.sequence,
      };
      changed = true;
    }
  }
  if (changed) {
    yield* writeRecord(path, state);
  }
});

/**
 * Merge a fork ancestor's curation records into this session's curation.
 *
 * Unites the consumed source ids of records for the same note and keeps this session's record kind.
 * Writes `curation.json` only when a record changes. Must run under the project lock.
 *
 * @throws Error naming the path when `curation.json` is damaged; its bytes are preserved.
 * @throws The original read or write error.
 */
export const inheritCuration = Effect.fnUntraced(function* (
  sessionDir: string,
  inherited: Readonly<Record<string, CurationRecord>>,
): Effect.fn.Return<CurationState, unknown, DurableWrites> {
  const path = curationPath(sessionDir);
  const state = yield* loadCuration(path);
  let changed = false;
  for (const [name, record] of Object.entries(inherited)) {
    const previous = state.notes[name];
    const merged: CurationRecord =
      previous === undefined
        ? structuredClone(record)
        : {
            ...previous,
            consumedSourceIds: [
              ...new Set([...previous.consumedSourceIds, ...record.consumedSourceIds]),
            ],
          };
    if (!isDeepStrictEqual(previous, merged)) {
      state.notes[name] = merged;
      changed = true;
    }
  }
  if (changed) {
    yield* writeRecord(path, state);
  }
  return state;
});

function withReboundSources(
  record: CurationRecord,
  fork: { projectId: string; lineage: ReadonlySet<string>; childSessionId: string },
): CurationRecord {
  return {
    ...record,
    consumedSourceIds: [
      ...new Set(record.consumedSourceIds.flatMap((id) => [id, rebindReference(id, fork)])),
    ],
  };
}

function damagedLineage(): Error {
  return new Error("Damaged ancestor memory lineage; files are preserved for review.");
}

const lineageOf = Effect.fnUntraced(function* (
  revision: Revision,
  lineage: Set<string>,
  readRevision: RevisionReader,
): Effect.fn.Return<Set<string>, unknown> {
  const visited = new Set([`${revision.sessionId}:${revision.id}`]);
  let next = revision.baseRevision;
  while (next !== null) {
    const key = `${next.sessionId}:${next.revisionId}`;
    if (visited.has(key)) {
      return yield* Effect.fail(damagedLineage());
    }
    visited.add(key);
    const ancestor = yield* readRevision(next);
    if (ancestor === undefined) {
      return yield* Effect.fail(damagedLineage());
    }
    lineage.add(next.sessionId);
    next = ancestor.baseRevision;
  }
  return lineage;
});

/**
 * Check a proposal's learnings against project curation and the state the proposer expected.
 *
 * Returns `curation` when a learning is curated against the proposal's evidence or exists without
 * generated provenance, `learning` when its digest or generated sequence differs from
 * `expectedLearnings`, and `undefined` when every learning may be written. Must run under the
 * project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 * @throws Error when the base lineage has a cycle or names a missing revision.
 * @throws The original read or write error.
 */
export const learningConflict = Effect.fnUntraced(function* (
  baseDir: string,
  proposal: Pick<
    MemoryProposal,
    "learnings" | "expectedLearnings" | "sourceIds" | "projectId" | "sessionId" | "baseRevision"
  >,
  readRevision: RevisionReader,
): Effect.fn.Return<"curation" | "learning" | undefined, unknown, DurableWrites> {
  const names = Object.keys(proposal.learnings);
  if (names.length === 0) {
    return undefined;
  }
  const project = yield* inspectProjectCuration(baseDir);
  const proposedEntries = new Set(
    proposal.sourceIds.map((id) => decodeReference(id)?.entryId ?? id),
  );
  const needsRebind = names.some(
    (name) =>
      project.curated[name]?.consumedSourceIds.some((id) => {
        const location = decodeReference(id);
        return (
          location?.projectId === proposal.projectId &&
          location.sessionId !== proposal.sessionId &&
          proposedEntries.has(location.entryId)
        );
      }) ?? false,
  );
  const base =
    needsRebind && proposal.baseRevision !== null
      ? yield* readRevision(proposal.baseRevision)
      : undefined;
  const lineage =
    base === undefined || proposal.baseRevision === null
      ? undefined
      : yield* lineageOf(base, new Set([proposal.baseRevision.sessionId]), readRevision);
  const disks = yield* readAll(names.map((name) => join(baseDir, "learnings", name)));
  for (const [index, name] of names.entries()) {
    const disk = disks[index];
    const curated = project.curated[name];
    const comparable =
      curated === undefined || lineage === undefined
        ? curated
        : withReboundSources(curated, {
            projectId: proposal.projectId,
            lineage,
            childSessionId: proposal.sessionId,
          });
    if (
      !mayUseNote(comparable, proposal.sourceIds, proposal) ||
      (disk !== undefined && project.generated[name] === undefined)
    ) {
      return "curation";
    }
    const expected = proposal.expectedLearnings[name];
    if (
      expected === undefined ||
      (disk === undefined ? null : digest(disk)) !== expected.digest ||
      (project.generated[name]?.sequence ?? null) !== expected.sequence
    ) {
      return "learning";
    }
  }
  return undefined;
});

/**
 * Merge a fork ancestor lineage's curation into this session's curation and return it.
 *
 * Records the ancestor session's own external curation first, then rebinds consumed references of
 * every session in the pointed revision's base lineage to `fork.childSessionId` and merges them
 * with `inheritCuration`. `readRevision` must return a revision only when its session belongs to
 * `fork.projectId`. Must run under the project lock.
 *
 * @throws Error when the ancestor's head or lineage names a missing revision, the lineage has a
 *   cycle, or a record is damaged.
 * @throws The original read or write error.
 */
export const inheritForkCuration = Effect.fnUntraced(function* (
  fork: { baseDir: string; projectId: string; sessionDir: string; childSessionId: string },
  pointer: RevisionPointer,
  readRevision: RevisionReader,
): Effect.fn.Return<CurationState, unknown, DurableWrites> {
  const selected = yield* readRevision(pointer);
  if (selected === undefined) {
    return yield* inheritCuration(fork.sessionDir, {});
  }
  const directory = join(fork.baseDir, "sessions", pointer.sessionId);
  const head = yield* readHead(directory);
  const generated =
    head === undefined
      ? undefined
      : yield* readRevision({ sessionId: pointer.sessionId, revisionId: head.revisionId });
  if (head !== undefined && generated === undefined) {
    return yield* Effect.fail(
      new Error(`Ancestor memory head in ${directory} is unavailable; files are preserved.`),
    );
  }
  const ancestor = yield* inspectCuration(
    directory,
    head?.views.notes ?? {},
    generated?.noteDependencies ?? {},
  );
  const lineage = yield* lineageOf(selected, new Set([pointer.sessionId]), readRevision);
  const rebind = { projectId: fork.projectId, lineage, childSessionId: fork.childSessionId };
  const relevant = Object.fromEntries(
    Object.entries(ancestor.notes).map(([name, record]) => [
      name,
      withReboundSources(record, rebind),
    ]),
  );
  return yield* inheritCuration(fork.sessionDir, relevant);
});
