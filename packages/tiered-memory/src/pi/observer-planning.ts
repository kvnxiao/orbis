import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { planIntervals } from "../domain/intervals.ts";
import type { ProcessedCoverage, ProjectedSource, SourceInterval } from "../domain/intervals.ts";
import { observerRequest } from "../domain/observer.ts";
import type { ObserverInput, ObserverRequest, PreviousReference } from "../domain/observer.ts";
import { decodeSpanReference } from "../domain/references.ts";
import { estimateTextTokens } from "../domain/tokens.ts";
import { uncoveredDiscarded } from "../storage/source-projection.ts";
import type { CanonicalMemory } from "./canonical-memory.ts";
import type { NoteValidity } from "./note-validity.ts";
import type { WorkerQueue } from "./worker.ts";

const emptyInterval: SourceInterval = { spans: [], tokens: 0 };
// Covers the "\n\n" between rendered spans, which planned span estimates do not count.
const spanSeparatorTokens = 64;

function requestTokens(request: Pick<ObserverRequest, "systemPrompt" | "prompt">): number {
  return estimateTextTokens(request.systemPrompt) + estimateTextTokens(request.prompt);
}

/**
 * Return the newest native compaction on `branch` that discarded an eligible source without
 * processed coverage, when its summary fits `checkpointTokens`.
 */
export function applicableCheckpoint(
  branch: readonly SessionEntry[],
  sources: readonly ProjectedSource[],
  coverage: ProcessedCoverage,
  checkpointTokens: number,
): ObserverInput["checkpoint"] {
  for (const entry of branch.toReversed()) {
    if (entry.type !== "compaction") {
      continue;
    }
    const discarded = uncoveredDiscarded(branch, entry, sources, coverage).length > 0;
    if (discarded && estimateTextTokens(entry.summary) <= checkpointTokens) {
      return { entryId: entry.id, summary: entry.summary };
    }
  }
  return undefined;
}

/**
 * Return what an observer request reads besides its interval: the current-work note from cached
 * canonical memory while `validity` is `valid`, or `invalid` only because native compaction
 * outdated it, and the applicable native checkpoint on `branch`.
 */
export function observerContext(
  canonical: CanonicalMemory,
  validity: NoteValidity,
  processed: ProcessedCoverage,
  active: { branch: readonly SessionEntry[]; sources: readonly ProjectedSource[] },
  checkpointTokens: number,
): Omit<ObserverInput, "interval"> {
  const { branch, sources } = active;
  const continuity =
    validity.state === "valid" || (validity.state === "invalid" && validity.continuity === true);
  const note = continuity ? canonical.workNote : undefined;
  const byEntry = new Map(sources.map((source) => [source.entryId, source]));
  const located = (reference: string): PreviousReference => {
    const decoded = decodeSpanReference(reference);
    const source = decoded === undefined ? undefined : byEntry.get(decoded.location.entryId);
    return {
      reference,
      source:
        source === undefined
          ? undefined
          : {
              entryId: source.entryId,
              role: source.role,
              order: source.order,
              time: source.time,
              range: decoded?.range,
            },
    };
  };
  return {
    previousNote:
      note === undefined
        ? undefined
        : {
            body: note.body,
            references: note.references.map(located),
            checkpointIds: note.checkpointIds,
          },
    checkpoint: applicableCheckpoint(branch, sources, processed, checkpointTokens),
  };
}

/**
 * Compute the estimated span budget of one observer interval: the observer input cap minus the
 * instructions, the previous note grown to the work-note reserve, its labels, the applicable
 * checkpoint, and span separators. Returns zero or less when nothing fits.
 */
export function intervalBudget(
  inputTokens: number,
  input: Omit<ObserverInput, "interval">,
  workNoteTokens: number,
): number {
  const base = requestTokens(observerRequest({ ...input, interval: emptyInterval }));
  const growth = Math.max(workNoteTokens - estimateTextTokens(input.previousNote?.body ?? ""), 0);
  return inputTokens - base - growth - spanSeparatorTokens;
}

/**
 * Build the observer request for `input` within `inputTokens`, dropping the checkpoint when only
 * the request without it fits; `undefined` when neither fits.
 */
export function fitObserverRequest(
  input: ObserverInput,
  inputTokens: number,
): ObserverRequest | undefined {
  const full = observerRequest(input);
  if (requestTokens(full) <= inputTokens) {
    return full;
  }
  const without = observerRequest({ ...input, checkpoint: undefined });
  return input.checkpoint !== undefined && requestTokens(without) <= inputTokens
    ? without
    : undefined;
}

/**
 * Plan observer intervals over the active branch's eligible sources and offer them to the queue in
 * branch order.
 *
 * Runs synchronously from Pi handlers and from the queue's drain. Plans within the span budget that
 * `context` leaves under `inputTokens`; when no interval fits that budget and `context` has a
 * checkpoint, plans again without it, as `fitObserverRequest` drops it at dispatch. Records on the
 * queue the span budget of a pass that leaves eligible unclaimed text unplanned because no span
 * fits even without the checkpoint, and clears it otherwise. Plans at most `maxIntervals` intervals
 * and stops at the first deferred offer; deferred and unplanned spans stay on disk for a later
 * call. `now` is the Effect clock time that starts each offered job's total deadline.
 */
export function scheduleObservations(
  queue: WorkerQueue,
  input: {
    sources: readonly ProjectedSource[];
    coverage: ProcessedCoverage;
    context: Omit<ObserverInput, "interval">;
    inputTokens: number;
    workNoteTokens: number;
    maxIntervals: number;
    now: number;
  },
): void {
  const { sources, coverage, context, maxIntervals } = input;
  const plan = (checkpoint: ObserverInput["checkpoint"]) => {
    const budgetTokens = intervalBudget(
      input.inputTokens,
      { ...context, checkpoint },
      input.workNoteTokens,
    );
    const intervals = planIntervals(sources, coverage, queue.claimed, {
      budgetTokens,
      maxIntervals,
    });
    return { budgetTokens, intervals };
  };
  let planned = plan(context.checkpoint);
  if (planned.intervals.length === 0 && context.checkpoint !== undefined) {
    planned = plan(undefined);
  }
  if (planned.intervals.length === 0) {
    const unplanned = planIntervals(sources, coverage, queue.claimed, {
      budgetTokens: Number.MAX_SAFE_INTEGER,
      maxIntervals: 1,
    });
    queue.recordPlanningStall(unplanned.length === 0 ? undefined : planned.budgetTokens);
    return;
  }
  queue.recordPlanningStall(undefined);
  for (const interval of planned.intervals) {
    if (queue.offer({ kind: "observer", interval, enqueuedAt: input.now }).kind === "deferred") {
      return;
    }
  }
}
