import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
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
  const owner = await withProjectLock(sessions, access(), async () =>
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
  const failure = new Error("action failed");
  await expect(
    withProjectLock(sessions, access(), async () => await Promise.reject(failure)),
  ).rejects.toBe(failure);
  expect(order).toEqual(["first start", "first end", "second"]);
});

test("dead predecessor tickets are recovered without overlapping live holders", async ({
  makeRoot,
}) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  let holders = 0;
  let overlap = false;
  const action = async (): Promise<void> => {
    holders++;
    overlap ||= holders > 1;
    await sleep(10);
    holders--;
  };
  await Promise.all([
    withProjectLock(sessions, access(), action, io),
    withProjectLock(sessions, access(), action, io),
    withProjectLock(sessions, access(), action, io),
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
  const io: LockIo = {
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
  const delayed = withProjectLock(
    sessions,
    access(),
    async () => {
      overlap ||= holderActive;
      await Promise.resolve();
    },
    io,
  );
  await enteredPublish.promise;
  await withProjectLock(sessions, access(), async () => {
    await Promise.resolve();
  });
  const holder = withProjectLock(sessions, access(), async () => {
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
  await expect(
    withProjectLock(sessions, access(), async () => await Promise.resolve("acquired")),
  ).resolves.toBe("acquired");
});

test("a live predecessor past the deadline reports busy", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: process.pid, token: "live" });
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
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
});

test("a Windows handle blocking dead-ticket removal waits until busy", async ({
  makeRoot,
  skip,
}) => {
  skip(process.platform !== "win32", "Windows reports an open ticket handle as EPERM or EBUSY.");
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: 4242, token: "dead" });
  let now = 0;
  const io: LockIo = {
    now: () => (now += 1000),
    isRunning: (pid) => pid !== 4242,
    removeTicket: async () => {
      await Promise.reject(
        Object.assign(new Error("ticket has an open handle"), { code: "EPERM" }),
      );
    },
  };
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
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
});

test("cancellation while waiting preserves the abort reason", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, 1, { version: 1, pid: process.pid, token: "live" });
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
  expect(await exists(join(sessions, ".lock", "tickets", "1.json"))).toBe(true);
});

test("cancellation after publication marks its ticket complete", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const controller = new AbortController();
  const reason = new Error("cancelled after publication");
  let ran = false;
  const io: LockIo = {
    now: () => Date.now(),
    isRunning: () => true,
    publish: async (source, ticket) => {
      await link(source, ticket);
      controller.abort(reason);
    },
  };
  await expect(
    withProjectLock(
      sessions,
      access(controller.signal),
      async () => {
        ran = true;
        await Promise.resolve();
      },
      io,
    ),
  ).rejects.toBe(reason);
  const owner = parseRecord(
    lockOwnerSchema,
    await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8"),
    "1.json",
  );
  expect(ran).toBe(false);
  expect(await exists(join(sessions, ".lock", "done", doneName(1, owner.token)))).toBe(true);
});

test("a failed read after publication still marks its ticket complete", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  const failure = new Error("readdir failed after publication");
  let armed = false;
  const io: LockIo = {
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
    withProjectLock(
      sessions,
      access(),
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
  await withProjectLock(sessions, access(), async () => {
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
  const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  await withProjectLock(
    sessions,
    access(),
    async () => {
      await Promise.resolve();
    },
    io,
  );
  expect(await exists(dead)).toBe(false);
  expect(await exists(live)).toBe(true);
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
    const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
    await expect(
      withProjectLock(
        sessions,
        access(),
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
  const io: LockIo = { now: () => Date.now(), isRunning: (pid) => pid !== 4242 };
  await expect(
    withProjectLock(
      join(root, "sessions"),
      access(),
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
    withProjectLock(sessions, access(), async () => {
      await Promise.resolve();
    }),
  ).rejects.toThrow("Invalid JSON");
  expect(await readFile(join(sessions, ".lock", "tickets", "1.json"), "utf8")).toBe("{not json");
});

test("an exhausted ticket sequence fails without changing the marker", async ({ makeRoot }) => {
  const sessions = join(await makeRoot(), "sessions");
  await writeTicket(sessions, Number.MAX_SAFE_INTEGER, { version: 1, pid: 4242, token: "dead" });
  await expect(
    withProjectLock(sessions, access(), async () => {
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
