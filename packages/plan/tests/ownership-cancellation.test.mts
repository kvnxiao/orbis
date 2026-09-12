import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import { presentRound, transitionRound } from "../src/domain/state.ts";
import type { RoundState } from "../src/domain/state.ts";
import { showPlanSettings } from "../src/pi/settings-menu.ts";
import * as terminal from "../src/pi/terminal.ts";
import * as config from "../src/storage/config.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test.for(["entry", "approval"] as const)(
  "cancellation during %s settings preparation restores Default mode and durable drafts",
  async (stage, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    f.runtime.start(f.ctx, "Preparation cancellation");
    const planId = f.runtime.active?.planId ?? "";
    const settings = await config.readSettings(join(f.ctx.cwd, "agent"), f.ctx.cwd, false);
    const pending = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const read = vi.spyOn(config, "readSettings");
    if (stage === "approval") {
      read.mockResolvedValueOnce(settings);
      vi.spyOn(terminal, "terminalReview").mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "approve" });
        await Promise.resolve();
      });
    }
    read.mockImplementationOnce(async () => {
      started.resolve(undefined);
      await pending.promise;
      return settings;
    });
    const controller = new AbortController();
    const outcome = f.runtime.review(
      f.ctx,
      { planId, expectedRevision: 0, markdown: "# Exact plan" },
      controller.signal,
    );
    await started.promise;
    controller.abort();
    pending.resolve(undefined);
    expect((await outcome).outcome).toBe("cancelled");
    expect(f.runtime.mode).toBe("default");
    expect(f.runtime.active?.accepted).toBeUndefined();
    expect(f.runtime.active?.phase).toBe("cancelled");
    f.runtime.restore(f.ctx);
    expect(f.runtime.mode).toBe("default");
    expect(f.runtime.active?.reviews?.[0]?.markdown).toBe("# Exact plan");
    expect(f.runtime.active?.phase).toBe("cancelled");
  },
);

test.for(["round", "review"] as const)(
  "pre-aborted %s preserves state and session bytes",
  async (operation, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    f.runtime.start(f.ctx, "Cancellation");
    const before = structuredClone(f.runtime.active);
    const path = f.manager.getSessionFile();
    if (path === undefined) {
      throw new Error("Missing session file");
    }
    const bytes = await readFile(path);
    const planId = before?.planId ?? "";
    const result =
      operation === "review"
        ? await f.runtime.review(
            f.ctx,
            { planId, expectedRevision: 0, markdown: "# Plan" },
            AbortSignal.abort(),
          )
        : await f.runtime.round(
            f.ctx,
            {
              planId,
              roundId: "round",
              expectedRevision: 0,
              questions: [
                { id: "scope", context: "Known", prompt: "Scope?", prerequisites: [], options: [] },
              ],
            },
            AbortSignal.abort(),
          );
    expect(f.runtime.active).toEqual(before);
    expect(await readFile(path)).toEqual(bytes);
    expect(result.outcome).toBe("cancelled");
  },
);

test("pre-aborted settings does not open scope selection", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const select = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
  await showPlanSettings(
    { ...f.ctx, signal: AbortSignal.abort(), ui: { ...f.ctx.ui, select } },
    join(f.ctx.cwd, "agent"),
  );
  expect(select).not.toHaveBeenCalled();
});

test("runtime snapshots and start results do not expose owned state", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const result = f.runtime.start(f.ctx, "Ownership");
  const active = f.runtime.active;
  if (active === undefined || result.outcome !== "started") {
    throw new Error("Missing plan");
  }
  active.questionNumbers.external = 10;
  result.plan.questionNumbers.result = 20;
  expect(f.runtime.active?.questionNumbers).toEqual({});
});

test("round inputs and answer objects remain caller-owned", () => {
  const state: RoundState = {
    phase: "research",
    roundNumber: 0,
    decisions: {},
    questionNumbers: {},
  };
  const question = {
    id: "scope",
    context: "Known",
    prompt: "Scope?",
    prerequisites: [],
    options: [
      { id: "small", label: "Small", explanation: "Focused" },
      { id: "large", label: "Large", explanation: "Complete" },
    ],
    recommendation: { optionId: "small", reason: "Focused" },
  };
  const round = presentRound(state, {
    planId: "plan",
    roundId: "round",
    expectedRevision: 0,
    questions: [question],
  });
  const option = question.options[0];
  if (option === undefined) {
    throw new Error("Missing option");
  }
  option.label = "External";
  expect(round.round?.questions[0]?.options[0]?.label).toBe("Small");
  const answer = { custom: "Original" };
  const answered = transitionRound(round, "round", 1, {
    type: "answer",
    questionId: "scope",
    answer,
  });
  answer.custom = "External";
  expect(answered.round?.drafts.scope?.answer).toEqual({ custom: "Original" });
  expect(round.round?.drafts.scope?.answer).toBeUndefined();
});
