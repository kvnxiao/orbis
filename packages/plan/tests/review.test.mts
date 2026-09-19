import { expect, test } from "vitest";

import { documentBlocks } from "../src/document/blocks.ts";
import { presentReview, transitionReview } from "../src/domain/state.ts";

test("feedback requires another exact revision and stale approval preserves current Markdown", () => {
  let state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Objective\n\nFirst revision.\n" },
  );
  state = transitionReview(state, 1, { type: "feedback", text: "Include verification." });
  expect(state.phase).toBe("research");
  expect(state.reviews?.at(-1)?.feedback).toBe("Include verification.");
  const revised = "# Objective\r\n\r\nSecond revision.\r\n\r\n## Verification\r\nRun tests.\r\n";
  state = presentReview(state, { planId: "plan", expectedRevision: 1, markdown: revised });
  expect(() => transitionReview(state, 1, { type: "approve" })).toThrow(
    expect.objectContaining({ kind: "revision-conflict", data: { expected: 1, current: 2 } }),
  );
  expect(state.reviews?.at(-1)?.markdown).toBe(revised);
  expect(transitionReview(state, 2, { type: "approve" }).phase).toBe("saving");
});

test("annotation validation rejects stale or malformed targets and includes current overall notes", () => {
  let state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "Same.\n\nSame.\n" },
  );
  const block = documentBlocks("Same.\n\nSame.\n")[1];
  if (block === undefined) {
    throw new Error("Missing fixture block");
  }
  expect(() =>
    transitionReview(state, 1, {
      type: "edit-note",
      blockId: block.id,
      excerpt: "Wrong",
      text: "note",
    }),
  ).toThrow(expect.objectContaining({ kind: "rejected" }));
  state = transitionReview(state, 1, {
    type: "edit-note",
    blockId: block.id,
    excerpt: block.excerpt,
    text: " ",
  });
  expect(transitionReview(state, 1, { type: "approve" }).phase).toBe("saving");
  state = transitionReview(state, 1, {
    type: "edit-note",
    blockId: block.id,
    excerpt: block.excerpt,
    text: "Clarify second occurrence",
  });
  state = transitionReview(state, 1, { type: "edit-feedback", text: "Private unfinished overall" });
  expect(() => transitionReview(state, 1, { type: "approve" })).toThrow(
    expect.objectContaining({ kind: "rejected" }),
  );
  const submitted = transitionReview(state, 1, { type: "submit-feedback" });
  expect(submitted.reviews?.[0]?.feedback).toContain(`block ${block.id}`);
  expect(submitted.reviews?.[0]?.feedback).toContain("Private unfinished");
  const next = presentReview(submitted, {
    planId: "plan",
    expectedRevision: 1,
    markdown: "Changed",
  });
  expect(next.reviews?.at(-1)?.notes).toBeUndefined();
  expect(() => transitionReview(next, 1, { type: "approve-with-notes" })).toThrow(
    expect.objectContaining({ kind: "revision-conflict", data: { expected: 1, current: 2 } }),
  );
  expect(transitionReview(next, 2, { type: "approve" }).phase).toBe("saving");
});

test("overall feedback submits the latest text", () => {
  let state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "Plan" },
  );
  state = transitionReview(state, 1, { type: "edit-feedback", text: "Confirmed overall" });
  state = transitionReview(state, 1, { type: "edit-feedback", text: "Unfinished replacement" });
  const submitted = transitionReview(state, 1, { type: "submit-feedback" });
  expect(submitted.reviews?.[0]?.feedback).toBe("Unfinished replacement");
});

test("blank feedback and cancellation do not approve the plan", () => {
  const state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Plan" },
  );
  expect(() => transitionReview(state, 1, { type: "feedback", text: " " })).toThrow(
    expect.objectContaining({ kind: "rejected" }),
  );
  const draft = transitionReview(state, 1, { type: "edit-feedback", text: "Unfinished feedback" });
  const cancelled = transitionReview(draft, 1, { type: "cancel" });
  expect(cancelled.reviews?.at(-1)?.feedbackDraft).toBe("Unfinished feedback");
  expect(cancelled.reviews?.at(-1)?.status).toBe("pending");
  expect(cancelled.phase).toBe("cancelled");
  expect(() =>
    presentReview(cancelled, { planId: "plan", expectedRevision: 1, markdown: "Replacement" }),
  ).toThrow(expect.objectContaining({ kind: "rejected" }));
});
