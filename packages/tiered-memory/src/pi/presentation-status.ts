import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { presentationHeaderTokens } from "../domain/settings.ts";
import type { SettingSource } from "../domain/settings.ts";
import { presentationMessageType, readPresentationEntry } from "../presentation/entries.ts";
import type { DamagedPresentation } from "../presentation/entries.ts";
import type { PresentationLog } from "../presentation/types.ts";
import type { CapacityStop, RequestLimits } from "./request-capacity.ts";

/**
 * Describe presentation for status.
 *
 * Token values are estimates, not provider usage; provider cache reads and writes of acting
 * requests are unknown in this version. `estimatedTokens`, `pending` (sent but not yet on the
 * branch), and `unconfirmed` (on the branch but not yet confirmed in the session file) describe the
 * acting presentation of the selected branch, `undefined` while storage is not open or memory is
 * disabled. `resets` counts confirmed reset records on the raw selected branch, including records
 * compaction later summarized, and never counts compactions; `lastReset` is the newest of them.
 * `limits` is the latest request's limits check, and `stop` the latest capacity stop with the
 * aborted assistant entry that followed its anchor on the selected branch.
 */
export interface PresentationStatus {
  budget: { tokens: number; source: SettingSource } | undefined;
  estimatedTokens: number | undefined;
  pending: number | undefined;
  unconfirmed: number | undefined;
  resets: number;
  lastReset: { reason: "budget"; tokensBefore: number; tokensAfter: number } | undefined;
  damaged: readonly DamagedPresentation[];
  limits: RequestLimits | undefined;
  stop: { stop: CapacityStop; abortedEntryId: string | undefined } | undefined;
  confirmationError: string | undefined;
}

// A stop whose anchor is not on the branch, as after tree navigation, attributes no response.
function abortedAfter(
  branch: readonly SessionEntry[],
  anchorId: string | undefined,
): string | undefined {
  const start = anchorId === undefined ? -1 : branch.findIndex((entry) => entry.id === anchorId);
  if (start === -1) {
    return undefined;
  }
  return branch
    .slice(start + 1)
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        (entry.message.stopReason === "error" || entry.message.stopReason === "aborted"),
    )?.id;
}

/**
 * Collect presentation status from the selected branch, the reconstructed `log`, the confirmed
 * entry ids, the effective budget, and the coordinator's latest checks.
 */
export function presentationStatusOf(input: {
  branch: readonly SessionEntry[];
  log: PresentationLog | undefined;
  projectId: string | undefined;
  confirmed: ReadonlySet<string>;
  budget: PresentationStatus["budget"];
  limits: RequestLimits | undefined;
  stop: CapacityStop | undefined;
  confirmationError: string | undefined;
}): PresentationStatus {
  let resets = 0;
  let lastReset: PresentationStatus["lastReset"];
  const damaged: DamagedPresentation[] = [];
  for (const entry of input.branch) {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      continue;
    }
    const read = readPresentationEntry(entry.details);
    if (read.kind === "damaged") {
      damaged.push({ entryId: entry.id, path: read.path });
    } else if (
      read.entry.kind === "reset" &&
      read.entry.lineage.projectId === input.projectId &&
      input.confirmed.has(entry.id)
    ) {
      resets++;
      const { reason, tokensBefore, tokensAfter } = read.entry;
      lastReset = { reason, tokensBefore, tokensAfter };
    }
  }
  const { log, stop } = input;
  return {
    budget: input.budget,
    estimatedTokens: log?.accumulatedTokens,
    pending: log?.records.filter((record) => record.entryId === undefined).length,
    unconfirmed: log?.records.filter((record) => record.entryId !== undefined && !record.confirmed)
      .length,
    resets,
    lastReset,
    damaged,
    limits: input.limits,
    stop:
      stop === undefined
        ? undefined
        : { stop, abortedEntryId: abortedAfter(input.branch, stop.anchorId) },
    confirmationError: input.confirmationError,
  };
}

const limitSources = {
  physical: "the selected model",
  "virtual-response": "the virtual model's latest response model, estimated",
  "virtual-declared": "the virtual model's declared limits, estimated",
} satisfies Record<Extract<RequestLimits, { kind: "known" }>["source"], string>;

