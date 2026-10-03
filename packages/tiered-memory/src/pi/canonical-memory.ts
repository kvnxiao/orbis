import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import { digest } from "../domain/canonical.ts";
import type { CurationEvent, InvalidReason } from "../domain/evidence.ts";
import { coverageOf, sourceBoundary } from "../domain/intervals.ts";
import type { ProcessedCoverage, SourceBoundary } from "../domain/intervals.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import { rebindToSession } from "../domain/references.ts";
import { readLineageRecords } from "../storage/coverage.ts";
import { recoverFailure } from "../storage/files.ts";
import { messageSources, projectMessages } from "../storage/source-projection.ts";
import { describeError } from "./configuration.ts";
import type { StorageScope } from "./execution.ts";
import { selectedPointer } from "./lineage.ts";
import type { ProposalBinding, SelectedRevision } from "./lineage.ts";
import type { FreshnessView } from "./note-freshness.ts";
import type { StorageSession } from "./storage-binding.ts";

/** Name the note file that holds the protected current-work note. */
export const workNoteName = "current-work.md";

/**
 * Report processed coverage of the selected lineage, or why it cannot be read.
 *
 * `unavailable` means a revision on the selected chain is missing or damaged; observer scheduling
 * pauses while it holds, since no gap can be computed.
 */
export type LineageCoverage =
  | { state: "available"; processed: ProcessedCoverage; changed: ReadonlySet<string> }
  | { state: "unavailable"; reason: string };

/**
 * Describe the selected revision's canonical memory as one in-memory read model.
 *
 * Storage-session work (start, reconciliation, and the refresh after a commit) builds it and
 * replaces it whole; the `context` snapshot, presentation, status, and observer inputs read it
 * synchronously, so no request hook performs storage I/O.
 *
 * - `revision` is `undefined` when nothing is selected; coverage is then empty.
 * - `workNote` is `undefined` when the revision has no current-work note, lists it in `invalidNotes`,
 *   or cannot be read; an empty `body` is an explicitly empty working state. Its `references` are
 *   rebound to the current session; `evidenceFingerprint` is its dependency's captured fingerprint,
 *   `undefined` when the revision records no dependency for it.
 * - `sourceBoundary` is the newest processed span in branch order, from the lineage coverage, or from
 *   the selected revision's own sources while lineage coverage is unavailable.
 * - `coverage.changed` lists the span references whose processing was dropped because their
 *   revision's evidence no longer matches the active branch.
 * - `curation` names the external change of each note curation record the store last found.
 */
export interface CanonicalMemory {
  revision: RevisionPointer | undefined;
  invalidNotes: readonly string[];
  invalidReason: InvalidReason | undefined;
  coverage: LineageCoverage;
  curation: Readonly<Record<string, CurationEvent>>;
  sourceBoundary: SourceBoundary | undefined;
  workNote:
    | {
        body: string;
        bodyDigest: string;
        references: readonly string[];
        evidenceFingerprint: string | undefined;
        checkpointIds: readonly string[];
      }
    | undefined;
}

/**
 * Carry open storage for automatic memory work and status: its scope and session, the cached
 * canonical memory, a copy of the managed note's freshness, the binding a proposal frame captured
 * now records, and the reason capture would refuse a proposal now, `undefined` when it would
 * proceed.
 */
export interface MemoryStorage {
  scope: StorageScope;
  session: StorageSession;
  canonical: CanonicalMemory;
  freshness: FreshnessView;
  binding: ProposalBinding;
  refusal: string | undefined;
}

/**
 * Read the canonical memory of a selection for storage-session work to cache.
 *
 * Reads the selected revision, then its lineage through `readLineageRecords` once; a lineage that
 * cannot be read yields `unavailable` coverage with the failure's message instead of failing. The
 * source boundary follows `branch` order, projected with the session's registered source times.
 *
 * @throws Error when tool-call, tool-result, or shell-command metadata on `branch` is malformed.
 * @throws The failures of `MemoryStore.inheritRevision` for the selected revision itself.
 */
export const readCanonicalMemory = Effect.fnUntraced(function* (
  session: StorageSession,
  selected: SelectedRevision,
  branch: readonly SessionEntry[],
): Effect.fn.Return<CanonicalMemory, unknown> {
  const { store } = session;
  const messages = messageSources(branch);
  const sources = projectMessages(messages, store, session.sources.sources);
  const revision = selectedPointer(selected) ?? undefined;
  const empty: CanonicalMemory = {
    revision,
    invalidNotes: selected.state === "selected" ? [...selected.invalidNotes] : [],
    invalidReason: selected.state === "selected" ? selected.invalidReason : undefined,
    coverage: { state: "available", processed: coverageOf([]), changed: new Set() },
    curation: store.curatedNotes,
    sourceBoundary: undefined,
    workNote: undefined,
  };
  if (selected.state === "unavailable") {
    const { sessionId, revisionId, reason } = selected;
    return {
      ...empty,
      revision: { sessionId, revisionId },
      coverage: { state: "unavailable", reason },
    };
  }
  if (revision === undefined) {
    return empty;
  }
  const record = yield* store.inheritRevision(revision);
  if (record === undefined) {
    const reason = `Selected revision ${revision.revisionId} is unavailable.`;
    return { ...empty, coverage: { state: "unavailable", reason } };
  }
  const evidence = session.sources.recordsOf(messages);
  const coverage = yield* readLineageRecords(store, revision, evidence).pipe(
    Effect.map((records): LineageCoverage => ({
      state: "available",
      processed: records.coverage,
      changed: records.changed,
    })),
    Effect.catchCause((cause) =>
      recoverFailure(cause, (failure): LineageCoverage => ({
        state: "unavailable",
        reason: describeError(failure),
      })),
    ),
  );
  const processed =
    coverage.state === "available"
      ? coverage.processed
      : coverageOf(rebindToSession(record.sourceIds, store));
  const body = record.notes[workNoteName];
  const dependency = record.noteDependencies[workNoteName];
  return {
    ...empty,
    coverage,
    sourceBoundary: sourceBoundary(sources, processed),
    workNote:
      body === undefined || empty.invalidNotes.includes(workNoteName)
        ? undefined
        : {
            body,
            bodyDigest: digest(body),
            references: rebindToSession(dependency?.sourceIds ?? [], store),
            evidenceFingerprint: dependency?.evidenceFingerprint,
            checkpointIds: [...(dependency?.checkpointIds ?? [])],
          },
  };
});
