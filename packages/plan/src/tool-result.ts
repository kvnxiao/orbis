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
  switch (result.outcome) {
    case "error":
      throw new Error(result.message);
    case "unsupported-mode":
    case "started":
    case "active":
    case "cancelled":
    case "approval":
    case "feedback":
    case "answers":
    case "clarification":
      break;
  }
  const details = instructions === undefined ? result : { ...result, instructions };
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
