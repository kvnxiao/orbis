import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { registerPlanPresenter } from "../src/presentation.ts";
import type { PlanPresentationRequest } from "../src/presentation.ts";
import { availablePresenters, presentationAction } from "../src/presenters.ts";
import * as terminal from "../src/terminal.ts";
import * as results from "../src/tool-result.ts";
import { selectPresenter } from "./presenter-fixture.mts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("public snapshots expose detached targets for a first annotation and validated batch submission", async () => {
  const f = await runtimeFixture();
  const cleanup = selectPresenter(f, async (request) => {
    if (request.snapshot.kind !== "review") {
      throw new Error("Expected review");
    }
    const block = request.snapshot.blocks.find((item) => item.kind === "paragraph");
    if (block === undefined) {
      throw new Error("No public paragraph target");
    }
    const update = {
      identity: request.identity,
      action: {
        type: "edit-note" as const,
        blockId: block.id,
        excerpt: block.excerpt,
        text: "Clarify this",
      },
    };
    expect(() =>
      request.updateDraft({ ...update, action: { ...update.action, excerpt: "Wrong source" } }),
    ).toThrow("excerpt");
    const snapshot = request.updateDraft(update);
    request.updateDraft({
      identity: request.identity,
      action: { type: "confirm-note", blockId: block.id },
    });
    if (snapshot.kind !== "review") {
      throw new Error("Expected review");
    }
    expect(snapshot.review.notes?.[0]?.confirmed).toBeUndefined();
    expect(() =>
      request.updateDraft({
        identity: request.identity,
        action: { type: "confirm-note", blockId: "missing" },
      }),
    ).toThrow("Unknown annotation");
    await Promise.resolve();
    return { identity: request.identity, action: { type: "submit-feedback" } };
  });
  try {
    f.runtime.start(f.ctx, "Public annotation");
    const result = await f.runtime.review(f.ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Plan\n\nOriginal source.",
    });
    expect(result).toMatchObject({ outcome: "feedback" });
    if (result.outcome !== "feedback") {
      throw new Error("Expected feedback");
    }
    expect(result.feedback).toContain("Original source.");
    expect(result.feedback).toContain("Clarify this");
  } finally {
    cleanup();
    await f.dispose();
  }
});

test.each([false, true])(
  "clarification resume bounds output and discards replaced owner: %s",
  async (replace) => {
    const f = await runtimeFixture();
    const view = vi
      .spyOn(terminal, "terminalRound")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "edit", questionId: "scope", unfinished: "é".repeat(60_000) });
        dispatch({
          type: "clarify",
          questionId: "scope",
          request: "Explain scope " + "Ω".repeat(60_000),
          id: "clarification",
        });
        await Promise.resolve();
      });
    const sent = vi.spyOn(f.api, "sendMessage").mockImplementation(() => undefined);
    const original = results.toolResult;
    const prepare = vi.spyOn(results, "toolResult").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (replace) {
        f.runtime.restore(f.ctx);
      }
      return result;
    });
    try {
      f.runtime.start(f.ctx, "Objective");
      await f.runtime.round(f.ctx, {
        planId: f.runtime.active?.planId ?? "",
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", prompt: "Scope?", context: "Known", prerequisites: [], options: [] },
        ],
      });
      await f.runtime.resumeClarification();
      expect(sent).toHaveBeenCalledTimes(replace ? 0 : 1);
      for (const [message] of sent.mock.calls) {
        const text = JSON.stringify(message.content);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
        expect(text).toContain("Full JSON:");
        expect(text).not.toContain("é");
      }
    } finally {
      prepare.mockRestore();
      sent.mockRestore();
      view.mockRestore();
      await f.dispose();
    }
  },
);

