import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Type } from "typebox";
import type { Static } from "typebox";

import { errorCode, readText } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import { parseRecord, readOptional } from "./records.ts";

const lockWaitMs = 5000;
const pollMs = 20;

/** Validate the lock owner record; `token` identifies the holder allowed to release the lock. */
export const lockOwnerSchema = Type.Object(
  {
    version: Type.Literal(1),
    pid: Type.Integer({ minimum: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** Define the `sessions/.lock/owner.json` payload. */
export type LockOwner = Static<typeof lockOwnerSchema>;

/**
 * Supply the clock and process probe the lock uses, so tests can pass the deadline or report an
 * owner gone.
 *
 * The default `isRunning` calls `process.kill(pid, 0)`: it returns false on `ESRCH`, true on
 * success or `EPERM`, and rethrows any other error.
 */
export interface LockIo {
  now: () => number;
  isRunning: (pid: number) => boolean;
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

const defaultLockIo: LockIo = { now: () => Date.now(), isRunning: processRunning };

function parseOwner(text: string, path: string): LockOwner | undefined {
  try {
    return parseRecord(lockOwnerSchema, text, path);
  } catch (error) {
    if (error instanceof Error) {
      return undefined;
    }
    throw error;
  }
}

async function inspectLock(
  lock: string,
  signal: AbortSignal,
  io: LockIo,
): Promise<"held" | "stale" | "gone"> {
  const path = join(lock, "owner.json");
  const text = await readText(path, signal);
  const owner = text === undefined ? undefined : parseOwner(text, path);
  if (owner !== undefined) {
    return io.isRunning(owner.pid) ? "held" : "stale";
  }
  let modified: number;
  try {
    modified = (await stat(lock)).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return "gone";
    }
    throw error;
  }
  signal.throwIfAborted();
  return io.now() - modified > lockWaitMs ? "stale" : "held";
}

async function pause(signal: AbortSignal): Promise<void> {
  try {
    await sleep(pollMs, undefined, { signal });
  } catch (error) {
    if (errorCode(error) === "ABORT_ERR") {
      signal.throwIfAborted();
    }
    throw error;
  }
}

function renameBlocked(code: string | undefined): boolean {
  return process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
}

async function restore(claimed: string, lock: string): Promise<void> {
  try {
    await rename(claimed, lock);
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EEXIST" && code !== "ENOTEMPTY" && !renameBlocked(code)) {
      throw error;
    }
  }
}

async function claimStale(lock: string, io: LockIo): Promise<"held" | "gone"> {
  const claimed = `${lock}.stale-${randomUUID()}`;
  try {
    await rename(lock, claimed);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return "gone";
    }
    if (renameBlocked(code)) {
      return "held";
    }
    throw error;
  }
  // A waiter that judged an older owner stale can claim a lock acquired after its inspection.
  if ((await inspectLock(claimed, new AbortController().signal, io)) === "held") {
    await restore(claimed, lock);
    return "held";
  }
  await rm(claimed, { recursive: true, force: true });
  return "gone";
}

async function attempt(
  lock: string,
  deadline: number,
  access: StorageAccess,
  io: LockIo,
): Promise<boolean> {
  access.signal.throwIfAborted();
  try {
    await mkdir(lock);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
  }
  let state = await inspectLock(lock, access.signal, io);
  if (state === "stale") {
    state = await claimStale(lock, io);
  }
  if (state === "held") {
    if (io.now() >= deadline) {
      throw new Error("Tiered memory project lock is busy. Retry after the other writer finishes.");
    }
    await pause(access.signal);
  }
  return false;
}

async function acquire(
  lock: string,
  deadline: number,
  access: StorageAccess,
  io: LockIo,
): Promise<void> {
  let acquired = false;
  while (!acquired) {
    // oxlint-disable-next-line no-await-in-loop -- Each attempt depends on the previous attempt's poll or stale-lock claim.
    acquired = await attempt(lock, deadline, access, io);
  }
}

async function release(lock: string, token: string): Promise<void> {
  const path = join(lock, "owner.json");
  const text = await readOptional(path);
  if (text !== undefined && parseOwner(text, path)?.token === token) {
    await rm(lock, { recursive: true, force: true });
  }
}

/**
 * Run `action` while holding the project mutation lock at `<sessionsDir>/.lock`.
 *
 * Acquires the lock by creating the directory, then writing `owner.json` through `access.write`.
 * When the directory exists, an owner whose process is gone makes the lock stale; a directory
 * without `owner.json`, or whose `owner.json` is not JSON or fails `lockOwnerSchema`, is stale once
 * the directory's modification time is older than the five-second deadline. A waiter claims a stale
 * lock by renaming it to a unique `.lock.stale-<uuid>` sibling, so only one waiter claims it, then
 * removes the claimed directory and retries; a claimed directory that is no longer stale is renamed
 * back. On Windows, a rename refused because a handle is open counts as held. A held lock is polled
 * until the deadline. Releases by removing the directory only while `owner.json` still names this
 * holder's token.
 *
 * @throws Error saying the lock is busy when the deadline passes; `access.signal.reason` when the
 *   signal aborts while waiting; the original filesystem error for any other failure.
 */
export async function withProjectLock<T>(
  sessionsDir: string,
  access: StorageAccess,
  action: () => Promise<T>,
  io: LockIo = defaultLockIo,
): Promise<T> {
  const lock = join(sessionsDir, ".lock");
  const token = randomUUID();
  access.signal.throwIfAborted();
  await mkdir(sessionsDir, { recursive: true });
  await acquire(lock, io.now() + lockWaitMs, access, io);
  try {
    const owner: LockOwner = { version: 1, pid: process.pid, token };
    await access.write(join(lock, "owner.json"), `${JSON.stringify(owner)}\n`);
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  try {
    return await action();
  } finally {
    await release(lock, token);
  }
}
