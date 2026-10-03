import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { SourceTime } from "../domain/evidence.ts";
import { eligibleSource, processingGaps } from "../domain/intervals.ts";
import type { ProcessedCoverage, ProjectedSource, ToolAttribution } from "../domain/intervals.ts";
import { encodeReference } from "../domain/references.ts";

/** Name one Pi message entry of a session branch. */
export type MessageEntry = Extract<SessionEntry, { type: "message" }>;

const textBlockSchema = Type.Object({ type: Type.Literal("text"), text: Type.String() });
const toolCallMarkerSchema = Type.Object({ type: Type.Literal("toolCall") });
const toolCallBlockSchema = Type.Object({
  type: Type.Literal("toolCall"),
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});
const toolResultSchema = Type.Object({
  toolCallId: Type.String(),
  toolName: Type.String(),
  isError: Type.Boolean(),
});
const blocksSchema = Type.Array(Type.Unknown());
// The fields of Pi's `bashExecution` message that a shell source records; `excludeFromContext`
// marks a `!!` command, which is never a source.
const shellExecutionSchema = Type.Object({
  command: Type.String(),
  output: Type.String(),
  exitCode: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  cancelled: Type.Boolean(),
  truncated: Type.Boolean(),
  fullOutputPath: Type.Optional(Type.String()),
  excludeFromContext: Type.Optional(Type.Boolean()),
});
const imageBlockSchema = Type.Object({ type: Type.Literal("image") });
const recallToolName = "recall";

// Pi's bounded nested-call record: no results, and `argumentsBytes` replaces oversized arguments.
const nestedCallsSchema = Type.Object({
  complete: Type.Boolean(),
  calls: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      argumentsBytes: Type.Optional(Type.Integer({ minimum: 0 })),
      status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("unfinished")]),
      durationMs: Type.Optional(Type.Number({ minimum: 0 })),
      error: Type.Optional(Type.String()),
    }),
  ),
});

// Fixed key order; JSON.stringify drops absent optional members, so equal records render equally.
// A record this version cannot read, such as one from a newer Pi, renders one fixed line so the
// entry stays registrable and its digest stays deterministic.
function nestedCallsText(nested: unknown): string {
  if (!Value.Check(nestedCallsSchema, nested)) {
    return "unrecognized record";
  }
  return JSON.stringify({
    complete: nested.complete,
    calls: nested.calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      argumentsBytes: call.argumentsBytes,
      status: call.status,
      durationMs: call.durationMs,
      error: call.error,
    })),
  });
}

function toolOf(message: MessageEntry["message"]): ToolAttribution | undefined {
  if (message.role === "toolResult") {
    const { toolCallId, toolName, isError } = message;
    return { kind: "result", toolCallId, toolName, isError };
  }
  const content: unknown = "content" in message ? message.content : undefined;
  const toolCallIds = Value.Check(blocksSchema, content)
    ? content.flatMap((block) => (Value.Check(toolCallBlockSchema, block) ? [block.id] : []))
    : [];
  return toolCallIds.length === 0 ? undefined : { kind: "calls", toolCallIds };
}

function attachmentsOf(message: MessageEntry["message"]): number {
  const content: unknown = "content" in message ? message.content : undefined;
  return Value.Check(blocksSchema, content)
    ? content.filter((block) => Value.Check(imageBlockSchema, block)).length
    : 0;
}

function shellText(message: MessageEntry["message"]): string {
  if (!Value.Check(shellExecutionSchema, message)) {
    throw new Error("Invalid shell command source metadata.");
  }
  const { command, exitCode, cancelled, truncated, output, fullOutputPath } = message;
  const status = { command, exitCode: exitCode ?? null, cancelled, truncated };
  const parts = [
    `User shell command: ${JSON.stringify(status)}`,
    output === "" ? "Output: none" : `Output:\n${output}`,
  ];
  if (fullOutputPath !== undefined) {
    parts.push(`Full output path (a reference; its contents were not read): ${fullOutputPath}`);
  }
  return parts.join("\n");
}

