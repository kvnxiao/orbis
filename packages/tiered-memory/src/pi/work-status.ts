import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { CurationEvent, InvalidReason } from "../domain/evidence.ts";
import { processingGaps } from "../domain/intervals.ts";
import type { ProcessingGap, SourceBoundary } from "../domain/intervals.ts";
import type { ObserverRejection } from "../domain/observer.ts";
import { correctionCauseText } from "../presentation/render.ts";
import { projectSources } from "../storage/source-projection.ts";
import { workNoteName } from "./canonical-memory.ts";
import type { MemoryStorage } from "./canonical-memory.ts";
import { describeError } from "./configuration.ts";
import type { DetectedCuration, FreshnessObservation } from "./note-freshness.ts";
import { noteValidity } from "./note-validity.ts";
import type { NoteValidity, UnknownOrigin } from "./note-validity.ts";
import type { AttemptFailure, JobOutcome, ObserverUsage, WorkerStatus } from "./worker.ts";

/**
 * Describe the selected revision's current-work note: `valid` with its source boundary and the
 * number of eligible sources not yet observed, `undefined` while coverage is unavailable; `invalid`
 * with its reason; or `absent`, with the kind of the note's curation record when one exists.
 */
export type WorkNoteStatus =
  | { state: "absent"; curation: CurationEvent["kind"] | undefined }
  | {
      state: "valid";
      revisionId: string;
      sourceBoundary: SourceBoundary | undefined;
      unobserved: number | undefined;
    }
  | { state: "invalid"; revisionId: string; reason: InvalidReason | undefined };

/**
 * Describe the selected note's freshness for status: its validity, the latest completed inspection,
 * and a detected curation that persisted curation does not yet record.
 */
export interface FreshnessStatus {
  validity: NoteValidity;
  observation: FreshnessObservation | undefined;
  detection: DetectedCuration | undefined;
}

/** Describe the active branch's processing gaps, or why lineage coverage is unavailable. */
export type ProcessingStatus =
  | { state: "available"; gaps: readonly ProcessingGap[] }
  | { state: "unavailable"; reason: string };

/** Describe each reason a selected revision is not current, as status renders it. */
export const invalidReasons = {
  "note-evidence": "Selected revision evidence changed in effective context.",
  curation: "Selected revision contains an externally curated note.",
  "assigned-evidence": "Selected revision assigned evidence changed in effective context.",
} satisfies Record<InvalidReason, string>;

// A branch whose source metadata is malformed has no gaps to report; reconciliation reports why.
function processingOf(
  memory: MemoryStorage,
  branch: readonly SessionEntry[],
  exhausted: ReadonlySet<string>,
): ProcessingStatus {
  const coverage = memory.canonical.coverage;
  if (coverage.state === "unavailable") {
    return coverage;
  }
  const { store, sources } = memory.session;
  try {
    const projected = projectSources(branch, store, sources.sources);
    const gaps = processingGaps(projected, coverage.processed, exhausted, coverage.changed);
    return { state: "available", gaps };
  } catch (error) {
    return { state: "unavailable", reason: describeError(error) };
  }
}

/**
 * Describe the cached canonical memory's work note, its freshness, and the active branch's
 * processing coverage for status; spans in `exhausted` report as `failed` gaps, and spans whose
 * revision's evidence changed report as `changed` gaps.
 */
export function canonicalStatus(
  memory: MemoryStorage | undefined,
  branch: readonly SessionEntry[],
  exhausted: ReadonlySet<string>,
): { workNote: WorkNoteStatus; freshness: FreshnessStatus; processing: ProcessingStatus } {
  if (memory === undefined) {
    return {
      workNote: { state: "absent", curation: undefined },
      freshness: { validity: { state: "absent" }, observation: undefined, detection: undefined },
      processing: { state: "unavailable", reason: "Memory storage is not open." },
    };
  }
  return { ...workNoteStatus(memory, branch, exhausted), freshness: freshnessOf(memory, branch) };
}

function freshnessOf(memory: MemoryStorage, branch: readonly SessionEntry[]): FreshnessStatus {
  const { observation, detection } = memory.freshness;
  return { validity: noteValidity(memory, branch), observation, detection };
}

function workNoteStatus(
  memory: MemoryStorage,
  branch: readonly SessionEntry[],
  exhausted: ReadonlySet<string>,
): { workNote: WorkNoteStatus; processing: ProcessingStatus } {
  const { canonical } = memory;
  const processing = processingOf(memory, branch, exhausted);
  const gaps = processing.state === "available" ? processing.gaps : undefined;
  const revisionId = canonical.revision?.revisionId;
  if (revisionId !== undefined && canonical.invalidNotes.includes(workNoteName)) {
    return {
      workNote: { state: "invalid", revisionId, reason: canonical.invalidReason },
      processing,
    };
  }
  if (revisionId === undefined || canonical.workNote === undefined) {
    return {
      workNote: { state: "absent", curation: canonical.curation[workNoteName]?.kind },
      processing,
    };
  }
  const unobserved = gaps?.filter((gap) => gap.kind !== "attachment").length;
  const { sourceBoundary } = canonical;
  return { workNote: { state: "valid", revisionId, sourceBoundary, unobserved }, processing };
}

