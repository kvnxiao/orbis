import { Type } from "typebox";
import type { Static } from "typebox";

import type { SourceTime } from "./evidence.ts";
import {
  decodeSpanReference,
  encodeReference,
  encodeSpanReference,
  entryReferenceOf,
  spanReferenceSchema,
} from "./references.ts";
import type { TextRange } from "./references.ts";
import { estimateTextTokens } from "./tokens.ts";

/**
 * Name a source's role: Pi's message role, or `bashExecution` for a shell command the user ran that
 * Pi includes in model context, which is user-attributed evidence.
 */
export const sourceRoleSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
  Type.Literal("toolResult"),
  Type.Literal("bashExecution"),
]);

/** Define a source's role. */
export type SourceRole = Static<typeof sourceRoleSchema>;

const roleLabels = {
  user: "user",
  assistant: "assistant",
  toolResult: "toolResult",
  bashExecution: "user shell command",
} satisfies Record<SourceRole, string>;

/** Return the label the observer prompt shows for a source role. */
export function sourceRoleLabel(role: SourceRole): string {
  return roleLabels[role];
}

// Bounds the recorded time a boundary renders, so presentation headers stay within their budget;
// Pi's ISO timestamps are far shorter.
const recordedAtLimit = 32;

/**
 * Validate a source boundary: the newest processed span on the selected lineage in branch order.
 *
 * `order` is the span's entry position on the branch that registered it; `role` is that entry's
 * role and `recordedAt` its recorded time, absent when unknown. A boundary names the conversation a
 * note summarizes through; it does not claim that earlier spans have no gaps.
 */
export const sourceBoundarySchema = Type.Object(
  {
    reference: spanReferenceSchema,
    order: Type.Integer({ minimum: 0 }),
    role: sourceRoleSchema,
    recordedAt: Type.Optional(Type.String({ maxLength: recordedAtLimit })),
  },
  { additionalProperties: false },
);

/** Define the source boundary that canonical notes and presentation records carry. */
export type SourceBoundary = Static<typeof sourceBoundarySchema>;

/**
 * Name a source's tool relationship: a tool result's call identifier, tool name, and error flag, or
 * the tool-call identifiers an assistant message issued. Every range of a split entry repeats it.
 */
export type ToolAttribution =
  | { kind: "result"; toolCallId: string; toolName: string; isError: boolean }
  | { kind: "calls"; toolCallIds: readonly string[] };

/**
 * Describe one branch message entry as the interval planner reads it.
 *
 * `reference` is the entry's span-`0` reference and `effectiveText` its text after context edits,
 * empty when `omitted` or when the entry has only attachments. `attachments` counts image content
 * blocks, which are outside the text representation. `excluded` names why an entry is never
 * assigned as new evidence: `recall` for a recalled excerpt; generated memory and status are custom
 * entries and never become sources. `tool` is absent for a message without tool calls.
 */
export interface ProjectedSource {
  reference: string;
  entryId: string;
  order: number;
  role: SourceRole;
  time: SourceTime;
  effectiveText: string;
  omitted: boolean;
  attachments: number;
  excluded: "recall" | undefined;
  tool?: ToolAttribution;
}

/**
 * Describe one span an observer reads.
 *
 * `reference` encodes `range` when the entry was split; `text` is exactly the assigned slice of the
 * entry's effective text, whose full length is `entryLength`. `tool` repeats the entry's tool
 * attribution on every range.
 */
export interface AssignedSpan {
  reference: string;
  entryId: string;
  order: number;
  role: ProjectedSource["role"];
  time: SourceTime;
  range: TextRange | undefined;
  entryLength: number;
  text: string;
  tool?: ToolAttribution;
}

/**
 * Describe an immutable observer assignment: spans in branch order with their estimated tokens.
 *
 * `tokens` is the estimate of every span's `renderSpanBlock` text. When a tool result immediately
 * follows an assistant message and does not fit the current interval, both start the next interval
 * if they fit together; a split keeps the result's tool-call identifier in its text.
 */
export interface SourceInterval {
  spans: readonly AssignedSpan[];
  tokens: number;
}

/**
 * Describe processed coverage on the selected lineage.
 *
 * `entries` holds span-`0` references of wholly processed entries; `ranges` holds the processed
 * ranges of split entries by their span-`0` reference, sorted and merged.
 */
