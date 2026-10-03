import type { Usage } from "@earendil-works/pi-ai";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";

import type { SourceInterval } from "../domain/intervals.ts";
import type { ObserverRejection } from "../domain/observer.ts";
import type { ConflictReason } from "../domain/proposal.ts";
import type { Limits } from "../domain/settings.ts";
import type { StorageServices } from "../storage/services.ts";
import { describeError } from "./configuration.ts";
import type { Execution, JobResult, StorageScope } from "./execution.ts";
import type { NoteValidity } from "./note-validity.ts";

/**
 * Describe one queued memory job; `enqueuedAt` is the Effect clock time the producer offered it,
 * which starts the job's total deadline. The consolidator adds its own variant.
 */
export interface ObserverJob {
  kind: "observer";
  interval: SourceInterval;
  enqueuedAt: number;
}

/** Name a queued memory job. */
export type WorkerJob = ObserverJob;

/** Report a synchronous offer: `deferred` leaves the job's spans unassigned on disk. */
export type QueueOffer = { kind: "queued" } | { kind: "deferred"; reason: "full" | "stopped" };

/**
 * Name why one provider attempt produced no acceptable result.
 *
 * Every variant is a pre-commit inference failure with no side effect, so the job retries it within
 * its `retries` and total deadline. Cancellation, stale dependencies, commit conflicts, and storage
 * failures are job outcomes and never retried. `provider` carries the provider's error text;
 * `truncated` means the response stopped at its output limit; `malformed` carries the JSON or
 * schema failure; `oversized` carries the estimated output tokens and their cap; `rejected` carries
 * the writer-boundary rejection.
 */
export type AttemptFailure =
  | { kind: "provider"; message: string }
  | { kind: "timeout"; timeoutMs: number }
  | { kind: "truncated" }
  | { kind: "malformed"; detail: string }
  | { kind: "oversized"; tokens: number; limit: number }
  | { kind: "rejected"; rejection: ObserverRejection };

/**
 * Report how a dispatched job ended.
 *
 * - `committed`: the head is durable.
 * - `stale`: dispatch found the interval covered, its spans changed or off the branch, storage or
 *   configuration unready, the observer model unresolved or too small, its request above the
 *   observer input cap even without the checkpoint (`oversize`), the total deadline already passed
 *   while it waited (`expired`), or the current-work note's freshness unknown (`freshness`), so no
 *   model call ran; its spans are released and the producer plans them again from current state.
 * - `conflict`: the commit's checks rejected the proposal; nothing is retried with old output.
 * - `exhausted`: every attempt failed, the total deadline passed after at least one attempt
 *   (`deadline`), or it passed before an accepted attempt's commit started its head write, which
 *   abandons the commit (`deadline` and `commit`); `failures` lists the failed attempts. The spans
 *   stay uncovered and are skipped for the rest of the storage session.
 * - `cancelled`: a disable, replacement, or shutdown stopped it, with the first reason.
 * - `failed`: the job failed with a storage or other error, whose message it carries; its spans stay
 *   uncovered and a later schedule plans them again.
 */
export type JobOutcome =
  | { kind: "committed"; revisionId: string }
  | {
      kind: "stale";
      reason: "covered" | "changed" | "unready" | "model" | "oversize" | "expired" | "freshness";
    }
  | { kind: "conflict"; reason: ConflictReason }
  | { kind: "exhausted"; failures: readonly AttemptFailure[]; deadline: boolean; commit: boolean }
  | { kind: "cancelled"; reason: unknown }
  | { kind: "failed"; message: string };

/**
 * Accumulate provider-reported usage of one storage session's observer attempts, retries included.
 *
 * `attempts` counts dispatched provider attempts and `reported` those whose response carried usage.
 * Each total sums the reporting attempts' finite values and is `undefined`, meaning unknown, while
 * no attempt reported that field; an attempt without a response adds nothing to any total.
 */
export interface ObserverUsage {
  attempts: number;
  reported: number;
  input: number | undefined;
  output: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
  cost: number | undefined;
}

/**
 * Describe the queue for status: queued and running jobs, offers deferred because the queue was
 * full, spans skipped after exhaustion, the latest job outcome, and observer usage. `planningStall`
 * is the estimated span budget of the latest planning pass when it left eligible unclaimed text
 * unplanned because no span fit that budget, and `undefined` otherwise. `planningDeferral`, which
 * the scheduler adds, is the unknown note freshness that deferred the latest planning pass.
 */
