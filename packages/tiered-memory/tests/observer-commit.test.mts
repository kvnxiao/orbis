import type * as FsPromises from "node:fs/promises";
import { link, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, vi } from "vitest";

import type { JobOutcome } from "../src/pi/worker.ts";
import { fixtureMessage } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import { afterHeadWrite } from "./storage-harness.mts";
import type { TestServices } from "./storage-harness.mts";
import { committedId, noteContent, runtimeFor, storeFor, test } from "./store-fixture.mts";
import {
  advance,
  controlledClock,
  noteReply,
  ScriptedObserver,
  workerFixture,
} from "./worker-fixture.mts";

// Holds the next `realpath` call, which the observer job makes while it projects current evidence
// between its first coverage check and its frame capture.
const realpathGate = vi.hoisted(() => ({
  armed: undefined as { entered: () => void; released: Promise<undefined> } | undefined,
}));

afterEach(() => {
  realpathGate.armed = undefined;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      const armed = realpathGate.armed;
      if (armed !== undefined) {
        realpathGate.armed = undefined;
        armed.entered();
        await armed.released;
      }
      return await actual.realpath(...args);
    },
  };
});

function holdNextRealpath(f: Fixture): { entered: Promise<undefined>; release: () => void } {
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  realpathGate.armed = {
    entered: () => {
      entered.resolve(undefined);
    },
    released: released.promise,
  };
  f.onDispose(async () => {
    released.resolve(undefined);
    await Promise.resolve();
  });
  return {
    entered: entered.promise,
    release: () => {
      released.resolve(undefined);
    },
  };
}

// Holds the next project-lock ticket publication until the test releases it.
function lockGate(): {
  services: TestServices;
  hold: () => { entered: Promise<undefined>; release: () => void };
} {
  let armed: { entered: () => void; released: Promise<undefined> } | undefined;
  return {
    services: {
      lock: {
        publish: async (source, ticket) => {
          const held = armed;
          armed = undefined;
          if (held !== undefined) {
            held.entered();
            await held.released;
          }
          await link(source, ticket);
        },
      },
    },
    hold() {
      const entered = Promise.withResolvers<undefined>();
      const released = Promise.withResolvers<undefined>();
      armed = {
        entered: () => {
          entered.resolve(undefined);
        },
        released: released.promise,
      };
      return {
        entered: entered.promise,
        release: () => {
          released.resolve(undefined);
        },
      };
    },
  };
}

async function observing(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options: FixtureOptions = {},
): Promise<{ f: Fixture; observer: ScriptedObserver }> {
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer, options);
  return { f, observer };
}

function lastOutcome(f: Fixture): JobOutcome | undefined {
  return f.memory().work.status?.last;
}

async function head(f: Fixture): Promise<string | null> {
  return await (await storeFor(f)).currentHead();
}

async function revisionsCovering(f: Fixture, references: readonly string[]): Promise<string[]> {
  const store = await storeFor(f);
  const files = await readdir(join(store.sessionDir, "revisions")).catch(() => []);
  const covering: string[] = [];
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- Revision files are few and read in order.
    const revision = await store.readRevision(file.replace(/\.json$/u, ""));
    if (references.every((reference) => revision?.sourceIds.includes(reference) === true)) {
      covering.push(revision?.id ?? "");
    }
  }
  return covering;
}

test("Pi a revision covering the interval selected during observer preparation skips the job without a second commit", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  observer.respond((call) => noteReply("Duplicate note.", call));
  const held = holdNextRealpath(f);
  await f.session.prompt("Shared goal.");
  await held.entered;
  const references = f.memory().work.status?.running?.interval.spans.map((span) => span.reference);
  expect(references?.length).toBeGreaterThan(0);
  const ctx = f.session.extensionRunner.createContext();
  const other = runtimeFor(f);
  await other.start(ctx);
  const covering = committedId(
    await other.commitProposal(
      ctx,
      other.captureProposal(ctx, noteContent({ "current-work.md": "Other writer.\n" }), [
        ...(references ?? []),
      ]),
    ),
  );
  await other.shutdown();
  await f.command("on");
  expect(f.memory().runtime.memoryStorage(ctx)?.canonical.revision?.revisionId).toBe(covering);
  held.release();
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "covered" });
  expect(observer.calls).toHaveLength(0);
  expect(await head(f)).toBe(covering);
  expect(await revisionsCovering(f, references ?? [])).toEqual([covering]);
});