export interface ProcessedCoverage {
  entries: ReadonlySet<string>;
  ranges: ReadonlyMap<string, readonly TextRange[]>;
}

/**
 * Report an eligible span without committed processing coverage.
 *
 * `unprocessed` is an entry without coverage; `partial` is a split entry with an unprocessed
 * remainder; `attachment` counts image blocks, which no worker in this version processes; `failed`
 * is an entry whose interval exhausted its attempts in the current storage session; `changed` is an
 * entry whose processed spans were dropped because their revision's evidence no longer matches.
 */
export type ProcessingGap =
  | { kind: "unprocessed"; reference: string }
  | { kind: "changed"; reference: string }
  | { kind: "partial"; reference: string; processed: readonly TextRange[] }
  | { kind: "attachment"; reference: string; count: number }
  | { kind: "failed"; reference: string };

function toolText(tool: ToolAttribution | undefined): string {
  if (tool === undefined) {
    return "";
  }
  if (tool.kind === "calls") {
    return `; tool calls ${tool.toolCallIds.join(", ")}`;
  }
  const outcome = tool.isError ? "failed" : "succeeded";
  return `; tool result for call ${tool.toolCallId} (${tool.toolName}), ${outcome}`;
}

/**
 * Render one assigned span as the observer reads it: a header line with its label, role, entry,
 * branch order, available time context, tool attribution, and range, then its text.
 *
 * Unknown time members render as `unknown`; nothing is inferred from processing time. Every range
 * of a split tool result repeats its call identifier, tool name, and outcome.
 */
export function renderSpanBlock(label: string, span: AssignedSpan): string {
  const range =
    span.range === undefined
      ? ""
      : `; characters ${String(span.range.start)}-${String(span.range.end)} of ${String(span.entryLength)}`;
  const header =
    `[${label}] ${sourceRoleLabel(span.role)} entry ${span.entryId}, order ${String(span.order)}; ` +
    `recorded ${span.time.recordedAt ?? "unknown"}; event time ${span.time.eventTime ?? "unknown"}; ` +
    `timezone ${span.time.timezone ?? "unknown"}${toolText(span.tool)}${range}`;
  return `${header}\n${span.text}`;
}

const widestLabel = "S99999";

function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

// Keeps the parts of sorted, merged ranges that lie within an entry's current text.
function clampRanges(ranges: readonly TextRange[] | undefined, length: number): TextRange[] {
  return (ranges ?? []).flatMap((range) =>
    range.start < length ? [{ start: range.start, end: Math.min(range.end, length) }] : [],
  );
}

function rangesCover(ranges: readonly TextRange[], length: number): boolean {
  const first = ranges[0];
  return ranges.length === 1 && first?.start === 0 && first.end >= length;
}

function covered(coverage: ProcessedCoverage, reference: string, length: number): boolean {
  return (
    coverage.entries.has(reference) ||
    rangesCover(clampRanges(coverage.ranges.get(reference), length), length)
  );
}

/**
 * Report whether processed coverage includes any part of a span reference: its whole entry, or a
 * range that intersects the span's range, or any range of its entry for a whole-entry span.
 *
 * Strings that `decodeSpanReference` rejects, including bare entry ids, never overlap.
 */
export function coverageOverlaps(coverage: ProcessedCoverage, reference: string): boolean {
  const decoded = decodeSpanReference(reference);
  if (decoded === undefined) {
    return false;
  }
  const entry = encodeReference(decoded.location);
  if (coverage.entries.has(entry)) {
    return true;
  }
  const ranges = coverage.ranges.get(entry) ?? [];
  const { range } = decoded;
  return range === undefined
    ? ranges.length > 0
    : ranges.some((merged) => merged.start < range.end && range.start < merged.end);
}

/**
 * Report whether a source has text that processing coverage must account for: it is not excluded,
 * not omitted from effective context, and not empty.
 */
export function eligibleSource(source: ProjectedSource): boolean {
  return source.excluded === undefined && !source.omitted && source.effectiveText !== "";
}

/**
 * Build processed coverage from the `sourceIds` of the revisions on the selected lineage.
 *
 * References must already be rebound to the current session and belong to its project. Strings that
 * `decodeSpanReference` rejects, including bare entry ids, are ignored; overlapping and adjacent
 * ranges merge.
 */
