import { Value } from "typebox/value";
import { expect, test } from "vitest";

import { presentRound, roundStateSchema, transitionRound } from "../src/domain/state.ts";
import type { QuestionInput, RoundState } from "../src/domain/state.ts";

const question: QuestionInput = {
  id: "scope",
  prerequisites: [],
  prompt: "Choose scope",
  context: "Known",
  options: [],
};
function initial(): RoundState {
  return presentRound(
    { phase: "research", decisions: {}, roundNumber: 0, questionNumbers: {} },
    { planId: "plan", roundId: "one", expectedRevision: 0, questions: [question] },
  );
}

test("withdrawal preserves drafts and permits explicit continuation without decisions", () => {
  let state = initial();
  state = transitionRound(state, "one", 1, {
    type: "answer",
    questionId: "scope",
    answer: { custom: "Keep me" },
  });
  const retired = presentRound(state, {
    planId: "plan",
    roundId: "one",
    expectedRevision: 1,
    questions: [],
    retire: [{ id: "scope", status: "withdrawn", reason: "Research resolved this" }],
  });
  expect(retired.round?.questions[0]).toMatchObject({
    number: 1,
    status: "withdrawn",
    prompt: "Choose scope",
  });
  expect(retired.round?.drafts.scope?.unfinished).toBe("Keep me");
  expect(() =>
    transitionRound(retired, "one", 2, {
      type: "answer",
      questionId: "scope",
      answer: { custom: "Wrong" },
    }),
  ).toThrow(expect.objectContaining({ kind: "rejected" }));
  const continued = transitionRound(retired, "one", 2, { type: "submit" });
  expect(continued.phase).toBe("research");
  expect(continued.decisions).toEqual({});
  expect(Value.Check(roundStateSchema, continued)).toBe(true);
});

test("reactivation retains question number and increments revision without accepting old drafts", () => {
  const retired = presentRound(initial(), {
    planId: "plan",
    roundId: "one",
    expectedRevision: 1,
    questions: [],
    retire: [{ id: "scope", status: "deferred", reason: "Wait for research" }],
  });
  const returned = presentRound(retired, {
    planId: "plan",
    roundId: "one",
    expectedRevision: 2,
    questions: [question],
  });
  expect(returned.round?.questions[0]).toMatchObject({ number: 1, revision: 3 });
  expect(() => transitionRound(returned, "one", 3, { type: "submit" })).toThrow(
    expect.objectContaining({ kind: "rejected" }),
  );
});

test("completed logical frontiers retain detached snapshots and sent question context", () => {
  let state = initial();
  state = transitionRound(state, "one", 1, {
    type: "clarify",
    questionId: "scope",
    id: "why",
    request: "Why?",
  });
  state = presentRound(state, {
    planId: "plan",
    roundId: "one",
    expectedRevision: 1,
    questions: [{ ...question, context: "New evidence" }],
    clarification: { id: "why", response: "Because" },
  });
  state = transitionRound(state, "one", 2, {
    type: "answer",
    questionId: "scope",
    answer: { custom: "Accepted" },
  });
  state = transitionRound(state, "one", 2, { type: "submit" });
  const next = presentRound(state, {
    planId: "plan",
    roundId: "two",
    expectedRevision: 0,
    questions: [{ ...question, id: "next" }],
  });
  expect(next.roundNumber).toBe(2);
  expect(next.history).toHaveLength(1);
  expect(next.history?.[0]?.round.clarifications[0]).toMatchObject({
    request: "Why?",
    response: "Because",
    question: { context: "Known" },
  });
  const old = state.round?.drafts.scope;
  if (old !== undefined) {
    old.unfinished = "Mutated";
  }
  expect(next.history?.[0]?.round.drafts.scope?.unfinished).toBe("Accepted");
  expect(Value.Check(roundStateSchema, next)).toBe(true);
});

test("updates cannot silently omit questions or skip a pending clarification response", () => {
  expect(() =>
    presentRound(initial(), { planId: "plan", roundId: "one", expectedRevision: 1, questions: [] }),
  ).toThrow(expect.objectContaining({ kind: "rejected" }));
  const waiting = transitionRound(initial(), "one", 1, {
    type: "clarify",
    questionId: "scope",
    id: "why",
    request: "Why?",
  });
  expect(() =>
    presentRound(waiting, {
      planId: "plan",
      roundId: "one",
      expectedRevision: 1,
      questions: [question],
    }),
  ).toThrow(expect.objectContaining({ kind: "rejected" }));
});