export interface WorkerStatus {
  queued: number;
  running: WorkerJob | undefined;
  deferred: number;
  exhausted: ReadonlySet<string>;
  last: JobOutcome | undefined;
  usage: ObserverUsage;
  planningStall: number | undefined;
  planningDeferral?: Extract<NoteValidity, { state: "unknown" }>;
}

function added(total: number | undefined, value: number): number | undefined {
  return Number.isFinite(value) ? (total ?? 0) + value : total;
}

/** Add one dispatched attempt's provider-reported usage, or an attempt without a response. */
export function addUsage(total: ObserverUsage, usage: Usage | undefined): ObserverUsage {
  if (usage === undefined) {
    return { ...total, attempts: total.attempts + 1 };
  }
  return {
    attempts: total.attempts + 1,
    reported: total.reported + 1,
    input: added(total.input, usage.input),
    output: added(total.output, usage.output),
    cacheRead: added(total.cacheRead, usage.cacheRead),
    cacheWrite: added(total.cacheWrite, usage.cacheWrite),
    cost: added(total.cost, usage.cost.total),
  };
}

const noUsage: ObserverUsage = {
  attempts: 0,
  reported: 0,
  input: undefined,
  output: undefined,
  cacheRead: undefined,
  cacheWrite: undefined,
  cost: undefined,
};

/**
 * Compute a dispatched attempt's deadline from the job's total deadline.
 *
 * The total deadline is `enqueuedAt + jobTimeoutMs` and includes queue waiting and earlier
 * attempts. Each attempt gets the remaining time divided by the attempts left, rounded down to at
 * least one millisecond, so a retry always has time. Returns `expired` when no time remains.
 */
export function attemptDeadline(
  job: Pick<WorkerJob, "enqueuedAt">,
  now: number,
  attempt: { index: number; attempts: number },
  jobTimeoutMs: number,
): { kind: "attempt"; timeoutMs: number } | { kind: "expired" } {
  const remaining = job.enqueuedAt + jobTimeoutMs - now;
  if (remaining <= 0) {
    return { kind: "expired" };
  }
  const left = Math.max(attempt.attempts - attempt.index, 1);
  return { kind: "attempt", timeoutMs: Math.max(Math.floor(remaining / left), 1) };
}

function outcomeOf(exit: Exit.Exit<JobResult<JobOutcome, never>, unknown>): JobOutcome {
  if (Exit.isFailure(exit)) {
    return { kind: "failed", message: describeError(Cause.squash(exit.cause)) };
  }
  const result = exit.value;
  return result.kind === "completed" ? result.value : { kind: "cancelled", reason: result.reason };
}

/**
 * Own one storage scope's serial memory-inference queue: a bounded queue with one consumer fiber,
 * shared by the observer and the future consolidator.
 *
 * One consumer establishes serial inference, so no semaphore guards model capacity. The queue holds
 * at most `queuedJobs` waiting jobs besides the running one; a job claims its spans from offer
 * until it ends. Closing the storage scope interrupts the consumer and stops the queue; a disable
 * cancels the running job, and `clear` discards the waiting ones. Each job runs through
 * `Execution.runWorkerJob`, and the consumer records every outcome, including failures. When the
 * queue drains after at least one job since the previous drain committed, the consumer calls its
 * drain callback once before resolving idle waiters, so a backlog planned against an older note is
 * planned again without waiting for another turn; a drain after only uncommitted outcomes calls
 * nothing.
 */
export class WorkerQueue {
  private readonly queue: Queue.Queue<WorkerJob>;
  private readonly waiting = new Set<WorkerJob>();
  private readonly exhausted = new Set<string>();
  private readonly idleWaiters: (() => void)[] = [];
  private readonly drained: () => void;
  private running: WorkerJob | undefined;
  private deferred = 0;
  private last: JobOutcome | undefined;
  private usage = noUsage;
  private planningStall: number | undefined;
  private committedSinceDrain = false;
  private stopped = false;

  private constructor(queue: Queue.Queue<WorkerJob>, drained: () => void) {
    this.queue = queue;
    this.drained = drained;
  }

  /**
   * Create the queue and fork its consumer into `storage` with `Execution.forkWorker`.
   *
   * `run` executes one job; the consumer records its outcome and takes the next job. `drained` runs
   * synchronously in the consumer after a drain that followed a commit, may offer jobs, and must
   * not throw.
   *
   * @throws The errors of `Execution.forkWorker`; nothing is forked.
   */
  static start(
    execution: Execution,
    storage: StorageScope,
    limits: Pick<Limits, "queuedJobs">,
    run: (job: WorkerJob) => Effect.Effect<JobOutcome, unknown, StorageServices>,
    drained: () => void,
  ): WorkerQueue {
    const queue = new WorkerQueue(
      Effect.runSync(Queue.bounded<WorkerJob>(limits.queuedJobs)),
      drained,
    );
    execution.forkWorker(storage, queue.consume(execution, storage, run));
    return queue;
  }

