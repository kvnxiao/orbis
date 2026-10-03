import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { evidenceMatches } from "../domain/evidence.ts";
import type { ProjectedSource } from "../domain/intervals.ts";
import { decodeSpanReference } from "../domain/references.ts";
import type { CorrectionCause } from "../presentation/entries.ts";
import {
  discardedSources,
  messageSources,
  projectSources,
  uncoveredDiscarded,
} from "../storage/source-projection.ts";
import { workNoteName } from "./canonical-memory.ts";
import type { CanonicalMemory, MemoryStorage } from "./canonical-memory.ts";
import { describeError } from "./configuration.ts";

/**
 * Name the check that could not establish a note's freshness, which determines how it recovers:
 * `inspection` for the note file's inspection, `evidence` for the check of its evidence against the
 * conversation, `continuity` for the check of a native compaction against processing coverage, and
 * `storage` while memory storage is not open.
 */
export type UnknownOrigin = "inspection" | "evidence" | "continuity" | "storage";

/**
 * Report whether the selected current-work note may be presented as current.
 *
 * - `absent`: the selection has no current-work note and no curation record of it.
 * - `valid`: its freshness is verified and nothing invalidates it.
 * - `invalid`: curation, an evidence change, or native compaction invalidated it; `cause` is the
 *   correction cause. `continuity` holds only when native compaction is the sole cause and the
 *   note's freshness is otherwise established, so the stored note may still supply observer
 *   continuity state.
 * - `unknown`: its freshness could not be established; `reason` reads as a clause after "because",
 *   without a trailing period, and `origin` names the check that could not run.
 */
export type NoteValidity =
  | { state: "absent" }
  | { state: "valid" }
  | { state: "invalid"; cause: CorrectionCause; continuity?: true }
  | { state: "unknown"; reason: string; origin: UnknownOrigin };

/** Report the validity of a presented note while memory storage is not open. */
export const storageClosed: Extract<NoteValidity, { state: "unknown" }> = {
  state: "unknown",
  reason: "memory storage is not open",
  origin: "storage",
};

/**
 * Report whether the selected note accounts for every eligible source the latest native compaction
 * discarded: `covered` when processed coverage of the selected lineage, or a checkpoint the note
 * depends on, accounts for each one; `uncovered` when one is unaccounted for; `unverifiable` with
 * the reason when lineage coverage is unavailable or the branch's sources cannot be projected.
 */
export type CompactionContinuity =
  | { entryId: string; state: "covered" | "uncovered" }
  | { entryId: string; state: "unverifiable"; reason: string };

/** Supply what validity reads: open storage's session, cached canonical memory, and freshness. */
export type ValidityMemory = Pick<MemoryStorage, "session" | "canonical" | "freshness">;

type Note = NonNullable<CanonicalMemory["workNote"]>;

// The spans every checkpoint the note cites discarded are accounted for through that checkpoint.
function checkpointAccounted(
  branch: readonly SessionEntry[],
  sources: readonly ProjectedSource[],
  checkpointIds: readonly string[],
): Set<string> {
  const accounted = new Set<string>();
  for (const entry of branch) {
    if (entry.type === "compaction" && checkpointIds.includes(entry.id)) {
      for (const source of discardedSources(branch, entry, sources)) {
        accounted.add(source.reference);
      }
    }
  }
  return accounted;
}

// One continuity per canonical memory, which storage-session work replaces whole on every change.
const continuities = new WeakMap<
  CanonicalMemory,
  { key: string; continuity: CompactionContinuity }
>();

/**
 * Return the continuity of the latest native compaction on `branch` for the selected note, or
 * `undefined` without a compaction.
 *
 * A discarded eligible source counts as accounted for when processed coverage of the selected
 * lineage includes its whole current text, or when a compaction on `branch` that the note's
 * `checkpointIds` cite discarded it. Coverage comes from `uncoveredDiscarded`, which observer
 * planning also uses, so an earlier failed span or a split entry's unprocessed range is never
 * treated as processed. The result is cached per canonical memory, keyed by the compaction entry
 * and the branch's context edits, the inputs of the discarded sources' effective text.
 */
export function latestCompaction(
  branch: readonly SessionEntry[],
  memory: Pick<ValidityMemory, "session" | "canonical">,
): CompactionContinuity | undefined {
  const compaction = branch.findLast((entry) => entry.type === "compaction");
  if (compaction?.type !== "compaction") {
    return undefined;
  }
  const edits = branch.flatMap((entry) => (entry.type === "context_edit" ? [entry.id] : []));
  const key = [compaction.id, ...edits].join("\n");
  const cached = continuities.get(memory.canonical);
  if (cached?.key === key) {
    return cached.continuity;
  }
  const continuity = continuityOf(branch, compaction, memory);
  continuities.set(memory.canonical, { key, continuity });
  return continuity;
}

