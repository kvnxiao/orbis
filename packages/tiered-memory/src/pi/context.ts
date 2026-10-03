import { randomUUID } from "node:crypto";

import type {
  ContextEvent,
  ContextEventResult,
  ContextWithSystemEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import type { SettingSource } from "../domain/settings.ts";
import { planPresentation, reconstructLog } from "../presentation/append-snapshots.ts";
import type { PresentationEntry, PresentationLineage } from "../presentation/entries.ts";
import { estimatePresentationTokens } from "../presentation/render.ts";
import type { PresentationLog, PresentationPlan, PresentedRecord } from "../presentation/types.ts";
import { actingContext, renderedAs } from "./acting-context.ts";
import type { AgentMessage, RequestState } from "./acting-context.ts";
import { appendReport, describeError } from "./configuration.ts";
import { noteValidity } from "./note-validity.ts";
import type { ValidityMemory } from "./note-validity.ts";
import {
  branchProject,
  confirmPresentations,
  presentationEntryOf,
  presentationsIn,
  rawPresentationIds,
  rawRecordIds,
  sendPresentation,
  unopenedLineage,
} from "./presentation-log.ts";
import { capacityStopLine, presentationStatusOf } from "./presentation-status.ts";
import type { PresentationStatus } from "./presentation-status.ts";
import {
  evaluateCapacity,
  requestFootprint,
  requestLimits,
  stopForCapacity,
} from "./request-capacity.ts";
import type { CapacityStop, RequestLimits } from "./request-capacity.ts";
import { takeRequestSnapshot, unopenedSnapshot } from "./request-snapshot.ts";
import type { IndexComponent, RequestSnapshot } from "./request-snapshot.ts";
import { projectEntriesOf } from "./storage-binding.ts";

/**
 * Read the runtime state presentation depends on: activation, open storage's session, cached
 * canonical memory, and note freshness, and the effective `presentationTokens` with its source,
 * `undefined` while no configuration is current.
 */
export interface PresentationRuntime {
  enabled: () => boolean;
  memory: () => PresentationMemory | undefined;
  budget: () => { tokens: number; source: SettingSource } | undefined;
}

type PresentationMemory = ValidityMemory;

// A request's snapshot with the lineage it presents and the log reconstructed for that lineage;
// `open` is false while memory storage is not open.
interface Prepared {
  snapshot: RequestSnapshot & { view: NonNullable<RequestSnapshot["view"]> };
  lineage: PresentationLineage;
  log: PresentationLog;
  open: boolean;
}

function sessionIdsOf(branch: readonly SessionEntry[], lineage: PresentationLineage) {
  const ids = new Set([lineage.sessionId]);
  for (const entry of projectEntriesOf(branch)) {
    if (entry.projectId === lineage.projectId) {
      ids.add(entry.sessionId);
    }
  }
  return ids;
}

function plannedRecords(plan: PresentationPlan): PresentationEntry[] {
  if (plan.kind === "append") {
    return [...plan.records];
  }
  return plan.kind === "reset" ? [...plan.corrections, plan.record] : [];
}

/**
 * Own the single Pi presentation coordinator of one extension instance: branch reconstruction,
 * append confirmation, the acting `context` transform, request accounting, and the capacity stop.
 *
 * Invariants:
 *
 * - The `context` transform is the request's snapshot point. It takes the snapshot synchronously from
 *   cached canonical memory and the note's validity and awaits nothing. It builds a new array and
 *   new messages and never mutates incoming messages, since a mutation leaks into dispatch even
 *   when the handler throws.
 * - The transform renders a sent record at the transcript tail until it reaches the raw branch, so a
 *   request never presents an older note as current while the newest is pending.
 * - `context_with_system` measures the request and may return the incoming transcript minus optional
 *   package-owned presentation messages, keeping the system message and every other element by
 *   identity, except that a reset carrying the current note beside the index becomes a new
 *   note-only message; it never changes the prompt or tools. Only the record that carries the
 *   current valid note body and the newest boundary record for that body are mandatory, and of such
 *   a reset only its note portion; index records, earlier boundary records, and superseded note
 *   copies are optional.
 * - A note that is invalid or whose freshness is unknown is withheld: the transform drops its records
 *   and renders resets without it, as new messages, and a correction states the cause.
 * - Records are sent only from the transform and from `sendCorrections`, which the hooks that inspect
 *   the note file and the idle points call; never from `session_before_compact`. Only the transform
 *   sends components, boundaries, and resets.
 * - While memory is disabled, the transform and `sendCorrections` still send corrections and keep
 *   invalid or unverified note representations out of acting context, without new records or a
 *   capacity check.
 * - While memory storage is not open, a branch with presentation records of its project is
 *   reconstructed from the branch alone, with the lineage its project entries name: the presented
 *   note's freshness is unknown, so it is withheld and corrected as unverified, without new records
 *   or a capacity check, whether memory is enabled or disabled.
 * - Presentation bookkeeping never establishes processing coverage or note validity.
 */
export class PresentationCoordinator {
  private readonly pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">;
  private readonly runtime: PresentationRuntime;
  private index: (() => IndexComponent | undefined) | undefined;
  private pending: PresentationEntry[] = [];
  private confirmed = new Set<string>();
  private request: RequestState | undefined;
  private stop: CapacityStop | undefined;
  private limits: RequestLimits | undefined;
  private confirmationError: string | undefined;

  /** Create the coordinator over the runtime state it reads and the Pi send and append APIs. */
  constructor(pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">, runtime: PresentationRuntime) {
    this.pi = pi;
    this.runtime = runtime;
  }

  /**
   * Install the source of the bounded index component; it is read synchronously at each snapshot
   * and must not perform I/O.
   */
  provideIndex(source: () => IndexComponent | undefined): void {
    this.index = source;
  }

  /**
   * Reset per-branch state after `session_start` or `session_tree`, dropping records sent for
   * another branch or session, then confirm and send due corrections as `settle` does.
   */
  async restore(ctx: ExtensionContext): Promise<void> {
    this.pending = [];
    this.confirmed = new Set();
    this.request = undefined;
    await this.settle(ctx);
  }

  /**
   * Confirm the valid presentation records of the raw selected branch, including records that
   * compaction later summarized, whose entries are in the session file after fsync. A read failure
   * is kept for status and confirms nothing.
   */
  async confirm(ctx: ExtensionContext): Promise<void> {
    const unconfirmed = rawPresentationIds(ctx.sessionManager.getBranch()).filter(
      (id) => !this.confirmed.has(id),
    );
    if (unconfirmed.length === 0) {
      return;
    }
    try {
      const file = ctx.sessionManager.getSessionFile();
      const confirmed = await Effect.runPromise(confirmPresentations(file, unconfirmed));
      for (const id of confirmed) {
        this.confirmed.add(id);
      }
      this.confirmationError = undefined;
    } catch (error) {
      this.confirmationError = describeError(error);
    }
  }

  /** Confirm records at an idle point, then send due corrections as `sendCorrections` does. */
  async settle(ctx: ExtensionContext): Promise<void> {
    await this.confirm(ctx);
    this.sendCorrections(ctx);
  }

  /**
   * Send corrections for presented notes that are no longer valid, synchronously from a fresh
   * snapshot, also while memory is disabled or storage is not open; components wait for the next
   * request.
   *
   * Pi appends a send while idle and flushes one sent during a run after the current turn's
   * messages, so a correction never lands between a tool call and its result.
   */
  sendCorrections(ctx: ExtensionContext): void {
    const prepared = this.prepare(ctx, ctx.sessionManager.getBranch());
    if (prepared === undefined) {
      return;
    }
    const plan = planPresentation(prepared.snapshot.view, prepared.log, Infinity, randomUUID);
    this.send(plannedRecords(plan).filter((entry) => entry.kind === "correction"));
  }

  /**
   * Transform one acting request's messages from its snapshot.
   *
   * Plans with `planPresentation` and sends the planned records, then builds the transcript with
   * `actingContext`. An `over-budget` plan stops the request with a `presentation-budget` capacity
   * stop and returns `undefined`. While memory is disabled or storage is not open, sends only
   * corrections and keeps withheld note representations out, without a capacity check.
   */
  transform(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | undefined {
    const branch = ctx.sessionManager.getBranch();
    const prepared = this.prepare(ctx, branch);
    this.request = undefined;
    if (prepared === undefined) {
      return undefined;
    }
    const { snapshot, lineage, open } = prepared;
    const { view, validity } = snapshot;
    const presenting = open && this.runtime.enabled();
    const budget = this.runtime.budget();
    const budgetTokens = presenting && budget !== undefined ? budget.tokens : Infinity;
    const plan = planPresentation(view, prepared.log, budgetTokens, randomUUID);
    if (plan.kind === "over-budget") {
      this.stopRequest(ctx, {
        cause: "presentation-budget",
        modelId: ctx.model === undefined ? undefined : `${ctx.model.provider}/${ctx.model.id}`,
        anchorId: view.anchorId,
        requiredTokens: plan.requiredTokens,
        availableTokens: plan.budgetTokens,
        headroomTokens: 0,
        estimate: false,
      });
      return undefined;
    }
    const planned = plannedRecords(plan);
    this.send(presenting ? planned : planned.filter((entry) => entry.kind === "correction"));
    const log = this.logFor(branch, lineage);
    const hideNote = validity.state === "invalid" || validity.state === "unknown";
    const acting = actingContext(event.messages, log, view, hideNote);
    this.request = presenting ? acting.request : undefined;
    return { messages: acting.messages };
  }

  /**
   * Measure the request that `context_with_system` assembled, yield optional memory, or stop the
   * request before dispatch when the complete note cannot fit.
   *
   * For `without-optional`, returns the incoming transcript minus the optional presentation
   * messages the transform kept, with a reset that carries the current note beside the index
   * replaced by a new note-only rendering, and every other element by identity. Only that note-only
   * portion of such a reset counts as mandatory. A request without presented memory, or with
   * unknown limits, is not checked.
   */
  account(event: ContextWithSystemEvent, ctx: ExtensionContext): ContextEventResult | undefined {
    const request = this.request;
    if (request === undefined) {
      return undefined;
    }
    const limits = requestLimits(ctx);
    this.limits = limits;
    if (limits.kind !== "known") {
      return undefined;
    }
    const reduced = new Map<string, AgentMessage>();
    for (const message of event.messages) {
      const id = presentationEntryOf(message)?.id;
      const noteOnly = id === undefined ? undefined : request.noteOnly.get(id);
      if (id !== undefined && noteOnly !== undefined) {
        reduced.set(id, renderedAs(message, noteOnly));
      }
    }
    const footprint = requestFootprint(event, ctx, { ...request, reduced }, limits);
    const decision = evaluateCapacity(footprint, limits, request.anchorId);
    if (decision.kind === "without-optional") {
      return {
        messages: event.messages.flatMap((message) => {
          const id = presentationEntryOf(message)?.id;
          if (id === undefined) {
            return [message];
          }
          return request.optional.has(id) ? [] : [reduced.get(id) ?? message];
        }),
      };
    }
    if (decision.kind === "stop") {
      this.stopRequest(ctx, decision.stop);
    }
    return undefined;
  }

  /**
   * Describe presentation on the active branch for status; reads no files. Reset counts use the
   * project of open storage, or of the branch's project entries while storage is not open; the
   * fields derived from the presentation log need enabled memory and open storage.
   */
  status(ctx: ExtensionContext): PresentationStatus {
    const memory = this.runtime.memory();
    const branch = ctx.sessionManager.getBranch();
    const lineage = memory === undefined ? undefined : storageLineage(memory);
    return presentationStatusOf({
      branch,
      log:
        lineage === undefined || !this.runtime.enabled() ? undefined : this.logFor(branch, lineage),
      projectId: lineage?.projectId ?? branchProject(branch),
      confirmed: this.confirmed,
      budget: this.runtime.budget(),
      limits: this.limits,
      stop: this.stop,
      confirmationError: this.confirmationError,
    });
  }

  /**
   * Report whether a current-work note correction this coordinator sent is still queued: Pi has not
   * appended it to the raw `branch`.
   */
  queuedCorrection(branch: readonly SessionEntry[]): boolean {
    const appended = rawRecordIds(branch);
    return this.pending.some(
      (entry) =>
        entry.kind === "correction" && entry.component === "work-note" && !appended.has(entry.id),
    );
  }

  // Records the stop, shows its status line, and persists that line as the latest report before
  // the abort, so the warning stays inspectable after the notification disappears.
  private stopRequest(ctx: ExtensionContext, stop: CapacityStop): void {
    stopForCapacity(ctx, stop, (recorded) => {
      this.stop = recorded;
      const line = capacityStopLine(recorded, undefined);
      ctx.ui.notify(line, "warning");
      appendReport(this.pi, line);
    });
  }

  private prepare(ctx: ExtensionContext, branch: readonly SessionEntry[]): Prepared | undefined {
    const anchorId = ctx.sessionManager.getLeafId() ?? undefined;
    const memory = this.runtime.memory();
    if (memory !== undefined) {
      const lineage = storageLineage(memory);
      const validity = noteValidity(memory, branch);
      const snapshot = takeRequestSnapshot(
        { lineage, anchorId },
        memory.canonical,
        this.index?.(),
        validity,
      );
      const { view } = snapshot;
      return view === undefined
        ? undefined
        : { snapshot: { view, validity }, lineage, log: this.logFor(branch, lineage), open: true };
    }
    const lineage = unopenedLineage(branch, ctx.sessionManager.getSessionId());
    if (lineage === undefined || anchorId === undefined) {
      return undefined;
    }
    const log = this.logFor(branch, lineage);
    const presented = log.current["work-note"]?.revision;
    return { snapshot: unopenedSnapshot(lineage, anchorId, presented), lineage, log, open: false };
  }

  private send(entries: readonly PresentationEntry[]): void {
    for (const entry of entries) {
      sendPresentation(this.pi, entry);
      this.pending.push(entry);
    }
  }

  // Prunes sent records that reached the raw branch, also when a context edit omits or replaces
  // them there, so the projection decides whether they still count as presented.
  private logFor(branch: readonly SessionEntry[], lineage: PresentationLineage): PresentationLog {
    const { records, damaged } = presentationsIn(branch);
    const appended = rawRecordIds(branch);
    this.pending = this.pending.filter((entry) => !appended.has(entry.id));
    const record = (entry: PresentationEntry, entryId: string | undefined): PresentedRecord => ({
      entry,
      entryId,
      confirmed: entryId !== undefined && this.confirmed.has(entryId),
      tokens: estimatePresentationTokens(entry),
    });
    return reconstructLog(
      records.map(({ entry, entryId }) => record(entry, entryId)),
      this.pending.map((entry) => record(entry, undefined)),
      {
        projectId: lineage.projectId,
        sessionIds: sessionIdsOf(branch, lineage),
        branchIds: new Set(branch.map((entry) => entry.id)),
      },
      damaged,
    );
  }
}

function storageLineage(memory: PresentationMemory): PresentationLineage {
  const { projectId, sessionId } = memory.session.store;
  return { projectId, sessionId };
}
