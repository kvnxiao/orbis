import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { terminalRound } from "../src/terminal.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("a closed or failed modal restores working defaults and stale cleanup preserves the newer wait", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const first = Promise.withResolvers<undefined>();
  const second = Promise.withResolvers<undefined>();
  const ui = { ...f.ctx.ui };
  vi.spyOn(ui, "custom")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockRejectedValueOnce(new Error("Modal failed"));
  const message = vi.fn<ExtensionContext["ui"]["setWorkingMessage"]>();
  const indicator = vi.fn<ExtensionContext["ui"]["setWorkingIndicator"]>();
  const ctx = {
    ...f.ctx,
    ui: { ...ui, setWorkingMessage: message, setWorkingIndicator: indicator },
  };
  const oldSignal = new AbortController();
  const old = terminalRound(
    ctx,
    () => ({ phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} }),
    () => undefined,
    oldSignal.signal,
  );
  expect(message).toHaveBeenLastCalledWith("Awaiting Plan");
  expect(indicator).toHaveBeenLastCalledWith({ frames: ["◴", "◷", "◶", "◵"], intervalMs: 350 });
  oldSignal.abort();
  expect(message).toHaveBeenLastCalledWith();
  const current = terminalRound(
    ctx,
    () => ({ phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} }),
    () => undefined,
  );
  first.resolve(undefined);
  await old;
  expect(message).toHaveBeenLastCalledWith("Awaiting Plan");
  second.resolve(undefined);
  await current;
  expect(message).toHaveBeenLastCalledWith();
  expect(indicator).toHaveBeenLastCalledWith();
  await expect(
    terminalRound(
      ctx,
      () => ({ phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} }),
      () => undefined,
    ),
  ).rejects.toThrow("Modal failed");
  expect(message).toHaveBeenLastCalledWith();
  expect(indicator).toHaveBeenLastCalledWith();
});
