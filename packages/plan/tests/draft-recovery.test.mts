import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { documentBlocks } from "../src/blocks.ts";
import { presentReview, presentRound, transitionReview, transitionRound } from "../src/state.ts";
import type { PlanningSession } from "../src/state.ts";
import { toolResult } from "../src/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("disk recovery preserves question numbers and separate confirmed and unfinished option text", async () => {
  const f = await runtimeFixture();
  try {
    f.runtime.start(f.ctx, "Recover drafts");
    const plan = f.runtime.active;
    if (plan === undefined) {
      throw new Error("No plan");
    }
    let state = presentRound(plan, {
      planId: plan.planId,
      roundId: "round",
      expectedRevision: 0,
      questions: [
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
      ],
    });
    state = transitionRound(state, "round", 1, {
      type: "edit-option",
      questionId: "scope",
      optionId: "local",
      text: "Confirmed",
    });
    state = transitionRound(state, "round", 1, {
      type: "confirm-option",
      questionId: "scope",
      optionId: "local",
    });
    state = transitionRound(state, "round", 1, {
      type: "edit-option",
      questionId: "scope",
      optionId: "local",
      text: "Unfinished",
    });
    state = transitionRound(state, "round", 1, {
      type: "edit-clarification",
      questionId: "scope",
      text: "Ask later",
    });
    expect(f.persist({ ...plan, ...state }).saved).toBe(true);
    f.runtime.restore(f.ctx);
    expect(f.runtime.active?.round?.questions[0]?.number).toBe(1);
    expect(f.runtime.active?.round?.drafts.scope).toMatchObject({
      answer: { optionId: "local", details: "Confirmed" },
      options: { local: { confirmed: "Confirmed", unfinished: "Unfinished" } },
      clarificationDraft: "Ask later",
    });
  } finally {
    await f.dispose();
  }
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
    state = transitionReview(state, 1, { type: "confirm-note", blockId: block.id });
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
          options: [],
        },
      ],
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
  },
);
