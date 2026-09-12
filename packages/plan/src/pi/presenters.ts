import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { documentBlocks } from "../document/blocks.ts";
import { draftActionSchema, resultActionSchema } from "../domain/state.ts";
import type { RoundState, RoundAction, ReviewAction } from "../domain/state.ts";
import type {
  PlanInteractionIdentity,
  PlanPresenter,
  PlanPresentationSnapshot,
} from "../presentation.ts";

const discovery = "orbis:plan-presenters:discover:v1";
/** Identify registry notifications scoped to Pi’s event bus. */
export const presentersChanged = "orbis:plan-presenters:changed:v1";
type Events = ExtensionAPI["events"];
const registrations = new WeakMap<
  ExtensionAPI,
  Set<{ attach: () => void; detach: () => void; id: string }>
>();

/** Return currently attached presenter capabilities for this event bus. */
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

/** Register a presenter and return idempotent removal across session reloads. */
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
  let registry = registrations.get(pi);
  if (registry === undefined) {
    registry = new Set();
    registrations.set(pi, registry);
    const owned = registry;
    pi.on("session_start", () => {
      for (const registration of owned) {
        registration.attach();
      }
    });
    pi.on("session_shutdown", () => {
      for (const registration of owned) {
        registration.detach();
      }
    });
  }
  if ([...registry].some((item) => item.id === definition.id)) {
    throw new Error(`Planning presenter ${definition.id} is already registered.`);
  }
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
    if (remove === undefined) {
      return;
    }
    remove();
    remove = undefined;
    pi.events.emit(presentersChanged, undefined);
  };
  attach();
  const registration = { attach, detach, id: definition.id };
  registry.add(registration);
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    registry.delete(registration);
    detach();
  };
}

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
const draftEnvelope = Type.Object({ identity: identitySchema, action: draftActionSchema }, object);
const resultEnvelope = Type.Object(
  { identity: identitySchema, action: resultActionSchema },
  object,
);

/** Validate interaction identity and the draft or result action schema. */
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

/** Copy presenter-visible state and source targets for one interaction. */
export function presentationSnapshot(state: RoundState): PlanPresentationSnapshot {
  if (state.phase === "round" && state.round !== undefined) {
    return {
      kind: "round",
      round: structuredClone(state.round),
      history: structuredClone(state.history ?? []),
    };
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
