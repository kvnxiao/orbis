import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { DocumentBlock } from "./blocks.ts";
import { registerPresenter } from "./presenters.ts";
import type { PlanRevision, Round, RoundAction, ReviewAction } from "./state.ts";

type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };

export interface PlanInteractionIdentity {
  readonly version: 1;
  readonly sessionId: string;
  readonly planId: string;
  readonly interactionId: string;
  readonly revision: number;
}

export type PlanPresentationSnapshot =
  | {
      readonly kind: "round";
      readonly round: ReadonlyData<Round>;
      readonly history: ReadonlyData<{ number: number; round: Round }[]>;
    }
  | {
      readonly kind: "review";
      readonly review: ReadonlyData<PlanRevision>;
      readonly blocks: ReadonlyData<DocumentBlock[]>;
    };

export interface PlanDraftUpdate {
  readonly identity: PlanInteractionIdentity;
  readonly action:
    | Extract<
        RoundAction,
        {
          type: "focus" | "edit" | "answer" | "clear-answer" | "edit-option" | "edit-clarification";
        }
      >
    | Extract<
        ReviewAction,
        {
          type: "edit-feedback" | "edit-note" | "remove-note";
        }
      >;
}

export interface PlanPresentationResult {
  readonly identity: PlanInteractionIdentity;
  readonly action:
    | Extract<RoundAction, { type: "submit" | "clarify" | "cancel" }>
    | Extract<
        ReviewAction,
        { type: "feedback" | "approve" | "approve-with-notes" | "submit-feedback" }
      >;
}

export interface PlanPresentationRequest {
  readonly identity: PlanInteractionIdentity;
  readonly snapshot: PlanPresentationSnapshot;
  readonly signal: AbortSignal;
  readonly updateDraft: (update: PlanDraftUpdate) => PlanPresentationSnapshot;
}

export interface PlanPresenter {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly present: (
    request: PlanPresentationRequest,
  ) => Promise<PlanPresentationResult | undefined>;
}

export function registerPlanPresenter(pi: ExtensionAPI, presenter: PlanPresenter): () => void {
  return registerPresenter(pi, presenter);
}
