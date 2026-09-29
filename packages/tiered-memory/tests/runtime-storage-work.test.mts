import type * as FsPromises from "node:fs/promises";
import { sep } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";

import type { MemoryProposal } from "../src/domain/proposal.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { writeDurable } from "../src/storage/files.ts";
import type { Fixture } from "./pi-fixture.mts";
import type { TestWrite } from "./storage-harness.mts";
import {
  committedId,
  noteContent,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  test,
} from "./store-fixture.mts";

interface Hold {
  reached: boolean;
  entered: PromiseWithResolvers<undefined>;
  release: PromiseWithResolvers<undefined>;
}

const gates = vi.hoisted(() => {
  const confirm: Hold[] = [];
  const layout: Hold[] = [];
  return { confirm, layout };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const hold = args[1] === "r+" ? gates.confirm.shift() : undefined;
      if (hold !== undefined) {
        hold.reached = true;
        hold.entered.resolve(undefined);
        await hold.release.promise;
      }
      return await actual.open(...args);
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const hold = gates.layout.shift();
      if (hold !== undefined) {
        hold.reached = true;
        hold.entered.resolve(undefined);
        await hold.release.promise;
      }
      return await actual.lstat(...args);
    },
  };
});

function newHold(): Hold {
  return {
    reached: false,
    entered: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
  };
}

function holdNextLayoutCheck(): Hold {
  const hold = newHold();
  gates.layout.push(hold);
  return hold;
}

function holdNextConfirmation(): Hold {
  const hold = newHold();
  gates.confirm.push(hold);
  return hold;
}

function withdraw(hold: Hold): void {
  const index = gates.layout.indexOf(hold);
  if (index !== -1) {
    gates.layout.splice(index, 1);
  }
}

async function yieldUntil(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 20 && !done(); turn++) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn lets scheduled fibers start before the next check.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function signalAtJobEnd(onEnd: () => void): AbortSignal {
  const controller = new AbortController();
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, "removeEventListener").mockImplementation((type, listener) => {
    remove(type, listener);
    onEnd();
  });
  return controller.signal;
}

test("a conflict refresh admitted while a commit applies its lineage runs after it and keeps the winner selected", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Concurrent commits.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, "Concurrent commits.");
  const winning = runtime.captureProposal(ctx, noteContent({ "current-work.md": "One\n" }), [
    source,
  ]);
  const losing = runtime.captureProposal(ctx, noteContent({ "journey.md": "Two\n" }), [source]);
  const confirmation = holdNextConfirmation();
  const first = runtime.commitProposal(ctx, winning);
  await confirmation.entered.promise;
  const jobEnded = Promise.withResolvers<undefined>();
  const second = runtime.commitProposal(
    {
      ...ctx,
      signal: signalAtJobEnd(() => {
        jobEnded.resolve(undefined);
      }),
    },
    losing,
  );
  await jobEnded.promise;
  const refresh = holdNextLayoutCheck();
  await yieldUntil(() => refresh.reached);
  withdraw(refresh);
  confirmation.release.resolve(undefined);
  const winner = committedId(await first);
  refresh.release.resolve(undefined);
  expect(await second).toMatchObject({ kind: "conflict", actualRevision: winner, reason: "head" });
  expect(storageOf(runtime)).toMatchObject({
    lineage: {
      selected: { state: "selected", revisionId: winner },
      pending: { state: "none" },
    },
    latestRevision: winner,
    registration: { event: "commit" },
    error: undefined,
  });
  const next = runtime.captureProposal(ctx, noteContent({ "journey.md": "Three\n" }), [source]);
  expect(next.baseRevision).toMatchObject({ revisionId: winner });
  expect(next.expectedRevision).toBe(winner);
});

const blueEvidence = "The setting is blue.";

interface BlueSelection {
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  source: string;
  selected: string;
  attempts: [MemoryProposal, MemoryProposal, MemoryProposal];
  holdAfterNextRegistration: () => Hold;
  failLockTicketAfterNextRegistration: (failure: Error) => void;
}

async function selectBlueNote(f: Fixture): Promise<BlueSelection> {
  await f.session.prompt(blueEvidence);
  const afterRegistration: (() => void)[] = [];
  const lockTicket: { failure: Error | undefined } = { failure: undefined };
  const write: TestWrite = async (path, contents) => {
    const failure = path.includes(`${sep}private${sep}`) ? lockTicket.failure : undefined;
    if (failure !== undefined) {
      lockTicket.failure = undefined;
      throw failure;
    }
    await writeDurable(path, contents);
    if (path.endsWith("sources.json")) {
      afterRegistration.shift()?.();
    }
  };
  const runtime = runtimeFor(f, { write });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, blueEvidence);
  const stale = (name: string): MemoryProposal =>
    runtime.captureProposal(ctx, noteContent({ [name]: `${name}\n` }), [source]);
  const attempts: BlueSelection["attempts"] = [
    stale("topic-a.md"),
    stale("topic-b.md"),
    stale("topic-c.md"),
  ];
  const selected = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Blue\n" }), [source]),
    ),
  );
  return {
    runtime,
    ctx,
    source,
    selected,
    attempts,
    holdAfterNextRegistration() {
      const hold = newHold();
      afterRegistration.push(() => {
        gates.layout.push(hold);
      });
      return hold;
    },
    failLockTicketAfterNextRegistration(failure) {
      afterRegistration.push(() => {
        lockTicket.failure = failure;
      });
    },
  };
}

