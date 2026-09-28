import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { Type } from "typebox";
import type { Static } from "typebox";

import { errorCode, fromPromise } from "./files.ts";
import { parseRecord } from "./records.ts";
import { LockFilesystem, ProcessLiveness, writeRecord } from "./services.ts";
import type { StorageServices } from "./services.ts";

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

// One publication attempt. `armed` stays true from the hard link until a fenced attempt has
// removed its ticket; the finalizer registered with a taken link writes the done marker only while
// armed.
interface Publication {
  readonly path: string;
  armed: boolean;
}

function busy(conflict?: unknown): Error {
  const message = "Tiered memory project lock is busy. Retry after the other writer finishes.";
  return conflict === undefined ? new Error(message) : new Error(message, { cause: conflict });
}

function windowsAccessConflict(error: unknown): boolean {
  const code = errorCode(error);
  return process.platform === "win32" && (code === "EPERM" || code === "EBUSY");
}

function unlessMissing<A>(
  effect: Effect.Effect<A, unknown>,
): Effect.Effect<A | undefined, unknown> {
  return effect.pipe(
    Effect.catch((error) =>
      errorCode(error) === "ENOENT" ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );
}

function inspectDirectory(path: string): Effect.Effect<void, unknown> {
  return unlessMissing(fromPromise(async () => await lstat(path))).pipe(
    Effect.flatMap((entry) => {
      if (entry?.isSymbolicLink() === true) {
        return Effect.fail(new Error(`Project lock directory is a symbolic link: ${path}`));
      }
      if (entry !== undefined && !entry.isDirectory()) {
        return Effect.fail(new Error(`Project lock path is not a directory: ${path}`));
      }
      return Effect.void;
    }),
  );
}

const ensureDirectory = Effect.fnUntraced(function* (
  path: string,
  recursive: boolean,
): Effect.fn.Return<void, unknown> {
  yield* inspectDirectory(path);
  yield* fromPromise(async () => await mkdir(path, { recursive })).pipe(
    Effect.asVoid,
    Effect.catch((error) => (errorCode(error) === "EEXIST" ? Effect.void : Effect.fail(error))),
  );
  yield* inspectDirectory(path);
});

const ticketNumbers = Effect.fnUntraced(function* (
  directory: string,
): Effect.fn.Return<number[], unknown, LockFilesystem> {
  const filesystem = yield* LockFilesystem;
  const numbers: number[] = [];
  for (const name of yield* filesystem.list(directory)) {
    const match = ticketName.exec(name);
    const number = Number(match?.[1]);
    if (match === null || !Number.isSafeInteger(number)) {
      return yield* Effect.fail(new Error(`Invalid project lock ticket: ${name}`));
    }
    numbers.push(number);
  }
  return numbers.toSorted((left, right) => left - right);
});

function exists(path: string): Effect.Effect<boolean, unknown> {
  return unlessMissing(fromPromise(async () => await stat(path))).pipe(
    Effect.map((entry) => entry !== undefined),
  );
}

function donePath(lock: string, number: number, token: string): string {
  const digest = createHash("sha256").update(token).digest("hex");
  return join(lock, "done", `${String(number)}-${digest}`);
}

type Skipped = { conflict: unknown } | undefined;

function skipWindowsConflict<R>(
  effect: Effect.Effect<Skipped, unknown, R>,
): Effect.Effect<Skipped, unknown, R> {
  return effect.pipe(
    Effect.catch((error) =>
      windowsAccessConflict(error) ? Effect.succeed({ conflict: error }) : Effect.fail(error),
    ),
  );
}

// The conflict becomes a value inside the removal's uninterruptible region: a failure that leaves
// the region while an interruption is pending skips outer handlers, so only this expected error is
// recovered there, and every other failure stays the removal's failure.
function removeSkippingConflict<R>(
  removal: Effect.Effect<void, unknown, R>,
): Effect.Effect<Skipped, unknown, R> {
  return Effect.uninterruptible(skipWindowsConflict(removal.pipe(Effect.as(undefined))));
}

const clearDeadPrivate = Effect.fnUntraced(function* (
  lock: string,
): Effect.fn.Return<void, unknown, LockFilesystem | ProcessLiveness> {
  const directory = join(lock, "private");
  const filesystem = yield* LockFilesystem;
  const liveness = yield* ProcessLiveness;
  for (const name of yield* fromPromise(async () => await readdir(directory))) {
    const match = privateName.exec(name);
    const pid = Number(match?.[1]);
    if (match === null || !Number.isSafeInteger(pid)) {
      yield* Effect.fail(new Error(`Invalid project lock private file: ${name}`));
      return;
    }
    if (!liveness.isRunning(pid)) {
      // Windows reports a file that another contender is removing as EPERM or EBUSY. A later
      // acquisition retries the removal.
      yield* removeSkippingConflict(filesystem.removePrivate(join(directory, name)));
    }
  }
});

const reclaimTicket = Effect.fnUntraced(function* (
  lock: string,
  number: number,
): Effect.fn.Return<Skipped, unknown, LockFilesystem | ProcessLiveness> {
  const filesystem = yield* LockFilesystem;
  const liveness = yield* ProcessLiveness;
  const ticket = join(lock, "tickets", `${String(number)}.json`);
  const text = yield* filesystem.readTicket(ticket);
  if (text === undefined) {
    return undefined;
  }
  const owner = parseRecord(lockOwnerSchema, text, ticket);
  const marker = donePath(lock, number, owner.token);
  const completed = yield* exists(marker);
  if (!completed && liveness.isRunning(owner.pid)) {
    return undefined;
  }
  const skipped = yield* removeSkippingConflict(filesystem.removeTicket(ticket));
  if (skipped !== undefined || !completed) {
    return skipped;
  }
  return yield* removeSkippingConflict(filesystem.removeDone(marker));
});

const clearFinished = Effect.fnUntraced(function* (
  lock: string,
  numbers: readonly number[],
): Effect.fn.Return<unknown, unknown, LockFilesystem | ProcessLiveness> {
  const maximum = numbers.at(-1);
  let skippedConflict: unknown;
  for (const number of numbers) {
    if (number === maximum) {
      break;
    }
    // Windows reports a ticket or marker that another contender is removing as EPERM or EBUSY.
    // A later poll retries the ticket, and a leftover marker never matches a new token.
    const skipped = yield* skipWindowsConflict(reclaimTicket(lock, number));
    if (skipped !== undefined) {
      skippedConflict = skipped.conflict;
    }
  }
  return skippedConflict;
});

function writeDoneMarker(lock: string, number: number, token: string): Effect.Effect<void> {
  return fromPromise(async () => {
    await mkdir(donePath(lock, number, token));
  }).pipe(Effect.orDie);
}

// The hard link is the whole acquisition, so the link and its finalizer registration are
// protected together. EEXIST becomes `undefined` inside the acquisition, so a pending interruption
// wins over it, while any other link failure fails the acquisition and registers nothing.
function publishAttempt(
  lock: string,
  source: string,
  number: number,
  token: string,
): Effect.Effect<Publication | undefined, unknown, LockFilesystem | Scope.Scope> {
  const publication: Publication = {
    path: join(lock, "tickets", `${String(number)}.json`),
    armed: true,
  };
  return Effect.acquireRelease(
    LockFilesystem.use((filesystem) => filesystem.publish(source, publication.path)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        errorCode(error) === "EEXIST" ? Effect.succeed(false) : Effect.fail(error),
      ),
    ),
    (linked) => {
      return linked && publication.armed ? writeDoneMarker(lock, number, token) : Effect.void;
    },
  ).pipe(Effect.map((linked) => (linked ? publication : undefined)));
}

