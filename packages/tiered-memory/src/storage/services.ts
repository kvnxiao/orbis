import { link, readdir, rm } from "node:fs/promises";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { errorCode, fromPromise, readText, writeDurable } from "./files.ts";

/**
 * Replace files durably for every storage module.
 *
 * Invariants:
 *
 * - `write` has the `writeDurable` contract: a reader sees the old or the new bytes.
 * - Each `write` runs as one uninterruptible unit, so an interrupted caller, and a scope that closes
 *   over it, waits for the write to settle.
 * - A failed `write` fails its caller with the original error, also when an interruption is pending;
 *   failure handlers outside the write do not run in that case, so a caller that recovers an
 *   expected error converts it to a value inside its own uninterruptible region.
 *
 * @throws The original error of the failed file operation, as the failure value.
 */
export class DurableWrites extends Context.Service<
  DurableWrites,
  { readonly write: (path: string, contents: string) => Effect.Effect<void, unknown> }
>()("@orbis/tiered-memory/storage/DurableWrites") {
  /** Write through `writeDurable` with Node's file operations. */
  static readonly live: DurableWrites["Service"] = {
    write: (path, contents) =>
      Effect.uninterruptible(
        fromPromise(async () => {
          await writeDurable(path, contents);
        }),
      ),
  };
}

/** Replace `path` with `contents` through `DurableWrites`, with its contract. */
export function writeText(
  path: string,
  contents: string,
): Effect.Effect<void, unknown, DurableWrites> {
  return DurableWrites.use((writes) => writes.write(path, contents));
}

/** Replace `path` with `value` as JSON plus a trailing newline through `DurableWrites`. */
export function writeRecord(
  path: string,
  value: unknown,
): Effect.Effect<void, unknown, DurableWrites> {
  return writeText(path, `${JSON.stringify(value)}\n`);
}

function remove(path: string, recursive: boolean): Effect.Effect<void, unknown> {
  return Effect.uninterruptible(
    fromPromise(async () => {
      await rm(path, { recursive, force: true });
    }),
  );
}

/**
 * Perform the project lock's filesystem steps that concurrent contenders race on.
 *
 * Invariants:
 *
 * - `publish` creates `ticket` as a hard link to `source` and fails with `EEXIST` when the ticket
 *   exists.
 * - `readTicket` returns `undefined` when the ticket does not exist.
 * - The removals succeed when the path is already absent and run as uninterruptible units, so no
 *   removal outlives the lock scope that started it.
 *
 * @throws The original filesystem error, as the failure value.
 */
export class LockFilesystem extends Context.Service<
  LockFilesystem,
  {
    readonly publish: (source: string, ticket: string) => Effect.Effect<void, unknown>;
    readonly list: (directory: string) => Effect.Effect<string[], unknown>;
    readonly readTicket: (path: string) => Effect.Effect<string | undefined, unknown>;
    readonly removeTicket: (path: string) => Effect.Effect<void, unknown>;
    readonly removeDone: (path: string) => Effect.Effect<void, unknown>;
    readonly removePrivate: (path: string) => Effect.Effect<void, unknown>;
  }
>()("@orbis/tiered-memory/storage/LockFilesystem") {
  /** Use `link`, `readdir`, `readText`, and forced `rm` from Node's file operations. */
  static readonly live: LockFilesystem["Service"] = {
    publish: (source, ticket) =>
      fromPromise(async () => {
        await link(source, ticket);
      }),
    list: (directory) => fromPromise(async () => await readdir(directory)),
    readTicket: readText,
    removeTicket: (path) => remove(path, false),
    removeDone: (path) => remove(path, true),
    removePrivate: (path) => remove(path, false),
  };
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw error;
  }
}

/**
 * Report whether a process identifier names a running process.
 *
 * @throws The original `process.kill` error for codes other than `ESRCH` and `EPERM`.
 */
export class ProcessLiveness extends Context.Service<
  ProcessLiveness,
  { readonly isRunning: (pid: number) => boolean }
>()("@orbis/tiered-memory/storage/ProcessLiveness") {
  /** Probe with signal 0: `ESRCH` is not running and `EPERM` is running. */
  static readonly live: ProcessLiveness["Service"] = { isRunning: processRunning };
}

/** Name every capability the storage modules read; time comes from Effect's `Clock`. */
export type StorageServices = DurableWrites | LockFilesystem | ProcessLiveness;

/** Provide the production capabilities; the layer builds synchronously. */
export const liveStorage: Layer.Layer<StorageServices> = Layer.mergeAll(
  Layer.succeed(DurableWrites, DurableWrites.live),
  Layer.succeed(LockFilesystem, LockFilesystem.live),
  Layer.succeed(ProcessLiveness, ProcessLiveness.live),
);