function textOf(message: MessageEntry["message"]): string {
  if (message.role === "bashExecution") {
    return shellText(message);
  }
  const parts: string[] = [];
  if (message.role === "toolResult") {
    if (!Value.Check(toolResultSchema, message)) {
      throw new Error("Invalid tool result source metadata.");
    }
    const { toolCallId, toolName, isError } = message;
    parts.push(`Tool result: ${JSON.stringify({ toolCallId, toolName, isError })}`);
    const nested: unknown = "nestedCalls" in message ? message.nestedCalls : undefined;
    if (nested !== undefined) {
      parts.push(`Nested calls: ${nestedCallsText(nested)}`);
    }
  }
  const content: unknown = "content" in message ? message.content : undefined;
  if (typeof content === "string") {
    parts.push(content);
  } else if (Value.Check(blocksSchema, content)) {
    for (const block of content) {
      if (Value.Check(textBlockSchema, block)) {
        parts.push(block.text);
      } else if (Value.Check(toolCallMarkerSchema, block)) {
        if (!Value.Check(toolCallBlockSchema, block)) {
          throw new Error("Invalid tool call source metadata.");
        }
        const { id, name, arguments: input } = block;
        parts.push(`Tool call: ${JSON.stringify({ id, name, arguments: input })}`);
      }
    }
  }
  return parts.join("\n");
}

function sourceTimestamp(entry: MessageEntry): string | undefined {
  const timestamp: unknown = "timestamp" in entry.message ? entry.message.timestamp : undefined;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  return /^\d{4}-\d\d-\d\dT/u.test(entry.timestamp) ? entry.timestamp : undefined;
}

function projectAllSources(
  branch: readonly SessionEntry[],
): ReturnType<typeof buildSessionProjection> {
  return buildSessionProjection(
    branch.map((entry) =>
      entry.type === "compaction"
        ? {
            type: "custom",
            id: entry.id,
            parentId: entry.parentId,
            timestamp: entry.timestamp,
            customType: "orbis-tiered-memory-projection",
            data: null,
          }
        : entry,
    ),
  );
}

/**
 * Describe one branch message entry that registration and projection read: its branch order, role,
 * raw text, the effective messages Pi builds for it after context edits, and their joined text.
 */
export interface MessageSource {
  entry: MessageEntry;
  order: number;
  role: ProjectedSource["role"];
  rawText: string;
  effective: MessageEntry["message"][];
  effectiveText: string;
}

function sourceRoleOf(message: MessageEntry["message"]): ProjectedSource["role"] | undefined {
  const { role } = message;
  if (role === "bashExecution") {
    return message.excludeFromContext === true ? undefined : role;
  }
  return role === "user" || role === "assistant" || role === "toolResult" ? role : undefined;
}

/**
 * Return the branch's message entries that have text or image blocks, in branch order, with their
 * raw and effective text.
 *
 * A user shell command that Pi includes in model context is a source whose text records its
 * command, exit status, cancellation, truncation, output, and the path of a saved full output as a
 * reference; one excluded from model context is not.
 *
 * Effective messages come from Pi's session projection with native compaction entries neutralized,
 * so a compacted entry stays a source. With `entryIds`, only those entries are read.
 *
 * @throws Error when tool-call, tool-result, or shell-command metadata is malformed.
 */
export function messageSources(
  branch: readonly SessionEntry[],
  entryIds?: ReadonlySet<string>,
): MessageSource[] {
  const effective = new Map(
    projectAllSources(branch).entries.map((entry) => [entry.sourceEntry.id, entry.messages]),
  );
  const sources: MessageSource[] = [];
  for (const [order, entry] of branch.entries()) {
    if (entry.type !== "message" || (entryIds !== undefined && !entryIds.has(entry.id))) {
      continue;
    }
    const role = sourceRoleOf(entry.message);
    if (role === undefined) {
      continue;
    }
    const rawText = textOf(entry.message);
    if (rawText === "" && attachmentsOf(entry.message) === 0) {
      continue;
    }
    const messages = effective.get(entry.id) ?? [];
    const effectiveText = messages
      .map((message) => textOf(message))
      .filter((text) => text !== "")
      .join("\n");
    sources.push({ entry, order, role, rawText, effective: messages, effectiveText });
  }
  return sources;
}

