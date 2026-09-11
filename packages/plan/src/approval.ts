import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { writeArtifact } from "./artifacts.ts";
import type { SaveResult } from "./persistence.ts";
import { hasReviewNotes, reviewFeedback } from "./state.ts";
import type { PlanApproval, PlanningSession } from "./state.ts";

/** Verify the displayed revision and supplementary artifacts before recording acceptance. */
export function saveApproval(
  state: PlanningSession,
  directory: string,
  persist: (state: PlanningSession) => SaveResult,
): { state: PlanningSession; outcome: "approval" | "error"; message: string } {
  const review = state.reviews?.at(-1);
  if (
    state.phase !== "saving" ||
    review?.status !== "pending" ||
    review.path === undefined ||
    !/^[a-f0-9-]{36}$/.test(state.planId) ||
    !isAbsolute(directory)
  ) {
    return {
      state,
      outcome: "error",
      message: "Approval requires the current persisted review artifact.",
    };
  }
  const notes = hasReviewNotes(review)
    ? {
        overall: review.feedbackDraft,
        blocks: structuredClone((review.notes ?? []).filter((note) => note.text.trim().length > 0)),
      }
    : undefined;
  const notesContent =
    notes === undefined
      ? undefined
      : `# Supplementary notes\n\nPlan: ${state.planId}\nRevision: ${String(review.revision)}\n\n${reviewFeedback(review)}\n`;
  const prior = state.pendingApproval;
  const intent: PlanApproval = prior ?? {
    version: 1,
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
          notesPath: `${review.path.slice(0, -3)}.notes.md`,
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
      JSON.stringify(intent.notes) !== JSON.stringify(notes) ||
      intent.notesContent !== notesContent ||
      (intent.notes === undefined) !== (intent.notesPath === undefined)
    ) {
      throw new Error(
        "An earlier approval needs reconciliation before changing its revision or notes.",
      );
    }
    const prepared = persist(pending);
    if (!prepared.saved) {
      throw new Error(prepared.message);
    }
    if (readFileSync(intent.planPath, "utf8") !== intent.planContent) {
      throw new Error(
        "Saved plan bytes differ from the reviewed revision. Preserve the file and resolve the conflict.",
      );
    }
    if (intent.notesPath !== undefined && intent.notesContent !== undefined) {
      writeArtifact(intent.notesPath, intent.notesContent, prior !== undefined);
    }
    const accepted: PlanningSession = {
      ...pending,
      phase: "accepted",
      accepted: intent,
      reviews: [...(state.reviews?.slice(0, -1) ?? []), { ...review, status: "approved" }],
    };
    delete accepted.pendingApproval;
    const saved = persist(accepted);
    if (!saved.saved) {
      throw new Error(saved.message);
    }
    return { state: accepted, outcome: "approval", message: `Plan approved: ${intent.planPath}` };
  } catch (error) {
    return {
      state: { ...pending, phase: "review" },
      outcome: "error",
      message: `${error instanceof Error ? error.message : String(error)} Use /plan to retry approval or Escape to pause.`,
    };
  }
}
