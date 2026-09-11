import { expect, test, vi } from "vitest";

import * as config from "../src/config.ts";
import * as persistence from "../src/persistence.ts";
import { presentRound } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
import * as results from "../src/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test.for([
  { objective: "Choose the next priority.", block: "```\nChoose the next priority.\n```" },
  {
    objective: "Use this example:\n```text\npriority\n```",
    block: "````\nUse this example:\n```text\npriority\n```\n````",
  },
  { objective: "", block: "```\nobjective not supplied\n```" },
])(
  "planning notices separate objectives from save status: $objective",
  async ({ objective, block }, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    const notify = vi.spyOn(f.ctx.ui, "notify");
    onTestFinished(() => {
      notify.mockRestore();
    });
    f.runtime.start(f.ctx, objective);
    expect(notify).toHaveBeenLastCalledWith(
      `Planning:\n${block}\n\nPlanning state is unsaved.`,
      "info",
    );
    f.runtime.start(f.ctx, objective);
    expect(notify).toHaveBeenLastCalledWith(`Planning:\n${block}\n\nPlanning state saved.`, "info");
    notify.mockClear();
    f.runtime.restore(f.ctx);
    expect(notify).toHaveBeenLastCalledWith(
      `Planning:\n${block}\n\nRestored from the active branch; new changes require disk confirmation.`,
      "info",
    );
  },
);

test("cancellation flushes pending drafts and reports a failing persistence backend", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Draft failure");
  const notify = vi.spyOn(f.ctx.ui, "notify");
  const save = vi.spyOn(persistence, "saveRecord");
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit", questionId: "scope", unfinished: "Unsaved cancellation draft" });
      save.mockReturnValue({ saved: false, message: "Injected persistence failure" });
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
    save.mockRestore();
    notify.mockRestore();
  });
  const result = await f.runtime.round(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    roundId: "round",
    expectedRevision: 0,
    questions: [
      { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
    ],
  });
  expect(result.outcome).toBe("cancelled");
  expect(save.mock.calls.at(-1)?.slice(0, 2)).toEqual([f.api, f.ctx]);
  expect(save.mock.calls.at(-1)?.[2]).toMatchObject({
    active: {
      phase: "cancelled",
      round: { drafts: { scope: { unfinished: "Unsaved cancellation draft" } } },
    },
  });
  expect(notify).toHaveBeenCalledWith("Injected persistence failure", "warning");
  save.mockRestore();
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("");
});

test.each([false, true])(
  "prepared input is delivered only to its owning session (restore=%s)",
  async (restore) => {
    const f = await runtimeFixture();
    f.runtime.start(f.ctx, "Objective");
    const active = f.runtime.active;
    if (active === undefined) {
      throw new Error("Missing plan");
    }
    f.persist({
      ...active,
      ...presentRound(active, {
        planId: active.planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
        ],
      }),
    });
    f.runtime.restore(f.ctx);
    const preparing = Promise.withResolvers<undefined>();
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof results.toolResult>>>();
    const serialize = vi.spyOn(results, "toolResult").mockImplementation(async () => {
      preparing.resolve(undefined);
      return await prepared.promise;
    });
    const view = vi
      .spyOn(terminal, "terminalRound")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "answer", questionId: "scope", answer: { custom: "CLI" } });
        dispatch({ type: "submit" });
        await Promise.resolve();
      });
    const send = vi.spyOn(f.api, "sendMessage");
    const content = [{ type: "text" as const, text: "Prepared answers" }];
    const pending = f.runtime.reopen(f.ctx);
    try {
      await preparing.promise;
      if (restore) {
        f.runtime.restore(f.ctx);
      }
      prepared.resolve({
        content,
        details: { outcome: "answers", roundId: "round", revision: 1, decisions: {} },
      });
      await pending;
      expect(send.mock.calls).toEqual(
        restore
          ? []
          : [[{ customType: "orbis-plan-input", content, display: true }, { triggerTurn: true }]],
      );
    } finally {
      prepared.resolve({ content, details: { outcome: "cancelled" } });
      await pending;
      serialize.mockRestore();
      view.mockRestore();
      send.mockRestore();
      await f.dispose();
    }
  },
);

test("an obsolete interaction cannot clear or abort the replacement interaction", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Objective");
  const planId = f.runtime.active?.planId;
  if (planId === undefined) {
    throw new Error("Missing plan");
  }
  const oldSettings = Promise.withResolvers<config.PlanSettings>();
  const settings = vi
    .spyOn(config, "readSettings")
    .mockImplementationOnce(async () => await oldSettings.promise);
  const viewOpened = Promise.withResolvers<undefined>();
  const viewDone = Promise.withResolvers<undefined>();
  let viewSignal: AbortSignal | undefined;
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, _read, _dispatch, signal) => {
      viewSignal = signal;
      viewOpened.resolve(undefined);
      await viewDone.promise;
    });
  try {
    const oldSignal = new AbortController();
    const previous = f.runtime.round(
      f.ctx,
      {
        planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
        ],
      },
      oldSignal.signal,
    );
    f.runtime.restore(f.ctx);
    const replacement = f.runtime.interact(f.ctx);
    await viewOpened.promise;
    oldSettings.resolve({
      symbols: "unicode",
      border: "rounded",
      showHints: true,
      shortcut: "shift+tab",
      planDirectory: f.ctx.cwd,
    });
    await expect(previous).resolves.toEqual({ outcome: "cancelled" });
    oldSignal.abort();
    expect(viewSignal?.aborted).toBe(false);
    expect(f.runtime.start(f.ctx, "Must not replace", true).outcome).toBe("error");
    viewDone.resolve(undefined);
    await replacement;
  } finally {
    oldSettings.resolve({
      symbols: "unicode",
      border: "rounded",
      showHints: true,
      shortcut: "shift+tab",
      planDirectory: f.ctx.cwd,
    });
    viewDone.resolve(undefined);
    settings.mockRestore();
    view.mockRestore();
  }
});

test("session restoration aborts replacement confirmation and rejects a late response", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Original");
  const confirmation = Promise.withResolvers<boolean>();
  const opened = Promise.withResolvers<undefined>();
  let signal: AbortSignal | undefined;
  const pending = f.runtime.requestStart(
    {
      ...f.ctx,
      ui: {
        ...f.ctx.ui,
        async confirm(_title, _message, options) {
          signal = options?.signal;
          opened.resolve(undefined);
          return await confirmation.promise;
        },
      },
    },
    "Obsolete",
    true,
  );
  await opened.promise;
  f.runtime.restore(f.ctx);
  const restored = f.runtime.active?.planId;
  expect(signal?.aborted).toBe(true);
  confirmation.resolve(true);
  await expect(pending).resolves.toEqual({ outcome: "cancelled" });
  expect(f.runtime.active?.planId).toBe(restored);
  expect(f.runtime.active?.objective).toBe("Original");
});
