import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { PlanningError, describe, errorResult } from "../domain/errors.ts";
import { sameRecord } from "../domain/record-equality.ts";
import {
  acceptApproval,
  approvalNotesPath,
  matchingApproval,
  isPlanId,
  recoverReview,
  supplementaryNotes,
} from "../domain/state.ts";
import type { PlanApproval, PlanningSession } from "../domain/state.ts";
import { writeArtifact } from "./artifacts.ts";
import { isFileError, saveFailure } from "./persistence.ts";
import type { SaveResult } from "./persistence.ts";

/** Verify the displayed revision and supplementary artifacts before recording acceptance. */
export function saveApproval(
  state: PlanningSession,
  directory: string,
  persist: (state: PlanningSession) => SaveResult,
): { state: PlanningSession; outcome: "approval" | "error"; message: string; error?: unknown } {
  const review = state.reviews?.at(-1);
  if (
    state.phase !== "saving" ||
    review?.status !== "pending" ||
    review.path === undefined ||
    !isPlanId(state.planId) ||
    !isAbsolute(directory)
  ) {
    return {
      state,
      outcome: "error",
      message: "Approval requires the current persisted review artifact.",
    };
  }
  const supplementary = structuredClone(supplementaryNotes(state.planId, review));
  const notes = supplementary?.notes;
  const notesContent = supplementary?.content;
  const prior = state.pendingApproval ?? matchingApproval(state);
  const approvalId = randomUUID();
  const intent: PlanApproval = prior ?? {
    version: 1,
    approvalId,
    planId: state.planId,
    revision: review.revision,
    sessionId: state.sessionId,
    cwd: state.cwd,
    planPath: review.path,
    planContent: review.markdown,
    approvedAt: new Date().toISOString(),
    ...(notes === undefined
      ? {}
      : {
          notes,
          notesPath: approvalNotesPath({ planPath: review.path, approvalId }),
          notesContent: notesContent ?? "",
        }),
  };
  const pending: PlanningSession = { ...state, pendingApproval: intent };
  try {
    if (
      intent.planId !== state.planId ||
      intent.revision !== review.revision ||
      intent.planPath !== review.path ||
      intent.planContent !== review.markdown ||
      !isAbsolute(intent.planPath) ||
      !sameRecord(intent.notes, notes) ||
      intent.notesContent !== notesContent ||
      (intent.notes === undefined) !== (intent.notesPath === undefined)
    ) {
      throw new PlanningError(
        "rejected",
        "An earlier approval needs reconciliation before changing its revision or notes.",
      );
    }
    const prepared = persist(pending);
    if (!prepared.saved) {
      throw saveFailure(prepared);
    }
    if (readFileSync(intent.planPath, "utf8") !== intent.planContent) {
      throw new PlanningError(
        "artifact-conflict",
        `Saved plan bytes differ from the reviewed revision at ${intent.planPath}.`,
        { data: { path: intent.planPath } },
      );
    }
    if (intent.notesPath !== undefined && intent.notesContent !== undefined) {
      writeArtifact(intent.notesPath, intent.notesContent, prior !== undefined);
    }
    const accepted = acceptApproval(pending);
    const saved = persist(accepted);
    if (!saved.saved) {
      throw saveFailure(saved);
    }
    return { state: accepted, outcome: "approval", message: `Plan approved: ${intent.planPath}` };
  } catch (error) {
    const failure = isFileError(error)
      ? new PlanningError("persistence", `Cannot save approval: ${describe(error)}`, {
          cause: error,
        })
      : error;
    return {
      state: recoverReview(pending),
      ...errorResult(failure),
    };
  }
}
