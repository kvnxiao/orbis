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

const gate = vi.hoisted(() => ({
  armed: false,
  entered: Promise.withResolvers<undefined>(),
  release: Promise.withResolvers<undefined>(),
  finished: Promise.withResolvers<undefined>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (!gate.armed) {
        return await actual.realpath(...args);
      }
      gate.armed = false;
      gate.entered.resolve(undefined);
      await gate.release.promise;
      try {
        return await actual.realpath(...args);
      } finally {
        gate.finished.resolve(undefined);
      }
    },
  };
});

test("a replacement during canonicalProjectRoot opens its own session and the old lookup never closes it", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Resolved during a replacement.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  gate.armed = true;
  const starting = runtime.start(ctx);
  await gate.entered.promise;
  await runtime.selectBranch(ctx);
  const opened = storageOf(runtime);
  expect(opened.registration).toMatchObject({ event: "session_tree" });
  gate.release.resolve(undefined);
  await starting;
  await gate.finished.promise;
  await new Promise((resolve) => setImmediate(resolve));
  expect(storageOf(runtime)).toEqual(opened);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Resolved during a replacement."),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
});
