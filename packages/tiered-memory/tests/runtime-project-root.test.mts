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
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (gate.armed) {
        gate.armed = false;
        gate.entered.resolve(undefined);
        await gate.release.promise;
      }
      return await actual.realpath(...args);
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
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(storageOf(runtime)).toEqual(opened);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Resolved during a replacement."),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
});