export function coverageOf(references: Iterable<string>): ProcessedCoverage {
  const entries = new Set<string>();
  const collected = new Map<string, TextRange[]>();
  for (const reference of references) {
    const decoded = decodeSpanReference(reference);
    if (decoded === undefined) {
      continue;
    }
    const entry = encodeReference(decoded.location);
    if (decoded.range === undefined) {
      entries.add(entry);
      continue;
    }
    const list = collected.get(entry);
    if (list === undefined) {
      collected.set(entry, [decoded.range]);
    } else {
      list.push(decoded.range);
    }
  }
  const ranges = new Map<string, readonly TextRange[]>();
  for (const [entry, list] of collected) {
    ranges.set(entry, mergeRanges(list));
  }
  return { entries, ranges };
}

/**
 * Report eligible sources that coverage does not account for, in branch order.
 *
 * Gaps are a set difference, so a later processed interval never conceals an earlier gap. Excluded,
 * omitted, and empty entries have no text gap. An entry with an exhausted span in `failed` reports
 * `failed` until it is covered; otherwise one with a span in `changed`, the span references whose
 * processing was dropped for changed evidence, reports `changed`. Processed ranges count only
 * within the entry's current text. An entry with attachments also reports an `attachment` gap, even
 * when its text is processed.
 */
export function processingGaps(
  sources: readonly ProjectedSource[],
  coverage: ProcessedCoverage,
  failed: ReadonlySet<string>,
  changed: ReadonlySet<string>,
): ProcessingGap[] {
  const failedEntries = new Set([...failed].map((reference) => entryReferenceOf(reference)));
  const changedEntries = new Set([...changed].map((reference) => entryReferenceOf(reference)));
  const gaps: ProcessingGap[] = [];
  for (const source of sources) {
    const { reference } = source;
    const length = source.effectiveText.length;
    if (eligibleSource(source) && !covered(coverage, reference, length)) {
      const processed = clampRanges(coverage.ranges.get(reference), length);
      if (failedEntries.has(reference)) {
        gaps.push({ kind: "failed", reference });
      } else if (changedEntries.has(reference)) {
        gaps.push({ kind: "changed", reference });
      } else if (processed.length > 0) {
        gaps.push({ kind: "partial", reference, processed });
      } else {
        gaps.push({ kind: "unprocessed", reference });
      }
    }
    if (source.excluded === undefined && source.attachments > 0) {
      gaps.push({ kind: "attachment", reference, count: source.attachments });
    }
  }
  return gaps;
}

/**
 * Return the newest processed span in branch order with its entry's role and recorded time, or
 * `undefined` when nothing is processed.
 */
export function sourceBoundary(
  sources: readonly ProjectedSource[],
  coverage: ProcessedCoverage,
): SourceBoundary | undefined {
  for (const source of sources.toSorted((left, right) => right.order - left.order)) {
    const { order, role } = source;
    const { recordedAt } = source.time;
    const time =
      recordedAt === undefined || recordedAt.length > recordedAtLimit ? {} : { recordedAt };
    if (coverage.entries.has(source.reference)) {
      return { reference: source.reference, order, role, ...time };
    }
    const last = coverage.ranges.get(source.reference)?.at(-1);
    const decoded = decodeSpanReference(source.reference);
    if (last !== undefined && decoded !== undefined) {
      return { reference: encodeSpanReference(decoded.location, last), order, role, ...time };
    }
  }
  return undefined;
}