test("Pi a job deadline that passes during observer preparation releases its spans without an attempt", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { jobTimeoutMs: 1000 } },
  });
  const held = holdNextRealpath(f);
  await f.session.prompt("Prepared late.");
  await held.entered;
  await advance(clock, 1000);
  held.release();
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "expired" });
  expect(observer.calls).toHaveLength(0);
  expect(await head(f)).toBeNull();
});

test("Pi a job deadline that passes while its commit waits for the project lock abandons the commit", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const gate = lockGate();
  const { f, observer } = await observing(createFixture, {
    services: { ...gate.services, clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 0 } },
  });
  await f.session.prompt("Committed late.");
  const pending = await observer.next();
  const lock = gate.hold();
  f.onDispose(async () => {
    lock.release();
    await Promise.resolve();
  });
  pending.reply(noteReply("Late note.", pending.call));
  await lock.entered;
  await advance(clock, 1000);
  lock.release();
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "exhausted", failures: [], deadline: true, commit: true });
  expect(await head(f)).toBeNull();
  await f.command("status");
  expect(f.report()).toContain(
    "last outcome: exhausted because the job deadline passed before its accepted output committed",
  );
  expect(f.report()).toContain("Processing coverage: 2 gaps (2 failed)");
});

test("Pi a job deadline that passes before the head write of an accepted retry abandons its commit and reports the earlier failure", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const gate = lockGate();
  const { f, observer } = await observing(createFixture, {
    services: { ...gate.services, clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 1 } },
  });
  await f.session.prompt("Committed late after a retry.");
  (await observer.next()).reply(fixtureMessage("not json"));
  const retry = await observer.next();
  const lock = gate.hold();
  f.onDispose(async () => {
    lock.release();
    await Promise.resolve();
  });
  retry.reply(noteReply("Late note.", retry.call));
  await lock.entered;
  await advance(clock, 1000);
  lock.release();
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({
    kind: "exhausted",
    failures: [{ kind: "malformed", detail: "Invalid JSON at observer response." }],
    deadline: true,
    commit: true,
  });
  expect(await head(f)).toBeNull();
  await f.command("status");
  expect(f.report()).toContain(
    "last outcome: exhausted because the job deadline passed before its accepted output committed after 1 failed attempts; last failure: malformed output: Invalid JSON at observer response.",
  );
});

test("Pi a job deadline that passes after its head write started still commits the revision", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const { f, observer } = await observing(createFixture, {
    services: {
      clock,
      write: afterHeadWrite(async () => {
        entered.resolve(undefined);
        await released.promise;
      }),
    },
    personal: { limits: { jobTimeoutMs: 1000, retries: 0 } },
  });
  f.onDispose(async () => {
    released.resolve(undefined);
    await Promise.resolve();
  });
  await f.session.prompt("Published late.");
  const pending = await observer.next();
  pending.reply(noteReply("Published note.", pending.call));
  await entered.promise;
  await advance(clock, 1000);
  released.resolve(undefined);
  await f.memory().work.idle();
  const revisionId = await head(f);
  expect(revisionId).not.toBeNull();
  expect(lastOutcome(f)).toEqual({ kind: "committed", revisionId });
  const store = await storeFor(f);
  expect(await readFile(join(store.sessionDir, "current", "current-work.md"), "utf8")).toBe(
    "Published note.",
  );
});
