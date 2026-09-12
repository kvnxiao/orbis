import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import type { Round, RuntimeResult } from "../domain/state.ts";

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
  result: RuntimeResult,
  instructions?: string,
): Promise<AgentToolResult<ResultDetails>> {
  if (result.outcome === "error") {
    throw new Error(result.message);
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
    case "cancelled":
    case "feedback":
    case "unsupported-mode":
      break;
  }
  const details = structuredClone(projected);
  let guidance = instructions;
  if (result.outcome === "approval") {
    guidance =
      "Approval is saved. Acknowledge approval and finish this planning turn. Only an explicit implementation action authorizes execution; a scheduled handoff sends its own implementation prompt. Do not start implementation from this approval result alone.";
  } else if (result.outcome === "cancelled") {
    guidance =
      "The operation was cancelled without submission or approval; saved unfinished work remains resumable. Stop planning for this turn. When the user explicitly asks to resume, call plan_start with replace: false to reopen saved work. Cancellation does not establish that a plan is missing or unrecoverable. Do not replace it or request approval in chat.";
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
      ...(result.outcome === "approval" ? { terminate: true } : {}),
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
    ...(result.outcome === "approval" ? { terminate: true } : {}),
  };
}
