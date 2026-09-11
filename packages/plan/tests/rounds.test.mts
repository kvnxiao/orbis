import { expect, test } from "vitest";

import { presentRound, transitionRound } from "../src/state.ts";
import type { QuestionInput, RoundState } from "../src/state.ts";
import { TerminalRound } from "../src/terminal.ts";
import { testEditor } from "./terminal-fixture.mts";

function question(id: string): QuestionInput {
  return {
    id,
    prerequisites: [],
    prompt: `Choose ${id}`,
    context: "Verified context",
    options: [
      { id: "local", label: "Local", explanation: "Works offline" },
      { id: "remote", label: "Remote", explanation: "Shares access" },
    ],
    recommendation: { optionId: "local", reason: "Offline access is required" },
  };
}
function round(questions = [question("storage"), question("scope")]): RoundState {
  return presentRound(
    { phase: "research", decisions: {} },
    { planId: "plan", roundId: "frontier", expectedRevision: 0, questions },
  );
}
function action(state: RoundState, input: Parameters<typeof transitionRound>[3]) {
  return transitionRound(state, "frontier", state.round?.revision ?? 0, input);
}

test("navigation and one answer never submit a round", () => {
  let state = round([question("storage")]);
  state = action(state, { type: "focus", questionId: "storage" });
  expect(state.decisions).toEqual({});
  state = action(state, { type: "answer", questionId: "storage", answer: { optionId: "local" } });
  expect(state.phase).toBe("round");
  expect(state.decisions).toEqual({});
  state = action(state, { type: "submit" });
  expect(state.decisions.storage?.answer).toEqual({ optionId: "local" });
});

test("reordering preserves identities and changed questions require selective reconfirmation", () => {
  let state = round();
  state = action(state, { type: "answer", questionId: "storage", answer: { optionId: "local" } });
  state = action(state, {
    type: "answer",
    questionId: "scope",
    answer: { custom: "Defer until next quarter" },
  });
  state = action(state, {
    type: "edit",
    questionId: "storage",
    unfinished: "Unfinished alternative",
  });
  const storage = question("storage");
  storage.options.reverse();
  state = presentRound(state, {
    planId: "plan",
    roundId: "frontier",
    expectedRevision: 1,
    questions: [question("scope"), storage],
  });
  expect(state.round?.drafts.storage?.revision).toBe(state.round?.questions[1]?.revision);
  expect(state.round?.drafts.storage?.answer).toEqual({ optionId: "local" });
  storage.context = "Changed constraint";
  state = presentRound(state, {
    planId: "plan",
    roundId: "frontier",
    expectedRevision: 2,
    questions: [question("scope"), storage],
  });
  expect(() => action(state, { type: "submit" })).toThrow("reconfirm storage");
  expect(state.round?.drafts.storage?.unfinished).toBe("Unfinished alternative");
  state = action(state, { type: "answer", questionId: "storage", answer: { optionId: "remote" } });
  expect(action(state, { type: "submit" }).decisions.scope?.answer).toEqual({
    custom: "Defer until next quarter",
  });
});

test("invalid answers and stale submissions preserve round state", () => {
  const state = round();
  const before = structuredClone(state);
  expect(() =>
    action(state, { type: "answer", questionId: "missing", answer: { optionId: "local" } }),
  ).toThrow("Unknown question");
  expect(() =>
    action(state, { type: "answer", questionId: "storage", answer: { optionId: "missing" } }),
  ).toThrow("Unknown option");
  expect(() =>
    action(state, { type: "answer", questionId: "storage", answer: { custom: " " } }),
  ).toThrow("contain text");
  expect(() => action(state, { type: "submit" })).toThrow("Answer or reconfirm");
  expect(() => transitionRound(state, "frontier", 0, { type: "submit" })).toThrow("Round changed");
  expect(state).toEqual(before);
});

test("JSON member order preserves unchanged question revisions and draft submission", () => {
  const original = question("storage");
  let state = round([original]);
  state = action(state, { type: "answer", questionId: "storage", answer: { optionId: "local" } });
  const reordered: QuestionInput = {
    recommendation: { reason: "Offline access is required", optionId: "local" },
    options: original.options.map((option) => ({
      explanation: option.explanation,
      label: option.label,
      id: option.id,
    })),
    context: original.context,
    prompt: original.prompt,
    prerequisites: original.prerequisites,
    id: original.id,
  };
  state = presentRound(state, {
    planId: "plan",
    roundId: "frontier",
    expectedRevision: 1,
    questions: [reordered],
  });
  expect(state.round?.questions[0]?.revision).toBe(1);
  expect(action(state, { type: "submit" }).decisions.storage?.answer).toEqual({
    optionId: "local",
  });
});

