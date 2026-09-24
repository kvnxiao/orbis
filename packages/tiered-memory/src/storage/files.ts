import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

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

/** Replace a file durably; `writeDurable` bound to its default operations is the production writer. */
export type DurableWriter = (path: string, contents: string) => Promise<void>;

/**
 * Carry the cancellation signal and durable writer that every storage operation of one session
 * uses.
 */
export interface StorageAccess {
  signal: AbortSignal;
  write: DurableWriter;
}

/** Return the string `code` of a Node.js system error, or `undefined` for any other value. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Report whether `error` is the abort reason of an aborted `signal`, which is cancellation, not
 * failure.
 */
export function cancelledBy(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted && Object.is(error, signal.reason);
}

/**
 * Replace `path` with `contents` so a reader sees the old or the new bytes, never a partial file.
 *
 * Creates missing parent directories, writes a temporary sibling opened with `wx`, fsyncs it,
 * renames it over `path`, then fsyncs the directory except on Windows, which cannot open a
 * directory for fsync. A failure after the temporary file exists leaves it behind; readers ignore
 * `*.tmp` names. Cancellation is not observed, so callers check their signal before starting an
 * atomic unit.
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
 * Read a UTF-8 file, or return `undefined` when it does not exist.
 *
 * @throws `signal.reason` when `signal` aborts before or during the read, and the original error
 *   for any other failure than `ENOENT`.
 */
export async function readText(path: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  try {
    const text = await readOptional(path, signal);
    signal.throwIfAborted();
    return text;
  } catch (error) {
    if (errorCode(error) === "ABORT_ERR") {
      signal.throwIfAborted();
    }
    throw error;
  }
}

/**
 * Reject a path list when any existing entry is a symbolic link; missing paths are skipped.
 *
 * @throws Error naming the first symbolic link; the original `lstat` error other than `ENOENT`;
 *   `signal.reason` when `signal` aborts.
 */
export async function rejectSymlinks(paths: readonly string[], signal: AbortSignal): Promise<void> {
  const links = await Promise.all(
    paths.map(async (path) => {
      try {
        return (await lstat(path)).isSymbolicLink() ? path : undefined;
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    }),
  );
  signal.throwIfAborted();
  const link = links.find((path) => path !== undefined);
  if (link !== undefined) {
    throw new Error(`Managed memory directory is a symlink: ${link}`);
  }
}