const staleReasons = {
  covered: "its sources were already processed",
  changed: "its sources changed",
  unready: "memory storage was not ready",
  model: "the observer model was unavailable",
  oversize: "its request no longer fits the observer input cap; its sources will be planned again",
  expired: "its job deadline passed while it waited; its sources will be planned again",
  freshness: "the current-work note's freshness was unknown; its sources will be planned again",
} satisfies Record<Extract<JobOutcome, { kind: "stale" }>["reason"], string>;

function rejectionText(rejection: ObserverRejection): string {
  if (rejection.kind === "unknown-label") {
    return `unassigned source label ${rejection.label} at ${rejection.path}`;
  }
  return rejection.kind === "oversized-note"
    ? `note of ${String(rejection.tokens)} estimated tokens exceeds its ${String(rejection.limit)}-token reserve`
    : "unchanged note without a previous note";
}

function failureText(failure: AttemptFailure): string {
  if (failure.kind === "provider") {
    return `provider error: ${failure.message}`;
  }
  if (failure.kind === "timeout") {
    return `timed out after ${String(failure.timeoutMs)} ms`;
  }
  if (failure.kind === "malformed") {
    return `malformed output: ${failure.detail}`;
  }
  if (failure.kind === "oversized") {
    return `output of ${String(failure.tokens)} estimated tokens exceeds ${String(failure.limit)}`;
  }
  return failure.kind === "truncated"
    ? "output reached its token limit"
    : rejectionText(failure.rejection);
}

function exhaustedText(outcome: Extract<JobOutcome, { kind: "exhausted" }>): string {
  const last = outcome.failures.at(-1);
  const failure = last === undefined ? "" : `; last failure: ${failureText(last)}`;
  const failed = `${String(outcome.failures.length)} failed attempts`;
  if (outcome.commit) {
    const after = last === undefined ? "" : ` after ${failed}`;
    return `exhausted because the job deadline passed before its accepted output committed${after}${failure}`;
  }
  const deadline = outcome.deadline ? "; the job deadline passed" : "";
  return `exhausted after ${failed}${deadline}${failure}`;
}

function outcomeText(outcome: JobOutcome | undefined): string {
  if (outcome === undefined) {
    return "none";
  }
  if (outcome.kind === "committed") {
    return `committed revision ${outcome.revisionId}`;
  }
  if (outcome.kind === "stale") {
    return `skipped because ${staleReasons[outcome.reason]}`;
  }
  if (outcome.kind === "conflict") {
    return `rejected by the ${outcome.reason} check`;
  }
  if (outcome.kind === "exhausted") {
    return exhaustedText(outcome);
  }
  return outcome.kind === "cancelled" ? "cancelled" : `failed: ${outcome.message}`;
}

const gapLabels = {
  unprocessed: "unprocessed",
  partial: "partially processed",
  changed: "changed since processing",
  failed: "failed",
  attachment: "with unsupported attachments",
} satisfies Record<ProcessingGap["kind"], string>;

const absentCuration = {
  edited: `${workNoteName} was edited outside tiered memory and stays excluded from generated memory.`,
  deleted: `${workNoteName} was deleted outside tiered memory; only evidence the deleted note did not consume can create a new note.`,
} satisfies Record<CurationEvent["kind"], string>;

function workNoteLine(note: WorkNoteStatus): string {
  if (note.state === "absent") {
    return note.curation === undefined
      ? "Current-work note: none"
      : `Current-work note: none; ${absentCuration[note.curation]}`;
  }
  if (note.state === "invalid") {
    const reason = note.reason === undefined ? "not current" : invalidReasons[note.reason];
    return `Current-work note: revision ${note.revisionId} is invalid: ${reason}`;
  }
  const boundary = note.sourceBoundary;
  const through =
    boundary === undefined
      ? "no source boundary"
      : `source boundary ${boundary.reference} (branch entry ${String(boundary.order)})`;
  const freshness =
    note.unobserved === undefined
      ? "unobserved sources unknown"
      : `${String(note.unobserved)} eligible sources not yet observed`;
  return `Current-work note: revision ${note.revisionId}; ${through}; ${freshness}`;
}

function processingLine(processing: ProcessingStatus): string {
  if (processing.state === "unavailable") {
    return `Processing coverage: unavailable (${processing.reason}); observer scheduling is paused.`;
  }
  const counts = Object.entries(gapLabels).flatMap(([kind, label]) => {
    const count = processing.gaps.filter((gap) => gap.kind === kind).length;
    return count === 0 ? [] : [`${String(count)} ${label}`];
  });
  return counts.length === 0
    ? "Processing coverage: no gaps"
    : `Processing coverage: ${String(processing.gaps.length)} gaps (${counts.join(", ")})`;
}

