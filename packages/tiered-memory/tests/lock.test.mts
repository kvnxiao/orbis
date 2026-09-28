import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import { expect } from "vitest";

import { Execution } from "../src/pi/execution.ts";
import { fromPromise, readText } from "../src/storage/files.ts";
import { lockOwnerSchema, withProjectLock } from "../src/storage/lock.ts";
import { parseRecord } from "../src/storage/records.ts";
import {
  interruptedOnly,
  openScope,
  runStorage,
  storageRuntime,
  testServices,
} from "./storage-harness.mts";
import type { TestLockFilesystem, TestServices } from "./storage-harness.mts";
import { rejectionPaths, test } from "./store-fixture.mts";

interface LockOverrides extends TestLockFilesystem {
  now: () => number;
  isRunning: (pid: number) => boolean;
}

function servicesOf(io: LockOverrides | undefined): TestServices {
  if (io === undefined) {
    return {};
  }
  const { now, isRunning, ...lock } = io;
  return { now, isRunning, lock };
}

async function withLock<A>(
  sessions: string,
  run: () => Promise<A>,
  io?: LockOverrides,
): Promise<A> {
  return await runStorage(withProjectLock(sessions, fromPromise(run)), servicesOf(io));
}

function forkLock(
  sessions: string,
  run: () => Promise<unknown>,
  io?: LockOverrides,
): Fiber.Fiber<unknown, unknown> {
  return storageRuntime(servicesOf(io)).runFork(withProjectLock(sessions, fromPromise(run)));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise<void>((done) => {
    child.once("exit", done);
  });
  if (pid === undefined) {
    throw new Error("Missing child process id.");
  }
  return pid;
}

