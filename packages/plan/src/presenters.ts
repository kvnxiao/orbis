import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { documentBlocks } from "./blocks.ts";
import type {
  PlanInteractionIdentity,
  PlanPresenter,
  PlanPresentationSnapshot,
} from "./presentation.ts";
import type { RoundState, RoundAction, ReviewAction } from "./state.ts";

const discovery = "orbis:plan-presenters:discover:v1";
export const presentersChanged = "orbis:plan-presenters:changed:v1";
type Events = ExtensionAPI["events"];

export function availablePresenters(events: Events): PlanPresenter[] {
  const presenters: PlanPresenter[] = [];
  events.emit(discovery, (presenter: unknown) => {
    if (isPresenter(presenter)) {
      presenters.push(presenter);
    }
  });
  return presenters;
}

function isPresenter(value: unknown): value is PlanPresenter {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "id" in value &&
    typeof value.id === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(value.id) &&
    value.id !== "terminal" &&
    "label" in value &&
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    "present" in value &&
    typeof value.present === "function"
  );
}

export function registerPresenter(pi: ExtensionAPI, value: unknown): () => void {
  if (!isPresenter(value)) {
    throw new Error(
      "A presenter requires version 1, a unique ID other than terminal, a label, and present().",
    );
  }
  const definition = Object.freeze({
    version: value.version,
    id: value.id,
    label: value.label,
    present: value.present,
  });
  let remove: (() => void) | undefined;
  let disposed = false;
  const attach = () => {
    if (disposed || remove !== undefined) {
      return;
    }
    if (availablePresenters(pi.events).some((item) => item.id === definition.id)) {
      throw new Error(`Planning presenter ${definition.id} is already registered.`);
    }
    remove = pi.events.on(discovery, (receive: unknown) => {
      if (typeof receive === "function") {
        Reflect.apply(receive, undefined, [definition]);
      }
    });
    pi.events.emit(presentersChanged, undefined);
  };
  const detach = () => {
    remove?.();
    remove = undefined;
    pi.events.emit(presentersChanged, undefined);
  };
  attach();
  pi.on("session_start", attach);
  pi.on("session_shutdown", detach);
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    detach();
  };
}

const text = Type.String();
const nonempty = Type.String({ minLength: 1 });
const object = { additionalProperties: false } as const;
const identitySchema = Type.Object(
  {
    version: Type.Literal(1),
    sessionId: nonempty,
    planId: nonempty,
    interactionId: nonempty,
    revision: Type.Integer({ minimum: 1 }),
  },
  object,
);
const draftSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("edit-option"), questionId: nonempty, optionId: nonempty, text },
    object,
  ),
  Type.Object({ type: Type.Literal("edit-clarification"), questionId: nonempty, text }, object),
  Type.Object({ type: Type.Literal("edit-note"), blockId: nonempty, excerpt: text, text }, object),
  Type.Object({ type: Type.Literal("confirm-note"), blockId: nonempty }, object),
  Type.Object({ type: Type.Literal("remove-note"), blockId: nonempty }, object),
  Type.Object({ type: Type.Literal("confirm-feedback") }, object),
  Type.Object({ type: Type.Literal("focus"), questionId: nonempty }, object),
  Type.Object({ type: Type.Literal("edit"), questionId: nonempty, unfinished: text }, object),
  Type.Object(
    {
      type: Type.Literal("answer"),
      questionId: nonempty,
      answer: Type.Union([
        Type.Object({ optionId: nonempty }, object),
        Type.Object({ custom: nonempty }, object),
      ]),
    },
    object,
  ),
  Type.Object({ type: Type.Literal("edit-feedback"), text }, object),
]);
const resultSchema = Type.Union([
  Type.Object({ type: Type.Literal("discard-approve") }, object),
  Type.Object({ type: Type.Literal("submit-feedback") }, object),
  Type.Object({ type: Type.Literal("submit") }, object),
  Type.Object(
    { type: Type.Literal("clarify"), questionId: nonempty, id: nonempty, request: nonempty },
    object,
  ),
  Type.Object({ type: Type.Literal("feedback"), text: nonempty }, object),
  Type.Object({ type: Type.Literal("approve") }, object),
  Type.Object({ type: Type.Literal("cancel") }, object),
]);
const draftEnvelope = Type.Object({ identity: identitySchema, action: draftSchema }, object);
const resultEnvelope = Type.Object({ identity: identitySchema, action: resultSchema }, object);

export function presentationAction(
  value: unknown,
  expected: PlanInteractionIdentity,
  draft: boolean,
): RoundAction | ReviewAction {
  const schema = draft ? draftEnvelope : resultEnvelope;
  if (!Value.Check(schema, value)) {
    throw new Error("Invalid planning presenter input.");
  }
  const identity = value.identity;
  if (
    identity.sessionId !== expected.sessionId ||
    identity.planId !== expected.planId ||
    identity.interactionId !== expected.interactionId ||
    identity.revision !== expected.revision
  ) {
    throw new Error("Planning interaction changed; reopen current input.");
  }
  return structuredClone(value.action);
}

export function presentationSnapshot(state: RoundState): PlanPresentationSnapshot {
  if (state.phase === "round" && state.round !== undefined) {
    return { kind: "round", round: structuredClone(state.round) };
  }
  const review = state.reviews?.at(-1);
  if (state.phase === "review" && review !== undefined) {
    return {
      kind: "review",
      review: structuredClone(review),
      blocks: documentBlocks(review.markdown),
    };
  }
  throw new Error("This planning interaction is no longer accepting input.");
}