function continuityOf(
  branch: readonly SessionEntry[],
  compaction: Extract<SessionEntry, { type: "compaction" }>,
  memory: Pick<ValidityMemory, "session" | "canonical">,
): CompactionContinuity {
  const entryId = compaction.id;
  const { coverage, workNote } = memory.canonical;
  if (coverage.state === "unavailable") {
    return { entryId, state: "unverifiable", reason: coverage.reason };
  }
  const { store, sources } = memory.session;
  let projected: ProjectedSource[];
  try {
    projected = projectSources(branch, store, sources.sources);
  } catch (error) {
    return { entryId, state: "unverifiable", reason: describeError(error) };
  }
  const accounted = checkpointAccounted(branch, projected, workNote?.checkpointIds ?? []);
  const uncovered = uncoveredDiscarded(branch, compaction, projected, coverage.processed).some(
    (source) => !accounted.has(source.reference),
  );
  return { entryId, state: uncovered ? "uncovered" : "covered" };
}

// Raw entries never change, so a dependency entry's evidence can differ from what reconciliation
// checked only when a context edit targets it or it left the branch; otherwise the projection is
// skipped.
function evidenceState(
  branch: readonly SessionEntry[],
  memory: Pick<ValidityMemory, "session">,
  note: Note,
): "unchanged" | "changed" | { reason: string } {
  const { evidenceFingerprint, references } = note;
  if (evidenceFingerprint === undefined) {
    return "unchanged";
  }
  const entryIds = new Set<string>();
  let decodable = true;
  for (const reference of references) {
    const entryId = decodeSpanReference(reference)?.location.entryId;
    decodable &&= entryId !== undefined;
    if (entryId !== undefined) {
      entryIds.add(entryId);
    }
  }
  const onBranch = new Set(branch.map((entry) => entry.id));
  const edited = branch.some(
    (entry) => entry.type === "context_edit" && entryIds.has(entry.targetId),
  );
  if (decodable && !edited && [...entryIds].every((entryId) => onBranch.has(entryId))) {
    return "unchanged";
  }
  try {
    const { store, sources } = memory.session;
    const records = sources.recordsOf(messageSources(branch, entryIds));
    const dependency = { sourceIds: [...references], evidenceFingerprint };
    return evidenceMatches(records, dependency, store.projectId) ? "unchanged" : "changed";
  } catch (error) {
    return { reason: describeError(error) };
  }
}

// Reasons read as a clause after "because", so a trailing period from an error message is dropped.
function clause(reason: string): string {
  return reason.endsWith(".") ? reason.slice(0, -1) : reason;
}

function canonicalCause(canonical: CanonicalMemory): CorrectionCause {
  const curated = canonical.curation[workNoteName];
  return canonical.invalidReason === "curation" && curated !== undefined
    ? { kind: "curation", event: curated }
    : { kind: "evidence" };
}

/**
 * Compute the selected current-work note's validity for `branch`, the active branch after Pi's
 * context edits, without I/O.
 *
 * Invalidation takes precedence over unknown freshness, in this order: canonical memory's
 * invalidation; a curation record of a note the selection no longer carries; a detected curation
 * that persisted curation does not yet record; a dependency span whose effective evidence changed
 * or left the branch; and a native compaction that discarded sources the note does not account for.
 * Then freshness is unknown when the dependency check or the compaction check cannot run, or when
 * the latest completed inspection could not establish the file's state. Request assembly, observer
 * planning, proposal capture, compaction, and status all use this calculation.
 */
export function noteValidity(
  memory: ValidityMemory,
  branch: readonly SessionEntry[],
): NoteValidity {
  const { canonical, freshness } = memory;
  if (canonical.revision === undefined) {
    return { state: "absent" };
  }
  if (canonical.invalidNotes.includes(workNoteName)) {
    return { state: "invalid", cause: canonicalCause(canonical) };
  }
  const note = canonical.workNote;
  if (note === undefined) {
    const curated = canonical.curation[workNoteName];
    return curated === undefined
      ? { state: "absent" }
      : { state: "invalid", cause: { kind: "curation", event: curated } };
  }
  const { detection, observation } = freshness;
  if (detection !== undefined) {
    return { state: "invalid", cause: { kind: "curation", event: detection.event } };
  }
  const evidence = evidenceState(branch, memory, note);
  if (evidence === "changed") {
    return { state: "invalid", cause: { kind: "evidence" } };
  }
  const continuity = latestCompaction(branch, memory);
  if (continuity?.state === "uncovered") {
    const cause = { kind: "fallback", compactionEntryId: continuity.entryId } as const;
    return evidence === "unchanged" && observation?.state === "verified"
      ? { state: "invalid", cause, continuity: true }
      : { state: "invalid", cause };
  }
  if (evidence !== "unchanged") {
    const reason = `its evidence could not be checked against the conversation: ${evidence.reason}`;
    return { state: "unknown", reason: clause(reason), origin: "evidence" };
  }
  if (continuity?.state === "unverifiable") {
    const reason = `the sources native compaction entry ${continuity.entryId} discarded could not be checked against processing coverage: ${continuity.reason}`;
    return { state: "unknown", reason: clause(reason), origin: "continuity" };
  }
  if (observation?.state !== "verified") {
    const reason = observation?.reason ?? "its file has not been inspected";
    return { state: "unknown", reason: clause(reason), origin: "inspection" };
  }
  return { state: "valid" };
}

/** Return the correction cause of a note whose validity is `invalid` or `unknown`. */
export function correctionCauseOf(
  validity: Extract<NoteValidity, { state: "invalid" | "unknown" }>,
): CorrectionCause {
  return validity.state === "invalid" ? validity.cause : { kind: "unverified" };
}