test("registration is local to the Pi bus and rejects duplicate IDs", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  const other = await runtimeFixture();
  onTestFinished(f.dispose);
  onTestFinished(other.dispose);
  const present = vi.fn<() => Promise<undefined>>(async () => {
    await Promise.resolve(undefined);
  });
  const definition = { version: 1 as const, id: "fixture", label: "Fixture", present };
  const remove = registerPlanPresenter(f.api, definition);
  expect(availablePresenters(f.api.events).map((item) => item.id)).toEqual(["fixture"]);
  expect(availablePresenters(other.api.events)).toEqual([]);
  expect(() => registerPlanPresenter(f.api, definition)).toThrow("already registered");
  expect(present).not.toHaveBeenCalled();
  remove();
  remove();
  expect(availablePresenters(f.api.events)).toEqual([]);
  expect(() => registerPlanPresenter(f.api, { ...definition, id: "terminal" })).toThrow("requires");
});

test("presenter snapshots are detached and draft callbacks expire after submission", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  let request: PlanPresentationRequest | undefined;
  onTestFinished(
    selectPresenter(f, async (input) => {
      request = input;
      const copy = input.snapshot;
      Reflect.set(copy, "kind", "invalid");
      input.updateDraft({
        identity: input.identity,
        action: { type: "answer", questionId: "scope", answer: { custom: "CLI" } },
      });
      expect(f.runtime.active?.decisions).toEqual({});
      expect(() =>
        input.updateDraft({
          identity: { ...input.identity, revision: 20 },
          action: { type: "edit", questionId: "scope", unfinished: "Wrong" },
        }),
      ).toThrow("changed");
      expect(() =>
        input.updateDraft({
          identity: input.identity,
          action: { type: "answer", questionId: "missing", answer: { custom: "Wrong" } },
        }),
      ).toThrow("Unknown");
      await Promise.resolve();
      return { identity: input.identity, action: { type: "submit" } };
    }),
  );
  f.runtime.start(f.ctx, "Objective");
  const planId = f.runtime.active?.planId ?? "";
  const result = await f.runtime.round(f.ctx, {
    planId,
    roundId: "round",
    expectedRevision: 0,
    questions: [
      { id: "scope", prompt: "Scope?", context: "Known", prerequisites: [], options: [] },
    ],
  });
  expect(result.outcome).toBe("answers");
  expect(f.runtime.active?.decisions.scope?.answer).toEqual({ custom: "CLI" });
  if (request === undefined) {
    throw new Error("Missing presenter request");
  }
  const completed = request;
  expect(completed.signal.aborted).toBe(true);
  expect(() =>
    completed.updateDraft({
      identity: completed.identity,
      action: { type: "edit", questionId: "scope", unfinished: "Too late" },
    }),
  ).toThrow("no longer active");
});

test.each(["decline", "throw", "remove"])(
  "presenter %s restores feedback drafts to TUI",
  async (mode) => {
    const f = await runtimeFixture();
    const cleanup = selectPresenter(f, async (input) => {
      input.updateDraft({
        identity: input.identity,
        action: { type: "edit-feedback", text: "Keep recovery" },
      });
      if (mode === "throw") {
        throw new Error("Disconnected");
      }
      if (mode === "remove") {
        cleanup.unregister();
        return await new Promise(() => undefined);
      }
      return undefined;
    });
    const terminalView = vi
      .spyOn(terminal, "terminalReview")
      .mockImplementation(async (_ctx, read, dispatch) => {
        expect(read().reviews?.at(-1)?.feedbackDraft).toBe("Keep recovery");
        dispatch({ type: "feedback", text: "Keep recovery" });
        await Promise.resolve();
      });
    try {
      f.runtime.start(f.ctx, "Objective");
      const result = await f.runtime.review(f.ctx, {
        planId: f.runtime.active?.planId ?? "",
        expectedRevision: 0,
        markdown: "# Plan",
      });
      expect(result).toMatchObject({ outcome: "feedback", feedback: "Keep recovery" });
    } finally {
      terminalView.mockRestore();
      cleanup();
      await f.dispose();
    }
  },
);

test("cancellation interrupts an uncooperative presenter without reopening TUI", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const opened = Promise.withResolvers<PlanPresentationRequest>();
  const finished = Promise.withResolvers<undefined>();
  onTestFinished(
    selectPresenter(f, async (request) => {
      opened.resolve(request);
      await finished.promise;
      return undefined;
    }),
  );
  f.runtime.start(f.ctx, "Objective");
  const pending = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Plan",
  });
  const request = await opened.promise;
  f.runtime.pause(f.ctx);
  expect((await pending).outcome).toBe("cancelled");
  expect(request.signal.aborted).toBe(true);
  expect(terminal.terminalReview).toHaveBeenCalledOnce();
  finished.reject(new Error("Late failure"));
  await Promise.resolve();
});

