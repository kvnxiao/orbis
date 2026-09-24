import { spawn } from "node:child_process";
import { mkdir, open, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { expect } from "vitest";

import { writeDurable } from "../src/storage/files.ts";
import { lockOwnerSchema, withProjectLock } from "../src/storage/lock.ts";
import type { LockIo } from "../src/storage/lock.ts";
import { parseRecord } from "../src/storage/records.ts";
import { rejectionPaths, test } from "./store-fixture.mts";

function access(signal = new AbortController().signal) {
  return { signal, write: writeDurable };
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
    child.once("exit", () => {
      done();
    });
  });
  if (pid === undefined) {
    throw new Error("Missing child process id.");
  }
  return pid;
}

async function writeOwner(lock: string, owner: unknown): Promise<void> {
  await mkdir(lock, { recursive: true });
  await writeFile(
    join(lock, "owner.json"),
    typeof owner === "string" ? owner : JSON.stringify(owner),
  );
}

test("withProjectLock writes owner.json with the pid and a token while the action runs", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const owner = await withProjectLock(sessions, access(), async () =>
    parseRecord(
      lockOwnerSchema,
      await readFile(join(sessions, ".lock", "owner.json"), "utf8"),
      "owner.json",
    ),
  );
  expect(owner).toMatchObject({ version: 1, pid: process.pid });
  expect(owner.token.length).toBeGreaterThan(0);
});

test("withProjectLock releases the lock after the action resolves and after it rejects", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await withProjectLock(sessions, access(), async () => {
    await Promise.resolve();
  });
  expect(await exists(join(sessions, ".lock"))).toBe(false);
  const failure = new Error("action failed");
  await expect(
    withProjectLock(sessions, access(), async () => await Promise.reject(failure)),
  ).rejects.toBe(failure);
  expect(await exists(join(sessions, ".lock"))).toBe(false);
});

test("a second holder waits until the first releases the lock", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const order: string[] = [];
  const held = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  const first = withProjectLock(sessions, access(), async () => {
    order.push("first start");
    entered.resolve(undefined);
    await held.promise;
    order.push("first end");
  });
  await entered.promise;
  const second = withProjectLock(sessions, access(), async () => {
    order.push("second");
    await Promise.resolve();
  });
  held.resolve(undefined);
  await Promise.all([first, second]);
  expect(order).toEqual(["first start", "first end", "second"]);
});

test("a stale owner whose process is gone is removed and the lock is acquired", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeOwner(join(sessions, ".lock"), { version: 1, pid: 4242, token: "previous" });
  const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  const token = await withProjectLock(
    sessions,
    access(),
    async () =>
      parseRecord(
        lockOwnerSchema,
        await readFile(join(sessions, ".lock", "owner.json"), "utf8"),
        "owner.json",
      ).token,
    io,
  );
  expect(token).not.toBe("previous");
});

test("two acquisitions racing over one dead owner hold the lock one at a time", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  let holders = 0;
  let overlapped = false;
  let runs = 0;
  const action = async (): Promise<void> => {
    holders++;
    overlapped ||= holders > 1;
    await sleep(5);
    holders--;
    runs++;
  };
  for (let round = 0; round < 20; round++) {
    // oxlint-disable-next-line no-await-in-loop -- Each round starts from a fresh dead owner after the previous round released the lock.
    await writeOwner(join(sessions, ".lock"), {
      version: 1,
      pid: 4242,
      token: `dead-${String(round)}`,
    });
    // oxlint-disable-next-line no-await-in-loop -- Each round starts from a fresh dead owner after the previous round released the lock.
    await Promise.all([
      withProjectLock(sessions, access(), action, io),
      withProjectLock(sessions, access(), action, io),
    ]);
  }
  expect(overlapped).toBe(false);
  expect(runs).toBe(40);
  expect((await readdir(sessions)).filter((name) => name.startsWith(".lock"))).toEqual([]);
});

test("a claimed lock whose owner is running again is renamed back and waited on", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const owner = { version: 1, pid: 4242, token: "revived" };
  await writeOwner(join(sessions, ".lock"), owner);
  let probes = 0;
  let now = 0;
  const io: LockIo = { now: () => (now += 1000), isRunning: () => ++probes > 1 };
  await expect(
    withProjectLock(
      sessions,
      access(),
      async () => {
        await Promise.resolve();
      },
      io,
    ),
  ).rejects.toThrow("project lock is busy");
  expect(JSON.parse(await readFile(join(sessions, ".lock", "owner.json"), "utf8"))).toEqual(owner);
  expect((await readdir(sessions)).filter((name) => name.startsWith(".lock"))).toEqual([".lock"]);
});

