import type * as FsPromises from "node:fs/promises";

import { expect, vi } from "vitest";

import {
  committedId,
  noteContent,
  runtimeFor,
  sourceReference,
  storageOf,
  test,
} from "./store-fixture.mts";

const gates = vi.hoisted(() => ({
  confirm: {
    armed: false,
    entered: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
  },
  layout: { armed: false, entered: false, release: Promise.withResolvers<undefined>() },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (gates.confirm.armed && args[1] === "r+") {
        gates.confirm.armed = false;
        gates.confirm.entered.resolve(undefined);
        await gates.confirm.release.promise;
      }
      return await actual.open(...args);
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (gates.layout.armed) {
        gates.layout.armed = false;
        gates.layout.entered = true;
        await gates.layout.release.promise;
      }
      return await actual.lstat(...args);
    },
  };
});

async function yieldUntil(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 20 && !done(); turn++) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn lets scheduled fibers start before the next check.
    await new Promise((resolve) => setImmediate(resolve));
  }
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
  gates.confirm.armed = true;
  const first = runtime.commitProposal(ctx, winning);
  await gates.confirm.entered.promise;
  const controller = new AbortController();
  const jobEnded = Promise.withResolvers<undefined>();
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, "removeEventListener").mockImplementation((type, listener) => {
    remove(type, listener);
    jobEnded.resolve(undefined);
  });
  const second = runtime.commitProposal({ ...ctx, signal: controller.signal }, losing);
  await jobEnded.promise;
  gates.layout.armed = true;
  await yieldUntil(() => gates.layout.entered);
  gates.layout.armed = false;
  gates.confirm.release.resolve(undefined);
  const winner = committedId(await first);
  gates.layout.release.resolve(undefined);
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
