import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { DocumentBlock } from "./document/blocks.ts";
import type { PlanRevision, Round, DraftAction, ResultAction } from "./domain/state.ts";
import { registerPresenter } from "./pi/presenters.ts";

type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };

/** Bind callbacks to one session, plan, and expiring interaction revision. */
export interface PlanInteractionIdentity {
  readonly version: 1;
  readonly sessionId: string;
  readonly planId: string;
  readonly interactionId: string;
  readonly revision: number;
}

/** Expose detached data; readonly checking does not freeze objects at runtime. */
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

/** Retain local input without submitting it to the agent. */
export interface PlanDraftUpdate {
  readonly identity: PlanInteractionIdentity;
  readonly action: DraftAction;
}

/** Submit only the user's explicit completion or cancellation action. */
export interface PlanPresentationResult {
  readonly identity: PlanInteractionIdentity;
  readonly action: ResultAction;
}

/** Reject invalid or expired draft callbacks synchronously; stop presentation on signal abort. */
export interface PlanPresentationRequest {
  readonly identity: PlanInteractionIdentity;
  readonly snapshot: PlanPresentationSnapshot;
  readonly signal: AbortSignal;
  readonly updateDraft: (update: PlanDraftUpdate) => PlanPresentationSnapshot;
}

/** Present detached input and return explicit submission; undefined restores terminal input. */
export interface PlanPresenter {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly present: (
    request: PlanPresentationRequest,
  ) => Promise<PlanPresentationResult | undefined>;
}

/** Register discovery and return an idempotent, permanent unregister function. */
export function registerPlanPresenter(pi: ExtensionAPI, presenter: PlanPresenter): () => void {
  return registerPresenter(pi, presenter);
}
