import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { Execution, StorageScope } from "../src/pi/execution.ts";
import { fromPromise, writeDurable } from "../src/storage/files.ts";
import { DurableWrites, LockFilesystem, ProcessLiveness } from "../src/storage/services.ts";
import type { StorageServices } from "../src/storage/services.ts";

/** Replace a durable write with a Promise operation; a rejection becomes the write's failure. */
export type TestWrite = (path: string, contents: string) => Promise<void>;

/** Replace lock filesystem steps with Promise operations; a rejection becomes the step's failure. */
export interface TestLockFilesystem {
  publish?: (source: string, ticket: string) => Promise<void>;
  list?: (directory: string) => Promise<string[]>;
  readTicket?: (path: string) => Promise<string | undefined>;
  removeTicket?: (path: string) => Promise<void>;
  removeDone?: (path: string) => Promise<void>;
  removePrivate?: (path: string) => Promise<void>;
}

/** Replace live capabilities; omitted members keep their live implementation. */
export interface TestServices {
  write?: TestWrite;
  lock?: TestLockFilesystem;
  isRunning?: (pid: number) => boolean;
  now?: () => number;
}

function hook<Args extends unknown[], A>(
  override: ((...args: Args) => Promise<A>) | undefined,
  live: (...args: Args) => Effect.Effect<A, unknown>,
  uninterruptible = false,
): (...args: Args) => Effect.Effect<A, unknown> {
  if (override === undefined) {
    return live;
  }
  return (...args) => {
    const operation = fromPromise(async () => await override(...args));
    return uninterruptible ? Effect.uninterruptible(operation) : operation;
  };
}

function steppingClock(now: () => number): Clock.Clock {
  const live = Effect.runSync(Clock.clockWith(Effect.succeed));
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: (duration: Duration.Duration) => live.sleep(duration),
  };
}

/** Build a synchronous capability layer from live services and `overrides`. */
export function testServices(overrides: TestServices = {}): Layer.Layer<StorageServices> {
  const write = overrides.write;
  const lock = overrides.lock ?? {};
  const live = LockFilesystem.live;
  const layer = Layer.mergeAll(
    Layer.succeed(DurableWrites, { write: hook(write, DurableWrites.live.write, true) }),
    Layer.succeed(LockFilesystem, {
      publish: hook(lock.publish, live.publish),
      list: hook(lock.list, live.list),
      readTicket: hook(lock.readTicket, live.readTicket),
      removeTicket: hook(lock.removeTicket, live.removeTicket, true),
      removeDone: hook(lock.removeDone, live.removeDone, true),
      removePrivate: hook(lock.removePrivate, live.removePrivate, true),
    }),
    Layer.succeed(ProcessLiveness, {
      isRunning: overrides.isRunning ?? ProcessLiveness.live.isRunning,
    }),
  );
  const now = overrides.now;
  return now === undefined
    ? layer
    : Layer.mergeAll(layer, Layer.succeed(Clock.Clock, steppingClock(now)));
}

const runtimes = new Set<ManagedRuntime.ManagedRuntime<StorageServices, never>>();

/** Create a storage runtime that the test fixtures dispose before removing temporary files. */
export function storageRuntime(
  overrides: TestServices = {},
): ManagedRuntime.ManagedRuntime<StorageServices, never> {
  const runtime = ManagedRuntime.make(testServices(overrides));
  runtimes.add(runtime);
  return runtime;
}

/** Dispose every storage runtime created since the last disposal. */
export async function disposeStorageRuntimes(): Promise<void> {
  const open = [...runtimes];
  runtimes.clear();
  await Promise.all(
    open.map(async (runtime) => {
      await runtime.dispose();
    }),
  );
}

/** Run `effect` in a fresh storage runtime over `overrides`. */
export async function runStorage<A>(
  effect: Effect.Effect<A, unknown, StorageServices>,
  overrides: TestServices = {},
): Promise<A> {
  return await storageRuntime(overrides).runPromise(effect);
}

/** Resolve whether `fiber` ended interrupted with no failure or defect. */
export async function interruptedOnly(fiber: Fiber.Fiber<unknown, unknown>): Promise<boolean> {
  const exit = await Effect.runPromise(Fiber.await(fiber));
  return Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
}

/** Write through `writeDurable`, then call `onMatch` after the first write whose path matches. */
export function afterWrite(matches: (path: string) => boolean, onMatch: () => void): TestWrite {
  let fired = false;
  return async (path, contents) => {
    await writeDurable(path, contents);
    if (!fired && matches(path)) {
      fired = true;
      onMatch();
    }
  };
}

/** Open a storage scope in `execution` whose startup does nothing, and return it. */
export async function openScope(execution: Execution): Promise<StorageScope> {
  let opened: StorageScope | undefined;
  await execution.run(
    execution.openStorage((storage) =>
      Effect.sync(() => {
        opened = storage;
      }),
    ),
  );
  if (opened === undefined) {
    throw new Error("The storage scope did not open.");
  }
  return opened;
}
