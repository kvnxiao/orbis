import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { documentBlocks } from "../src/document/blocks.ts";
import {
  presentReview,
  presentRound,
  transitionReview,
  transitionRound,
} from "../src/domain/state.ts";
import type { PlanningSession } from "../src/domain/state.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("branch restoration preserves the selected composer mode before an objective exists", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.toggleMode(f.ctx);
  const planBranch = f.manager.getLeafId();
  f.runtime.toggleMode(f.ctx);
  const defaultBranch = f.manager.getLeafId();
  if (planBranch === null || defaultBranch === null) {
    throw new Error("Missing saved mode branches");
  }
  f.manager.branch(planBranch);
  f.runtime.restore(f.ctx);
  expect(f.runtime.mode).toBe("plan");
  expect(f.runtime.active).toBeUndefined();
  f.manager.branch(defaultBranch);
  f.runtime.restore(f.ctx);
  expect(f.runtime.mode).toBe("default");
});

test("clarification resumes with saved round counts and drafts", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Round recovery");
  const plan = f.runtime.active;
  if (plan === undefined) {
    throw new Error("Missing plan");
  }
  const questions = [
    {
      id: "scope",
      prompt: "Scope?",
      context: "Known",
      prerequisites: [],
      options: [
        { id: "local", label: "Local", explanation: "Offline" },
        { id: "remote", label: "Remote", explanation: "Shared" },
      ],
      recommendation: { optionId: "local", reason: "Offline" },
    },
  ];
  let state = presentRound(plan, {
    planId: plan.planId,
    roundId: "first",
    expectedRevision: 0,
    questions,
  });
  f.persist({ ...plan, ...state });
  state = transitionRound(state, "first", 1, {
    type: "answer",
    questionId: "scope",
    answer: { custom: "Small" },
  });
  state = transitionRound(state, "first", 1, { type: "submit" });
  state = presentRound(state, {
    planId: plan.planId,
    roundId: "second",
    expectedRevision: 0,
    questions,
  });
  state = transitionRound(state, "second", 1, {
    type: "edit",
    questionId: "scope",
    unfinished: "Keep this draft",
  });
  state = transitionRound(state, "second", 1, {
    type: "edit-option",
    questionId: "scope",
    optionId: "local",
    text: "Keep option notes",
  });
  state = transitionRound(state, "second", 1, {
    type: "answer",
    questionId: "scope",
    answer: { optionId: "local" },
  });
  state = transitionRound(state, "second", 1, {
    type: "clarify",
    questionId: "scope",
    id: "why",
    request: "What is included?",
  });
  f.persist({ ...plan, ...state });
  const secondBranch = f.manager.getLeafId();
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.roundNumber).toBe(2);
  f.runtime.pause(f.ctx);
  f.runtime.restore(f.ctx);
  const resumed = await f.runtime.requestStart(f.ctx, "Continue planning", false);
  expect(resumed.outcome).toBe("clarification");
  expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("Keep this draft");
  expect(f.runtime.active?.round?.drafts.scope?.options).toEqual({ local: "Keep option notes" });
  expect(f.runtime.active?.round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Keep option notes",
  });
  expect(f.runtime.active?.round?.clarifications[0]?.request).toBe("What is included?");
  expect(f.runtime.active?.roundNumber).toBe(2);
  expect(f.runtime.mode).toBe("plan");
  if (secondBranch === null) {
    throw new Error("Missing saved branch");
  }
  f.manager.branch(secondBranch);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.roundNumber).toBe(2);
});

test("review recovery preserves note anchors and unfinished edits without saving modified Markdown", async () => {
  const f = await runtimeFixture();
  try {
    f.runtime.start(f.ctx, "Recover review");
    const plan = f.runtime.active;
    if (plan === undefined) {
      throw new Error("No plan");
    }
    const markdown = "# Exact\r\n\r\nRepeated.\r\n\r\nRepeated.\r\n";
    const block = documentBlocks(markdown)[2];
    if (block === undefined) {
      throw new Error("No block");
    }
    let state = presentReview(plan, { planId: plan.planId, expectedRevision: 0, markdown });
    state = transitionReview(state, 1, {
      type: "edit-note",
      blockId: block.id,
      excerpt: block.excerpt,
      text: "Confirmed note",
    });
    state = transitionReview(state, 1, {
      type: "edit-note",
      blockId: block.id,
      excerpt: block.excerpt,
      text: "Unfinished note",
    });
    state = transitionReview(state, 1, { type: "edit-feedback", text: "Unfinished overall" });
    expect(f.persist({ ...plan, ...state }).saved).toBe(true);
    f.runtime.restore(f.ctx);
    expect(f.runtime.active?.reviews).toEqual(state.reviews);
    expect(f.runtime.active?.reviews?.[0]?.markdown).toBe(markdown);
  } finally {
    await f.dispose();
  }
});

test.each([false, true])(
  "entry and clarification output exclude private drafts before truncation: %s",
  async (oversized) => {
    const plan: PlanningSession = {
      planId: "plan",
      sessionId: "session",
      branchId: null,
      cwd: "/fixture",
      objective: "Test",
      phase: "research",
      roundNumber: 0,
      questionNumbers: {},
      decisions: {},
    };
    let state = presentRound(plan, {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: [
        {
          id: "scope",
          prompt: "Scope?",
          context: oversized ? "Context\n".repeat(10000) : "Known",
          prerequisites: [],
          options: [
            { id: "local", label: "Local", explanation: "Offline" },
            { id: "remote", label: "Remote", explanation: "Shared" },
          ],
          recommendation: { optionId: "local", reason: "Offline first" },
        },
      ],
    });
    state = transitionRound(state, "round", 1, {
      type: "edit-option",
      questionId: "scope",
      optionId: "remote",
      text: "PRIVATE-OPTION-NOTE",
    });
    state = transitionRound(state, "round", 1, {
      type: "answer",
      questionId: "scope",
      answer: { custom: "Confirmed user response" },
    });
    state = transitionRound(state, "round", 1, {
      type: "edit",
      questionId: "scope",
      unfinished: "PRIVATE-UNFINISHED",
    });
    state = transitionRound(state, "round", 1, {
      type: "edit-clarification",
      questionId: "scope",
      text: "PRIVATE-CLARIFY",
    });
    const round = state.round;
    if (round === undefined) {
      throw new Error("Missing round");
    }
    const results = await Promise.all([
      toolResult({ outcome: "active", plan: { ...plan, ...state } }),
      toolResult({ outcome: "clarification", round, draftsSubmitted: false }),
    ]);
    await Promise.all(
      results.map(async (result) => {
        const details = result.details;
        const serialized =
          "truncated" in details
            ? await readFile(details.resultPath, "utf8")
            : JSON.stringify(result);
        expect(serialized).not.toContain("PRIVATE-");
        expect(serialized).toContain("Confirmed user response");
        expect("truncated" in details).toBe(oversized);
      }),
    );
    expect(round.drafts.scope?.unfinished).toBe("PRIVATE-UNFINISHED");
    expect(round.drafts.scope?.options).toEqual({ remote: "PRIVATE-OPTION-NOTE" });
  },
);