function limitsLine(limits: RequestLimits | undefined): string[] {
  if (limits === undefined || limits.kind === "none") {
    return [];
  }
  if (limits.kind === "unknown") {
    return [
      `Request capacity: unknown for ${limits.modelId} because ${limits.reason}; requests are not stopped for capacity.`,
    ];
  }
  return [
    `Request capacity: ${String(limits.contextWindow)} tokens for ${limits.modelId}, from ${limitSources[limits.source]}.`,
  ];
}

/**
 * Render the status line of a capacity stop: its cause and estimates, whether an aborted response
 * `abortedEntryId` followed it, and the recovery for its cause.
 *
 * A presentation-budget stop names `requiredTokens` as the smallest `limits.presentationTokens`
 * that holds the note-only baseline. That value is valid with the current limits: it exceeds the
 * current budget, which `budgetsConflict` already held at or above the work-note and index budgets
 * plus three headers.
 */
export function capacityStopLine(stop: CapacityStop, abortedEntryId: string | undefined): string {
  const estimate = stop.estimate ? " estimated" : "";
  const what =
    stop.cause === "context-window"
      ? `the current-work note does not fit the context window of ${stop.modelId ?? "the selected model"}: ${String(stop.requiredTokens)}${estimate} tokens required, including ${String(stop.headroomTokens)} of generation headroom, ${String(stop.availableTokens)} available`
      : `the complete presentation baseline exceeds limits.presentationTokens: ${String(stop.requiredTokens)} estimated tokens required, ${String(stop.availableTokens)} allowed`;
  const recovery =
    stop.cause === "context-window"
      ? "Run /compact, or select a model with a larger context window, then retry."
      : `Set limits.presentationTokens to at least ${String(stop.requiredTokens)}, then retry. To restore the earlier limits.workNoteTokens instead, also set limits.presentationTokens to at least that limits.workNoteTokens plus limits.indexTokens plus ${String(3 * presentationHeaderTokens)}.`;
  const attribution =
    abortedEntryId === undefined
      ? "The request was stopped before dispatch."
      : `The aborted response ${abortedEntryId} was stopped by tiered memory, not cancelled by the user.`;
  return `Capacity stop: ${what}. ${attribution} ${recovery}`;
}

/**
 * Render presentation status lines; the wording is the user-facing contract that `docs/usage.md`
 * documents.
 */
export function presentationLines(status: PresentationStatus): string[] {
  const budget =
    status.budget === undefined
      ? "budget unavailable"
      : `budget ${String(status.budget.tokens)} estimated tokens (${status.budget.source})`;
  const presented =
    status.estimatedTokens === undefined
      ? "not presented"
      : `${String(status.estimatedTokens)} estimated tokens presented, ${String(status.pending ?? 0)} pending, ${String(status.unconfirmed ?? 0)} unconfirmed`;
  const lines = [`Presentation: complete appended revisions; ${budget}; ${presented}.`];
  const last = status.lastReset;
  lines.push(
    last === undefined
      ? `Presentation resets: ${String(status.resets)}; compactions are counted separately.`
      : `Presentation resets: ${String(status.resets)}, last for ${last.reason} from ${String(last.tokensBefore)} to ${String(last.tokensAfter)} estimated tokens; compactions are counted separately.`,
  );
  if (status.damaged.length > 0) {
    const listed = status.damaged
      .map((damaged) => `entry ${damaged.entryId} at ${damaged.path}`)
      .join(", ");
    lines.push(
      `Damaged presentation records on the active branch: ${String(status.damaged.length)} excluded (${listed})`,
    );
  }
  if (status.confirmationError !== undefined) {
    lines.push(`Presentation confirmation error: ${status.confirmationError}`);
  }
  lines.push(...limitsLine(status.limits));
  if (status.stop !== undefined) {
    lines.push(capacityStopLine(status.stop.stop, status.stop.abortedEntryId));
  }
  lines.push("Acting provider cache reads and writes: unknown in this version.");
  return lines;
}
