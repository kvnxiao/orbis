import type { AssistantMessage } from "@earendil-works/pi-ai";
import { expect, test, vi } from "vitest";

import { presentRound } from "../src/domain/state.ts";
import * as terminal from "../src/pi/terminal.ts";
import * as results from "../src/pi/tool-result.ts";
import * as config from "../src/storage/config.ts";
import * as persistence from "../src/storage/persistence.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("planning notices omit pending draft saves", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const notify = vi.spyOn(f.ctx.ui, "notify");
  let pendingNotice: unknown;
  let savedNotice: unknown;
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Revise this" });
      f.runtime.present(f.ctx);
      pendingNotice = notify.mock.lastCall;
      f.runtime.save(f.ctx);
      f.runtime.present(f.ctx);
      savedNotice = notify.mock.lastCall;
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    notify.mockRestore();
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Review selection");
  await f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Plan",
  });
  expect(view).toHaveBeenCalledOnce();
  expect(pendingNotice).toEqual(["Planning:\n```\nReview selection\n```", "info"]);
  expect(savedNotice).toEqual([
    "Planning:\n```\nReview selection\n```\n\nPlanning state saved.",
    "info",
  ]);
});

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

test.for([
  { scenario: "expected error", expected: "stop" },
  { scenario: "typed abort", expected: "stop" },
  { scenario: "provider abort", expected: "stop" },
  { scenario: "network failure", expected: undefined },
  { scenario: "partial content", expected: undefined },
  { scenario: "diagnostic", expected: undefined },
  { scenario: "later turn", expected: undefined },
  { scenario: "unaborted signal", expected: undefined },
  { scenario: "settled", expected: undefined },
  { scenario: "restored", expected: undefined },
] as const)(
  "review closure replacement preserves $scenario boundaries",
  async ({ scenario, expected }, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    const turn = new AbortController();
    const ctx = {
      ...f.ctx,
      signal: turn.signal,
      abort() {
        if (scenario !== "unaborted signal") {
          turn.abort();
        }
      },
    };
    const view = vi
      .spyOn(terminal, "terminalReview")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "cancel" });
        await Promise.resolve();
      });
    onTestFinished(() => {
      view.mockRestore();
    });
    f.runtime.start(ctx, "Review closure");
    await f.runtime.review(ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Pending",
    });
    const message: AssistantMessage = {
      role: "assistant",
      api: "openai-responses",
      provider: "fixture",
      model: "fixture",
      content: [],
      stopReason: "error",
      errorMessage: "This operation was aborted",
      timestamp: 123,
      usage: {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    switch (scenario) {
      case "expected error":
      case "unaborted signal":
        break;
      case "typed abort":
        message.stopReason = "aborted";
        break;
      case "provider abort":
        message.errorMessage = "Request was aborted";
        break;
      case "network failure":
        message.errorMessage = "WebSocket error";
        break;
      case "partial content":
        message.content = [{ type: "text", text: "Keep this content" }];
        break;
      case "diagnostic":
        message.diagnostics = [
          {
            type: "provider_transport_failure",
            timestamp: 123,
            error: { name: "Error", message: "Keep this diagnostic" },
          },
        ];
        break;
      case "later turn":
        ctx.signal = AbortSignal.abort();
        break;
      case "settled":
        f.runtime.settled(ctx);
        break;
      case "restored":
        f.runtime.restore(ctx);
        break;
    }
    const before = structuredClone(message);
    const replacement = f.runtime.replaceReviewAbort(message, ctx);
    expect(replacement?.role === "assistant" ? replacement.stopReason : undefined).toBe(expected);
    expect(
      replacement?.role === "assistant" ? replacement.errorMessage : undefined,
    ).toBeUndefined();
    expect(message).toEqual(before);
    expect(f.runtime.replaceReviewAbort(message, ctx)).toBeUndefined();
  },
);

test("review closure warns while idle and preserves persistence failure warnings", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const notify = vi.spyOn(f.ctx.ui, "notify");
  const save = vi.spyOn(persistence, "saveRecord");
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Unsent feedback" });
      save.mockReturnValue({ saved: false, message: "Injected persistence failure" });
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
    save.mockRestore();
    notify.mockRestore();
  });
  f.runtime.start(f.ctx, "Idle review");
  const result = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Pending",
  });
  await expect(result).rejects.toThrow("Planning result is not confirmed on disk");
  expect(f.runtime.active?.reviews?.at(-1)?.feedbackDraft).toBe("Unsent feedback");
  expect(notify).toHaveBeenCalledWith("Injected persistence failure", "warning");
  expect(notify).toHaveBeenLastCalledWith(
    "Plan review closed without approval. Use /plan to resume.",
    "warning",
  );
});

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
  const result = f.runtime.round(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    roundId: "round",
    expectedRevision: 0,
    questions: [
      { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
    ],
  });
  await expect(result).rejects.toThrow("Planning result is not confirmed on disk");
  expect(save.mock.calls.at(-1)?.slice(0, 2)).toEqual([f.api, f.ctx]);
  expect(save.mock.calls.findLast((call) => call[4] === undefined)?.[2]).toMatchObject({
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
  const pending = f.runtime.requestOpen(
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
    undefined,
    "replace-obsolete",
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
