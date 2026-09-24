import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Type } from "typebox";
import type { Static } from "typebox";

import { errorCode, readText } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import { parseRecord } from "./records.ts";

const lockWaitMs = 5000;
const pollMs = 20;
const ticketName = /^([1-9]\d*)\.json$/u;
const privateName = /^([1-9]\d*)-[0-9a-f-]+\.json(?:\.[0-9a-f-]+\.tmp)?$/u;

/** Validate the immutable owner record published for a lock ticket. */
export const lockOwnerSchema = Type.Object(
  {
    version: Type.Literal(1),
    pid: Type.Integer({ minimum: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** Define a `sessions/.lock/tickets/<number>.json` payload. */
export type LockOwner = Static<typeof lockOwnerSchema>;

/** Supply time, process liveness, and atomic ticket publication. */
export interface LockIo {
  now: () => number;
  isRunning: (pid: number) => boolean;
  publish?: (source: string, ticket: string) => Promise<void>;
  list?: (directory: string) => Promise<string[]>;
  removeTicket?: (path: string) => Promise<void>;
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

function busy(): Error {
  return new Error("Tiered memory project lock is busy. Retry after the other writer finishes.");
}

function removalBlocked(error: unknown): boolean {
  const code = errorCode(error);
  return process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
}

async function inspectDirectory(path: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }
  signal.throwIfAborted();
  if (entry.isSymbolicLink()) {
    throw new Error(`Project lock directory is a symbolic link: ${path}`);
  }
  if (!entry.isDirectory()) {
    throw new Error(`Project lock path is not a directory: ${path}`);
  }
}

async function ensureDirectory(
  path: string,
  signal: AbortSignal,
  recursive = false,
): Promise<void> {
  await inspectDirectory(path, signal);
  try {
    await mkdir(path, { recursive });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
  }
  await inspectDirectory(path, signal);
}

async function ticketNumbers(directory: string, io: LockIo): Promise<number[]> {
  const numbers: number[] = [];
  for (const name of await (io.list ?? readdir)(directory)) {
    const match = ticketName.exec(name);
    if (match === null) {
      throw new Error(`Invalid project lock ticket: ${name}`);
    }
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number)) {
      throw new Error(`Invalid project lock ticket: ${name}`);
    }
    numbers.push(number);
  }
  return numbers.toSorted((left, right) => left - right);
}

async function ticketOwner(
  directory: string,
  number: number,
  signal: AbortSignal,
): Promise<LockOwner | undefined> {
  const path = join(directory, `${String(number)}.json`);
  const text = await readText(path, signal);
  return text === undefined ? undefined : parseRecord(lockOwnerSchema, text, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function donePath(lock: string, number: number, token: string): string {
  const digest = createHash("sha256").update(token).digest("hex");
  return join(lock, "done", `${String(number)}-${digest}`);
}

async function clearDeadPrivate(lock: string, io: LockIo): Promise<void> {
  const directory = join(lock, "private");
  for (const name of await readdir(directory)) {
    const match = privateName.exec(name);
    if (match === null) {
      throw new Error(`Invalid project lock private file: ${name}`);
    }
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid)) {
      throw new Error(`Invalid project lock private file: ${name}`);
    }
    if (!io.isRunning(pid)) {
      // oxlint-disable-next-line no-await-in-loop -- Only the dead process's private file is removed.
      await rm(join(directory, name), { force: true });
    }
  }
}

async function clearFinished(
  lock: string,
  numbers: number[],
  signal: AbortSignal,
  io: LockIo,
): Promise<void> {
  const maximum = numbers.at(-1);
  for (const number of numbers) {
    if (number === maximum) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- The ticket can disappear during another cleanup.
    const owner = await ticketOwner(join(lock, "tickets"), number, signal);
    if (owner === undefined) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Completion is checked for this ticket.
    const completed = await exists(donePath(lock, number, owner.token));
    if (!completed && io.isRunning(owner.pid)) {
      continue;
    }
    try {
      const path = join(lock, "tickets", `${String(number)}.json`);
      // oxlint-disable-next-line no-await-in-loop -- Only tickets below the maximum are reclaimed.
      await (
        io.removeTicket ??
        (async (ticket) => {
          await rm(ticket, { force: true });
        })
      )(path);
    } catch (error) {
      if (removalBlocked(error)) {
        continue;
      }
      throw error;
    }
    if (completed) {
      // oxlint-disable-next-line no-await-in-loop -- A done marker belongs to its ticket token.
      await rm(donePath(lock, number, owner.token), { recursive: true, force: true });
    }
  }
}

async function publishTicket(
  lock: string,
  source: string,
  deadline: number,
  access: StorageAccess,
  io: LockIo,
  publication: { number: number | undefined },
): Promise<number> {
  const directory = join(lock, "tickets");
  for (;;) {
    access.signal.throwIfAborted();
    // oxlint-disable-next-line no-await-in-loop -- The next number depends on the published maximum.
    const numbers = await ticketNumbers(directory, io);
    const maximum = numbers.at(-1) ?? 0;
    if (maximum >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Project lock ticket sequence exhausted.");
    }
    const number = maximum + 1;
    try {
      // oxlint-disable-next-line no-await-in-loop -- A hard link publishes a complete owner atomically.
      await (io.publish ?? link)(source, join(directory, `${String(number)}.json`));
      publication.number = number;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
      if (io.now() >= deadline) {
        throw busy();
      }
      // oxlint-disable-next-line no-await-in-loop -- Retry after a conflicting publication.
      await pause(access.signal);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Recheck fences a number retired during publication.
    const after = await ticketNumbers(directory, io);
    if ((after.at(-1) ?? 0) === number) {
      return number;
    }
    // oxlint-disable-next-line no-await-in-loop -- This ticket never entered an action.
    await rm(join(directory, `${String(number)}.json`), { force: true });
    publication.number = undefined;
    if (io.now() >= deadline) {
      throw busy();
    }
  }
}

async function waitForTurn(
  lock: string,
  number: number,
  deadline: number,
  access: StorageAccess,
  io: LockIo,
): Promise<void> {
  for (;;) {
    access.signal.throwIfAborted();
    // oxlint-disable-next-line no-await-in-loop -- Each poll sees current predecessors.
    const numbers = await ticketNumbers(join(lock, "tickets"), io);
    // oxlint-disable-next-line no-await-in-loop -- Cleanup precedes entry.
    await clearFinished(lock, numbers, access.signal, io);
    // oxlint-disable-next-line no-await-in-loop -- Cleanup may change predecessor membership.
    const remaining = await ticketNumbers(join(lock, "tickets"), io);
    if (remaining.every((candidate) => candidate >= number)) {
      return;
    }
    if (io.now() >= deadline) {
      throw busy();
    }
    // oxlint-disable-next-line no-await-in-loop -- Wait for a predecessor to release.
    await pause(access.signal);
  }
}

/**
 * Run `action` under the project mutation lock.
 *
 * A complete owner record is published as an atomic hard link to a numbered ticket. The greatest
 * ticket remains as a sequence marker. A delayed publisher rejects a retired number by rechecking
 * the maximum before waiting. Lower live tickets finish first; dead owners and completed tickets
 * are reclaimed. A damaged ticket is preserved and reported.
 *
 * @throws Error when the lock is busy or the ticket sequence is exhausted; `access.signal.reason`
 *   when cancelled while waiting; the original filesystem error for other failures.
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
  await ensureDirectory(sessionsDir, access.signal, true);
  await ensureDirectory(lock, access.signal);
  await ensureDirectory(join(lock, "tickets"), access.signal);
  await ensureDirectory(join(lock, "done"), access.signal);
  await ensureDirectory(join(lock, "private"), access.signal);
  if (await exists(join(lock, "owner.json"))) {
    throw new Error("Unsupported project lock layout: owner.json");
  }
  await clearDeadPrivate(lock, io);
  const privatePath = join(lock, "private", `${String(process.pid)}-${token}.json`);
  const owner: LockOwner = { version: 1, pid: process.pid, token };
  const deadline = io.now() + lockWaitMs;
  const publication: { number: number | undefined } = { number: undefined };
  try {
    await access.write(privatePath, `${JSON.stringify(owner)}\n`);
    const number = await publishTicket(lock, privatePath, deadline, access, io, publication);
    await waitForTurn(lock, number, deadline, access, io);
    access.signal.throwIfAborted();
    return await action();
  } finally {
    try {
      if (publication.number !== undefined) {
        await mkdir(donePath(lock, publication.number, token));
      }
    } finally {
      await rm(privatePath, { force: true });
    }
  }
}