async function writeTicket(sessions: string, number: number, owner: unknown): Promise<void> {
  const directory = join(sessions, ".lock", "tickets");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${String(number)}.json`),
    typeof owner === "string" ? owner : JSON.stringify(owner),
  );
}

async function tickets(sessions: string): Promise<string[]> {
  return await readdir(join(sessions, ".lock", "tickets"));
}

function doneName(number: number, token: string): string {
  return `${String(number)}-${createHash("sha256").update(token).digest("hex")}`;
}

test("a holder publishes its pid and token and leaves a sequence marker", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const owner = await withLock(sessions, async () =>
    parseRecord(
      lockOwnerSchema,
      await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
      "1.json",
    ),
  );
  expect(owner).toMatchObject({ version: 1, pid: process.pid });
  expect(owner.token.length).toBeGreaterThan(0);
  expect(await tickets(sessions)).toEqual(["1.json"]);
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

test("a second holder waits until the first resolves or rejects", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const order: string[] = [];
  const held = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  const first = withLock(sessions, async () => {
    order.push("first start");
    entered.resolve(undefined);
    await held.promise;
    order.push("first end");
  });
  await entered.promise;
  const second = withLock(sessions, async () => {
    order.push("second");
    await Promise.resolve();
  });
  held.resolve(undefined);
  await Promise.all([first, second]);
  const failure = new Error("action failed");
  await expect(withLock(sessions, async () => await Promise.reject(failure))).rejects.toBe(failure);
  expect(order).toEqual(["first start", "first end", "second"]);
});

test("dead predecessor tickets are recovered without overlapping live holders", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const io: LockOverrides = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  let holders = 0;
  let overlap = false;
  const hold = async (): Promise<void> => {
    holders++;
    overlap ||= holders > 1;
    await sleep(10);
    holders--;
  };
  await Promise.all([
    withLock(sessions, hold, io),
    withLock(sessions, hold, io),
    withLock(sessions, hold, io),
  ]);
  expect(overlap).toBe(false);
  expect((await tickets(sessions)).length).toBeLessThanOrEqual(2);
});

test("a delayed publication cannot reuse a retired ticket before a live holder", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const enteredPublish = Promise.withResolvers<undefined>();
  const resumePublish = Promise.withResolvers<undefined>();
  const holderEntered = Promise.withResolvers<undefined>();
  const releaseHolder = Promise.withResolvers<undefined>();
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    publish: async (source, ticket) => {
      enteredPublish.resolve(undefined);
      await resumePublish.promise;
      await link(source, ticket);
    },
  };
  let holderActive = false;
  let overlap = false;
  const delayed = withLock(
    sessions,
    async () => {
      overlap ||= holderActive;
      await Promise.resolve();
    },
    io,
  );
  await enteredPublish.promise;
  await withLock(sessions, async () => {
    await Promise.resolve();
  });
  const holder = withLock(sessions, async () => {
    holderActive = true;
    holderEntered.resolve(undefined);
    await releaseHolder.promise;
    holderActive = false;
  });
  await holderEntered.promise;
  expect(await tickets(sessions)).toEqual(["3.json"]);
  resumePublish.resolve(undefined);
  await sleep(100);
  expect(overlap).toBe(false);
  releaseHolder.resolve(undefined);
  await Promise.all([delayed, holder]);
  expect(overlap).toBe(false);
});

test("a killed writer's ticket is recovered", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: await exitedPid(), token: "dead" });
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"))).resolves.toBe(
    "acquired",
  );
});

test("a live predecessor past the deadline reports busy", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: process.pid, token: "live" });
  let now = 0;
  const io: LockOverrides = { now: () => (now += 1000), isRunning: () => true };
  await expect(
    withLock(
      sessions,
      async () => {
        await Promise.resolve();
      },
      io,
    ),
  ).rejects.toThrow("project lock is busy");
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
});

test("a persistent Windows dead-ticket removal conflict reports busy with that conflict as cause", async ({
  makeRoot,
  skip,
}) => {
  skip(process.platform !== "win32", "Windows reports a conflicting removal as EPERM or EBUSY.");
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const conflict = Object.assign(new Error("ticket removal conflicts with another contender"), {
    code: "EPERM",
  });
  let now = 0;
  const io: LockOverrides = {
    now: () => (now += 1000),
    isRunning: (pid) => pid !== 4242,
    removeTicket: async () => {
      await Promise.reject(conflict);
    },
  };
  let failure: unknown;
  try {
    await withLock(
      sessions,
      async () => {
        await Promise.resolve();
      },
      io,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error && failure.message).toContain("project lock is busy");
  expect(failure instanceof Error && failure.cause).toBe(conflict);
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
});

test.for(["EPERM", "EBUSY"])(
  "a Windows %s ticket read that races its removal is retried on a later poll",
  async (code, { makeRoot, skip }) => {
    skip(process.platform !== "win32", "Windows reports a ticket being removed as EPERM or EBUSY.");
    const sessions = join(await makeRoot(), "sessions");
    await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
    let removalInProgress = true;
    const io: LockOverrides = {
      now: () => Date.now(),
      isRunning: (pid) => pid !== 4242,
      readTicket: async (path) => {
        if (removalInProgress) {
          removalInProgress = false;
          throw Object.assign(new Error("ticket is being removed"), { code });
        }
        return await Effect.runPromise(readText(path));
      },
    };
    await expect(
      withLock(sessions, async () => await Promise.resolve("acquired"), io),
    ).resolves.toBe("acquired");
    expect(removalInProgress).toBe(false);
    expect(await tickets(sessions)).toEqual(["2.json"]);
  },
);

test("a non-Windows EPERM ticket read rejects acquisition with that error", async ({
  makeRoot,
  skip,
}) => {
  skip(process.platform === "win32", "Windows skips EPERM ticket reads as removal conflicts.");
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const failure = Object.assign(new Error("ticket read denied"), { code: "EPERM" });
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    readTicket: async () => await Promise.reject(failure),
  };
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"), io)).rejects.toBe(
    failure,
  );
});

test("a Windows done-marker removal that races another cleaner still acquires the lock", async ({
  makeRoot,
  skip,
}) => {
  skip(process.platform !== "win32", "Windows reports a concurrently removed directory as EPERM.");
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: process.pid, token: "finished" });
  await mkdir(join(sessions, ".lock", "done", doneName(1, "finished")), { recursive: true });
  let markerRemovalRaced = false;
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    removeDone: async () => {
      markerRemovalRaced = true;
      await Promise.reject(
        Object.assign(new Error("directory removal raced another cleaner"), { code: "EPERM" }),
      );
    },
  };
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"), io)).resolves.toBe(
    "acquired",
  );
  expect(markerRemovalRaced).toBe(true);
  expect(await tickets(sessions)).toEqual(["2.json"]);
});

test("an interruption while waiting ends acquisition, keeps the predecessor's ticket, and removes its own private record", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: process.pid, token: "live" });
  let ran = false;
  const fiber = forkLock(sessions, async () => {
    ran = true;
    await Promise.resolve();
  });
  await sleep(50);
  fiber.interruptUnsafe();
  expect(await interruptedOnly(fiber)).toBe(true);
  expect(ran).toBe(false);
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
  expect(await readdir(join(sessions, ".lock", "private"))).toEqual([]);
});

test("an interruption after publication marks its ticket complete without running the action", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  let ran = false;
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async (source, ticket) => {
      await link(source, ticket);
      fiber.interruptUnsafe();
    },
  };
  const fiber = forkLock(
    sessions,
    async () => {
      ran = true;
      await Promise.resolve();
    },
    io,
  );
  expect(await interruptedOnly(fiber)).toBe(true);
  const owner = parseRecord(
    lockOwnerSchema,
    await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
    "1.json",
  );
  expect(ran).toBe(false);
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

test("an interruption during a publication attempt's hard link still writes its done marker", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let ran = false;
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async (source, ticket) => {
      entered.resolve(undefined);
      await gate.promise;
      await link(source, ticket);
    },
  };
  const fiber = forkLock(
    sessions,
    async () => {
      ran = true;
      await Promise.resolve();
    },
    io,
  );
  await entered.promise;
  fiber.interruptUnsafe();
  gate.resolve(undefined);
  expect(await interruptedOnly(fiber)).toBe(true);
  const owner = parseRecord(
    lockOwnerSchema,
    await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
    "1.json",
  );
  expect(ran).toBe(false);
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

function fencingPublisher(sessions: string): NonNullable<LockOverrides["publish"]> {
  let fenced = false;
  return async (source, ticket) => {
    await link(source, ticket);
    if (!fenced) {
      fenced = true;
      await writeTicket(sessions, 2, { version: 1, pid: 4242, token: "retired" });
    }
  };
}

test("a fenced publication removes its ticket and leaves no done marker", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    publish: fencingPublisher(sessions),
  };
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"), io)).resolves.toBe(
    "acquired",
  );
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(false);
  const done = await readdir(join(sessions, ".lock", "done"));
  expect(done.filter((name) => name.startsWith("1-"))).toEqual([]);
  expect(done.filter((name) => name.startsWith("3-"))).toHaveLength(1);
});

test("a failed ticket removal after fencing leaves the done marker armed", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const failure = new Error("fenced ticket removal failed");
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    publish: fencingPublisher(sessions),
    removeTicket: async (path) => {
      if (path.endsWith(`${sep}1.json`)) {
        throw failure;
      }
      await rm(path, { force: true });
    },
  };
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"), io)).rejects.toBe(
    failure,
  );
  const owner = parseRecord(
    lockOwnerSchema,
    await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
    "1.json",
  );
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

test("a failed read after publication still marks its ticket complete", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const failure = new Error("readdir failed after publication");
  let armed = false;
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async (source, ticket) => {
      await link(source, ticket);
      armed = true;
    },
    list: async (directory) => {
      if (armed) {
        armed = false;
        throw failure;
      }
      return await readdir(directory);
    },
  };
  await expect(
    withLock(
      sessions,
      async () => {
        await Promise.resolve();
      },
      io,
    ),
  ).rejects.toBe(failure);
  const owner = parseRecord(
    lockOwnerSchema,
    await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
    "1.json",
  );
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

test("a live owner whose ticket changes token is not removed by release", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const ticket = join(sessions, ".lock", "tickets", "1.json");
  await withLock(sessions, async () => {
    await writeFile(ticket, JSON.stringify({ version: 1, pid: process.pid, token: "other" }));
  });
  expect(JSON.parse(await readFile(ticket, "utf8"))).toMatchObject({ token: "other" });
});

test("private files from a dead process are removed without touching a live writer", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const directory = join(sessions, ".lock", "private");
  await mkdir(directory, { recursive: true });
  const dead = join(directory, "4242-dead.json");
  const live = join(directory, `${String(process.pid)}-beef.json`);
  await writeFile(dead, "{}");
  await writeFile(live, "{}");
  const io: LockOverrides = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  await withLock(
    sessions,
    async () => {
      await Promise.resolve();
    },
    io,
  );
  expect(await exists(dead)).toBe(false);
  expect(await exists(live)).toBe(true);
});

test("a Windows dead-private removal that races another contender still acquires the lock", async ({
  makeRoot,
  skip,
}) => {
  skip(process.platform !== "win32", "Windows reports a concurrently removed file as EPERM.");
  const sessions = join(await makeRoot(), "sessions");
  const directory = join(sessions, ".lock", "private");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "4242-dead.json"), "{}");
  let privateRemovalRaced = false;
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    removePrivate: async () => {
      privateRemovalRaced = true;
      await Promise.reject(
        Object.assign(new Error("private removal raced another contender"), { code: "EPERM" }),
      );
    },
  };
  await expect(withLock(sessions, async () => await Promise.resolve("acquired"), io)).resolves.toBe(
    "acquired",
  );
  expect(privateRemovalRaced).toBe(true);
});

for (const child of [undefined, "tickets", "done", "private"] as const) {
  test(`a symlink at ${child ?? ".lock"} is rejected before external files change`, async ({
    makeRoot,
  }) => {
    const root = await makeRoot();
    const sessions = join(root, "sessions");
    const lock = join(sessions, ".lock");
    const external = join(root, "external");
    await mkdir(sessions);
    await mkdir(external);
    const target = child === undefined ? lock : join(lock, child);
    if (child !== undefined) {
      await mkdir(lock);
    }
    const marker = join(
      external,
      child === "private" || child === undefined ? "4242-dead.json" : "keep.txt",
    );
    await writeFile(marker, "external content");
    await symlink(external, target, process.platform === "win32" ? "junction" : "dir");
    const io: LockOverrides = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
    await expect(
      withLock(
        sessions,
        async () => {
          await Promise.resolve();
          throw new Error("entered action");
        },
        io,
      ),
    ).rejects.toThrow("symbolic link");
    expect(await readdir(external)).toEqual([marker.split(/[\\/]/u).at(-1)]);
    expect(await readFile(marker, "utf8")).toBe("external content");
  });
}

test("a symlinked sessions directory is rejected before external lock cleanup", async ({
  makeRoot,
}) => {
  const root = await makeRoot();
  const external = join(root, "external");
  const privateDir = join(external, ".lock", "private");
  await mkdir(privateDir, { recursive: true });
  const marker = join(privateDir, "4242-dead.json");
  await writeFile(marker, "external content");
  await symlink(
    external,
    join(root, "sessions"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const io: LockOverrides = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  await expect(
    withLock(
      join(root, "sessions"),
      async () => {
        await Promise.resolve();
        throw new Error("entered action");
      },
      io,
    ),
  ).rejects.toThrow("symbolic link");
  expect(await readFile(marker, "utf8")).toBe("external content");
});

test("damaged and unsupported ticket records remain available for repair", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, "{not json");
  await expect(
    withLock(sessions, async () => {
      await Promise.resolve();
    }),
  ).rejects.toThrow("Invalid JSON");
  expect(await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8")).toBe("{not json");
});

test("an exhausted ticket sequence fails without changing the marker", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, Number.MAX_SAFE_INTEGER, { version: 1, pid: 4242, token: "dead" });
  await expect(
    withLock(sessions, async () => {
      await Promise.resolve();
    }),
  ).rejects.toThrow("sequence exhausted");
  expect(await tickets(sessions)).toEqual([`${String(Number.MAX_SAFE_INTEGER)}.json`]);
});

test("owner records reject unsupported versions, missing tokens, and wrong pid types", () => {
  expect(rejectionPaths(lockOwnerSchema, { version: 2, pid: 1, token: "t" })).toContain("/version");
  expect(rejectionPaths(lockOwnerSchema, { version: 1, pid: 1 })).toContain("/token");
  expect(rejectionPaths(lockOwnerSchema, { version: 1, pid: "1", token: "t" })).toContain("/pid");
});

test("a job cancelled while its hard link fails with EEXIST reports cancelled with the disable reason", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const { entered, gate } = gatedStep();
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async (_source, ticket) => {
      entered.resolve(undefined);
      await gate.promise;
      throw Object.assign(new Error(`EEXIST: file already exists, link -> ${ticket}`), {
        code: "EEXIST",
      });
    },
  };
  const reason = new Error("Test disable reason.");
  const release = () => {
    gate.resolve(undefined);
  };
  const race = await raceLock(
    sessions,
    io,
    { entered: entered.promise, release },
    "disable",
    reason,
  );
  expect(cancelledWith(race)).toBe(reason);
  expect(await readdir(join(sessions, ".lock", "done"))).toEqual([]);
});

test.for(["EPERM", "EBUSY"])(
  "a dead-ticket removal that fails with %s during a disable reports cancelled on Windows and rejects elsewhere",
  async (code, { makeRoot }) => {
    const sessions = join(await makeRoot(), "sessions");
    await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
    const { entered, gate } = gatedStep();
    const failure = Object.assign(new Error(`${code}: operation not permitted, unlink`), { code });
    const io: LockOverrides = {
      now: () => Date.now(),
      isRunning: (pid) => pid !== 4242,
      removeTicket: async () => {
        entered.resolve(undefined);
        await gate.promise;
        throw failure;
      },
    };
    const reason = new Error("Test disable reason.");
    const release = () => {
      gate.resolve(undefined);
    };
    const race = await raceLock(
      sessions,
      io,
      { entered: entered.promise, release },
      "disable",
      reason,
    );
    const windows = process.platform === "win32";
    expect(windows ? cancelledWith(race) : rejectionOf(race)).toBe(windows ? reason : failure);
    expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
  },
);

test("an interruption during a fenced ticket's removal still disarms its done marker", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    publish: fencingPublisher(sessions),
    removeTicket: async (path) => {
      if (path.endsWith(`${sep}1.json`)) {
        entered.resolve(undefined);
        await gate.promise;
      }
      await rm(path, { force: true });
    },
  };
  const fiber = forkLock(sessions, async () => await Promise.resolve("acquired"), io);
  await entered.promise;
  fiber.interruptUnsafe();
  gate.resolve(undefined);
  expect(await interruptedOnly(fiber)).toBe(true);
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(false);
  const done = await readdir(join(sessions, ".lock", "done"));
  expect(done.filter((name) => name.startsWith("1-"))).toEqual([]);
});

type Race = { settled: "resolved"; value: unknown } | { settled: "rejected"; error: unknown };

function rejectionOf(race: Race): unknown {
  if (race.settled !== "rejected") {
    throw new Error("Expected the lock work to reject.", { cause: race.value });
  }
  return race.error;
}

function cancelledWith(race: Race): unknown {
  const value = race.settled === "resolved" ? race.value : undefined;
  if (typeof value !== "object" || value === null || !("kind" in value) || !("reason" in value)) {
    throw new Error("Expected a job result.", { cause: race });
  }
  expect(value.kind).toBe("cancelled");
  return value.reason;
}

async function raceLock(
  sessions: string,
  io: LockOverrides,
  step: { entered: Promise<unknown>; release: () => void },
  cancel: "disable" | "replacement",
  reason: Error = new Error(cancel),
): Promise<Race> {
  const execution = new Execution(testServices(servicesOf(io)));
  try {
    const storage = await openScope(execution);
    const locked = withProjectLock(sessions, Effect.succeed("locked"));
    const work =
      cancel === "disable"
        ? execution.runJob(storage, undefined, () => locked)
        : execution.runInStorage(storage, Effect.asVoid(locked));
    await step.entered;
    if (cancel === "disable") {
      execution.cancelActiveWork(reason);
    } else {
      execution.replace(reason);
    }
    step.release();
    return await work.then(
      (value: unknown) => ({ settled: "resolved" as const, value }),
      (error: unknown) => ({ settled: "rejected" as const, error }),
    );
  } finally {
    await execution.shutdown(new Error("Test finished."));
  }
}

function gatedStep(): {
  entered: PromiseWithResolvers<undefined>;
  gate: PromiseWithResolvers<undefined>;
} {
  return { entered: Promise.withResolvers(), gate: Promise.withResolvers() };
}

test("storage work whose dead-ticket removal fails with EPERM while a replacement closes its scope resolves on Windows and rejects elsewhere", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const { entered, gate } = gatedStep();
  const failure = Object.assign(new Error("EPERM: operation not permitted, unlink"), {
    code: "EPERM",
  });
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: (pid) => pid !== 4242,
    removeTicket: async () => {
      entered.resolve(undefined);
      await gate.promise;
      throw failure;
    },
  };
  const release = () => {
    gate.resolve(undefined);
  };
  const race = await raceLock(sessions, io, { entered: entered.promise, release }, "replacement");
  const windows = process.platform === "win32";
  expect(race.settled).toBe(windows ? "resolved" : "rejected");
  expect(race.settled === "resolved" ? race.value : race.error).toBe(windows ? undefined : failure);
});

test.for(["disable", "replacement"] as const)(
  "a genuine dead-ticket removal failure that races a %s rejects with the original error",
  async (cancel, { makeRoot }) => {
    const sessions = join(await makeRoot(), "sessions");
    await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
    const { entered, gate } = gatedStep();
    const failure = Object.assign(new Error("EIO: i/o error, unlink"), { code: "EIO" });
    const io: LockOverrides = {
      now: () => Date.now(),
      isRunning: (pid) => pid !== 4242,
      removeTicket: async () => {
        entered.resolve(undefined);
        await gate.promise;
        throw failure;
      },
    };
    const release = () => {
      gate.resolve(undefined);
    };
    const race = await raceLock(sessions, io, { entered: entered.promise, release }, cancel);
    expect(rejectionOf(race)).toBe(failure);
  },
);

test("a genuine hard-link failure that races a disable rejects with the original error", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const { entered, gate } = gatedStep();
  const failure = Object.assign(new Error("EIO: i/o error, link"), { code: "EIO" });
  const io: LockOverrides = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async () => {
      entered.resolve(undefined);
      await gate.promise;
      throw failure;
    },
  };
  const release = () => {
    gate.resolve(undefined);
  };
  const race = await raceLock(sessions, io, { entered: entered.promise, release }, "disable");
  expect(rejectionOf(race)).toBe(failure);
  expect(await readdir(join(sessions, ".lock", "done"))).toEqual([]);
});