  /**
   * Offer a job without waiting; a full or stopped queue defers it, and a full one counts the
   * deferral.
   *
   * Runs synchronously from a Pi event handler and never applies backpressure to Pi.
   */
  offer(job: WorkerJob): QueueOffer {
    if (this.stopped) {
      return { kind: "deferred", reason: "stopped" };
    }
    if (!Queue.offerUnsafe(this.queue, job)) {
      this.deferred++;
      return { kind: "deferred", reason: "full" };
    }
    this.waiting.add(job);
    return { kind: "queued" };
  }

  /** Discard every waiting job, leaving its spans unassigned on disk; the running job continues. */
  clear(): void {
    for (const job of Effect.runSync(Queue.clear(this.queue))) {
      this.waiting.delete(job);
    }
    this.settleIdle();
  }

  /** Report whether the scope closed, after which every offer defers. */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** Return the span references of queued, running, and exhausted jobs, which the planner skips. */
  get claimed(): ReadonlySet<string> {
    const jobs = this.running === undefined ? [...this.waiting] : [...this.waiting, this.running];
    return new Set([
      ...this.exhausted,
      ...jobs.flatMap((job) => job.interval.spans.map((span) => span.reference)),
    ]);
  }

  /** Return a copy of the queue's status. */
  get status(): WorkerStatus {
    return {
      queued: this.waiting.size,
      running: this.running === undefined ? undefined : structuredClone(this.running),
      deferred: this.deferred,
      exhausted: new Set(this.exhausted),
      last: this.last,
      usage: this.usage,
      planningStall: this.planningStall,
    };
  }

  /** Record one dispatched observer attempt's provider-reported usage; see `addUsage`. */
  recordUsage(usage: Usage | undefined): void {
    this.usage = addUsage(this.usage, usage);
  }

  /** Record the latest planning pass's stalled span budget, or `undefined` when it did not stall. */
  recordPlanningStall(budgetTokens: number | undefined): void {
    this.planningStall = budgetTokens;
  }

  /**
   * Resolve once no job waits or runs, or the queue stopped; resolves immediately when idle.
   *
   * A job offered later does not delay an earlier call that already resolved.
   */
  async idle(): Promise<void> {
    if (this.stopped || (this.running === undefined && this.waiting.size === 0)) {
      return;
    }
    const settled = Promise.withResolvers<undefined>();
    this.idleWaiters.push(() => {
      settled.resolve(undefined);
    });
    await settled.promise;
  }

  private settleIdle(): void {
    if (this.stopped || (this.running === undefined && this.waiting.size === 0)) {
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve();
      }
    }
  }

  private consume(
    execution: Execution,
    storage: StorageScope,
    run: (job: WorkerJob) => Effect.Effect<JobOutcome, unknown, StorageServices>,
  ): Effect.Effect<void, never, StorageServices> {
    const take = Queue.take(this.queue).pipe(
      Effect.tap((job) =>
        Effect.sync(() => {
          this.waiting.delete(job);
          this.running = job;
        }),
      ),
    );
    const runNext = take.pipe(
      Effect.flatMap((job) =>
        Effect.exit(execution.runWorkerJob(storage, run(job))).pipe(
          Effect.flatMap((exit) =>
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
              ? Effect.interrupt
              : Effect.sync(() => {
                  this.finish(job, outcomeOf(exit));
                }),
          ),
        ),
      ),
    );
    return Effect.forever(runNext).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.stopped = true;
          this.running = undefined;
          Queue.shutdownUnsafe(this.queue);
          this.settleIdle();
        }),
      ),
    );
  }

  private finish(job: WorkerJob, outcome: JobOutcome): void {
    this.running = undefined;
    this.last = outcome;
    if (outcome.kind === "exhausted") {
      for (const span of job.interval.spans) {
        this.exhausted.add(span.reference);
      }
    }
    if (outcome.kind === "committed") {
      this.committedSinceDrain = true;
    }
    if (this.waiting.size === 0 && this.committedSinceDrain) {
      this.committedSinceDrain = false;
      this.drained();
    }
    this.settleIdle();
  }
}
