import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import type { SaveResult } from "./persistence.ts";
import type { PlanApproval, PlanningSession } from "./state.ts";

export function saveApproval(
  state: PlanningSession,
  directory: string,
  persist: (state: PlanningSession) => SaveResult,
): { state: PlanningSession; outcome: "approval" | "error"; message: string } {
  const review = state.reviews?.at(-1);
  if (
    state.phase !== "saving" ||
    review?.status !== "pending" ||
    !/^[a-f0-9-]{36}$/.test(state.planId) ||
    !isAbsolute(directory)
  ) {
    return {
      state,
      outcome: "error",
      message: "Approval requires the current reviewed revision and an absolute output directory.",
    };
  }
  const priorIntent = state.pendingApproval;
  const intent: PlanApproval = priorIntent ?? {
    version: 1,
    planId: state.planId,
    revision: review.revision,
    sessionId: state.sessionId,
    cwd: state.cwd,
    planPath: join(directory, `${state.planId}-${String(review.revision)}.md`),
    planContent: review.markdown,
    approvedAt: new Date().toISOString(),
  };
  if (
    intent.planId !== state.planId ||
    intent.revision !== review.revision ||
    intent.planContent !== review.markdown ||
    !isAbsolute(intent.planPath)
  ) {
    return {
      state,
      outcome: "error",
      message: "An earlier approval needs reconciliation before another revision can be approved.",
    };
  }
  const pending: PlanningSession = { ...state, pendingApproval: intent };
  try {
    const prepared = persist(pending);
    if (!prepared.saved) {
      throw new Error(prepared.message);
    }
    mkdirSync(dirname(intent.planPath), { recursive: true });
    if (existsSync(intent.planPath)) {
      if (
        priorIntent === undefined ||
        readFileSync(intent.planPath, "utf8") !== intent.planContent
      ) {
        throw new Error(
          `The approval path already exists: ${intent.planPath}. Preserve this file and resolve the collision before retrying.`,
        );
      }
    } else {
      const temporary = `${intent.planPath}.${randomUUID()}.tmp`;
      const descriptor = openSync(temporary, "wx");
      try {
        try {
          writeFileSync(descriptor, intent.planContent, "utf8");
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        linkSync(temporary, intent.planPath);
      } finally {
        unlinkSync(temporary);
      }
    }
    if (readFileSync(intent.planPath, "utf8") !== review.markdown) {
      throw new Error("Saved plan bytes differ from the reviewed revision.");
    }
    const accepted: PlanningSession = {
      ...pending,
      phase: "accepted",
      accepted: intent,
      reviews: [...(state.reviews?.slice(0, -1) ?? []), { ...review, status: "approved" }],
    };
    delete accepted.pendingApproval;
    const result = persist(accepted);
    if (!result.saved) {
      throw new Error(result.message);
    }
    return {
      state: accepted,
      outcome: "approval",
      message: `Approved plan saved to ${intent.planPath}.`,
    };
  } catch (error) {
    return {
      state: { ...pending, phase: "review" },
      outcome: "error",
      message: `Approval is incomplete: ${error instanceof Error ? error.message : String(error)}. Retry this exact revision to reconcile any saved file, or cancel.`,
    };
  }
}
