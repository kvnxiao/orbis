import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import type { StorageServices } from "../storage/services.ts";

class Invocation {
  private first: { reason: unknown } | undefined;
  private fiber: Fiber.Fiber<unknown, unknown> | undefined;

  bind(fiber: Fiber.Fiber<unknown, unknown>): void {
    this.fiber = fiber;
    if (this.first !== undefined) {
      fiber.interruptUnsafe();
    }
  }

  cancel(reason: unknown): void {
    this.first ??= { reason };
    this.fiber?.interruptUnsafe();
  }

  get reason(): unknown {
    return this.first?.reason;
  }
}

const state = Symbol("StorageScope state");

interface ScopeState {
  readonly scope: Scope.Closeable;
  readonly invocations: Set<Invocation>;
}

/**
 * Identify one storage session's lifetime; its state is private to this module.
 *
 * Invariants:
 *
 * - Its scope uses the parallel finalizer strategy and closes only under `Effect.uninterruptible`,
 *   because an interrupted close skips its remaining finalizers.
 * - Closing its scope interrupts and awaits the storage startup fiber, the lineage applications, and
 *   the jobs forked into it; only uninterruptible durable writes delay the close.
 */
export interface StorageScope {
  readonly [state]: ScopeState;
}

/**
 * Report how a job ended.
 *
 * `outcome` is the durable outcome the job recorded before it ended, including when interruption
 * followed the recording. `reason` is the first cancellation reason recorded for the job, whichever
 * of the host signal, a disable, a replacement, or shutdown came first.
 */
export type JobResult<A, O> =
  | { kind: "completed"; value: A; outcome: O | undefined }
  | { kind: "cancelled"; reason: unknown; outcome: O | undefined };

function interruptCurrent(handle: FiberHandle.FiberHandle): void {
  const fiber = FiberHandle.getUnsafe(handle);
  if (Option.isSome(fiber)) {
    fiber.value.interruptUnsafe();
  }
}

function awaitCompletion(fiber: Fiber.Fiber<unknown, unknown>): Effect.Effect<void, unknown> {
  return Fiber.await(fiber).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
        ? Effect.void
        : Effect.failCause(exit.cause),
    ),
  );
}

/**
 * Own one extension instance's Effect runtime, its work owners, its storage scopes, and the order
 * of its transitions.
 *
 * Owners:
 *
 * - Settings load, branch step, and role work: one `FiberHandle` each; new work replaces the owner's
 *   previous fiber.
 * - Storage scope: one per storage session, with its jobs and lineage applications; the next scope
 *   opens only after the previous close finished, so at most one close is in flight.
 *
 * A replacement or shutdown first interrupts obsolete work synchronously without awaiting it,
 * recording each job's reason, then closes the old storage scope uninterruptibly; later requests
 * share a close in flight. Shutdown marks itself started before awaiting anything and waits only
 * for non-cooperative durable writes, never for settings or role work, and never on a timeout.
 *
 * Rule: interrupting a fiber can run its finalizers and resume the fibers awaiting it in the
 * caller's stack, and the branch step is the only fiber that opens storage. So `replace` and
 * `shutdown` interrupt the branch step before anything that could resume it, shutdown marks itself
 * started before any interrupt, and `cancelActiveWork` reads the storage scope before it interrupts
 * role work.
 */
export class Execution {
  private readonly runtime: ManagedRuntime.ManagedRuntime<StorageServices, never>;
  private readonly owners: Scope.Closeable;
  private readonly settingsLoad: FiberHandle.FiberHandle;
  private readonly branchStep: FiberHandle.FiberHandle;
  private readonly roleWork: FiberHandle.FiberHandle;
  private storage: StorageScope | undefined;
  private teardown: Fiber.Fiber<void> | undefined;
  private stopping: Promise<void> | undefined;

  /**
   * Build the instance's runtime over `services` and create the owners.
   *
   * `services` must build synchronously.
   */
  constructor(services: Layer.Layer<StorageServices>) {
    this.runtime = ManagedRuntime.make(services);
    this.owners = Scope.makeUnsafe("parallel");
    this.settingsLoad = Effect.runSync(Scope.provide(FiberHandle.make(), this.owners));
    this.branchStep = Effect.runSync(Scope.provide(FiberHandle.make(), this.owners));
    this.roleWork = Effect.runSync(Scope.provide(FiberHandle.make(), this.owners));
  }