/**
 * Return an entry's source time: `recordedAt` from the transcript entry, and event time and
 * timezone from `context` when it supplies them.
 */
export function timeOf(entry: MessageEntry, context: SourceTime | undefined): SourceTime {
  const recordedAt = sourceTimestamp(entry);
  return {
    ...(recordedAt === undefined ? {} : { recordedAt }),
    ...(context?.eventTime === undefined ? {} : { eventTime: context.eventTime }),
    ...(context?.timezone === undefined ? {} : { timezone: context.timezone }),
  };
}

/**
 * Project the branch's message entries into the sources the interval planner reads, in branch
 * order, without reading or writing files.
 *
 * Includes the same entries as registration: every message with text or image blocks, so an
 * image-only message is projected with empty text and counted attachments and is never covered.
 * Text comes from the same representation, including `nestedCalls`; an unrecognized nested-call
 * record renders `Nested calls: unrecognized record`. Event time and timezone come from
 * `registered`, the registry's records; `recordedAt` comes from the entry. `attachments` counts
 * image blocks in the effective content, `tool` names the entry's tool call or result, and a
 * `recall` tool result is excluded as new evidence.
 *
 * @throws Error when tool-call, tool-result, or shell-command metadata is malformed.
 */
export function projectSources(
  branch: readonly SessionEntry[],
  scope: { projectId: string; sessionId: string },
  registered: readonly { entryId: string; time: SourceTime }[],
): ProjectedSource[] {
  return projectMessages(messageSources(branch), scope, registered);
}

/**
 * Project message sources that `messageSources` already read as `projectSources` does, so a caller
 * that also needs source records projects the branch once.
 */
export function projectMessages(
  messages: readonly MessageSource[],
  scope: { projectId: string; sessionId: string },
  registered: readonly { entryId: string; time: SourceTime }[],
): ProjectedSource[] {
  const times = new Map(registered.map((source) => [source.entryId, source.time]));
  return messages.map((source) => {
    const { entry } = source;
    const message = entry.message;
    const projected: ProjectedSource = {
      reference: encodeReference({ ...scope, entryId: entry.id, span: 0 }),
      entryId: entry.id,
      order: source.order,
      role: source.role,
      time: timeOf(entry, times.get(entry.id)),
      effectiveText: source.effectiveText,
      omitted: source.effective.length === 0,
      attachments: source.effective.reduce((count, item) => count + attachmentsOf(item), 0),
      excluded:
        message.role === "toolResult" && message.toolName === recallToolName ? "recall" : undefined,
    };
    const tool = toolOf(message);
    if (tool !== undefined) {
      projected.tool = tool;
    }
    return projected;
  });
}

/**
 * Return the eligible sources a native compaction discarded, in branch order, as `eligibleSource`
 * counts them for processing gaps.
 *
 * A compaction discards the branch entries before its `firstKeptEntryId`, or before the compaction
 * itself when that entry is not on `branch`. `sources` is `branch`'s projection, whose `order` is
 * the branch index.
 */
export function discardedSources(
  branch: readonly SessionEntry[],
  compaction: Extract<SessionEntry, { type: "compaction" }>,
  sources: readonly ProjectedSource[],
): ProjectedSource[] {
  const kept = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  const end = kept === -1 ? branch.indexOf(compaction) : kept;
  return sources.filter((source) => source.order < end && eligibleSource(source));
}

/**
 * Return the eligible sources a native compaction discarded whose text processed coverage does not
 * wholly account for, in branch order: unprocessed entries and split entries with an unprocessed
 * range, as `processingGaps` reports them. Attachments, which no worker processes, do not count.
 */
export function uncoveredDiscarded(
  branch: readonly SessionEntry[],
  compaction: Extract<SessionEntry, { type: "compaction" }>,
  sources: readonly ProjectedSource[],
  coverage: ProcessedCoverage,
): ProjectedSource[] {
  const discarded = discardedSources(branch, compaction, sources);
  const uncovered = new Set(
    processingGaps(discarded, coverage, new Set(), new Set())
      .filter((gap) => gap.kind === "unprocessed" || gap.kind === "partial")
      .map((gap) => gap.reference),
  );
  return discarded.filter((source) => uncovered.has(source.reference));
}
