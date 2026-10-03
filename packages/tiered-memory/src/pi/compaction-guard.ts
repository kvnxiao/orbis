import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
  SessionCompactFailedEvent,
} from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import { correctionCauseText } from "../presentation/render.ts";
import { noteCoverage } from "./compaction-coverage.ts";
import { appendReport, describeError } from "./configuration.ts";
import type { PresentationCoordinator } from "./context.ts";
import type { FreshnessMonitor } from "./freshness-monitor.ts";
import { correctionCauseOf, noteValidity, storageClosed } from "./note-validity.ts";
import type { NoteValidity, ValidityMemory } from "./note-validity.ts";
import { confirmPresentations, unopenedLineage } from "./presentation-log.ts";

type CompactionReason = SessionBeforeCompactEvent["reason"];

/**
 * Name why no correction covers a stale note in a prepared compaction: not yet sent, sent but still
 * queued by Pi, outside the prepared input and retained tail, or not confirmed in the session
 * file.
 */
type GapCause = "unpublished" | "queued" | "not-in-input" | "not-durable";

/**
 * Describe a compaction the guard decided on: its origin, Pi's retry decision when the guard saw
 * it, and the stale note's cause. A `cancel` publishes the correction when the gap is
 * `unpublished`; a `proceed` let compaction continue with the gap reported.
 */
interface Decision {
  outcome: "cancel" | "proceed";
  reason: CompactionReason;
  willRetry: boolean;
  cause: string;
  gap: GapCause;
}

// A presented note the guard cannot let compaction summarize without a covering correction:
// `identity` and the correction cause name its invalidation, `projectId` its records' project.
interface StaleNote {
  projectId: string;
  identity: readonly string[];
  validity: Extract<NoteValidity, { state: "invalid" | "unknown" }>;
}

/**
 * Describe the guard for status: the latest correction cancellation and the latest compaction that
 * proceeded without a covering correction, each with its origin and cause, and the latest failure
 * of the guard's own check.
 */
export interface CompactionGuardStatus {
  cancellation: { reason: CompactionReason; cause: string } | undefined;
  gap: { reason: CompactionReason; cause: string; gap: string } | undefined;
  error: string | undefined;
}

const origins = {
  manual: "manual",
  threshold: "automatic threshold",
  overflow: "automatic overflow",
} satisfies Record<CompactionReason, string>;

const gapTexts = {
  unpublished: "not durable",
  queued: "not durable",
  "not-durable": "not durable",
  "not-in-input": "not included in the compaction input",
} satisfies Record<GapCause, string>;

const unsavedTexts = {
  unpublished: "The correction that says so was not yet saved in the session.",
  queued: "The correction that says so was sent, but Pi has not yet saved it in the session.",
} satisfies Record<Extract<GapCause, "unpublished" | "queued">, string>;

function nextStep(reason: CompactionReason, willRetry: boolean): string {
  if (reason === "manual") {
    return "Run /compact again to compact with the correction.";
  }
  return reason === "overflow" && willRetry
    ? "Pi does not retry the request that overflowed; send it again to compact with the correction and continue."
    : "Pi runs automatic compaction again at a later check, no later than the next prompt.";
}

function causeOf(validity: StaleNote["validity"]): string {
  const text = correctionCauseText(correctionCauseOf(validity));
  return validity.state === "unknown" ? `${text}: ${validity.reason}` : text;
}

/**
 * Keep a stale current-work note out of native compaction through Pi's public compaction hooks.
 *
 * Invariants:
 *
 * - `beforeCompact` inspects the note file, computes the note's validity, and reads the preparation
 *   and branch entries without changing them. It cancels with `{ cancel: true }`, never by
 *   throwing, and sends nothing. When `event.signal` aborted during its awaits, it decides nothing,
 *   counts nothing, and reports nothing.
 * - A correction cancellation happens only when the prepared input carries a presented note that is
 *   invalid or unverified and no covering correction was sent and saved. Per invalidation, the
 *   guard cancels once while the correction is unsent, and once while Pi still queues it, at most
 *   twice in all; then, or when the correction is saved but not confirmed or not in the prepared
 *   input, compaction proceeds and the gap is reported.
 * - While memory storage is not open, a presented note of the branch's project is unverifiable.
 * - `failed` publishes the correction for the guard's own cancellation, recorded at `beforeCompact`,
 *   with a non-triggering send it never awaits, then notifies and persists the cause.
 * - The guard never starts a compaction, prompt, retry, or triggering send, and never changes native
 *   settings. It runs whether memory is enabled or disabled.
 */