async function editToGreenWithTurn(f: Fixture): Promise<void> {
  f.session.sessionManager.appendContextEdit(sourceEntry(f, blueEvidence).id, {
    content: "The setting is green.",
  });
  await f.session.prompt("A later turn.");
}

const headConflict = { kind: "conflict", reason: "head" };
const blueValid = { state: "selected", invalidNotes: [] };
const greenInvalid = {
  state: "selected",
  invalidNotes: ["current-work.md"],
  invalidReason: "note-evidence",
};
const blueCount = { sources: 2, event: "commit" };
const greenCount = { sources: 4, event: "commit" };

test("a refresh after an older registration keeps the newer registration's note invalidation and source count", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, selected, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  const [older, newer] = attempts;
  const olderHeld = holdAfterNextRegistration();
  const first = runtime.commitProposal(ctx, older);
  await olderHeld.entered.promise;
  await editToGreenWithTurn(f);
  expect(await runtime.commitProposal(ctx, newer)).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  olderHeld.release.resolve(undefined);
  expect(await first).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    ...greenInvalid,
    revisionId: selected,
  });
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test("an attempt that starts first but registers last supplies validity and count to a refresh that runs after its own", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  const [startedFirst, registeredFirst] = attempts;
  const beforeRegistration = holdNextLayoutCheck();
  const late = runtime.commitProposal(ctx, startedFirst);
  await beforeRegistration.entered.promise;
  const earlyHeld = holdAfterNextRegistration();
  const early = runtime.commitProposal(ctx, registeredFirst);
  await earlyHeld.entered.promise;
  await editToGreenWithTurn(f);
  beforeRegistration.release.resolve(undefined);
  expect(await late).toMatchObject(headConflict);
  earlyHeld.release.resolve(undefined);
  expect(await early).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test("a refresh uses a newer registration whose own refresh has not run, and that later refresh leaves the state unchanged", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  const [older, newer] = attempts;
  const olderHeld = holdAfterNextRegistration();
  const first = runtime.commitProposal(ctx, older);
  await olderHeld.entered.promise;
  await editToGreenWithTurn(f);
  const newerHeld = holdAfterNextRegistration();
  const second = runtime.commitProposal(ctx, newer);
  await newerHeld.entered.promise;
  olderHeld.release.resolve(undefined);
  expect(await first).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
  const refreshed = storageOf(runtime);
  newerHeld.release.resolve(undefined);
  expect(await second).toMatchObject(headConflict);
  expect(storageOf(runtime)).toEqual(refreshed);
});

test("a rejected commit runs no refresh and its registration supplies the next refresh", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, holdAfterNextRegistration, failLockTicketAfterNextRegistration } =
    await selectBlueNote(f);
  const [older, rejected] = attempts;
  const olderHeld = holdAfterNextRegistration();
  const first = runtime.commitProposal(ctx, older);
  await olderHeld.entered.promise;
  await editToGreenWithTurn(f);
  const failure = new Error("Injected lock ticket write failure.");
  failLockTicketAfterNextRegistration(failure);
  await expect(runtime.commitProposal(ctx, rejected)).rejects.toBe(failure);
  expect(storageOf(runtime).lineage.selected).toMatchObject(blueValid);
  expect(storageOf(runtime).registration).toMatchObject(blueCount);
  olderHeld.release.resolve(undefined);
  expect(await first).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test("a registration published while a commit confirms its branch reference supplies that commit's refresh", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  const committing = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Blue again\n" }),
    [source],
  );
  const confirmation = holdNextConfirmation();
  const first = runtime.commitProposal(ctx, committing);
  await confirmation.entered.promise;
  await editToGreenWithTurn(f);
  const publishingHeld = holdAfterNextRegistration();
  const second = runtime.commitProposal(ctx, attempts[0]);
  await publishingHeld.entered.promise;
  confirmation.release.resolve(undefined);
  const committed = committedId(await first);
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    ...greenInvalid,
    revisionId: committed,
  });
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
  publishingHeld.release.resolve(undefined);
  expect(await second).toMatchObject(headConflict);
});

test("a registration published during a paused refresh survives that refresh and supplies the next refresh", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  const [paused, publishing, next] = attempts;
  const nextHeld = holdAfterNextRegistration();
  const third = runtime.commitProposal(ctx, next);
  await nextHeld.entered.promise;
  const refreshHeld = Promise.withResolvers<Hold>();
  const first = runtime.commitProposal(
    {
      ...ctx,
      signal: signalAtJobEnd(() => {
        refreshHeld.resolve(holdNextLayoutCheck());
      }),
    },
    paused,
  );
  const refresh = await refreshHeld.promise;
  await refresh.entered.promise;
  await editToGreenWithTurn(f);
  const publishingHeld = holdAfterNextRegistration();
  const second = runtime.commitProposal(ctx, publishing);
  await publishingHeld.entered.promise;
  refresh.release.resolve(undefined);
  expect(await first).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(blueValid);
  expect(storageOf(runtime).registration).toMatchObject(blueCount);
  nextHeld.release.resolve(undefined);
  expect(await third).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
  publishingHeld.release.resolve(undefined);
  expect(await second).toMatchObject(headConflict);
});