test("a deferred draft survives another logical frontier and requires reconfirmation", () => {
  let state = transitionRound(initial(), "one", 1, {
    type: "answer",
    questionId: "scope",
    answer: { custom: "Retained" },
  });
  state = presentRound(state, {
    planId: "plan",
    roundId: "one",
    expectedRevision: 1,
    questions: [],
    retire: [{ id: "scope", status: "deferred", reason: "Research pending" }],
  });
  state = transitionRound(state, "one", 2, { type: "submit" });
  state = presentRound(state, {
    planId: "plan",
    roundId: "two",
    expectedRevision: 0,
    questions: [{ ...question, id: "other" }],
  });
  state = transitionRound(state, "two", 1, {
    type: "answer",
    questionId: "other",
    answer: { custom: "Done" },
  });
  state = transitionRound(state, "two", 1, { type: "submit" });
  state = presentRound(state, {
    planId: "plan",
    roundId: "three",
    expectedRevision: 0,
    questions: [question],
  });
  expect(state.round?.questions[0]).toMatchObject({ number: 1, revision: 3 });
  expect(state.round?.drafts.scope?.unfinished).toBe("Retained");
  expect(() => transitionRound(state, "three", 1, { type: "submit" })).toThrow(
    expect.objectContaining({ kind: "rejected" }),
  );
});

test.each(["withdrawn", "deferred"] as const)(
  "reactivated %s questions restore drafts and sent context during a later frontier update",
  (status) => {
    let state = initial();
    state = transitionRound(state, "one", 1, {
      type: "answer",
      questionId: "scope",
      answer: { custom: "Retained draft" },
    });
    state = transitionRound(state, "one", 1, {
      type: "clarify",
      questionId: "scope",
      id: "original",
      request: "Original request",
    });
    state = presentRound(state, {
      planId: "plan",
      roundId: "one",
      expectedRevision: 1,
      questions: [],
      retire: [{ id: "scope", status, reason: "More research" }],
      clarification: { id: "original", response: "Original response" },
    });
    state = transitionRound(state, "one", 2, { type: "submit" });
    const other = { ...question, id: "other" };
    state = presentRound(state, {
      planId: "plan",
      roundId: "two",
      expectedRevision: 0,
      questions: [other],
    });
    state = transitionRound(state, "two", 1, {
      type: "clarify",
      questionId: "other",
      id: "reopen",
      request: "Reconsider scope",
    });
    state = presentRound(state, {
      planId: "plan",
      roundId: "two",
      expectedRevision: 1,
      questions: [other, question],
      clarification: { id: "reopen", response: "Scope is relevant again" },
    });
    expect(state.round?.drafts.scope?.unfinished).toBe("Retained draft");
    expect(state.round?.questions[1]).toMatchObject({ number: 1, revision: 3 });
    expect(state.round?.clarifications.find((entry) => entry.id === "original")).toMatchObject({
      request: "Original request",
      response: "Original response",
      question: { context: "Known" },
    });
    state = transitionRound(state, "two", 2, {
      type: "clarify",
      questionId: "scope",
      id: "followup",
      request: "Follow-up request",
    });
    expect(
      state.round?.clarifications.filter((entry) => entry.questionId === "scope"),
    ).toHaveLength(2);
  },
);

test("reused request IDs across questions retain both exchanges and resolve the pending request", () => {
  let state = transitionRound(initial(), "one", 1, {
    type: "clarify",
    questionId: "scope",
    id: "why",
    request: "Original",
  });
  state = presentRound(state, {
    planId: "plan",
    roundId: "one",
    expectedRevision: 1,
    questions: [],
    retire: [{ id: "scope", status: "deferred", reason: "Wait" }],
    clarification: { id: "why", response: "Original response" },
  });
  state = transitionRound(state, "one", 2, { type: "submit" });
  const other = { ...question, id: "other" };
  state = presentRound(state, {
    planId: "plan",
    roundId: "two",
    expectedRevision: 0,
    questions: [other],
  });
  state = transitionRound(state, "two", 1, {
    type: "clarify",
    questionId: "other",
    id: "why",
    request: "New request",
  });
  state = presentRound(state, {
    planId: "plan",
    roundId: "two",
    expectedRevision: 1,
    questions: [other, question],
    clarification: { id: "why", response: "New response" },
  });
  expect(
    state.round?.clarifications.map(({ questionId, response }) => ({ questionId, response })),
  ).toEqual([
    { questionId: "scope", response: "Original response" },
    { questionId: "other", response: "New response" },
  ]);
});