export class CompactionGuard {
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  private readonly freshness: Pick<FreshnessMonitor, "inspect">;
  private readonly presentation: Pick<
    PresentationCoordinator,
    "queuedCorrection" | "sendCorrections"
  >;
  private readonly memory: () => ValidityMemory | undefined;
  private cancels = new Map<string, { total: number; queued: boolean }>();
  private decision: Decision | undefined;
  private latest: CompactionGuardStatus = {
    cancellation: undefined,
    gap: undefined,
    error: undefined,
  };

  /** Create the guard over the note inspection, presentation, and open storage's memory. */
  constructor(
    pi: Pick<ExtensionAPI, "appendEntry">,
    owners: {
      freshness: Pick<FreshnessMonitor, "inspect">;
      presentation: Pick<PresentationCoordinator, "queuedCorrection" | "sendCorrections">;
      memory: () => ValidityMemory | undefined;
    },
  ) {
    this.pi = pi;
    this.freshness = owners.freshness;
    this.presentation = owners.presentation;
    this.memory = owners.memory;
  }

  /** Forget cancellation counts and decisions for a new storage session or branch. */
  reset(): void {
    this.cancels = new Map();
    this.decision = undefined;
  }

  /** Return a copy of the guard's status. */
  get status(): CompactionGuardStatus {
    return structuredClone(this.latest);
  }

  /**
   * Decide whether a prepared compaction may proceed, returning `{ cancel: true }` for a correction
   * cancellation and `undefined` otherwise. A failure of the check itself lets compaction proceed
   * and is notified, persisted as a report, and kept for status.
   */
  async beforeCompact(
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
  ): Promise<SessionBeforeCompactResult | undefined> {
    this.decision = undefined;
    try {
      await this.freshness.inspect(ctx, "compaction");
      const stale = event.signal.aborted ? undefined : this.staleNote(event, ctx);
      const gap = stale === undefined ? undefined : await this.gapOf(event, ctx, stale.projectId);
      if (stale === undefined || gap === undefined || event.signal.aborted) {
        return undefined;
      }
      const decision = this.decide(event, stale, gap);
      this.decision = decision;
      if (decision.outcome !== "cancel") {
        return undefined;
      }
      this.latest = {
        ...this.latest,
        cancellation: { reason: event.reason, cause: decision.cause },
      };
      return { cancel: true };
    } catch (error) {
      if (!event.signal.aborted) {
        this.reportFailure(event, ctx, describeError(error));
      }
      return undefined;
    }
  }

  /**
   * Publish the correction after the guard's own cancellation and notify and persist its cause;
   * ignores a failure the guard did not cause.
   */
  failed(event: SessionCompactFailedEvent, ctx: ExtensionContext): void {
    const decision = this.decision;
    this.decision = undefined;
    if (decision?.outcome !== "cancel" || !event.aborted) {
      return;
    }
    if (decision.gap === "unpublished") {
      this.presentation.sendCorrections(ctx);
    }
    const unsaved = decision.gap === "queued" ? unsavedTexts.queued : unsavedTexts.unpublished;
    const message = `Tiered memory cancelled the ${origins[decision.reason]} compaction because the current-work note in its input is no longer current: ${decision.cause}. ${unsaved} ${nextStep(decision.reason, decision.willRetry)}`;
    ctx.ui.notify(message, "warning");
    appendReport(this.pi, message);
  }

