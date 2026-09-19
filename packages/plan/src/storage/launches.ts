import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { PlanningError } from "../domain/errors.ts";
import { approvalSchema, validApprovalPayload } from "../domain/state.ts";
import { saveFailure, readSavedRecord, saveRecord } from "./persistence.ts";

/** Identify session entries that record authorized implementation attempts. */
export const launchEntryType = "orbis-plan-launch";

const launchSchema = Type.Object({
  version: Type.Literal(1),
  id: Type.String({ minLength: 1 }),
  approval: approvalSchema,
  destination: Type.Union([Type.Literal("here"), Type.Literal("new")]),
  originSessionId: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal("requested"), Type.Literal("received"), Type.Literal("failed")]),
  failure: Type.Optional(Type.String({ minLength: 1 })),
});

/** Record one launch without claiming that implementation has completed. */
export type LaunchRecord = Static<typeof launchSchema>;

/** Read launch records only from the disk-confirmed active branch. */
export function readLaunches(ctx: ExtensionContext): LaunchRecord[] {
  const saved = readSavedRecord(ctx, undefined, launchEntryType, true);
  if (saved.status === "unreadable") {
    throw new PlanningError("persistence", saved.message, { cause: saved });
  }
  if (saved.status === "none") {
    return [];
  }
  return saved.records.map((entry) => {
    let data: unknown;
    if (entry.type === "custom") {
      data = entry.data;
    } else if (entry.type === "custom_message") {
      data = entry.details;
    }
    if (
      !Value.Check(launchSchema, data) ||
      !validApprovalPayload(data.approval) ||
      (data.status === "failed") !== (data.failure !== undefined)
    ) {
      throw new PlanningError("persistence", "Invalid implementation launch record.");
    }
    return structuredClone(data);
  });
}

/** Confirm launch intent on disk before dispatching a prompt or session replacement. */
export function saveLaunch(pi: ExtensionAPI, ctx: ExtensionContext, record: LaunchRecord): void {
  const result = saveRecord(pi, ctx, record, undefined, launchEntryType);
  if (!result.saved) {
    throw saveFailure(result);
  }
}
