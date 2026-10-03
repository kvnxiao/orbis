import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { digest } from "../domain/canonical.ts";
import type { CurationEvent } from "../domain/evidence.ts";
import { parseRecord } from "../storage/records.ts";
import { headSchema } from "../storage/revisions.ts";
import { ManagedReads } from "../storage/services.ts";
import { describeError } from "./configuration.ts";

/** Bound one managed-file inspection; a slower inspection leaves the note's freshness unknown. */
export const noteInspectionTimeoutMs = 2000;

/**
 * Report what one inspection of a session's managed note file established.
 *
 * - `verified`: the file matches its view in the session's head; or the head records no view of the
 *   note and the file matches the note's curation record, or the note has none, so nothing outside
 *   the extension changed it.
 * - `pending`: a head read was not yet materialized, so the views may be mid-write, which is not
 *   curation. `unfinished` holds when the last head read is still unmaterialized; whether that is
 *   this process's publication in flight or an unfinished write is for the caller to decide.
 * - `recurated`: the head records no view of the note and the file no longer matches its curation
 *   record, such as an edited note that is now deleted; reconciliation records the change.
 * - `curated`: the file differs from its view: `edited` with the observed bytes' digest, or
 *   `deleted`.
 * - `unknown`: the inspection could not establish the file's state; `reason` says why.
 *
 * `headRevisionId` is the newest head the inspection read, `null` before the session's first
 * commit.
 */
export type NoteInspection =
  | { kind: "verified"; headRevisionId: string | null }
  | { kind: "pending"; headRevisionId: string; unfinished: boolean }
  | { kind: "recurated" | "curated"; headRevisionId: string; event: CurationEvent }
  | { kind: "unknown"; reason: string };

interface Reads {
  headBefore: string | undefined;
  noteBefore: string | undefined;
  headAfter: string | undefined;
  noteAfter: string | undefined;
}

function observedEvent(note: string | undefined): CurationEvent {
  return note === undefined ? { kind: "deleted" } : { kind: "edited", digest: digest(note) };
}

function classify(
  name: string,
  reads: Reads,
  context: { headPath: string; curated: CurationEvent | undefined },
): NoteInspection {
  const parse = (text: string | undefined) =>
    text === undefined ? undefined : parseRecord(headSchema, text, context.headPath);
  const before = parse(reads.headBefore);
  const after = parse(reads.headAfter) ?? before;
  if (after !== undefined && (before?.materialized === false || !after.materialized)) {
    return { kind: "pending", headRevisionId: after.revisionId, unfinished: !after.materialized };
  }
  if (reads.headBefore !== reads.headAfter || reads.noteBefore !== reads.noteAfter) {
    return {
      kind: "unknown",
      reason: "the note file or its memory head changed while it was read",
    };
  }
  if (before === undefined) {
    return { kind: "verified", headRevisionId: null };
  }
  const headRevisionId = before.revisionId;
  const event = observedEvent(reads.noteBefore);
  const view = before.views.notes[name];
  if (view === undefined) {
    const { curated } = context;
    return curated === undefined || isDeepStrictEqual(curated, event)
      ? { kind: "verified", headRevisionId }
      : { kind: "recurated", headRevisionId, event };
  }
  return event.kind === "edited" && event.digest === view
    ? { kind: "verified", headRevisionId }
    : { kind: "curated", headRevisionId, event };
}

/**
 * Inspect the managed note `name` of the session in `sessionDir` against its view in the session's
 * head, or against `curated`, the note's curation record, when the head records no view of it,
 * within `noteInspectionTimeoutMs`.
 *
 * Reads the head, the note file, the head again, and the note again through `ManagedReads`, without
 * the project lock. A read of an unmaterialized head makes the result `pending`; other differing
 * reads make it `unknown`, as do a read or head-validation failure and an exceeded bound. Never
 * fails.
 */
export const inspectNoteFile = Effect.fnUntraced(function* (
  sessionDir: string,
  name: string,
  curated: CurationEvent | undefined,
): Effect.fn.Return<NoteInspection, never, ManagedReads> {
  const { read } = yield* ManagedReads;
  const headPath = join(sessionDir, "head.json");
  const notePath = join(sessionDir, "current", name);
  return yield* Effect.gen(function* () {
    const headBefore = yield* read(headPath);
    const noteBefore = yield* read(notePath);
    const headAfter = yield* read(headPath);
    const noteAfter = yield* read(notePath);
    const reads = { headBefore, noteBefore, headAfter, noteAfter };
    return yield* Effect.try({
      try: () => classify(name, reads, { headPath, curated }),
      catch: (error) => error,
    });
  }).pipe(
    Effect.timeoutOption(Duration.millis(noteInspectionTimeoutMs)),
    Effect.map(
      Option.getOrElse((): NoteInspection => ({
        kind: "unknown",
        reason: `the inspection did not finish within ${String(noteInspectionTimeoutMs)} ms`,
      })),
    ),
    Effect.catch((error) =>
      Effect.succeed<NoteInspection>({
        kind: "unknown",
        reason: `the note file could not be inspected: ${describeError(error)}`,
      }),
    ),
  );
});
