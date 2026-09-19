import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { PlanningError } from "../domain/errors.ts";
import { sameRecord } from "../domain/record-equality.ts";
import {
  runtimeResultSchema,
  sessionSchema,
  validSnapshot,
  validSession,
  approvalKey,
  validApprovalPayload,
} from "../domain/state.ts";
import type { PlanningSession, RuntimeResult } from "../domain/state.ts";
import { readLaunches } from "./launches.ts";
import { saveFailure, readSavedRecord, saveRecord } from "./persistence.ts";

const entryType = "orbis-plan-operation";
const base = {
  version: Type.Literal(1),
  key: Type.String({ minLength: 1 }),
  input: Type.Unknown(),
  sessionId: Type.String(),
  cwd: Type.String(),
};
const recordSchema = Type.Union([
  Type.Object({ ...base, status: Type.Literal("pending") }),
  Type.Object({
    ...base,
    status: Type.Literal("complete"),
    state: Type.Optional(sessionSchema),
    result: runtimeResultSchema,
  }),
]);

function validResult(result: RuntimeResult, state: PlanningSession | undefined): boolean {
  switch (result.outcome) {
    case "started":
    case "active":
      return sameRecord(result.plan, state);
    case "answers":
      return (
        state?.round?.submitted === true &&
        result.roundId === state.round.id &&
        result.revision === state.round.revision &&
        sameRecord(result.decisions, state.decisions) &&
        sameRecord(result.clarifications, state.round.clarifications)
      );
    case "clarification":
      return state?.phase === "clarification" && sameRecord(result.round, state.round);
    case "feedback":
      return (
        result.revision === state?.reviews?.at(-1)?.revision &&
        result.feedback === state.reviews.at(-1)?.feedback
      );
    case "approval":
    case "implementation":
      return validApprovalPayload(result.approval) && sameRecord(result.approval, state?.accepted);
    case "error":
    case "cancelled":
    case "unsupported-mode":
      return true;
  }
  throw new Error("Unknown planning result.");
}

/** Persist operation intent and replay results only against unchanged planning state. */
export async function runPlanningOperation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  key: string,
  input: unknown,
  readState: () => PlanningSession | undefined,
  current: () => boolean,
  perform: (begin: () => void) => Promise<RuntimeResult>,
): Promise<RuntimeResult> {
  const saved = readSavedRecord(ctx, undefined, entryType);
  if (saved.status === "unreadable") {
    throw new PlanningError("persistence", saved.message, { cause: saved });
  }
  const records = saved.status === "record" ? saved.records : [];
  const previous = records
    .map((entry) => {
      const data = entry.type === "custom" ? entry.data : undefined;
      if (
        !Value.Check(recordSchema, data) ||
        (data.status === "complete" &&
          ((data.state !== undefined && !validSession(data.state)) ||
            !validResult(data.result, data.state)))
      ) {
        throw new PlanningError("persistence", "Invalid planning operation record.");
      }
      return data;
    })
    .findLast((record) => record.key === key);
  if (previous !== undefined) {
    if (!sameRecord(previous.input, input)) {
      return {
        outcome: "error",
        message:
          "Planning operation identity conflicts with different input. Reuse the original arguments for a retry.",
      };
    }
    if (
      previous.sessionId !== ctx.sessionManager.getSessionId() ||
      previous.cwd !== ctx.cwd ||
      !current()
    ) {
      return {
        outcome: "error",
        message: "Planning operation belongs to another session or has expired.",
      };
    }
    if (previous.status === "pending") {
      return {
        outcome: "error",
        message:
          "Planning operation is unfinished or its result is uncertain. Use plan_open or /plan to explicitly recover saved work; do not repeat the mutation.",
      };
    }
    if (!sameRecord(previous.state, readState())) {
      return {
        outcome: "error",
        message:
          "Planning operation was superseded by newer state. Use plan_open to inspect current work.",
      };
    }
    const result = previous.result;
    if (result.outcome === "implementation") {
      const latest = readLaunches(ctx).findLast(
        (launch) => approvalKey(launch.approval) === approvalKey(result.approval),
      );
      if (
        latest?.id !== result.launchId ||
        latest.status !== result.status ||
        latest.sessionId !== ctx.sessionManager.getSessionId()
      ) {
        return {
          outcome: "error",
          message:
            "Implementation launch changed after this planning result. Use plan_implement to inspect the current launch.",
        };
      }
    }
    if (
      (result.outcome === "approval" || result.outcome === "implementation") &&
      (readFileSync(result.approval.planPath, "utf8") !== result.approval.planContent ||
        (result.approval.notesPath !== undefined &&
          readFileSync(result.approval.notesPath, "utf8") !== result.approval.notesContent))
    ) {
      return {
        outcome: "error",
        message: "Approved artifacts changed. Use plan_open to recover the saved review.",
      };
    }
    return structuredClone(result);
  }
  if (!current()) {
    return { outcome: "cancelled" };
  }
  const intent = {
    version: 1 as const,
    key,
    input: structuredClone(input),
    sessionId: ctx.sessionManager.getSessionId(),
    cwd: ctx.cwd,
    status: "pending" as const,
  };
  const execution = { begun: false };
  const result = await perform(() => {
    const savedIntent = saveRecord(pi, ctx, intent, undefined, entryType);
    if (!savedIntent.saved) {
      throw saveFailure(savedIntent);
    }
    execution.begun = true;
  });
  if (!execution.begun) {
    return result;
  }
  if (!current()) {
    return { outcome: "cancelled" };
  }
  if (result.outcome === "error") {
    return result;
  }
  const state = readState();
  const planning = readSavedRecord(ctx);
  const confirmed =
    planning.status === "record" &&
    planning.entry.type === "custom" &&
    validSnapshot(planning.entry.data)
      ? planning.entry.data.active
      : undefined;
  if (!sameRecord(confirmed, state)) {
    throw new PlanningError("persistence", "Planning result is not confirmed on disk.");
  }
  const complete = {
    ...intent,
    status: "complete" as const,
    ...(state === undefined ? {} : { state: structuredClone(state) }),
    result: structuredClone(result),
  };
  if (!Value.Check(recordSchema, complete) || !validResult(result, state)) {
    throw new Error("Planning operation completed with inconsistent state.");
  }
  const persisted = saveRecord(pi, ctx, complete, undefined, entryType);
  if (!persisted.saved) {
    throw saveFailure(persisted);
  }
  return result;
}