test("clarification retains unsubmitted drafts and resolves the same round", () => {
  let state = round();
  state = action(state, { type: "edit", questionId: "scope", unfinished: "Only the CLI" });
  state = action(state, {
    type: "clarify",
    questionId: "storage",
    id: "clarify-1",
    request: "Can remote storage work offline?",
  });
  expect(state.phase).toBe("clarification");
  expect(state.decisions).toEqual({});
  state = presentRound(state, {
    planId: "plan",
    roundId: "frontier",
    expectedRevision: 1,
    questions: [question("storage"), question("scope")],
    clarification: { id: "clarify-1", response: "The remote service requires connectivity." },
  });
  expect(state.round?.drafts.scope?.unfinished).toBe("Only the CLI");
  expect(state.round?.clarifications[0]?.response).toBe(
    "The remote service requires connectivity.",
  );
});

test("duplicate identities, unknown prerequisites and invalid recommendations are rejected", () => {
  expect(() => round([question("storage"), question("storage")])).toThrow("unique");
  const dependent = question("format");
  dependent.prerequisites = ["storage"];
  expect(() => round([dependent])).toThrow("unresolved prerequisite");
  const invalid = question("storage");
  invalid.recommendation = { optionId: "missing", reason: "Invalid" };
  expect(() => round([invalid])).toThrow("unknown option");
  expect(() => round([question("__proto__")])).toThrow("Invalid round");
});

test("terminal Tab wraps with unfinished text and submission requires review", () => {
  let state = round();
  let done = false;
  const component = new TerminalRound(
    () => state,
    (input) => {
      state = action(state, input);
    },
    () => {
      done = true;
    },
    () => undefined,
    testEditor(),
  );
  component.handleInput("\r");
  component.handleInput("unfinished");
  component.handleInput("\x1b");
  expect(state.round?.drafts.storage?.unfinished).toBe("unfinished");
  component.handleInput("\t");
  expect(state.round?.focus).toBe("scope");
  component.handleInput("\t");
  expect(state.round?.focus).toBe("storage");
  component.handleInput("\x1b[Z");
  expect(state.round?.focus).toBe("scope");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  component.handleInput("\t");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  expect(done).toBe(false);
  for (let i = 0; i < 7; i++) {
    component.handleInput("\x1b[B");
  }
  component.handleInput("\r");
  component.handleInput("\r");
  expect(done).toBe(true);
  expect(state.phase).toBe("research");
});

test("cancellation retains drafts without decisions", () => {
  const state = action(
    action(round(), { type: "edit", questionId: "scope", unfinished: "draft" }),
    { type: "cancel" },
  );
  expect(state.phase).toBe("cancelled");
  expect(state.round?.drafts.scope?.unfinished).toBe("draft");
  expect(state.decisions).toEqual({});
});

test("question numbers survive revisions and continue across frontiers", () => {
  let state = round();
  expect(state.round?.questions.map((item) => item.number)).toEqual([1, 2]);
  state = presentRound(state, {
    planId: "plan",
    roundId: "frontier",
    expectedRevision: 1,
    questions: [question("scope"), question("storage")],
  });
  expect(state.round?.questions.map((item) => item.number)).toEqual([2, 1]);
  for (const id of ["scope", "storage"]) {
    state = action(state, { type: "answer", questionId: id, answer: { optionId: "local" } });
  }
  state = action(state, { type: "submit" });
  state = presentRound(state, {
    planId: "plan",
    roundId: "next",
    expectedRevision: 0,
    questions: [question("new"), question("storage")],
  });
  expect(state.round?.questions.map((item) => item.number)).toEqual([3, 1]);
});

test("option confirmation selects details while abandoned edits survive without submission", () => {
  let state = round([question("storage")]);
  state = action(state, {
    type: "edit-option",
    questionId: "storage",
    optionId: "local",
    text: "Confirmed context",
  });
  state = action(state, { type: "confirm-option", questionId: "storage", optionId: "local" });
  state = action(state, {
    type: "edit-option",
    questionId: "storage",
    optionId: "local",
    text: "Unfinished change",
  });
  state = action(state, {
    type: "edit-option",
    questionId: "storage",
    optionId: "remote",
    text: "Private alternative",
  });
  state = action(state, { type: "answer", questionId: "storage", answer: { optionId: "local" } });
  const submitted = action(state, { type: "submit" });
  expect(submitted.decisions.storage?.answer).toEqual({
    optionId: "local",
    details: "Confirmed context",
  });
  expect(submitted.decisions.storage?.selectedOption?.label).toBe("Local");
  expect(submitted.round?.drafts.storage?.options?.remote?.unfinished).toBe("Private alternative");
  expect(() =>
    action(state, { type: "edit-option", questionId: "storage", optionId: "missing", text: "x" }),
  ).toThrow("Unknown option");
});