  /** Report a compaction that proceeded without a covering correction. */
  compacted(ctx: ExtensionContext): void {
    const decision = this.decision;
    this.decision = undefined;
    if (decision?.outcome !== "proceed") {
      return;
    }
    const gap = gapTexts[decision.gap];
    this.latest = { ...this.latest, gap: { reason: decision.reason, cause: decision.cause, gap } };
    const limit =
      decision.gap === "unpublished" || decision.gap === "queued"
        ? "and the cancellation limit for this change is reached"
        : "which cancelling the compaction would not change";
    const message = `Tiered memory let the ${origins[decision.reason]} compaction proceed although the current-work note in its input is no longer current: ${decision.cause}. Its correction is ${gap}, ${limit}.`;
    ctx.ui.notify(message, "warning");
    appendReport(this.pi, message);
  }

  private reportFailure(
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
    error: string,
  ): void {
    this.latest = { ...this.latest, error };
    const message = `Tiered memory could not check whether the current-work note in the ${origins[event.reason]} compaction's input is still current (${error}); the compaction proceeded.`;
    ctx.ui.notify(message, "warning");
    appendReport(this.pi, message);
  }

  private staleNote(
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
  ): StaleNote | undefined {
    const memory = this.memory();
    if (memory === undefined) {
      const branch = event.branchEntries;
      const lineage = unopenedLineage(branch, ctx.sessionManager.getSessionId());
      return lineage === undefined
        ? undefined
        : { projectId: lineage.projectId, identity: ["unopened"], validity: storageClosed };
    }
    const revision = memory.canonical.revision;
    const validity = noteValidity(memory, event.branchEntries);
    if (revision === undefined || (validity.state !== "invalid" && validity.state !== "unknown")) {
      return undefined;
    }
    const identity = [revision.sessionId, revision.revisionId];
    return { projectId: memory.session.store.projectId, identity, validity };
  }

  // Cancels once while the correction is unsent and once while Pi queues it, never more than twice
  // per invalidation; cancelling for a saved correction would record nothing new.
  private decide(event: SessionBeforeCompactEvent, stale: StaleNote, gap: GapCause): Decision {
    const key = JSON.stringify([...stale.identity, correctionCauseOf(stale.validity)]);
    const count = this.cancels.get(key) ?? { total: 0, queued: false };
    const cancel =
      (gap === "unpublished" && count.total === 0) ||
      (gap === "queued" && !count.queued && count.total < 2);
    if (cancel) {
      this.cancels.set(key, {
        total: count.total + 1,
        queued: count.queued || gap === "queued",
      });
    }
    return {
      outcome: cancel ? "cancel" : "proceed",
      reason: event.reason,
      willRetry: event.willRetry,
      cause: causeOf(stale.validity),
      gap,
    };
  }

  private async gapOf(
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
    projectId: string,
  ): Promise<GapCause | undefined> {
    const coverage = noteCoverage(event, projectId);
    if (coverage.kind === "none") {
      return undefined;
    }
    if (coverage.kind === "uncorrected") {
      return this.presentation.queuedCorrection(event.branchEntries) ? "queued" : "unpublished";
    }
    if (coverage.kind === "outside") {
      return "not-in-input";
    }
    const file = ctx.sessionManager.getSessionFile();
    const confirmed = await Effect.runPromise(
      confirmPresentations(file, coverage.entryIds).pipe(
        Effect.catch(() => Effect.succeed(new Set<string>())),
      ),
    );
    return coverage.entryIds.some((id) => confirmed.has(id)) ? undefined : "not-durable";
  }
}

/** Render the status lines of the latest correction cancellation, correction gap, and check failure. */
export function guardLines(status: CompactionGuardStatus): string[] {
  const lines: string[] = [];
  const { cancellation, gap, error } = status;
  if (cancellation !== undefined) {
    lines.push(
      `Latest correction cancellation: the ${origins[cancellation.reason]} compaction, because the current-work note in its input is no longer current: ${cancellation.cause}.`,
    );
  }
  if (gap !== undefined) {
    lines.push(
      `Latest correction gap: the ${origins[gap.reason]} compaction proceeded while the correction was ${gap.gap}; the current-work note in its input is no longer current: ${gap.cause}.`,
    );
  }
  if (error !== undefined) {
    lines.push(`Correction cancellation check failed (${error}); the compaction proceeded.`);
  }
  return lines;
}
