import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import type { ProjectedSource } from "../domain/intervals.ts";
import type { Limits } from "../domain/settings.ts";
import type { StorageServices } from "../storage/services.ts";
import { projectSources } from "../storage/source-projection.ts";
import type { StorageScope } from "./execution.ts";
import { roleModel } from "./models.ts";
import { noteValidity } from "./note-validity.ts";
import type { NoteValidity } from "./note-validity.ts";
import { observerContext, scheduleObservations } from "./observer-planning.ts";
import { runObserverJob } from "./observer.ts";
import type { ObserverPorts } from "./observer.ts";
import type { MemoryRuntime } from "./runtime.ts";
import { WorkerQueue } from "./worker.ts";
import type { JobOutcome, WorkerJob, WorkerStatus } from "./worker.ts";

/**
 * Own automatic memory work for one extension instance: one `WorkerQueue` per storage scope and the
 * scheduling that feeds it, outside `MemoryRuntime`.
 *
 * Invariants:
 *
 * - A queue belongs to exactly one storage scope and ends when that scope closes; a replacement scope
 *   starts a new queue, so old results never reach it, and a job commits only while its scope is
 *   current.
 * - Scheduling runs synchronously from Pi handlers and from a queue drain that followed a commit,
 *   reads only in-memory state, and never waits for a job. It refuses while memory is disabled,
 *   storage is not open, capture would refuse, no configuration is current, the observer role is
 *   not ready, or lineage coverage is unavailable, and defers while the current-work note's
 *   freshness is unknown, so an unverified note never reaches the observer as continuity state.
 * - `discard` drops waiting jobs; `MemoryRuntime.disable` cancels the running one.
 */
export class MemoryWork {
  private readonly runtime: MemoryRuntime;
  private current: { scope: StorageScope; queue: WorkerQueue } | undefined;
  private deferral: Extract<NoteValidity, { state: "unknown" }> | undefined;

  /** Create the owner over the runtime whose storage scopes its queues join. */
  constructor(runtime: MemoryRuntime) {
    this.runtime = runtime;
  }

  /**
   * Plan eligible intervals of the active branch from current coverage and offer them to the
   * current scope's queue, starting that queue on first use.
   *
   * Call it after storage opens on `session_start` and `session_tree`, after each completed turn,
   * and after memory is enabled; the queue also calls it when it drains after a commit. Plans at
   * most `queuedJobs` intervals, each within the observer input budget, so re-enabling plans only
   * bounded catch-up.
   */
  schedule(ctx: ExtensionContext): void {
    this.deferral = undefined;
    const storage = this.runtime.enabled ? this.runtime.memoryStorage(ctx) : undefined;
    const { configuration, roles } = this.runtime.snapshot;
    const observer = roles?.observer;
    if (
      storage === undefined ||
      storage.refusal !== undefined ||
      configuration === undefined ||
      observer?.state !== "ready" ||
      storage.canonical.coverage.state !== "available"
    ) {
      return;
    }
    const { limits } = configuration.settings;
    const queue = this.queueFor(storage.scope, ctx, limits);
    if (queue === undefined) {
      return;
    }
    const processed = storage.canonical.coverage.processed;
    const branch = ctx.sessionManager.getBranch();
    const validity = noteValidity(storage, branch);
    if (validity.state === "unknown") {
      this.deferral = validity;
      return;
    }
    const { session } = storage;
    let sources: ProjectedSource[];
    try {
      sources = projectSources(branch, session.store, session.sources.sources);
    } catch {
      // Malformed source metadata fails reconciliation, which status reports; nothing is planned.
      return;
    }
    const context = observerContext(
      storage.canonical,
      validity,
      processed,
      { branch, sources },
      limits.checkpointTokens,
    );
    scheduleObservations(queue, {
      sources,
      coverage: processed,
      context,
      inputTokens: observer.inputTokens,
      workNoteTokens: limits.workNoteTokens,
      maxIntervals: limits.queuedJobs,
      now: this.runtime.execution.now(),
    });
  }

  /** Discard the current queue's waiting jobs, leaving their spans unassigned on disk. */
  discard(): void {
    this.current?.queue.clear();
  }

  /**
   * Return the current scope's queue status with the deferral of the latest planning pass, or
   * `undefined` while no queue is open.
   */
  get status(): WorkerStatus | undefined {
    const queue = this.current?.queue;
    if (queue === undefined || queue.isStopped) {
      return undefined;
    }
    const status = queue.status;
    return this.deferral === undefined ? status : { ...status, planningDeferral: this.deferral };
  }

  /**
   * Resolve once the current queue has no waiting or running job, or it stopped; resolves
   * immediately without a queue.
   */
  async idle(): Promise<void> {
    await this.current?.queue.idle();
  }

  private queueFor(
    scope: StorageScope,
    ctx: ExtensionContext,
    limits: Pick<Limits, "queuedJobs">,
  ): WorkerQueue | undefined {
    const current = this.current;
    if (current?.scope === scope && !current.queue.isStopped) {
      return current.queue;
    }
    if (this.runtime.execution.currentScope !== scope || this.runtime.execution.stopped) {
      return undefined;
    }
    const queue = WorkerQueue.start(
      this.runtime.execution,
      scope,
      limits,
      (job) => this.run(scope, ctx, job),
      () => {
        this.schedule(ctx);
      },
    );
    this.current = { scope, queue };
    return queue;
  }

  private run(
    scope: StorageScope,
    ctx: ExtensionContext,
    job: WorkerJob,
  ): Effect.Effect<JobOutcome, unknown, StorageServices> {
    return Effect.suspend(() => {
      const settings = this.runtime.snapshot.configuration?.settings;
      if (settings === undefined) {
        return Effect.succeed({ kind: "stale", reason: "unready" } as const);
      }
      const runtime = this.runtime;
      const storage = (): ReturnType<ObserverPorts["storage"]> => {
        const open = runtime.memoryStorage(ctx);
        return open?.scope === scope ? open : undefined;
      };
      const ports: ObserverPorts = {
        ctx,
        storage,
        model: () => roleModel(ctx, settings, "observer"),
        recordUsage: (usage) => {
          if (this.current?.scope === scope) {
            this.current.queue.recordUsage(usage);
          }
        },
        async commit(proposal, signal) {
          if (storage() === undefined) {
            const reason = new Error("Tiered memory storage changed before the observer commit.");
            return { kind: "cancelled", reason };
          }
          return await runtime.commitProposal(
            { sessionManager: ctx.sessionManager, signal },
            proposal,
          );
        },
      };
      return runObserverJob(job, ports, settings.limits);
    });
  }
}
