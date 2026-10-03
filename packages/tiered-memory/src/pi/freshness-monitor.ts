import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type * as Effect from "effect/Effect";

import type { StorageServices } from "../storage/services.ts";
import { workNoteName } from "./canonical-memory.ts";
import type { Execution, StorageScope } from "./execution.ts";
import { inspectNoteFile } from "./note-inspection.ts";
import type { NoteInspection } from "./note-inspection.ts";
import type { StorageSessionOwner } from "./storage-session.ts";

/** Name the lifecycle point that requests an inspection of the managed note file. */
export type InspectionPoint =
  | "input"
  | "before_agent_start"
  | "turn_start"
  | "turn_end"
  | "compaction";

/**
 * Inspect the managed current-work note file at acting-turn and compaction boundaries and apply
 * each result to the storage session's freshness.
 *
 * Invariants:
 *
 * - An inspection is bounded by `noteInspectionTimeoutMs`, reads without the project lock, and never
 *   waits for reconciliation or the storage-session turn.
 * - `turn_start` inspects only when no inspection began since the last idle point, which covers runs
 *   that skip `input` and `before_agent_start` without repeating their reads.
 * - A result applies only while its storage scope and freshness generation are unchanged.
 * - An unmaterialized head is this process's publication in flight only while startup, a job, or
 *   storage-session work of the scope holds its turn when the inspection starts or completes;
 *   otherwise it is an unfinished memory write, and the note's freshness is unknown.
 * - Recording a detected curation, and the refresh after another process changed the head, after an
 *   unfinished write, or after a curated note without a view no longer matches its record, run as
 *   background storage-session work, never on the prompt path; `settled` waits for them.
 */
export class FreshnessMonitor {
  private readonly execution: Execution;
  private readonly storage: StorageSessionOwner;
  private readonly runStorageWork: (
    scope: StorageScope,
    work: Effect.Effect<void, unknown, StorageServices>,
  ) => Promise<void>;
  private inspectedSinceIdle = false;
  private recurated: string | undefined;
  private readonly background = new Set<Promise<void>>();
  private settledWork: ((ctx: ExtensionContext) => void) | undefined;

  /**
   * Create the monitor over the runtime's execution and storage owner; `runStorageWork` admits
   * storage-session work and records its failure.
   */
  constructor(
    execution: Execution,
    storage: StorageSessionOwner,
    runStorageWork: (
      scope: StorageScope,
      work: Effect.Effect<void, unknown, StorageServices>,
    ) => Promise<void>,
  ) {
    this.execution = execution;
    this.storage = storage;
    this.runStorageWork = runStorageWork;
  }

  /** Mark an idle point: `agent_settled`, `session_start`, or `session_tree`. */
  markIdle(): void {
    this.inspectedSinceIdle = false;
  }

  /**
   * Inspect the open storage session's current-work note file and apply the result.
   *
   * Does nothing while storage is not open, and at `turn_start` after another inspection began
   * since the last idle point. After an applied result, refreshes in the background when the head
   * it read differs from the latest head this process saw, when it found an unfinished write, or
   * when a curated note without a view newly differs from its record, and records a pending
   * detection in the background.
   *
   * @throws The original defect of the inspection.
   */
  async inspect(ctx: ExtensionContext, point: InspectionPoint): Promise<void> {
    if (point === "turn_start" && this.inspectedSinceIdle) {
      return;
    }
    this.inspectedSinceIdle = true;
    const open = this.storage.open;
    if (open === undefined) {
      return;
    }
    const { scope } = open;
    const started = this.storage.freshness.current;
    const sessionDir = open.session.store.sessionDir;
    const publishing = this.execution.holdsTurn(scope);
    const curated = open.canonical.curation[workNoteName];
    const inspection = await this.execution.runDetached(
      inspectNoteFile(sessionDir, workNoteName, curated),
    );
    if (inspection === undefined || this.execution.stopped) {
      return;
    }
    const unfinished =
      inspection.kind === "pending" &&
      inspection.unfinished &&
      !publishing &&
      !this.execution.holdsTurn(scope);
    const applied: NoteInspection = unfinished
      ? {
          kind: "unknown",
          reason: `memory storage has not finished writing revision ${inspection.headRevisionId}`,
        }
      : inspection;
    if (!this.storage.applyInspection(scope, started, applied, this.execution.now())) {
      return;
    }
    const latest = this.storage.openIn(scope)?.latestRevision ?? null;
    const changed = inspection.kind !== "unknown" && inspection.headRevisionId !== latest;
    if (changed || unfinished || this.newlyRecurated(sessionDir, inspection)) {
      this.track(scope, this.storage.refresh(scope, ctx), ctx);
    }
    this.recordPending(ctx);
  }

  /**
   * Call `listener` after each background recording or refresh settles, since planning and
   * proposals that it held back may proceed; replaces an earlier listener.
   */
  whenSettled(listener: (ctx: ExtensionContext) => void): void {
    this.settledWork = listener;
  }

  /** Start recording a pending detected curation as background storage-session work. */
  recordPending(ctx: ExtensionContext): void {
    const open = this.storage.open;
    if (open === undefined || !this.storage.freshness.awaitsRecording) {
      return;
    }
    this.track(open.scope, this.storage.recordDetection(open.scope, ctx), ctx);
  }

  /** Resolve once every background recording and refresh this monitor started has settled. */
  async settled(): Promise<void> {
    while (this.background.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Work tracked while this waits must also settle.
      await Promise.all(this.background);
    }
  }

  // A record that only fork inheritance supplied never changes on refresh, so each observed state
  // of such a note schedules one refresh.
  private newlyRecurated(sessionDir: string, inspection: NoteInspection): boolean {
    if (inspection.kind !== "recurated") {
      return false;
    }
    const observed = JSON.stringify([sessionDir, inspection.event]);
    const fresh = observed !== this.recurated;
    this.recurated = observed;
    return fresh;
  }

  private track(
    scope: StorageScope,
    work: Effect.Effect<void, unknown, StorageServices>,
    ctx: ExtensionContext,
  ): void {
    const task = this.runStorageWork(scope, work).finally(() => {
      this.background.delete(task);
      this.settledWork?.(ctx);
    });
    this.background.add(task);
  }
}
