import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { readOptional } from "./records.ts";

/** Supply the file operations `writeDurable` performs, so tests can fail any single step. */
export interface DurableWriteIo {
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  open: (
    path: string,
    flags: "wx" | "r",
  ) => Promise<{
    writeFile: (data: string) => Promise<void>;
    sync: () => Promise<void>;
    close: () => Promise<void>;
  }>;
  rename: (from: string, to: string) => Promise<void>;
}

/** Return the string `code` of a Node.js system error, or `undefined` for any other value. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Replace `path` with `contents` so a reader sees the old or the new bytes, never a partial file.
 *
 * Creates missing parent directories, writes a temporary sibling opened with `wx`, fsyncs it,
 * renames it over `path`, then fsyncs the directory except on Windows, which cannot open a
 * directory for fsync. A failure after the temporary file exists leaves it behind; readers ignore
 * `*.tmp` names. Cancellation is not observed; `DurableWrites` runs it as an uninterruptible unit.
 *
 * @throws The original error from whichever file operation failed.
 */
export async function writeDurable(
  path: string,
  contents: string,
  io: DurableWriteIo = { mkdir, open, rename },
): Promise<void> {
  const directory = dirname(path);
  await io.mkdir(directory, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await io.open(temporary, "wx");
  try {
    await file.writeFile(contents);
    await file.sync();
  } finally {
    await file.close();
  }
  await io.rename(temporary, path);
  if (process.platform === "win32") {
    return;
  }
  const handle = await io.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Run a Promise operation as an Effect that fails with the original rejection.
 *
 * Interruption aborts `signal` and abandons the promise without waiting for it, so callers use it
 * only for operations whose late completion is harmless, or inside an uninterruptible region.
 */
export function fromPromise<A>(
  run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (error) => error });
}

/**
 * Read a UTF-8 file, or return `undefined` when it does not exist.
 *
 * Interruption aborts the read.
 *
 * @throws The original read error for every failure other than `ENOENT`.
 */
export function readText(path: string): Effect.Effect<string | undefined, unknown> {
  return fromPromise(async (signal) => await readOptional(path, signal));
}

function symlinkAt(path: string): Effect.Effect<string | undefined, unknown> {
  return fromPromise(async () => await lstat(path)).pipe(
    Effect.map((entry) => (entry.isSymbolicLink() ? path : undefined)),
    Effect.catch((error) =>
      errorCode(error) === "ENOENT" ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );
}

/**
 * Reject a path list when any existing entry is a symbolic link; missing paths are skipped.
 *
 * @throws Error naming the first symbolic link in input order.
 * @throws The original `lstat` error other than `ENOENT`.
 */
export function rejectSymlinks(paths: readonly string[]): Effect.Effect<void, unknown> {
  return Effect.forEach(paths, symlinkAt, { concurrency: "unbounded" }).pipe(
    Effect.flatMap((links) => {
      const link = links.find((path) => path !== undefined);
      return link === undefined
        ? Effect.void
        : Effect.fail(new Error(`Managed memory directory is a symlink: ${link}`));
    }),
  );
}

/**
 * Recover the failure in `cause` with `recover`; a cause with only interruptions interrupts again,
 * so catch-all handlers never swallow cancellation.
 */
export function recoverFailure<A>(
  cause: Cause.Cause<unknown>,
  recover: (failure: unknown) => A,
): Effect.Effect<A> {
  return Cause.hasInterruptsOnly(cause)
    ? Effect.interrupt
    : Effect.sync(() => recover(Cause.squash(cause)));
}
