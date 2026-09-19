import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import { describe, isPlanningError, PlanningError } from "../domain/errors.ts";
import type { PlanningErrorKind } from "../domain/errors.ts";
import type { Round, RuntimeResult } from "../domain/state.ts";

const remediation = {
  "invalid-input": "Correct the payload and retry.",
  rejected: "",
  "revision-conflict": "Reload this revision before retrying.",
  "interaction-closed": "Stop using this interaction. Reopen current input with plan_open.",
  persistence:
    "Correct the storage error and reload Pi before retrying; preserve unsaved changes before reload.",
  settings: "Correct the named settings file and retry.",
  "artifact-conflict": "Preserve the file and resolve the conflict before retrying.",
} satisfies Record<PlanningErrorKind, string>;

function toolError(error: unknown): Error {
  if (!isPlanningError(error)) {
    return error instanceof Error ? error : new Error(describe(error), { cause: error });
  }
  let message = error.message;
  switch (error.kind) {
    case "revision-conflict":
      message += ` Current revision: ${String(error.data.current)}.`;
      break;
    case "persistence":
      if (error.data?.deferred === true) {
        return new Error(message, { cause: error });
      }
      break;
    case "settings":
    case "artifact-conflict":
    case "invalid-input":
    case "rejected":
    case "interaction-closed":
      break;
  }
  const advice = remediation[error.kind];
  return new Error(advice.length === 0 ? message : `${message} ${advice}`, { cause: error });
}

function submittedRound(round: Round): Round {
  return {
    ...round,
    drafts: Object.fromEntries(
      Object.entries(round.drafts).map(([id, draft]) => [
        id,
        {
          revision: draft.revision,
          unfinished: "",
          ...(draft.answer === undefined ? {} : { answer: draft.answer }),
        },
      ]),
    ),
  };
}

type ResultDetails =
  | Exclude<RuntimeResult, { outcome: "error" }>
  | { outcome: RuntimeResult["outcome"]; truncated: true; resultPath: string };

/** Project submitted state and spill oversized JSON without exposing local-only drafts. */
export async function toolResult(
  pending: RuntimeResult | Promise<RuntimeResult>,
  instructions?: string,
): Promise<AgentToolResult<ResultDetails>> {
  let result: RuntimeResult;
  try {
    result = await pending;
  } catch (error) {
    throw toolError(error);
  }
  if (result.outcome === "error") {
    throw toolError(
      "error" in result ? result.error : new PlanningError("rejected", result.message),
    );
  }
  let projected = result;
  switch (result.outcome) {
    case "clarification":
      projected = { ...result, round: submittedRound(result.round) };
      break;
    case "active":
    case "started":
      projected = {
        ...result,
        plan: {
          ...result.plan,
          ...(result.plan.round === undefined ? {} : { round: submittedRound(result.plan.round) }),
          ...(result.plan.history === undefined
            ? {}
            : {
                history: result.plan.history.map((entry) => ({
                  ...entry,
                  round: submittedRound(entry.round),
                })),
              }),
          ...(result.plan.reviews === undefined
            ? {}
            : {
                reviews: result.plan.reviews.map((review) => {
                  const submitted = { ...review, feedbackDraft: "" };
                  delete submitted.notes;
                  return submitted;
                }),
              }),
        },
      };
      break;
    case "answers":
    case "approval":
    case "implementation":
    case "cancelled":
    case "feedback":
    case "unsupported-mode":
      break;
  }
  const details = structuredClone(projected);
  let guidance = instructions;
  if (result.outcome === "approval") {
    guidance =
      "Approval is saved. Acknowledge approval and finish this planning turn. Only an explicit implementation action authorizes execution; a scheduled handoff starts a receiving turn whose plan_implement result supplies execution instructions. Do not start implementation from this approval result alone.";
  } else if (result.outcome === "implementation") {
    guidance =
      result.status === "received"
        ? "Continue the existing authorized implementation in this session. Read the approved Markdown and follow the execution instructions in this result. Use ordinary implementation tools; do not launch it again."
        : "This launch is already recorded. Report its status and finish this turn without creating another session or starting implementation here. Only an explicit restart authorizes another launch.";
  } else if (result.outcome === "cancelled") {
    guidance =
      "The operation was cancelled without submission or approval; saved unfinished work remains resumable. Stop planning for this turn. When the user explicitly asks to resume, call plan_open with replace: false to reopen saved work. Cancellation does not establish that a plan is missing or unrecoverable. Do not replace it or request approval in chat.";
  }
  const serialized = JSON.stringify(
    guidance === undefined ? details : { instructions: guidance, ...details },
    null,
    2,
  );
  const truncated = truncateHead(serialized);
  if (!truncated.truncated) {
    return {
      content: [{ type: "text", text: serialized }],
      details,
      ...(result.outcome === "approval" ||
      (result.outcome === "implementation" && result.status === "requested")
        ? { terminate: true }
        : {}),
    };
  }
  const directory = await mkdtemp(join(tmpdir(), "orbis-plan-result-"));
  const resultPath = join(directory, "result.json");
  await writeFile(resultPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const notice = `\n\nPlanning outcome: ${result.outcome}. Result truncated. Full JSON: ${resultPath}`;
  const preview = truncateHead(serialized, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice),
    maxLines: DEFAULT_MAX_LINES - 2,
  });
  return {
    content: [{ type: "text", text: `${preview.content}${notice}` }],
    details: { outcome: result.outcome, truncated: true, resultPath },
    ...(result.outcome === "approval" ||
    (result.outcome === "implementation" && result.status === "requested")
      ? { terminate: true }
      : {}),
  };
}
