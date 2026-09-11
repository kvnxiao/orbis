import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { documentBlocks } from "./blocks.ts";

const identity = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^(?!__proto__$|prototype$|constructor$)[a-zA-Z0-9_-]+$",
});
const prose = Type.String({ minLength: 1, pattern: "\\S" });
const questionSchema = Type.Object(
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
      {
        maxItems: 4,
        description:
          "Use 2–4 distinct options and supply recommendation, or use [] for free text and omit recommendation. Never supply exactly one option. The UI adds Other and Ask for clarification automatically.",
      },
    ),
    recommendation: Type.Optional(
      Type.Object(
        { optionId: identity, reason: prose },
        {
          additionalProperties: false,
          description:
            "When options is nonempty, this field is required. Set optionId to one of this question's options[].id values and provide a nonblank reason. When options is [], omit this field entirely.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);
const storedQuestionSchema = Type.Object({
  ...questionSchema.properties,
  revision: Type.Integer({ minimum: 1 }),
  number: Type.Integer({ minimum: 1 }),
  status: Type.Optional(Type.Union([Type.Literal("withdrawn"), Type.Literal("deferred")])),
  reason: Type.Optional(prose),
});

export const roundSchema = Type.Object(
  {
    planId: identity,
    roundId: identity,
    expectedRevision: Type.Integer({ minimum: 0 }),
    questions: Type.Array(questionSchema),
    retire: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: identity,
            status: Type.Union([Type.Literal("withdrawn"), Type.Literal("deferred")]),
            reason: prose,
          },
          { additionalProperties: false },
        ),
      ),
    ),
    clarification: Type.Optional(
      Type.Object({ id: identity, response: prose }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
export type QuestionInput = Static<typeof questionSchema>;
export type RoundInput = Static<typeof roundSchema>;
/** Preserve one logical decision's display number across content revisions. */
export type Question = Static<typeof storedQuestionSchema>;
type Answer =
  | { optionId: string; details?: string; custom?: never }
  | { custom: string; optionId?: never };
export interface Draft {
  revision: number;
  unfinished: string;
  answer?: Answer;
  options?: Record<string, string>;
  clarificationDraft?: string;
}
const clarificationSchema = Type.Object({
  id: identity,
  questionId: identity,
  request: prose,
  response: Type.Optional(prose),
  question: Type.Optional(storedQuestionSchema),
});
type Clarification = Static<typeof clarificationSchema>;
export interface Round {
  id: string;
  revision: number;
  questions: Question[];
  drafts: Record<string, Draft>;
  focus: string;
  clarifications: Clarification[];
  submitted: boolean;
}
interface Decision {
  questionId: string;
  questionRevision: number;
  question: Question;
  roundId: string;
  answer: Answer;
  selectedOption?: QuestionInput["options"][number];
}
export interface RoundState {
  roundNumber: number;
  phase: "research" | "round" | "clarification" | "review" | "saving" | "accepted" | "cancelled";
  round?: Round;
  decisions: Record<string, Decision>;
  reviews?: PlanRevision[];
  questionNumbers: Record<string, number>;
  history?: { number: number; round: Round }[];
}
const noteSchema = Type.Object(
  {
    blockId: Type.String(),
    excerpt: Type.String(),
    revision: Type.Integer({ minimum: 1 }),
    text: Type.String(),
  },
  { additionalProperties: false },
);
const planRevisionSchema = Type.Object({
  revision: Type.Integer({ minimum: 1 }),
  markdown: prose,
  path: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("feedback"),
    Type.Literal("approved"),
    Type.Literal("superseded"),
  ]),
  feedbackDraft: Type.String(),
  feedback: Type.Optional(prose),
  notes: Type.Optional(Type.Array(noteSchema)),
});
export type PlanRevision = Static<typeof planRevisionSchema>;

const approvedNotesSchema = Type.Object({ overall: Type.String(), blocks: Type.Array(noteSchema) });
/** Describe immutable artifacts bound to one explicit approval. */
export const approvalSchema = Type.Object({
  version: Type.Literal(1),
  planId: Type.String(),
  revision: Type.Integer({ minimum: 1 }),
  sessionId: Type.String(),
  cwd: Type.String(),
  planPath: Type.String(),
  planContent: Type.String(),
  approvedAt: Type.String(),
  notes: Type.Optional(approvedNotesSchema),
  notesPath: Type.Optional(Type.String()),
  notesContent: Type.Optional(Type.String()),
});
export type PlanApproval = Static<typeof approvalSchema>;

export interface PlanningSession extends RoundState {
  planId: string;
  sessionId: string;
  branchId: string | null;
  cwd: string;
  objective: string;
  accepted?: PlanApproval;
  pendingApproval?: PlanApproval;
}
export type RuntimeResult =
  | { outcome: "error"; message: string }
  | { outcome: "unsupported-mode"; message: string }
  | { outcome: "started" | "active"; plan: PlanningSession }
  | { outcome: "cancelled"; planId?: string }
  | { outcome: "approval"; message: string; approval: PlanApproval }
  | { outcome: "feedback"; revision: number; feedback: string }
  | {
      outcome: "answers";
      roundId: string;
      revision: number;
      decisions: RoundState["decisions"];
      clarifications?: Clarification[];
    }
  | { outcome: "clarification"; round: NonNullable<RoundState["round"]>; draftsSubmitted: false };

export type ReviewAction =
  | { type: "approve" }
  | { type: "approve-with-notes" }
  | { type: "edit-note"; blockId: string; excerpt: string; text: string }
  | { type: "remove-note"; blockId: string }
  | { type: "submit-feedback" }
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
  | { type: "edit-option"; questionId: string; optionId: string; text: string }
  | { type: "edit-clarification"; questionId: string; text: string }
  | { type: "clear-answer"; questionId: string }
  | {
      type: "answer";
      questionId: string;
      answer: { optionId: string; custom?: never } | { custom: string; optionId?: never };
    }
  | { type: "clarify"; questionId: string; request: string; id: string }
  | { type: "submit" }
  | { type: "cancel" };

const storedAnswerSchema = Type.Union([
  Type.Object(
    { optionId: identity, details: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  Type.Object({ custom: prose }, { additionalProperties: false }),
]);

const storedRoundSchema = Type.Object({
  id: identity,
  revision: Type.Integer({ minimum: 1 }),
  focus: identity,
  submitted: Type.Boolean(),
  questions: Type.Array(storedQuestionSchema, { minItems: 1 }),
  drafts: Type.Record(
    Type.String(),
    Type.Object({
      revision: Type.Integer({ minimum: 1 }),
      unfinished: Type.String(),
      answer: Type.Optional(storedAnswerSchema),
      options: Type.Optional(Type.Record(identity, Type.String())),
      clarificationDraft: Type.Optional(Type.String()),
    }),
  ),
  clarifications: Type.Array(clarificationSchema),
});

export const roundStateSchema = Type.Object({
  roundNumber: Type.Integer({ minimum: 0 }),
  questionNumbers: Type.Record(identity, Type.Integer({ minimum: 1 })),
  phase: Type.Union([
    Type.Literal("research"),
    Type.Literal("round"),
    Type.Literal("clarification"),
    Type.Literal("review"),
    Type.Literal("saving"),
    Type.Literal("accepted"),
    Type.Literal("cancelled"),
  ]),
  reviews: Type.Optional(Type.Array(planRevisionSchema)),
  decisions: Type.Record(
    Type.String(),
    Type.Object({
      questionId: identity,
      questionRevision: Type.Integer({ minimum: 1 }),
      question: storedQuestionSchema,
      roundId: identity,
      answer: storedAnswerSchema,
      selectedOption: Type.Optional(questionSchema.properties.options.items),
    }),
  ),
  round: Type.Optional(storedRoundSchema),
  history: Type.Optional(
    Type.Array(Type.Object({ number: Type.Integer({ minimum: 1 }), round: storedRoundSchema })),
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
  if (action.type === "approve" && hasReviewNotes(current)) {
    throw new Error("Choose Approve with notes or Request revision for these notes.");
  }
  if (action.type === "approve-with-notes" && !hasReviewNotes(current)) {
    throw new Error("Use Approve when the review has no notes.");
  }
  if (action.type === "approve" || action.type === "approve-with-notes") {
    return { ...state, phase: "saving" };
  }
  if (action.type === "submit-feedback") {
    return transitionReview(state, revision, { type: "feedback", text: reviewFeedback(current) });
  }
  if (action.type === "feedback" || action.type === "edit-feedback") {
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
  const review = structuredClone(current);
  if (action.type === "edit-note") {
    const block = documentBlocks(current.markdown).find((item) => item.id === action.blockId);
    if (block === undefined || block.excerpt !== action.excerpt) {
      throw new Error("Unknown source block or changed excerpt.");
    }
    review.notes ??= [];
    const note = review.notes.find((item) => item.blockId === block.id);
    if (note === undefined) {
      review.notes.push({
        blockId: block.id,
        excerpt: block.excerpt,
        revision,
        text: action.text,
      });
    } else {
      note.text = action.text;
    }
  }
  if (action.type === "remove-note") {
    if (review.notes?.some((note) => note.blockId === action.blockId) !== true) {
      throw new Error("Unknown annotation.");
    }
    review.notes = review.notes.filter((note) => note.blockId !== action.blockId);
  }
  return { ...state, reviews: [...(state.reviews?.slice(0, -1) ?? []), review] };
}

export function transitionInteraction(
  state: RoundState,
  id: string,
  revision: number,
  action: RoundAction | ReviewAction,
): RoundState {
  if (
    action.type === "approve-with-notes" ||
    action.type === "edit-note" ||
    action.type === "remove-note" ||
    action.type === "submit-feedback" ||
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
    id: item.id,
    prerequisites: item.prerequisites.toSorted(),
    context: item.context,
    prompt: item.prompt,
    options: item.options
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((option) => ({
        id: option.id,
        label: option.label,
        explanation: option.explanation,
      })),
    recommendation:
      item.recommendation === undefined
        ? undefined
        : {
            optionId: item.recommendation.optionId,
            reason: item.recommendation.reason,
          },
  });
}

export function presentRound(state: RoundState, input: RoundInput): RoundState {
  if (state.phase === "cancelled") {
    throw new Error(
      "Use /plan to explicitly resume unfinished work before changing its questions.",
    );
  }
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
  if (!same && (state.history ?? []).some((entry) => entry.round.id === input.roundId)) {
    throw new Error("Use a new round identity; historical frontiers are read-only.");
  }
  const pending = same
    ? previous.clarifications.find((item) => item.response === undefined)
    : undefined;
  if (pending !== undefined && input.clarification?.id !== pending.id) {
    throw new Error("Resolve the pending clarification when updating its frontier.");
  }
  const ids = new Set<string>();
  const questionNumbers = { ...state.questionNumbers };
  const drafts: Record<string, Draft> = {};
  const questions: Question[] = input.questions.map((question) => {
    if (ids.has(question.id)) {
      throw new Error("Question identities must be unique.");
    }
    ids.add(question.id);
    const unresolved = question.prerequisites.filter((id) => !Object.hasOwn(state.decisions, id));
    if (unresolved.length > 0) {
      throw new Error(
        `Question ${question.id} has unresolved prerequisite IDs: ${unresolved.join(", ")}. Prerequisites must reference submitted decisions. Defer this question until those decisions are submitted; preserve their question IDs.`,
      );
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
    const old =
      previous?.questions.find((item) => item.id === question.id) ??
      state.history
        ?.toReversed()
        .flatMap((entry) => entry.round.questions)
        .find((item) => item.id === question.id) ??
      state.decisions[question.id]?.question;
    const unchanged =
      old !== undefined &&
      old.status === undefined &&
      normalizeQuestion(old) === normalizeQuestion(question);
    const revision = old === undefined ? 1 : old.revision + (unchanged ? 0 : 1);
    let draft = same ? previous.drafts[question.id] : undefined;
    if (draft === undefined && old?.status !== undefined) {
      draft =
        previous?.drafts[question.id] ??
        state.history?.findLast((entry) =>
          entry.round.questions.some((item) => item.id === question.id),
        )?.round.drafts[question.id];
    }
    drafts[question.id] = draft === undefined ? { revision, unfinished: "" } : { ...draft };
    const number =
      questionNumbers[question.id] ?? Math.max(0, ...Object.values(questionNumbers)) + 1;
    questionNumbers[question.id] = number;
    return { ...question, revision, number };
  });
  const retiredIds = new Set<string>();
  for (const retirement of input.retire ?? []) {
    const old = same ? previous.questions.find((item) => item.id === retirement.id) : undefined;
    if (old === undefined || ids.has(retirement.id) || retiredIds.has(retirement.id)) {
      throw new Error("Retire each known question once and omit it from active questions.");
    }
    retiredIds.add(retirement.id);
    questions.push({ ...old, ...retirement, revision: old.revision + 1 });
    drafts[old.id] = structuredClone(
      previous?.drafts[old.id] ?? { revision: old.revision, unfinished: "" },
    );
  }
  if (same) {
    for (const old of previous.questions) {
      if (ids.has(old.id) || retiredIds.has(old.id)) {
        continue;
      }
      if (old.status === undefined) {
        throw new Error("Explicitly retire omitted questions with a reason.");
      }
      questions.push(structuredClone(old));
      drafts[old.id] = structuredClone(
        previous.drafts[old.id] ?? { revision: old.revision, unfinished: "" },
      );
    }
  }
  const contextIds = new Set(questions.map((question) => question.id));
  const retainedClarifications = new Map<string, Clarification>();
  for (const round of [
    ...(state.history ?? []).map((entry) => entry.round),
    ...(previous === undefined ? [] : [previous]),
  ]) {
    for (const entry of round.clarifications) {
      if (contextIds.has(entry.questionId) && (entry.response !== undefined || same)) {
        retainedClarifications.set(
          JSON.stringify([entry.questionId, entry.id]),
          structuredClone(entry),
        );
      }
    }
  }
  const clarifications = [...retainedClarifications.values()];
  if (input.clarification !== undefined) {
    const response = input.clarification;
    const request = clarifications.find(
      (item) =>
        item.id === response.id &&
        item.questionId === pending?.questionId &&
        item.response === undefined,
    );
    if (request === undefined || request.response !== undefined) {
      throw new Error("Clarification request is missing or already resolved.");
    }
    request.response = response.response;
  }
  const first = questions[0];
  if (first === undefined) {
    throw new Error("A round requires questions.");
  }
  const roundNumber = state.roundNumber + Number(!same);
  return {
    ...state,
    ...(!same && previous !== undefined
      ? {
          history: [
            ...(state.history ?? []),
            { number: state.roundNumber, round: structuredClone(previous) },
          ],
        }
      : {}),
    questionNumbers,
    roundNumber,
    phase: "round",
    ...(state.reviews === undefined
      ? {}
      : {
          reviews: state.reviews.map((review) =>
            review.status === "pending" ? { ...review, status: "superseded" as const } : review,
          ),
        }),
    round: {
      id: input.roundId,
      revision: (same ? previous.revision : 0) + 1,
      questions,
      drafts,
      focus:
        same && ids.has(previous.focus)
          ? previous.focus
          : (questions.find((item) => item.status === undefined)?.id ?? first.id),
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
      !(
        state.phase === "clarification" &&
        ["focus", "edit", "answer", "clear-answer", "edit-option", "edit-clarification"].includes(
          action.type,
        )
      )) ||
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
      if (question.status !== undefined) {
        continue;
      }
      const draft = round.drafts[question.id];
      if (draft?.answer === undefined || draft.revision !== question.revision) {
        throw new Error(`Answer or reconfirm ${question.id} before submitting.`);
      }
      const selectedOption = question.options.find((item) => item.id === draft.answer?.optionId);
      decisions[question.id] = {
        questionId: question.id,
        questionRevision: question.revision,
        question,
        roundId: round.id,
        answer: draft.answer,
        ...(selectedOption === undefined ? {} : { selectedOption }),
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
  if (question.status !== undefined) {
    throw new Error("This question is inactive.");
  }
  if (action.type === "focus") {
    round.focus = question.id;
  }
  if (action.type === "edit") {
    draft.unfinished = action.unfinished;
  }
  if (action.type === "edit-clarification") {
    draft.clarificationDraft = action.text;
  }
  if (action.type === "clear-answer") {
    delete draft.answer;
  }
  if (action.type === "edit-option") {
    if (!question.options.some((item) => item.id === action.optionId)) {
      throw new Error("Unknown option identity.");
    }
    draft.options ??= {};
    draft.options[action.optionId] = action.text;
    if (draft.answer?.optionId === action.optionId) {
      draft.answer =
        action.text.trim().length === 0
          ? { optionId: action.optionId }
          : { optionId: action.optionId, details: action.text };
    }
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
    if (answer.custom !== undefined) {
      draft.unfinished = answer.custom;
    }
    const notes = answer.optionId === undefined ? undefined : draft.options?.[answer.optionId];
    draft.answer =
      answer.optionId !== undefined && notes !== undefined && notes.trim().length > 0
        ? { ...answer, details: notes }
        : answer;
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
    round.clarifications.push({
      id: action.id,
      questionId: question.id,
      request: action.request,
      question: structuredClone(question),
    });
    round.focus = question.id;
    draft.clarificationDraft = "";
    return { ...next, phase: "clarification" };
  }
  return next;
}

export function hasReviewNotes(review: PlanRevision): boolean {
  return (
    review.feedbackDraft.trim().length > 0 ||
    (review.notes?.some((note) => note.text.trim().length > 0) ?? false)
  );
}

export function reviewFeedback(review: PlanRevision): string {
  return [
    review.feedbackDraft,
    ...(review.notes ?? [])
      .filter((note) => note.text.trim().length > 0)
      .map(
        (note) =>
          `Revision ${String(note.revision)} · block ${note.blockId}\nSource excerpt:\n${note.excerpt}\nNote:\n${note.text}`,
      ),
  ]
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}