test.each([
  { draft: false, payload: { identity: { version: 2 }, action: { type: "approve" } } },
  { draft: false, payload: { identity: undefined, action: { type: "approve" } } },
  {
    draft: true,
    payload: {
      action: { type: "answer", questionId: "scope", answer: { custom: "A", optionId: "b" } },
    },
  },
  { draft: false, payload: { action: { type: "approve", markdown: "Overwrite" } } },
  {
    draft: true,
    payload: {
      action: {
        type: "answer",
        questionId: "scope",
        answer: { optionId: "local", details: "Hidden notes" },
      },
    },
  },
])("malformed presenter input is rejected before dispatch: %j", ({ payload, draft }) => {
  const identity = {
    version: 1 as const,
    sessionId: "session",
    planId: "plan",
    interactionId: "interaction",
    revision: 1,
  };
  expect(() => presentationAction({ identity, ...payload }, identity, draft)).toThrow("Invalid");
});

test("restoration rejects a pending presenter's late approval and draft update", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const opened = Promise.withResolvers<PlanPresentationRequest>();
  const finish = Promise.withResolvers<undefined>();
  onTestFinished(
    selectPresenter(f, async (request) => {
      opened.resolve(request);
      await finish.promise;
      return { identity: request.identity, action: { type: "approve" } };
    }),
  );
  f.runtime.start(f.ctx, "Original");
  const pending = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Old",
  });
  const request = await opened.promise;
  f.runtime.restore(f.ctx);
  const restored = f.runtime.active?.planId;
  expect((await pending).outcome).toBe("cancelled");
  expect(() =>
    request.updateDraft({
      identity: request.identity,
      action: { type: "edit-feedback", text: "Late" },
    }),
  ).toThrow("no longer active");
  finish.resolve(undefined);
  await Promise.resolve();
  expect(f.runtime.active?.planId).toBe(restored);
  expect(f.runtime.active?.accepted).toBeUndefined();
});

test("Use terminal rejects a late presenter approval while terminal drafts remain active", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const opened = Promise.withResolvers<PlanPresentationRequest>();
  const finish = Promise.withResolvers<undefined>();
  const back = Promise.withResolvers<undefined>();
  const inTerminal = Promise.withResolvers<undefined>();
  const selection = Promise.withResolvers<string | undefined>();
  const cleanup = selectPresenter(f, async (request) => {
    opened.resolve(request);
    await finish.promise;
    return { identity: request.identity, action: { type: "approve" } };
  });
  onTestFinished(cleanup);
  vi.spyOn(f.ctx.ui, "select")
    .mockResolvedValueOnce("fixture")
    .mockImplementationOnce(async () => await selection.promise);
  vi.spyOn(terminal, "terminalReview")
    .mockImplementationOnce(async (_ctx, _read, _dispatch, _signal, switchView) => {
      switchView?.();
      await Promise.resolve();
    })
    .mockImplementationOnce(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Terminal draft" });
      inTerminal.resolve(undefined);
      await back.promise;
      dispatch({ type: "cancel" });
    });
  f.runtime.start(f.ctx, "Presenter transfer");
  const pending = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Plan",
  });
  const request = await opened.promise;
  selection.resolve("Use terminal (Recommended)");
  await inTerminal.promise;
  finish.resolve(undefined);
  await Promise.resolve();
  expect(() =>
    request.updateDraft({
      identity: request.identity,
      action: { type: "edit-feedback", text: "Stale" },
    }),
  ).toThrow("no longer active");
  expect(f.runtime.active?.accepted).toBeUndefined();
  expect(f.runtime.active?.reviews?.at(-1)?.feedbackDraft).toBe("Terminal draft");
  back.resolve(undefined);
  expect((await pending).outcome).toBe("cancelled");
});
