import { expect, test } from "vitest";

import { documentBlocks } from "../src/document/blocks.ts";
import { presentReview, transitionReview } from "../src/domain/state.ts";

test("current annotation and overall text submit directly or approve as supplementary notes", () => {
  let state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Plan\n\nKeep the service.\n" },
  );
  const block = documentBlocks(state.reviews?.[0]?.markdown ?? "")[1];
  if (block === undefined) {
    throw new Error("Missing block");
  }
  state = transitionReview(state, 1, {
    type: "edit-note",
    blockId: block.id,
    excerpt: block.excerpt,
    text: "Auxiliary context",
  });
  state = transitionReview(state, 1, { type: "edit-feedback", text: "Overall context" });
  expect(() => transitionReview(state, 1, { type: "approve" })).toThrow(
    expect.objectContaining({ kind: "rejected" }),
  );
  const approved = transitionReview(state, 1, { type: "approve-with-notes" });
  expect(approved.phase).toBe("saving");
  expect(approved.reviews?.[0]?.markdown).toBe("# Plan\n\nKeep the service.\n");
  const submitted = transitionReview(state, 1, { type: "submit-feedback" });
  expect(submitted.reviews?.[0]?.feedback).toContain("Auxiliary context");
  expect(submitted.reviews?.[0]?.feedback).toContain("Overall context");
  const cleared = transitionReview(
    transitionReview(state, 1, {
      type: "edit-note",
      blockId: block.id,
      excerpt: block.excerpt,
      text: " ",
    }),
    1,
    { type: "edit-feedback", text: "" },
  );
  expect(transitionReview(cleared, 1, { type: "approve" }).phase).toBe("saving");
});
