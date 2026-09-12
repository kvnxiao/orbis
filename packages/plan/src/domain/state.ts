import { isAbsolute } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { documentBlocks } from "../document/blocks.ts";
import { DocumentAnalysis } from "../document/document-analysis.ts";
import { sameRecord } from "./record-equality.ts";

const identity = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^(?!__proto__$|prototype$|constructor$)[a-zA-Z0-9_-]+$",
});
const prose = Type.String({ minLength: 1, pattern: "\\S" });
/** State the option/recommendation rule at every model-facing question boundary. */
export const questionGuidance =
  "Use 2–4 distinct options with recommendation: { optionId, reason }; optionId must match one of this question's option IDs and reason must be nonblank. For free text, use options: [] and omit recommendation. Exactly one option is invalid. The UI adds Other and Ask for clarification automatically.";
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
        description: questionGuidance,
      },
    ),
    recommendation: Type.Optional(
      Type.Object(
        { optionId: identity, reason: prose },
        {
          additionalProperties: false,
          description: questionGuidance,
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

/** Validate model-facing frontier input before applying domain prerequisites. */
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
            status: StringEnum(["withdrawn", "deferred"] as const),
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
/** Describe model-authored questions without local drafts or display numbering. */
export type QuestionInput = Static<typeof questionSchema>;
/** Bind a frontier update to its expected plan and round revision. */
export type RoundInput = Static<typeof roundSchema>;
/** Preserve one logical decision's display number across content revisions. */
export type Question = Static<typeof storedQuestionSchema>;
/** Keep unfinished input separate from explicitly selected answers. */
export type Draft = Static<typeof storedRoundSchema>["drafts"][string];
const clarificationSchema = Type.Object({
  id: identity,
  questionId: identity,
  request: prose,
  response: Type.Optional(prose),
  question: Type.Optional(storedQuestionSchema),
});
type Clarification = Static<typeof clarificationSchema>;
/** Retain versioned questions, drafts, and sent clarification exchanges. */
export type Round = Static<typeof storedRoundSchema>;
/** Describe workflow state independently of session persistence. */
export type RoundState = Static<typeof roundStateSchema>;
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
/** Bind review notes and feedback to an immutable Markdown revision. */
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
/** Record the exact approved artifacts and owning session. */
export type PlanApproval = Static<typeof approvalSchema>;

/** Bind domain state to its plan, working directory, and session identity. */
export type PlanningSession = Static<typeof sessionSchema>;
/** Return detached planning outcomes to tool and command adapters. */
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

/** Validate the expected revision and exact Markdown submitted for review. */
export const reviewSchema = Type.Object(
  { planId: identity, expectedRevision: Type.Integer({ minimum: 0 }), markdown: prose },
  { additionalProperties: false },
);
/** Bind Markdown to the plan’s expected review revision. */
export type ReviewInput = Static<typeof reviewSchema>;
const storedAnswerSchema = Type.Union([
  Type.Object(
    {
      optionId: identity,
      details: Type.Optional(Type.String()),
      custom: Type.Optional(Type.Never()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { custom: prose, optionId: Type.Optional(Type.Never()) },
    { additionalProperties: false },
  ),
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

/** Validate stored workflow fields before checking cross-field invariants. */
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

/** Describe the current stored session format; domain validation establishes cross-field invariants. */
export const sessionSchema = Type.Object({
  ...roundStateSchema.properties,
  planId: Type.String(),
  sessionId: Type.String({ minLength: 1 }),
  branchId: Type.Union([Type.String(), Type.Null()]),
  cwd: Type.String(),
  objective: Type.String(),
  accepted: Type.Optional(approvalSchema),
  pendingApproval: Type.Optional(approvalSchema),
});

/** Describe branch snapshots without accepting unsupported stored versions. */
export const snapshotSchema = Type.Object({
  version: Type.Literal(1),
  mode: Type.Union([Type.Literal("plan"), Type.Literal("default")]),
  active: Type.Optional(sessionSchema),
  unfinished: Type.Array(sessionSchema),
});

/** Accept canonical UUID identities used in artifact filenames. */
export function isPlanId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
}

function validPath(value: string): boolean {
  return isAbsolute(value) && !value.includes("\0");
}

function validQuestion(question: Question, numbers: Record<string, number>): boolean {
  const ids = new Set(question.options.map((option) => option.id));
  return (
    numbers[question.id] === question.number &&
    ids.size === question.options.length &&
    question.options.length !== 1 &&
    (question.options.length === 0
      ? question.recommendation === undefined
      : question.recommendation !== undefined && ids.has(question.recommendation.optionId)) &&
    (question.status === undefined) === (question.reason === undefined)
  );
}

function validRound(round: Round, numbers: Record<string, number>): boolean {
  const ids = new Set(round.questions.map((question) => question.id));
  return (
    ids.size === round.questions.length &&
    ids.has(round.focus) &&
    Object.keys(round.drafts).every((id) => ids.has(id)) &&
    round.questions.every((question) => {
      const draft = round.drafts[question.id];
      const answer = draft?.answer;
      return (
        validQuestion(question, numbers) &&
        draft !== undefined &&
        draft.revision <= question.revision &&
        (draft.revision !== question.revision ||
          answer?.optionId === undefined ||
          question.options.some((option) => option.id === answer.optionId)) &&
        (!round.submitted ||
          question.status !== undefined ||
          (answer !== undefined && draft.revision === question.revision))
      );
    }) &&
    new Set(round.clarifications.map((entry) => JSON.stringify([entry.questionId, entry.id])))
      .size === round.clarifications.length &&
    round.clarifications.every(
      (entry) =>
        ids.has(entry.questionId) &&
        (entry.question === undefined ||
          (entry.question.id === entry.questionId && validQuestion(entry.question, numbers))),
    )
  );
}

function validReview(review: PlanRevision): boolean {
  if (review.path !== undefined && !validPath(review.path)) {
    return false;
  }
  const notes = review.notes ?? [];
  if (new Set(notes.map((note) => note.blockId)).size !== notes.length) {
    return false;
  }
  if (notes.length === 0) {
    return true;
  }
  const blocks = new Map(documentBlocks(review.markdown).map((block) => [block.id, block]));
  return notes.every(
    (note) =>
      note.revision === review.revision && blocks.get(note.blockId)?.excerpt === note.excerpt,
  );
}

function validApproval(
  approval: PlanApproval,
  plan: PlanningSession,
  review: PlanRevision | undefined,
): boolean {
  if (review === undefined) {
    return false;
  }
  const timestamp = Date.parse(approval.approvedAt);
  const supplementary = supplementaryNotes(plan.planId, review);
  const notes = supplementary?.notes;
  const notesContent = supplementary?.content;
  return (
    approval.planId === plan.planId &&
    approval.sessionId === plan.sessionId &&
    approval.cwd === plan.cwd &&
    approval.revision === review.revision &&
    approval.planContent === review.markdown &&
    approval.planPath === review.path &&
    validPath(approval.planPath) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === approval.approvedAt &&
    sameRecord(approval.notes, notes) &&
    approval.notesContent === notesContent &&
    (notes === undefined
      ? approval.notesPath === undefined
      : approval.notesPath === `${approval.planPath.slice(0, -3)}.notes.md`)
  );
}

/** Validate recorded ownership, revisions, histories, and artifact bindings before restoration. */
export function validSession(plan: PlanningSession): boolean {
  if (!isPlanId(plan.planId) || !validPath(plan.cwd)) {
    return false;
  }
  const numbers = Object.values(plan.questionNumbers);
  if (
    new Set(numbers).size !== numbers.length ||
    numbers.some((number) => number < 1 || number > numbers.length)
  ) {
    return false;
  }
  const round = plan.round;
  const reviews = plan.reviews ?? [];
  const review = reviews.at(-1);
  const history = plan.history ?? [];
  if (round !== undefined && !validRound(round, plan.questionNumbers)) {
    return false;
  }
  if (
    history.some(
      (entry, index) =>
        entry.number !== index + 1 ||
        !entry.round.submitted ||
        !validRound(entry.round, plan.questionNumbers),
    )
  ) {
    return false;
  }
  if (
    new Set([...history.map((entry) => entry.round.id), ...(round === undefined ? [] : [round.id])])
      .size !==
    history.length + Number(round !== undefined)
  ) {
    return false;
  }
  if (plan.roundNumber !== history.length + Number(round !== undefined)) {
    return false;
  }
  if (reviews.some((item, index) => item.revision !== index + 1 || !validReview(item))) {
    return false;
  }
  if (
    Object.entries(plan.decisions).some(
      ([id, decision]) =>
        id !== decision.questionId ||
        id !== decision.question.id ||
        decision.questionRevision !== decision.question.revision ||
        !validQuestion(decision.question, plan.questionNumbers) ||
        (decision.answer.optionId === undefined
          ? decision.selectedOption !== undefined
          : !decision.question.options.some((option) => option.id === decision.answer.optionId) ||
            !sameRecord(
              decision.selectedOption,
              decision.question.options.find((option) => option.id === decision.answer.optionId),
            )),
    )
  ) {
    return false;
  }
  if (
    plan.accepted !== undefined &&
    (plan.phase !== "accepted" || !validApproval(plan.accepted, plan, review))
  ) {
    return false;
  }
  if (
    plan.pendingApproval !== undefined &&
    (plan.phase === "accepted" || !validApproval(plan.pendingApproval, plan, review))
  ) {
    return false;
  }
  switch (plan.phase) {
    case "round":
      return (
        round !== undefined &&
        !round.submitted &&
        round.clarifications.every((entry) => entry.response !== undefined)
      );
    case "clarification":
      return (
        round !== undefined &&
        !round.submitted &&
        round.clarifications.some((entry) => entry.response === undefined)
      );
    case "review":
    case "saving":
      return review?.status === "pending" && (round === undefined || round.submitted);
    case "accepted":
      return plan.accepted !== undefined && review?.status === "approved";
    case "research":
      return round === undefined || round.submitted;
    case "cancelled":
      return true;
  }
  throw new Error("Unknown planning phase.");
}

/** Validate the expected predecessor and append a pending revision. */
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

/** Apply a revision-bound review action without mutating prior state. */
export function transitionReview(
  state: RoundState,
  revision: number,
  action: ReviewAction,
  analysis?: DocumentAnalysis,
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
  let review = current;
  if (action.type === "edit-note") {
    const source =
      analysis?.markdown === current.markdown ? analysis : new DocumentAnalysis(current.markdown);
    const block = source.byId.get(action.blockId);
    if (block === undefined || block.excerpt !== action.excerpt) {
      throw new Error("Unknown source block or changed excerpt.");
    }
    const note = {
      blockId: block.id,
      excerpt: block.excerpt,
      revision,
      text: action.text,
    };
    const exists = current.notes?.some((item) => item.blockId === block.id) === true;
    review = {
      ...current,
      notes: exists
        ? (current.notes?.map((item) => (item.blockId === block.id ? note : item)) ?? [])
        : [...(current.notes ?? []), note],
    };
  }
  if (action.type === "remove-note") {
    if (review.notes?.some((note) => note.blockId === action.blockId) !== true) {
      throw new Error("Unknown annotation.");
    }
    review = { ...current, notes: review.notes.filter((note) => note.blockId !== action.blockId) };
  }
  return { ...state, reviews: [...(state.reviews?.slice(0, -1) ?? []), review] };
}

/** Dispatch every supported action through its round or review identity guard. */
export function transitionInteraction(
  state: RoundState,
  id: string,
  revision: number,
  action: RoundAction | ReviewAction,
  analysis?: DocumentAnalysis,
): RoundState {
  switch (action.type) {
    case "cancel":
      if (state.phase !== "review") {
        return transitionRound(state, id, revision, action);
      }
      if (id !== "review") {
        throw new Error("This action requires the current plan review.");
      }
      return transitionReview(state, revision, action, analysis);
    case "approve-with-notes":
    case "edit-note":
    case "remove-note":
    case "submit-feedback":
    case "approve":
    case "feedback":
    case "edit-feedback":
      if (id !== "review") {
        throw new Error("This action requires the current plan review.");
      }
      return transitionReview(state, revision, action, analysis);
    case "edit":
    case "answer":
    case "clear-answer":
    case "edit-option":
    case "edit-clarification":
    case "focus":
    case "clarify":
    case "submit":
      return transitionRound(state, id, revision, action);
  }
  action satisfies never;
  throw new Error("Unknown planning action.");
}

/** Bind a pending revision to an absolute artifact path without changing its content. */
export function stampReviewPath(
  state: PlanningSession,
  revision: number,
  path: string,
): PlanningSession {
  const review = state.reviews?.at(-1);
  if (
    state.phase !== "review" ||
    review?.status !== "pending" ||
    review.revision !== revision ||
    !validPath(path) ||
    (review.path !== undefined && review.path !== path)
  ) {
    throw new Error("Artifact path requires the current pending review.");
  }
  return { ...state, reviews: [...(state.reviews?.slice(0, -1) ?? []), { ...review, path }] };
}

/** Restore an interrupted save to its pending review without discarding approval intent. */
export function recoverReview(state: PlanningSession): PlanningSession {
  if (
    state.reviews?.at(-1)?.status !== "pending" ||
    (state.phase !== "saving" && state.phase !== "review")
  ) {
    throw new Error("Save recovery requires a pending review.");
  }
  return { ...state, phase: "review" };
}

/** Accept the pending approval; the caller must verify its artifacts first. */
export function acceptApproval(state: PlanningSession): PlanningSession {
  const review = state.reviews?.at(-1);
  const approval = state.pendingApproval;
  if (
    state.phase !== "saving" ||
    review?.status !== "pending" ||
    approval === undefined ||
    !validApproval(approval, state, review)
  ) {
    throw new Error("Acceptance requires the current approval intent.");
  }
  const accepted: PlanningSession = {
    ...state,
    phase: "accepted",
    accepted: approval,
    reviews: [...(state.reviews?.slice(0, -1) ?? []), { ...review, status: "approved" }],
  };
  delete accepted.pendingApproval;
  return accepted;
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

/** Validate frontier dependencies and preserve stable question numbers and detached history. */
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
  let nextQuestionNumber = Math.max(0, ...Object.values(questionNumbers)) + 1;
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
      throw new Error(questionGuidance);
    }
    if (question.recommendation !== undefined && !optionIds.has(question.recommendation.optionId)) {
      throw new Error("Recommendation references an unknown option.");
    }
    const old =
      previous?.questions.find((item) => item.id === question.id) ??
      state.history
        ?.findLast((entry) => entry.round.questions.some((item) => item.id === question.id))
        ?.round.questions.find((item) => item.id === question.id) ??
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
    drafts[question.id] =
      draft === undefined ? { revision, unfinished: "" } : structuredClone(draft);
    const number = questionNumbers[question.id] ?? nextQuestionNumber++;
    questionNumbers[question.id] = number;
    return { ...structuredClone(question), revision, number };
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

/** Apply a round-bound action and retain unfinished input until explicit submission. */
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
  const round =
    action.type === "submit"
      ? structuredClone(current)
      : {
          ...current,
          drafts: { ...current.drafts },
          clarifications: [...current.clarifications],
        };
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
  const draft = structuredClone(round.drafts[action.questionId]);
  if (question === undefined || draft === undefined) {
    throw new Error("Unknown question identity.");
  }
  if (question.status !== undefined) {
    throw new Error("This question is inactive.");
  }
  round.drafts[action.questionId] = draft;
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
        : { ...answer };
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

/** Detect nonblank annotations or overall feedback for approval choices. */
export function hasReviewNotes(review: PlanRevision): boolean {
  return (
    review.feedbackDraft.trim().length > 0 ||
    (review.notes?.some((note) => note.text.trim().length > 0) ?? false)
  );
}

/** Project nonblank notes and overall feedback into submitted review text. */
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

/** Project supplementary notes and their exact companion bytes without modifying the revision. */
export function supplementaryNotes(
  planId: string,
  review: PlanRevision,
): { notes: NonNullable<PlanApproval["notes"]>; content: string } | undefined {
  if (!hasReviewNotes(review)) {
    return undefined;
  }
  return {
    notes: {
      overall: review.feedbackDraft,
      blocks: (review.notes ?? []).filter((note) => note.text.trim().length > 0),
    },
    content: `# Supplementary notes\n\nPlan: ${planId}\nRevision: ${String(review.revision)}\n\n${reviewFeedback(review)}\n`,
  };
}

const actionIdentity = Type.String({ minLength: 1 });
const actionText = Type.String();
const object = { additionalProperties: false } as const;
/** Validate local draft edits without permitting submission. */
export const draftActionSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("edit-option"),
      questionId: actionIdentity,
      optionId: actionIdentity,
      text: actionText,
    },
    object,
  ),
  Type.Object(
    { type: Type.Literal("edit-clarification"), questionId: actionIdentity, text: actionText },
    object,
  ),
  Type.Object({ type: Type.Literal("clear-answer"), questionId: actionIdentity }, object),
  Type.Object(
    {
      type: Type.Literal("edit-note"),
      blockId: actionIdentity,
      excerpt: actionText,
      text: actionText,
    },
    object,
  ),
  Type.Object({ type: Type.Literal("remove-note"), blockId: actionIdentity }, object),
  Type.Object({ type: Type.Literal("focus"), questionId: actionIdentity }, object),
  Type.Object(
    { type: Type.Literal("edit"), questionId: actionIdentity, unfinished: actionText },
    object,
  ),
  Type.Object(
    {
      type: Type.Literal("answer"),
      questionId: actionIdentity,
      answer: Type.Union([
        Type.Object({ optionId: actionIdentity, custom: Type.Optional(Type.Never()) }, object),
        Type.Object({ custom: actionIdentity, optionId: Type.Optional(Type.Never()) }, object),
      ]),
    },
    object,
  ),
  Type.Object({ type: Type.Literal("edit-feedback"), text: actionText }, object),
]);
/** Validate explicit interaction completion. */
export const resultActionSchema = Type.Union([
  Type.Object({ type: Type.Literal("approve-with-notes") }, object),
  Type.Object({ type: Type.Literal("submit-feedback") }, object),
  Type.Object({ type: Type.Literal("submit") }, object),
  Type.Object(
    {
      type: Type.Literal("clarify"),
      questionId: actionIdentity,
      id: actionIdentity,
      request: actionIdentity,
    },
    object,
  ),
  Type.Object({ type: Type.Literal("feedback"), text: actionIdentity }, object),
  Type.Object({ type: Type.Literal("approve") }, object),
  Type.Object({ type: Type.Literal("cancel") }, object),
]);

/** Describe edits that retain unsubmitted input. */
export type DraftAction = Static<typeof draftActionSchema>;
/** Describe explicit submission or cancellation. */
export type ResultAction = Static<typeof resultActionSchema>;
/** Bind question actions to the owning round. */
export type RoundAction = Extract<
  DraftAction | ResultAction,
  { questionId: string } | { type: "submit" | "cancel" }
>;
/** Bind document actions to the current review. */
export type ReviewAction = Exclude<
  DraftAction | ResultAction,
  Exclude<RoundAction, { type: "cancel" }>
>;