const detectedChanges = {
  edited: "edit",
  deleted: "deletion",
} satisfies Record<CurationEvent["kind"], string>;

const unknownRecoveries = {
  inspection: "the note is not presented as current until an inspection verifies it.",
  evidence:
    "the note is not presented as current until its evidence can be checked against the conversation; an inspection of its file does not clear this.",
  continuity:
    "the note is not presented as current until processing coverage can be checked; an inspection of its file does not clear this.",
  storage:
    "the note is not presented as current until memory storage opens. Resolve the storage error, then run /reload.",
} satisfies Record<UnknownOrigin, string>;

const deferralRecoveries = {
  inspection: "Check that current-work.md is readable, then run /reload.",
  evidence:
    "Navigate with /tree to a point before the conversation entry whose source metadata cannot be read.",
  continuity: "Resolve the processing coverage problem this status reports, then run /reload.",
  storage: "Resolve the storage error, then run /reload.",
} satisfies Record<UnknownOrigin, string>;

/** Render the current-work note's freshness lines of status. */
export function freshnessLines(freshness: FreshnessStatus): string[] {
  const { validity, observation, detection } = freshness;
  const lines: string[] = [];
  if (validity.state === "valid" && observation?.state === "verified") {
    const at = new Date(observation.at).toISOString();
    lines.push(
      `Current-work note freshness: verified at ${at} by the latest completed inspection.`,
    );
  } else if (validity.state === "unknown") {
    lines.push(
      `Current-work note freshness: unknown because ${validity.reason}; ${unknownRecoveries[validity.origin]}`,
    );
  } else if (validity.state === "invalid") {
    lines.push(
      `Current-work note freshness: not current because ${correctionCauseText(validity.cause)}.`,
    );
  }
  if (detection !== undefined && detection.persistence !== "recorded") {
    const failure =
      detection.error === undefined
        ? ""
        : ` Recording failed (${detection.error}); the next inspection retries it.`;
    lines.push(
      `Current-work note curation: the detected ${detectedChanges[detection.event.kind]} awaits recording; memory proposals are refused until it is recorded.${failure}`,
    );
  }
  return lines;
}

/**
 * Render the work-note, freshness, processing-coverage, and observer-queue lines of status;
 * `storage` is `undefined` while storage is not open and `worker` while no queue is open.
 */
export function workLines(
  storage:
    | { workNote: WorkNoteStatus; freshness: FreshnessStatus; processing: ProcessingStatus }
    | undefined,
  worker: WorkerStatus | undefined,
): string[] {
  const lines =
    storage === undefined
      ? []
      : [
          workNoteLine(storage.workNote),
          ...freshnessLines(storage.freshness),
          processingLine(storage.processing),
        ];
  if (worker !== undefined) {
    lines.push(
      `Observer jobs: ${String(worker.queued)} queued, ${worker.running === undefined ? "none" : "one"} running, ${String(worker.deferred)} deferred offers, ${String(worker.exhausted.size)} exhausted spans; last outcome: ${outcomeText(worker.last)}`,
      usageLine(worker.usage),
      "Observer outcomes and usage cover this session since tiered memory last loaded, switched sessions, or navigated the tree.",
    );
    const deferral = worker.planningDeferral;
    if (deferral !== undefined) {
      lines.push(
        `Observer planning: deferred because the current-work note's freshness is unknown: ${deferral.reason}. ${deferralRecoveries[deferral.origin]}`,
      );
    }
    if (worker.planningStall !== undefined) {
      lines.push(
        `Observer planning: stalled; after the instructions, the previous note at its reserve, and its references, the observer input cap leaves ${String(Math.max(worker.planningStall, 0))} estimated tokens for sources, which no source span fits, even without a native checkpoint. Raise limits.workerInputTokens, lower limits.workNoteTokens, or select an observer model with a larger context window.`,
      );
    }
  }
  return lines;
}

function usageField(label: string, value: number | undefined, unit: string): string {
  return `${label} ${value === undefined ? "unknown" : `${String(value)}${unit}`}`;
}

function usageLine(usage: ObserverUsage): string {
  if (usage.attempts === 0) {
    return "Observer usage (provider-reported): no attempts";
  }
  const fields = [
    usageField("input", usage.input, " tokens"),
    usageField("output", usage.output, " tokens"),
    usageField("cache read", usage.cacheRead, " tokens"),
    usageField("cache write", usage.cacheWrite, " tokens"),
    usageField("cost", usage.cost, ""),
  ];
  return `Observer usage (provider-reported): ${String(usage.reported)} of ${String(usage.attempts)} attempts reported usage; ${fields.join(", ")}`;
}