  /** Report whether shutdown has started. */
  get stopped(): boolean {
    return this.stopping !== undefined;
  }

  /**
   * Begin a session replacement: interrupt the branch step and role work, cancel the current
   * storage scope's jobs with `reason`, and start closing that scope.
   *
   * Call it before starting the replacement's settings load and branch step. Leaves the settings
   * load running; a close already in flight stays shared.
   *
   * @throws Error when shutdown has started; nothing changes.
   */
  replace(reason: unknown): void {
    if (this.stopping !== undefined) {
      throw new Error("Tiered memory has shut down for this session.");
    }
    interruptCurrent(this.branchStep);
    interruptCurrent(this.roleWork);
    this.closeStorage(reason);
  }

  /**
   * Start a settings load in its owner, interrupting the previous load, and return its fiber.
   *
   * Call it only after `replace` succeeded.
   */
  startSettingsLoad<A>(load: Effect.Effect<A, unknown>): Fiber.Fiber<A, unknown> {
    return Effect.runSync(FiberHandle.run(this.settingsLoad, load));
  }

  /**
   * Run a lifecycle transition from a Pi callback and settle when it ends.
   *
   * Resolves on success and on interruption, which means a later transition superseded the work.
   * After shutdown started, resolves without running.
   *
   * @throws The original error or defect of a failure, unchanged.
   */
  async run(effect: Effect.Effect<void, unknown, StorageServices>): Promise<void> {
    if (this.stopping !== undefined) {
      return;
    }
    await this.runtime.runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause),
        ),
      ),
    );
  }

  /**
   * Run `step` as the branch step, interrupting the previous step, and wait for it.
   *
   * Completes without failing when a replacement or shutdown interrupts the step.
   *
   * @throws The original failure of `step`.
   */
  runBranchStep(
    step: Effect.Effect<void, unknown, StorageServices>,
  ): Effect.Effect<void, unknown, StorageServices> {
    return FiberHandle.run(this.branchStep, step).pipe(Effect.flatMap(awaitCompletion));
  }

  /**
   * Run `work` as the role check, interrupting the previous check, and wait for it.
   *
   * A caller whose check is superseded completes without applying results; the interrupted check
   * applies none because it changes state only after its last await.
   *
   * @throws The original failure of `work`.
   */
  runRoleWork(work: Effect.Effect<void, unknown>): Effect.Effect<void, unknown> {
    return FiberHandle.run(this.roleWork, work).pipe(Effect.flatMap(awaitCompletion));
  }

  /**
   * Wait for the storage close in flight, open a new storage scope, run `startup` as a fiber in it,
   * and wait for that fiber.
   *
   * `startup` changes runtime state only after its last await. Completes without failing when the
   * scope closes before `startup` finishes.
   *
   * @throws The original failure of `startup`.
   */
  readonly openStorage = Effect.fnUntraced(function* (
    this: Execution,
    startup: (storage: StorageScope) => Effect.Effect<void, unknown, StorageServices>,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    if (this.teardown !== undefined) {
      yield* Fiber.await(this.teardown);
    }
    const storage: StorageScope = {
      [state]: { scope: Scope.makeUnsafe("parallel"), invocations: new Set() },
    };
    this.storage = storage;
    const fiber = yield* Effect.forkIn(startup(storage), storage[state].scope);
    yield* awaitCompletion(fiber);
  });

  /**
   * Interrupt role work and cancel the current storage scope's jobs with `reason`.
   *
   * Leaves the settings load, the branch step, the storage scope, and its lineage applications
   * running.
   */
  cancelActiveWork(reason: unknown): void {
    const storage = this.storage;
    interruptCurrent(this.roleWork);
    if (storage !== undefined) {
      cancelJobs(storage, reason);
    }
  }

  /**
   * Run a job in `storage` with a host signal and wait for it.
   *
   * A pre-aborted `signal` resolves `cancelled` with its reason and starts no work. The job
   * receives `record`, which stores its durable outcome. A host abort, a disable, a replacement, or
   * shutdown records its reason if none is recorded, then interrupts the job. Resolves only after
   * the job fiber ended, so its lock and transaction cleanup finished.
   *
   * @throws Error when shutdown has started or `storage` is no longer current; nothing runs.
   * @throws The original error or defect of a failure `Exit`, including one that also has
   *   interruptions: a genuine failure that races a cancellation rejects instead of reporting
   *   `cancelled`.
   */
  async runJob<A, O>(
    storage: StorageScope,
    signal: AbortSignal | undefined,
    job: (record: (outcome: O) => void) => Effect.Effect<A, unknown, StorageServices>,
  ): Promise<JobResult<A, O>> {
    if (this.stopping !== undefined || storage !== this.storage) {
      throw new Error("Memory storage is unavailable while disabled or before it opens.");
    }
    if (signal?.aborted === true) {
      return { kind: "cancelled", reason: signal.reason, outcome: undefined };
    }
    const invocation = new Invocation();
    storage[state].invocations.add(invocation);
    const abort = (): void => {
      invocation.cancel(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    let outcome: O | undefined;
    const record = (recorded: O): void => {
      outcome = recorded;
    };
    try {
      // The job may start before `runSync` returns, so it is bound before the scheduler runs it.
      const fiber = this.runtime.runSync(
        Effect.forkIn(job(record), storage[state].scope).pipe(
          Effect.tap((forked) =>
            Effect.sync(() => {
              invocation.bind(forked);
            }),
          ),
        ),
      );
      const exit = await Effect.runPromise(Fiber.await(fiber));
      if (Exit.isSuccess(exit)) {
        return { kind: "completed", value: exit.value, outcome };
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        return { kind: "cancelled", reason: invocation.reason, outcome };
      }
      return await Effect.runPromise(Effect.failCause(exit.cause));
    } finally {
      signal?.removeEventListener("abort", abort);
      storage[state].invocations.delete(invocation);
    }
  }

  /**
   * Admit `effect` to `storage`'s scope as storage-session work and wait for it.
   *
   * A closed scope admits nothing and runs no synchronous prefix, because the fork does not start
   * immediately. After shutdown started, resolves without running. Disable does not interrupt
   * admitted work; closing the scope does. Resolves on success and on interruption.
   *
   * @throws The original error or defect of a failure.
   */
  async runInStorage(
    storage: StorageScope,
    effect: Effect.Effect<void, unknown, StorageServices>,
  ): Promise<void> {
    if (this.stopping !== undefined) {
      return;
    }
    const fiber = this.runtime.runSync(Effect.forkIn(effect, storage[state].scope));
    await Effect.runPromise(awaitCompletion(fiber));
  }

  /**
   * Stop every owner, close the current storage scope, and dispose the runtime.
   *
   * Marks shutdown started, interrupts the settings load, the branch step, and role work, and
   * cancels jobs with `reason`, all before awaiting anything; then awaits the storage close, closes
   * the owners, and awaits `ManagedRuntime.dispose`. Repeated calls return the first call's
   * promise.
   */
  async shutdown(reason: unknown): Promise<void> {
    if (this.stopping === undefined) {
      const started = Promise.withResolvers<undefined>();
      this.stopping = started.promise.then(async () => {
        await this.finishStop();
      });
      // A branch step joins the settings load, so it is interrupted first; otherwise it would
      // resume on the load's interruption inside this call.
      try {
        interruptCurrent(this.branchStep);
        interruptCurrent(this.settingsLoad);
        interruptCurrent(this.roleWork);
        this.closeStorage(reason);
      } finally {
        started.resolve(undefined);
      }
    }
    await this.stopping;
  }

  private async finishStop(): Promise<void> {
    const teardown = this.teardown;
    if (teardown !== undefined) {
      await Effect.runPromise(Fiber.await(teardown));
    }
    await Effect.runPromise(Effect.uninterruptible(Scope.close(this.owners, Exit.void)));
    await this.runtime.dispose();
  }

  private closeStorage(reason: unknown): void {
    const storage = this.storage;
    if (storage === undefined) {
      return;
    }
    this.storage = undefined;
    cancelJobs(storage, reason);
    this.teardown = Effect.runFork(
      Effect.uninterruptible(Scope.close(storage[state].scope, Exit.void)),
    );
  }
}

function cancelJobs(storage: StorageScope, reason: unknown): void {
  for (const invocation of storage[state].invocations) {
    invocation.cancel(reason);
  }
}