const pastDeadline = Effect.fnUntraced(function* (deadline: number): Effect.fn.Return<boolean> {
  return (yield* Clock.currentTimeMillis) >= deadline;
});

const publishTicket = Effect.fnUntraced(function* (
  lock: string,
  source: string,
  token: string,
  deadline: number,
): Effect.fn.Return<number, unknown, LockFilesystem | Scope.Scope> {
  const filesystem = yield* LockFilesystem;
  const directory = join(lock, "tickets");
  for (;;) {
    const maximum = (yield* ticketNumbers(directory)).at(-1) ?? 0;
    if (maximum >= Number.MAX_SAFE_INTEGER) {
      return yield* Effect.fail(new Error("Project lock ticket sequence exhausted."));
    }
    const number = maximum + 1;
    const publication = yield* publishAttempt(lock, source, number, token);
    if (publication === undefined) {
      if (yield* pastDeadline(deadline)) {
        return yield* Effect.fail(busy());
      }
      yield* Effect.sleep(pollMs);
      continue;
    }
    // The recheck fences a number retired during a delayed publication.
    if (((yield* ticketNumbers(directory)).at(-1) ?? 0) === number) {
      return number;
    }
    yield* Effect.uninterruptible(
      filesystem.removeTicket(publication.path).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            publication.armed = false;
          }),
        ),
      ),
    );
    if (yield* pastDeadline(deadline)) {
      return yield* Effect.fail(busy());
    }
  }
});

