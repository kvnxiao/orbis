import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import type { RuntimeResult } from "./state.ts";

type ResultDetails =
  | Exclude<RuntimeResult, { outcome: "error" }>
  | { outcome: RuntimeResult["outcome"]; truncated: true; resultPath: string };

export async function toolResult(
  result: RuntimeResult,
  instructions?: string,
): Promise<AgentToolResult<ResultDetails>> {
  if (result.outcome === "error") {
    throw new Error(result.message);
  }
  const projected = structuredClone(result);
  let round;
  switch (projected.outcome) {
    case "clarification":
      round = projected.round;
      break;
    case "active":
    case "started":
      round = projected.plan.round;
      break;
    case "answers":
    case "approval":
    case "cancelled":
    case "feedback":
    case "unsupported-mode":
      break;
  }
  const rounds = [
    round,
    ...(projected.outcome === "active" || projected.outcome === "started"
      ? (projected.plan.history ?? []).map((entry) => entry.round)
      : []),
  ];
  for (const item of rounds) {
    if (item === undefined) {
      continue;
    }
    for (const draft of Object.values(item.drafts)) {
      draft.unfinished = "";
      delete draft.options;
      delete draft.clarificationDraft;
    }
  }
  if (projected.outcome === "active" || projected.outcome === "started") {
    for (const review of projected.plan.reviews ?? []) {
      review.feedbackDraft = "";
      delete review.notes;
    }
  }
  const details = instructions === undefined ? projected : { ...projected, instructions };
  const serialized = JSON.stringify(details, null, 2);
  const truncated = truncateHead(serialized);
  if (!truncated.truncated) {
    return { content: [{ type: "text", text: serialized }], details };
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
  };
}
