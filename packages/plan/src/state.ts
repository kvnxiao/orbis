import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const identity = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^(?!__proto__$|prototype$|constructor$)[a-zA-Z0-9_-]+$",
});
const prose = Type.String({ minLength: 1, pattern: "\\S" });
export const questionSchema = Type.Object(
  {
    id: identity,
    prerequisites: Type.Array(identity, { uniqueItems: true }),
    context: prose,
    prompt: prose,
    options: Type.Array(
      Type.Object(
        { id: identity, label: prose, explanation: prose },
        { additionalProperties: false },
      ),
      { maxItems: 4 },
    ),
    recommendation: Type.Optional(
      Type.Object({ optionId: identity, reason: prose }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
export const roundSchema = Type.Object(
  {
    planId: identity,
    roundId: identity,
    expectedRevision: Type.Integer({ minimum: 0 }),
    questions: Type.Array(questionSchema, { minItems: 1 }),
    clarification: Type.Optional(
      Type.Object({ id: identity, response: prose }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
export type QuestionInput = Static<typeof questionSchema>;
export type RoundInput = Static<typeof roundSchema>;
export interface Question extends QuestionInput {
  revision: number;
}
export type Answer = { optionId: string; custom?: never } | { custom: string; optionId?: never };
export interface Draft {
  revision: number;
  unfinished: string;
  answer?: Answer;
}
export interface Clarification {
  id: string;
  questionId: string;
  request: string;
  response?: string;
}
export interface Round {
  id: string;
  revision: number;
  questions: Question[];
  drafts: Record<string, Draft>;
  focus: string;
  clarifications: Clarification[];
  submitted: boolean;
}
export interface Decision {
  questionId: string;
  questionRevision: number;
  question: Question;
  roundId: string;
  answer: Answer;
}
export interface RoundState {
  phase: "research" | "round" | "clarification" | "review" | "saving" | "accepted" | "cancelled";
  round?: Round;
  decisions: Record<string, Decision>;
  reviews?: PlanRevision[];
}
export interface PlanRevision {
  revision: number;
  markdown: string;
  status: "pending" | "feedback" | "approved";
  feedbackDraft: string;
  feedback?: string;
}
export type ReviewAction =
  | { type: "approve" }
  | { type: "feedback"; text: string }
  | { type: "edit-feedback"; text: string }
  | { type: "cancel" };
export const reviewSchema = Type.Object(
  { planId: identity, expectedRevision: Type.Integer({ minimum: 0 }), markdown: prose },
  { additionalProperties: false },
);
export type ReviewInput = Static<typeof reviewSchema>;
export type RoundAction =
  | { type: "focus"; questionId: string }
  | { type: "edit"; questionId: string; unfinished: string }
  | { type: "answer"; questionId: string; answer: Answer }
  | { type: "clarify"; questionId: string; request: string; id: string }
  | { type: "submit" }
  | { type: "cancel" };

export const roundStateSchema = Type.Object({
  phase: Type.Union([
    Type.Literal("research"),
    Type.Literal("round"),
    Type.Literal("clarification"),
    Type.Literal("review"),
    Type.Literal("saving"),
    Type.Literal("accepted"),
    Type.Literal("cancelled"),
  ]),
  reviews: Type.Optional(
    Type.Array(
      Type.Object({
        revision: Type.Integer({ minimum: 1 }),
        markdown: prose,
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("feedback"),
          Type.Literal("approved"),
        ]),
        feedbackDraft: Type.String(),
        feedback: Type.Optional(prose),
      }),
    ),
  ),
  decisions: Type.Record(
    Type.String(),
    Type.Object({
      questionId: identity,
      questionRevision: Type.Integer({ minimum: 1 }),
      question: Type.Object({
        ...questionSchema.properties,
        revision: Type.Integer({ minimum: 1 }),
      }),
      roundId: identity,
      answer: Type.Union([
        Type.Object({ optionId: identity }, { additionalProperties: false }),
        Type.Object({ custom: prose }, { additionalProperties: false }),
      ]),
    }),
  ),
  round: Type.Optional(
    Type.Object({
      id: identity,
      revision: Type.Integer({ minimum: 1 }),
      focus: identity,
      submitted: Type.Boolean(),
      questions: Type.Array(
        Type.Object({ ...questionSchema.properties, revision: Type.Integer({ minimum: 1 }) }),
        { minItems: 1 },
      ),
      drafts: Type.Record(
        Type.String(),
        Type.Object({
          revision: Type.Integer({ minimum: 1 }),
          unfinished: Type.String(),
          answer: Type.Optional(
            Type.Union([
              Type.Object({ optionId: identity }, { additionalProperties: false }),
              Type.Object({ custom: prose }, { additionalProperties: false }),
            ]),
          ),
        }),
      ),
      clarifications: Type.Array(
        Type.Object({
          id: identity,
          questionId: identity,
          request: prose,
          response: Type.Optional(prose),
        }),
      ),
    }),
  ),
});

export function presentReview(state: RoundState, input: ReviewInput): RoundState {
  if (state.phase === "cancelled") {
    throw new Error("Use /plan to explicitly resume cancelled planning before requesting review.");
  }
  if (!Value.Check(reviewSchema, input)) {
    throw new Error("Invalid review input. Supply exact Markdown and the current revision.");
  }
  if (state.phase === "accepted" || state.phase === "saving") {
    throw new Error("This plan cannot receive a new review.");
  }
  if (state.round !== undefined && !state.round.submitted) {
    throw new Error("Submit the unresolved round before reviewing a plan.");
  }
  const latest = state.reviews?.at(-1);
  if (input.expectedRevision !== (latest?.revision ?? 0)) {
    throw new Error("Plan revision changed. Reload before requesting review.");
  }
  return {
    ...state,
    phase: "review",
    reviews: [
      ...(state.reviews ?? []),
      {
        revision: (latest?.revision ?? 0) + 1,
        markdown: input.markdown,
        status: "pending",
        feedbackDraft: "",
      },
    ],
  };
}

export function transitionReview(
  state: RoundState,
  revision: number,
  action: ReviewAction,
): RoundState {
  const current = state.reviews?.at(-1);
  if (
    current === undefined ||
    current.revision !== revision ||
    state.phase !== "review" ||
    current.status !== "pending"
  ) {
    throw new Error("Plan review changed. Reload the current revision.");
  }
  if (action.type === "cancel") {
    return { ...state, phase: "cancelled" };
  }
  if (action.type === "approve") {
    return { ...state, phase: "saving" };
  }
  if (action.type === "feedback" && action.text.trim().length === 0) {
    throw new Error("Describe the requested changes before sending feedback.");
  }
  const updated: PlanRevision =
    action.type === "feedback"
      ? { ...current, status: "feedback", feedback: action.text }
      : { ...current, feedbackDraft: action.text };
  return {
    ...state,
    phase: action.type === "feedback" ? "research" : "review",
    reviews: [...(state.reviews?.slice(0, -1) ?? []), updated],
  };
}

export function transitionInteraction(
  state: RoundState,
  id: string,
  revision: number,
  action: RoundAction | ReviewAction,
): RoundState {
  if (
    action.type === "approve" ||
    action.type === "feedback" ||
    action.type === "edit-feedback" ||
    (action.type === "cancel" && state.phase === "review")
  ) {
    if (id !== "review") {
      throw new Error("This action requires the current plan review.");
    }
    return transitionReview(state, revision, action);
  }
  return transitionRound(state, id, revision, action);
}

function normalizeQuestion(item: QuestionInput) {
  return JSON.stringify({
    ...item,
    prerequisites: item.prerequisites.toSorted(),
    options: item.options.toSorted((a, b) => a.id.localeCompare(b.id)),
    revision: undefined,
  });
}

export function presentRound(state: RoundState, input: RoundInput): RoundState {
  if (state.phase === "accepted" || state.phase === "saving") {
    throw new Error("Start another plan explicitly before presenting more questions.");
  }
  if (!Value.Check(roundSchema, input)) {
    throw new Error("Invalid round input; correct the fields and retry.");
  }
  const previous = state.round;
  const same = previous?.id === input.roundId;
  if (input.expectedRevision !== (same ? previous.revision : 0)) {
    throw new Error("Round changed; reload its current revision.");
  }
  if (!same && previous !== undefined && !previous.submitted) {
    throw new Error("Resume or cancel the unfinished round before replacing it.");
  }
  const ids = new Set<string>();
  const drafts: Record<string, Draft> = {};
  const questions = input.questions.map((question) => {
    if (ids.has(question.id)) {
      throw new Error("Question identities must be unique.");
    }
    ids.add(question.id);
    if (question.prerequisites.some((id) => !Object.hasOwn(state.decisions, id))) {
      throw new Error(`Question ${question.id} has an unresolved prerequisite.`);
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== question.options.length) {
      throw new Error("Option identities must be unique within a question.");
    }
    if (
      question.options.length === 1 ||
      (question.options.length > 0 && question.recommendation === undefined)
    ) {
      throw new Error(
        "Offer meaningful alternatives with a recommendation and reason, or use free text.",
      );
    }
    if (question.recommendation !== undefined && !optionIds.has(question.recommendation.optionId)) {
      throw new Error("Recommendation references an unknown option.");
    }
    const old = same
      ? previous.questions.find((item) => item.id === question.id)
      : state.decisions[question.id]?.question;
    const unchanged = old !== undefined && normalizeQuestion(old) === normalizeQuestion(question);
    const revision = old === undefined ? 1 : old.revision + (unchanged ? 0 : 1);
    const draft = same ? previous.drafts[question.id] : undefined;
    drafts[question.id] = draft === undefined ? { revision, unfinished: "" } : { ...draft };
    return { ...question, revision };
  });
  const clarifications = same ? previous.clarifications.map((item) => ({ ...item })) : [];
  if (input.clarification !== undefined) {
    const response = input.clarification;
    const request = clarifications.find((item) => item.id === response.id);
    if (request === undefined || request.response !== undefined) {
      throw new Error("Clarification request is missing or already resolved.");
    }
    request.response = response.response;
  }
  const first = questions[0];
  if (first === undefined) {
    throw new Error("A round requires questions.");
  }
  return {
    ...state,
    phase: "round",
    round: {
      id: input.roundId,
      revision: (same ? previous.revision : 0) + 1,
      questions,
      drafts,
      focus: same && ids.has(previous.focus) ? previous.focus : first.id,
      clarifications,
      submitted: false,
    },
  };
}

export function transitionRound(
  state: RoundState,
  roundId: string,
  revision: number,
  action: RoundAction,
): RoundState {
  const current = state.round;
  if (current === undefined || current.id !== roundId || current.revision !== revision) {
    throw new Error("Round changed; reload its current revision.");
  }
  if (
    (state.phase !== "round" &&
      !(state.phase === "clarification" && ["focus", "edit", "answer"].includes(action.type))) ||
    current.submitted
  ) {
    throw new Error("This round is not accepting input.");
  }
  const round = structuredClone(current);
  const next = { ...state, round };
  if (action.type === "cancel") {
    return { ...next, phase: "cancelled" };
  }
  if (action.type === "submit") {
    const decisions = { ...state.decisions };
    for (const question of round.questions) {
      const draft = round.drafts[question.id];
      if (draft?.answer === undefined || draft.revision !== question.revision) {
        throw new Error(`Answer or reconfirm ${question.id} before submitting.`);
      }
      decisions[question.id] = {
        questionId: question.id,
        questionRevision: question.revision,
        question,
        roundId: round.id,
        answer: draft.answer,
      };
    }
    round.submitted = true;
    return { ...next, decisions, phase: "research" };
  }
  const question = round.questions.find((item) => item.id === action.questionId);
  const draft = round.drafts[action.questionId];
  if (question === undefined || draft === undefined) {
    throw new Error("Unknown question identity.");
  }
  if (action.type === "focus") {
    round.focus = question.id;
  }
  if (action.type === "edit") {
    draft.unfinished = action.unfinished;
  }
  if (action.type === "answer") {
    const answer = action.answer;
    if ((answer.optionId !== undefined) === (answer.custom !== undefined)) {
      throw new Error("Choose an option or provide custom text, exclusively.");
    }
    if (
      answer.optionId !== undefined &&
      !question.options.some((option) => option.id === answer.optionId)
    ) {
      throw new Error("Unknown option identity.");
    }
    if (answer.custom?.trim().length === 0) {
      throw new Error("Custom answers must contain text.");
    }
    draft.answer = answer;
    draft.revision = question.revision;
  }
  if (action.type === "clarify") {
    if (
      action.request.trim().length === 0 ||
      action.id.length === 0 ||
      round.clarifications.some((item) => item.id === action.id)
    ) {
      throw new Error("Provide a clarification request with a new identity.");
    }
    round.clarifications.push({ id: action.id, questionId: question.id, request: action.request });
    return { ...next, phase: "clarification" };
  }
  return next;
}