const waitForTurn = Effect.fnUntraced(function* (
  lock: string,
  number: number,
  deadline: number,
): Effect.fn.Return<void, unknown, LockFilesystem | ProcessLiveness> {
  const tickets = join(lock, "tickets");
  for (;;) {
    const skippedConflict = yield* clearFinished(lock, yield* ticketNumbers(tickets));
    const remaining = yield* ticketNumbers(tickets);
    if (remaining.every((candidate) => candidate >= number)) {
      return;
    }
    if (yield* pastDeadline(deadline)) {
      yield* Effect.fail(busy(skippedConflict));
      return;
    }
    yield* Effect.sleep(pollMs);
  }
});

const prepareLayout = Effect.fnUntraced(function* (
  sessionsDir: string,
  lock: string,
): Effect.fn.Return<void, unknown, LockFilesystem | ProcessLiveness> {
  yield* ensureDirectory(sessionsDir, true);
  for (const directory of [
    lock,
    ...["tickets", "done", "private"].map((name) => join(lock, name)),
  ]) {
    yield* ensureDirectory(directory, false);
  }
  if (yield* exists(join(lock, "owner.json"))) {
    yield* Effect.fail(new Error("Unsupported project lock layout: owner.json"));
    return;
  }
  yield* clearDeadPrivate(lock);
});

/**
 * Run `action` under the project mutation lock inside a transaction-local scope.
 *
 * Writes a complete private owner record and registers its removal, then publishes the owner as the
 * next numbered ticket through an atomic hard link; each attempt's release writes the done marker.
 * Closing the scope writes the done marker, then removes the private record. `action` must not take
 * the lock again. While acquiring:
 *
 * - The greatest ticket remains as a sequence marker, and a delayed publisher rejects a retired
 *   number by rechecking the maximum before waiting.
 * - Lower live tickets finish first; dead owners and completed tickets are reclaimed, and a damaged
 *   ticket is preserved and reported.
 * - Waiting polls every 20 ms on `Clock` and is interruptible; `action` runs interruptibly.
 *
 * @throws Error when the lock is busy at the 5000 ms deadline; its `cause` is the last Windows
 *   access conflict skipped in the final poll, when one was skipped.
 * @throws Error when the ticket sequence is exhausted.
 * @throws Error when a lock directory is a symbolic link or not a directory, or the retired
 *   `owner.json` layout is present.
 * @throws The failure of `action`, unchanged.
 * @throws The original filesystem error for other failures.
 */
export function withProjectLock<A, R>(
  sessionsDir: string,
  action: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, unknown, R | StorageServices> {
  return Effect.scoped(
    Effect.gen(function* () {
      const lock = join(sessionsDir, ".lock");
      const token = randomUUID();
      yield* prepareLayout(sessionsDir, lock);
      const privatePath = join(lock, "private", `${String(process.pid)}-${token}.json`);
      const owner: LockOwner = { version: 1, pid: process.pid, token };
      const deadline = (yield* Clock.currentTimeMillis) + lockWaitMs;
      yield* Effect.addFinalizer(() =>
        fromPromise(async () => {
          await rm(privatePath, { force: true });
        }).pipe(Effect.orDie),
      );
      yield* writeRecord(privatePath, owner);
      const number = yield* publishTicket(lock, privatePath, token, deadline);
      yield* waitForTurn(lock, number, deadline);
      return yield* action;
    }),
  );
}