test("a stale lock that Windows refuses to rename while a handle is open is waited on", async ({
  makeRoot,
  skip,
}) => {
  skip(
    process.platform !== "win32",
    "Only Windows refuses to rename a directory with an open file.",
  );
  const sessions = join(await makeRoot(), "sessions");
  await writeOwner(join(sessions, ".lock"), { version: 1, pid: 4242, token: "dead" });
  const handle = await open(join(sessions, ".lock", "owner.json"), "r");
  let now = 0;
  const io: LockIo = { now: () => (now += 1000), isRunning: (pid) => pid !== 4242 };
  try {
    await expect(
      withProjectLock(
        sessions,
        access(),
        async () => {
          await Promise.resolve();
        },
        io,
      ),
    ).rejects.toThrow("project lock is busy");
  } finally {
    await handle.close();
  }
  expect(await exists(join(sessions, ".lock", "owner.json"))).toBe(true);
});

test("a killed writer's lock is recovered without manual removal", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeOwner(join(sessions, ".lock"), { version: 1, pid: await exitedPid(), token: "dead" });
  await expect(
    withProjectLock(sessions, access(), async () => await Promise.resolve("acquired")),
  ).resolves.toBe("acquired");
});

test("a live owner past the deadline fails with the busy error", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeOwner(join(sessions, ".lock"), { version: 1, pid: process.pid, token: "live" });
  let now = 0;
  const io: LockIo = { now: () => (now += 1000), isRunning: () => true };
  await expect(
    withProjectLock(
      sessions,
      access(),
      async () => {
        await Promise.resolve();
      },
      io,
    ),
  ).rejects.toThrow("project lock is busy");
  expect(await exists(join(sessions, ".lock", "owner.json"))).toBe(true);
});

test("a lock directory without owner.json is polled while it is newer than the deadline", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await mkdir(join(sessions, ".lock"), { recursive: true });
  const controller = new AbortController();
  const reason = new Error("stop waiting");
  setTimeout(() => {
    controller.abort(reason);
  }, 100);
  await expect(
    withProjectLock(sessions, access(controller.signal), async () => {
      await Promise.resolve();
    }),
  ).rejects.toBe(reason);
  expect(await exists(join(sessions, ".lock"))).toBe(true);
});

test("a lock directory without a valid owner older than the deadline is removed and acquired", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  const lock = join(sessions, ".lock");
  await writeOwner(lock, "{not json");
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  await expect(
    withProjectLock(sessions, access(), async () => await Promise.resolve("acquired")),
  ).resolves.toBe("acquired");
});

test("an aborted signal stops polling with the signal's reason", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeOwner(join(sessions, ".lock"), { version: 1, pid: process.pid, token: "live" });
  const controller = new AbortController();
  const reason = new Error("session replaced");
  setTimeout(() => {
    controller.abort(reason);
  }, 50);
  await expect(
    withProjectLock(sessions, access(controller.signal), async () => {
      await Promise.resolve();
    }),
  ).rejects.toBe(reason);
});

test("release leaves a lock whose owner.json names another token", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const owner = join(sessions, ".lock", "owner.json");
  await withProjectLock(sessions, access(), async () => {
    await writeFile(owner, JSON.stringify({ version: 1, pid: process.pid, token: "other" }));
  });
  expect(JSON.parse(await readFile(owner, "utf8"))).toMatchObject({ token: "other" });
});

test("owner.json with an unsupported version is rejected at /version", () => {
  const owner = { version: 2, pid: 1, token: "t" };
  expect(rejectionPaths(lockOwnerSchema, owner)).toContain("/version");
  expect(() => parseRecord(lockOwnerSchema, JSON.stringify(owner), "owner.json")).toThrow(
    "Invalid record at owner.json: /version",
  );
});

test("owner.json missing its token is rejected at /token", () => {
  expect(rejectionPaths(lockOwnerSchema, { version: 1, pid: 1 })).toContain("/token");
});

test("owner.json with a wrong-typed pid is rejected at /pid", () => {
  expect(rejectionPaths(lockOwnerSchema, { version: 1, pid: "1", token: "t" })).toContain("/pid");
});