function uncoveredSegments(taken: readonly TextRange[], length: number): TextRange[] {
  const segments: TextRange[] = [];
  let cursor = 0;
  for (const range of clampRanges(taken, length)) {
    if (range.start > cursor) {
      segments.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < length) {
    segments.push({ start: cursor, end: length });
  }
  return segments;
}

function spanOf(source: ProjectedSource, range: TextRange | undefined): AssignedSpan {
  const decoded = decodeSpanReference(source.reference);
  if (decoded === undefined) {
    throw new Error(`Invalid projected source reference: ${source.reference}`);
  }
  const text = source.effectiveText;
  return {
    reference: encodeSpanReference(decoded.location, range),
    entryId: source.entryId,
    order: source.order,
    role: source.role,
    time: source.time,
    range,
    entryLength: text.length,
    text: range === undefined ? text : text.slice(range.start, range.end),
    ...(source.tool === undefined ? {} : { tool: source.tool }),
  };
}

function spanTokens(span: AssignedSpan): number {
  return estimateTextTokens(renderSpanBlock(widestLabel, span));
}

// Splits one uncovered segment into ranges whose blocks fit `budgetTokens`, cutting before a low
// surrogate so a range never separates a surrogate pair. Returns no spans when even one character
// cannot fit.
function splitSegment(
  source: ProjectedSource,
  segment: TextRange,
  budgetTokens: number,
): AssignedSpan[] {
  const probe = spanOf(source, { start: segment.end - 1, end: segment.end });
  const headerTokens = estimateTextTokens(renderSpanBlock(widestLabel, { ...probe, text: "" })) + 1;
  const chunk = (budgetTokens - headerTokens) * 4;
  if (chunk < 2) {
    return [];
  }
  const text = source.effectiveText;
  const spans: AssignedSpan[] = [];
  let start = segment.start;
  while (start < segment.end) {
    let end = Math.min(start + chunk, segment.end);
    const code = text.charCodeAt(end);
    if (end < segment.end && code >= 0xdc00 && code <= 0xdfff) {
      end--;
    }
    spans.push(spanOf(source, { start, end }));
    start = end;
  }
  return spans;
}

function candidateSpans(
  source: ProjectedSource,
  taken: ProcessedCoverage,
  budgetTokens: number,
): AssignedSpan[] {
  const length = source.effectiveText.length;
  if (!eligibleSource(source) || covered(taken, source.reference, length)) {
    return [];
  }
  const ranges = clampRanges(taken.ranges.get(source.reference), length);
  if (ranges.length === 0) {
    const whole = spanOf(source, undefined);
    if (spanTokens(whole) <= budgetTokens) {
      return [whole];
    }
  }
  return uncoveredSegments(ranges, length).flatMap((segment) =>
    splitSegment(source, segment, budgetTokens),
  );
}

function pack(spans: readonly AssignedSpan[], budgetTokens: number): SourceInterval[] {
  const intervals: { spans: AssignedSpan[]; tokens: number }[] = [];
  let current: { spans: AssignedSpan[]; tokens: number } = { spans: [], tokens: 0 };
  for (const span of spans) {
    const tokens = spanTokens(span);
    if (current.tokens + tokens <= budgetTokens) {
      current.spans.push(span);
      current.tokens += tokens;
      continue;
    }
    const next: { spans: AssignedSpan[]; tokens: number } = { spans: [span], tokens };
    const previous = current.spans.at(-1);
    if (span.role === "toolResult" && previous?.role === "assistant" && current.spans.length > 1) {
      const previousTokens = spanTokens(previous);
      if (previousTokens + tokens <= budgetTokens) {
        current.spans.pop();
        current.tokens -= previousTokens;
        next.spans.unshift(previous);
        next.tokens += previousTokens;
      }
    }
    if (current.spans.length > 0) {
      intervals.push(current);
    }
    current = next;
  }
  if (current.spans.length > 0) {
    intervals.push(current);
  }
  return intervals;
}

/**
 * Plan observer intervals over uncovered eligible text in branch order.
 *
 * Skips excluded, omitted, and empty entries, covered spans, and spans in `claimed` (queued,
 * running, or failed span references). Each interval's estimated tokens stay within `budgetTokens`.
 * An entry whose uncovered text does not fit one span becomes consecutive ranges split at
 * code-point boundaries; each range is its own span, so an unseen suffix is never claimed.
 * Attachments are never assigned. Returns at most `maxIntervals` intervals; later eligible text
 * stays unassigned on disk.
 */
export function planIntervals(
  sources: readonly ProjectedSource[],
  coverage: ProcessedCoverage,
  claimed: ReadonlySet<string>,
  limits: { budgetTokens: number; maxIntervals: number },
): SourceInterval[] {
  const claimedCoverage = coverageOf(claimed);
  const taken: ProcessedCoverage = {
    entries: new Set([...coverage.entries, ...claimedCoverage.entries]),
    ranges: new Map(
      [...new Set([...coverage.ranges.keys(), ...claimedCoverage.ranges.keys()])].map((key) => [
        key,
        mergeRanges([
          ...(coverage.ranges.get(key) ?? []),
          ...(claimedCoverage.ranges.get(key) ?? []),
        ]),
      ]),
    ),
  };
  const spans = sources.flatMap((source) => candidateSpans(source, taken, limits.budgetTokens));
  return pack(spans, limits.budgetTokens).slice(0, limits.maxIntervals);
}
