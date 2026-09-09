import { expect, test } from "vitest";

import { presentReview, transitionReview } from "../src/state.ts";

test("feedback requires another exact revision and stale approval preserves current Markdown", () => {
  let state = presentReview(
    { phase: "research", decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Objective\n\nFirst revision.\n" },
  );
  state = transitionReview(state, 1, { type: "feedback", text: "Include verification." });
  expect(state.phase).toBe("research");
  expect(state.reviews?.at(-1)?.feedback).toBe("Include verification.");
  const revised = "# Objective\r\n\r\nSecond revision.\r\n\r\n## Verification\r\nRun tests.\r\n";
  state = presentReview(state, { planId: "plan", expectedRevision: 1, markdown: revised });
  expect(() => transitionReview(state, 1, { type: "approve" })).toThrow("Plan review changed");
  expect(state.reviews?.at(-1)?.markdown).toBe(revised);
  expect(transitionReview(state, 2, { type: "approve" }).phase).toBe("saving");
});

test("blank feedback and cancellation do not approve the plan", () => {
  const state = presentReview(
    { phase: "research", decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Plan" },
  );
  expect(() => transitionReview(state, 1, { type: "feedback", text: " " })).toThrow(
    "Describe the requested changes",
  );
  const draft = transitionReview(state, 1, { type: "edit-feedback", text: "Unfinished feedback" });
  const cancelled = transitionReview(draft, 1, { type: "cancel" });
  expect(cancelled.reviews?.at(-1)?.feedbackDraft).toBe("Unfinished feedback");
  expect(cancelled.reviews?.at(-1)?.status).toBe("pending");
  expect(cancelled.phase).toBe("cancelled");
  expect(() =>
    presentReview(cancelled, { planId: "plan", expectedRevision: 1, markdown: "Replacement" }),
  ).toThrow("resume");
});
