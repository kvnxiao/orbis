import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";

import { digest } from "../domain/canonical.ts";
import { curationRecordSchema, mayUseNote } from "../domain/evidence.ts";
import type { CurationEvent, CurationRecord } from "../domain/evidence.ts";
import type { NoteDependency, RevisionPointer } from "../domain/proposal.ts";
import { noteNameSchema, rebindReference } from "../domain/references.ts";
import { readText } from "./files.ts";
import { parseRecord } from "./records.ts";
import { earlierNoteNames, readHead } from "./revisions.ts";
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

/** Define the `sessions/<session-id>/curation.json` payload. */
export type CurationState = Static<typeof curationSchema>;

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

const loadCuration = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<CurationState, unknown> {
  const text = yield* readText(path);
  return text === undefined ? { version: 1, notes: {} } : parseRecord(curationSchema, text, path);
});

/** Read UTF-8 files concurrently, with `undefined` for each file that does not exist. */
export function readAll(paths: readonly string[]): Effect.Effect<(string | undefined)[], unknown> {
  return Effect.forEach(paths, readText, { concurrency: "unbounded" });
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

/**
 * Record edited or deleted files among `generated` in `records` and report whether a record
 * changed.
 *
 * A file whose digest differs from `digest` records `edited` with its digest, and a missing file
 * records `deleted`, each consuming `consumed` together with the earlier record's sources. A
 * `digest` of `undefined` expects the file to be absent.
 *
 * @throws The original read error other than `ENOENT`.
 */
export const reconcileRecords = Effect.fnUntraced(function* (
  records: Record<string, CurationRecord>,
  generated: readonly {
    name: string;
    path: string;
    digest: string | undefined;
    consumed: readonly string[];
  }[],
): Effect.fn.Return<boolean, unknown> {
  const contents = yield* readAll(generated.map(({ path }) => path));
  let changed = false;
  for (const [index, { name, digest: expected, consumed }] of generated.entries()) {
    const content = contents[index];
    if ((content === undefined ? undefined : digest(content)) === expected) {
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
 * together with any earlier record's. A note with a curation record but no digest in `views` stays
 * inspected against its record when `earlier` reports that a view of this session tracked it, such
 * as an edited note a later commit excluded: an `edited` record's file that is now missing records
 * `deleted`, and one with other bytes records their digest; a `deleted` record's file that
 * reappears records `edited`. Each keeps the record's consumed sources. Only a file that no longer
 * matches its record asks `earlier`, so the revision chain is read only when a record can change. A
 * record that only a fork ancestor's curation supplied names no file of this session and is not
 * inspected. Writes `curation.json` only when a record changes. Must run under the project lock.
 *
 * @throws Error naming the path when `curation.json` is not JSON or fails `curationSchema`; its
 *   bytes are preserved.
 * @throws The original read or write error, and the failures of `earlier`.
 */
export const inspectCuration = Effect.fnUntraced(function* (
  sessionDir: string,
  views: Head["views"]["notes"],
  noteDependencies: Readonly<Record<string, NoteDependency>>,
  earlier: (names: ReadonlySet<string>) => Effect.Effect<ReadonlySet<string>, unknown>,
): Effect.fn.Return<CurationState, unknown, DurableWrites> {
  const path = curationPath(sessionDir);
  const state = yield* loadCuration(path);
  const viewed = Object.entries(views).map(([name, viewDigest]) => ({
    name,
    path: join(sessionDir, "current", name),
    digest: viewDigest,
    consumed: noteDependencies[name]?.sourceIds ?? [],
  }));
  const unviewed = Object.entries(state.notes).flatMap(([name, record]) =>
    Object.hasOwn(views, name)
      ? []
      : [
          {
            name,
            path: join(sessionDir, "current", name),
            digest: record.kind === "edited" ? record.digest : undefined,
            consumed: [],
          },
        ],
  );
  const contents = yield* readAll(unviewed.map((note) => note.path));
  const drifted = unviewed.filter(({ digest: expected }, index) => {
    const content = contents[index];
    return (content === undefined ? undefined : digest(content)) !== expected;
  });
  const tracked =
    drifted.length === 0
      ? new Set<string>()
      : yield* earlier(new Set(drifted.map(({ name }) => name)));
  const recordedOnly = drifted.filter(({ name }) => tracked.has(name));
  if (yield* reconcileRecords(state.notes, [...viewed, ...recordedOnly])) {
    yield* writeRecord(path, state);
  }
  return state;
});

/**
 * Record an observed external change of a session note and return the session's curation.
 *
 * Records `event` for `name` with `consumed` and any earlier record's consumed sources, unless the
 * earlier record already forbids a note generated from `consumed`; the earlier record then stays.
 * Records the observed event without reading the note file, so a file restored after the
 * observation still records it. Writes `curation.json` only when it records. Must run under the
 * project lock.
 *
 * @throws Error naming the path when `curation.json` is not JSON or fails `curationSchema`; its
 *   bytes are preserved.
 * @throws The original read or write error.
 */
export const recordObservedCuration = Effect.fnUntraced(function* (
  sessionDir: string,
  observed: { name: string; event: CurationEvent; consumed: readonly string[] },
  scope: { projectId: string; sessionId: string },
): Effect.fn.Return<CurationState, unknown, DurableWrites> {
  const path = curationPath(sessionDir);
  const state = yield* loadCuration(path);
  const { name, event, consumed } = observed;
  const previous = state.notes[name];
  if (previous !== undefined && !mayUseNote(previous, consumed, scope)) {
    return state;
  }
  const consumedSourceIds = [...new Set([...consumed, ...(previous?.consumedSourceIds ?? [])])];
  state.notes[name] =
    event.kind === "edited"
      ? { kind: "edited", digest: event.digest, consumedSourceIds }
      : { kind: "deleted", consumedSourceIds };
  yield* writeRecord(path, state);
  return state;
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

/** Return a curation record whose consumed references also include their fork rebinding. */
export function withReboundSources(
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

/**
 * Add the sessions of `revision`'s base chain to `lineage` and return it.
 *
 * @throws Error when the chain has a cycle or names a missing revision.
 * @throws The failures of `readRevision`.
 */
export const lineageOf = Effect.fnUntraced(function* (
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
 * Merge a fork ancestor lineage's curation into this session's curation and return it.
 *
 * Records the ancestor session's own external curation first, then rebinds consumed references of
 * every session in the pointed revision's base lineage to `fork.childSessionId` and merges them
 * with `inheritCuration`. `readRevision` must return a revision only when its session belongs to
 * `fork.projectId`. Must run under the project lock, after the caller repaired the ancestor
 * session's pending head; otherwise views that head never wrote are recorded as curation.
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
    (names) =>
      earlierNoteNames(names, generated?.parentRevisionId ?? null, (revisionId) =>
        readRevision({ sessionId: pointer.sessionId, revisionId }),
      ),
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
