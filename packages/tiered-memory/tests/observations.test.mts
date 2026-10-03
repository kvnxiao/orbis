import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { expect, test as vitest } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import {
  evidenceMatches,
  mayUseNote,
  sourceFingerprint,
  sourceReferences,
} from "../src/domain/evidence.ts";
import type { SourceEvidence } from "../src/domain/evidence.ts";
import {
  coverageOf,
  planIntervals,
  processingGaps,
  renderSpanBlock,
  sourceBoundary,
} from "../src/domain/intervals.ts";
import type { AssignedSpan, ProjectedSource, SourceInterval } from "../src/domain/intervals.ts";
import {
  observationCitationSchema,
  observationId,
  observationRecordSchema,
} from "../src/domain/observations.ts";
import {
  acceptObserverOutput,
  observerOutputSchema,
  observerRequest,
} from "../src/domain/observer.ts";
import type { ObserverInput, ObserverOutput, PreviousReference } from "../src/domain/observer.ts";
import { memoryProposalSchema, validateProposal } from "../src/domain/proposal.ts";
import {
  decodeSpanReference,
  encodeReference,
  encodeSpanReference,
  rebindReference,
  sourceIdSchema,
  spanReferenceSchema,
} from "../src/domain/references.ts";
import type { TextRange } from "../src/domain/references.ts";
import { estimateTextTokens } from "../src/domain/tokens.ts";
import { readLineageRecords } from "../src/storage/coverage.ts";
import { parseRecord } from "../src/storage/records.ts";
import { projectSources } from "../src/storage/source-projection.ts";
import type { SourceSessionManager } from "../src/storage/sources.ts";
import {
  baseProposal,
  committedId,
  openRegistry,
  openStore,
  rejectionPaths,
  test,
  zeroUsage,
} from "./store-fixture.mts";
import type { TestStore } from "./store-fixture.mts";

const projectId = "a".repeat(64);
const scope = { projectId, sessionId: "session-1" };
const recordedAt = "2026-03-01T09:30:00.000Z";

function ref(entryId: string, range?: TextRange): string {
  return encodeSpanReference({ ...scope, entryId, span: 0 }, range);
}

function projected(
  entryId: string,
  order: number,
  effectiveText: string,
  overrides: Partial<ProjectedSource> = {},
): ProjectedSource {
  return {
    reference: ref(entryId),
    entryId,
    order,
    role: "user",
    time: { recordedAt },
    effectiveText,
    omitted: false,
    attachments: 0,
    excluded: undefined,
    ...overrides,
  };
}

function span(entryId: string, order: number, text: string, overrides: Partial<AssignedSpan> = {}) {
  return {
    reference: ref(entryId),
    entryId,
    order,
    role: "user" as const,
    time: { recordedAt },
    range: undefined,
    entryLength: text.length,
    text,
    ...overrides,
  } satisfies AssignedSpan;
}

function intervalOf(...spans: AssignedSpan[]): SourceInterval {
  return { spans, tokens: 0 };
}

function inputOf(interval: SourceInterval, overrides: Partial<ObserverInput> = {}): ObserverInput {
  return { interval, previousNote: undefined, checkpoint: undefined, ...overrides };
}

const fingerprint = "f".repeat(64);

function accept(
  output: ObserverOutput,
  input: ObserverInput,
  workNoteTokens = 1024,
  evidenceFingerprint = fingerprint,
) {
  const request = observerRequest(input);
  return acceptObserverOutput(
    output,
    { labels: request.labels, interval: input.interval, evidenceFingerprint },
    workNoteTokens,
  );
}

function previousRef(reference: string): PreviousReference {
  return { reference, source: undefined };
}

const emptyNote = { status: "empty" } as const;

vitest("observationRecordSchema rejects a record missing citations at /citations", () => {
  expect(
    rejectionPaths(observationRecordSchema, { id: "o1", kind: "request", text: "x", ordinal: 0 }),
  ).toContain("/citations");
});

vitest("observationRecordSchema rejects an empty citation list at /citations", () => {
  const record = { id: "o1", kind: "request", text: "x", ordinal: 0, citations: [] };
  expect(rejectionPaths(observationRecordSchema, record)).toContain("/citations");
});

vitest("observationRecordSchema rejects a wrong-typed ordinal at /ordinal", () => {
  const citation = { kind: "checkpoint", entryId: "c1" };
  const record = { id: "o1", kind: "request", text: "x", ordinal: "0", citations: [citation] };
  expect(rejectionPaths(observationRecordSchema, record)).toContain("/ordinal");
});

vitest("observationRecordSchema rejects an unknown observation kind at /kind", () => {
  const citation = { kind: "checkpoint", entryId: "c1" };
  const record = { id: "o1", kind: "guess", text: "x", ordinal: 0, citations: [citation] };
  expect(rejectionPaths(observationRecordSchema, record)).toContain("/kind");
});

vitest("observationCitationSchema rejects a source citation missing its time at /time", () => {
  expect(
    rejectionPaths(observationCitationSchema, { kind: "source", reference: ref("e1"), order: 0 }),
  ).toContain("/time");
});

vitest.for([
  {
    label: "a response missing workNote",
    value: { observations: [] },
    path: "/workNote",
  },
  {
    label: "an unknown work-note status",
    value: { observations: [], workNote: { status: "other" } },
    path: "/workNote/status",
  },
  {
    label: "an updated note without a body",
    value: { observations: [], workNote: { status: "updated", sources: ["S1"] } },
    path: "/workNote",
  },
  {
    label: "an observation without labels",
    value: {
      observations: [{ kind: "request", text: "x", sources: [] }],
      workNote: emptyNote,
    },
    path: "/observations/0/sources",
  },
  {
    label: "a malformed label",
    value: {
      observations: [{ kind: "request", text: "x", sources: ["S0"] }],
      workNote: emptyNote,
    },
    path: "/observations/0/sources/0",
  },
])("observerOutputSchema rejects $label at $path", ({ value, path }) => {
  expect(rejectionPaths(observerOutputSchema, value)).toContain(path);
});

vitest("parseRecord rejects a malformed observer response with its failing path", () => {
  expect(() =>
    parseRecord(
      observerOutputSchema,
      '{"observations":[],"workNote":{"status":"other"}}',
      "response",
    ),
  ).toThrow("Invalid record at response: /workNote");
});

vitest("memoryProposalSchema rejects a proposal missing observations at /observations", () => {
  const { observations: _removed, ...rest } = baseProposal(scope);
  expect(rejectionPaths(memoryProposalSchema, rest)).toContain("/observations");
});

vitest("validateProposal rejects a source citation outside sourceIds and names its path", () => {
  const proposal = baseProposal(scope, {
    sourceIds: [ref("e1")],
    observations: [
      {
        id: "o1",
        kind: "request",
        text: "x",
        ordinal: 0,
        citations: [{ kind: "source", reference: ref("e2"), order: 1, time: {} }],
      },
    ],
  });
  expect(() => validateProposal(proposal)).toThrow(
    "/observations/0/citations/0/reference names a span outside /sourceIds",
  );
});

vitest("spanReferenceSchema accepts span 0 and a range and rejects noncanonical bounds", () => {
  expect(Value.Check(spanReferenceSchema, ref("e1"))).toBe(true);
  expect(Value.Check(spanReferenceSchema, ref("e1", { start: 0, end: 10 }))).toBe(true);
  expect(Value.Check(sourceIdSchema, ref("e1", { start: 4, end: 10 }))).toBe(true);
  expect(Value.Check(spanReferenceSchema, `${ref("e1").slice(0, -1)}01-10`)).toBe(false);
  expect(Value.Check(spanReferenceSchema, `${ref("e1").slice(0, -1)}a-10`)).toBe(false);
});

vitest("decodeSpanReference rejects an empty or reversed range", () => {
  expect(decodeSpanReference(`${ref("e1").slice(0, -1)}5-5`)).toBeUndefined();
  expect(decodeSpanReference(`${ref("e1").slice(0, -1)}9-5`)).toBeUndefined();
});

vitest("encodeSpanReference and decodeSpanReference round-trip a text range and span 0", () => {
  const range = { start: 12, end: 4000 };
  const reference = ref("e1", range);
  expect(reference).toBe(`tm1:${projectId}:session-1:e1:12-4000`);
  expect(decodeSpanReference(reference)).toEqual({
    location: { ...scope, entryId: "e1", span: 0 },
    range,
  });
  expect(decodeSpanReference(ref("e1"))).toEqual({
    location: { ...scope, entryId: "e1", span: 0 },
    range: undefined,
  });
});

vitest("rebindReference keeps a range while rebinding an ancestor reference", () => {
  const fork = { projectId, lineage: new Set(["session-1"]), childSessionId: "child" };
  expect(rebindReference(ref("e1", { start: 0, end: 8 }), fork)).toBe(
    `tm1:${projectId}:child:e1:0-8`,
  );
});

vitest("range evidence resolves to its entry record and its fingerprint includes the range", () => {
  const source = {
    reference: ref("e1"),
    entryId: "e1",
    rawDigest: "1".repeat(64),
    effectiveDigest: "1".repeat(64),
    omitted: false,
  };
  const ranged = ref("e1", { start: 0, end: 8 });
  const resolved = sourceReferences([source], [ranged]);
  expect(resolved.references).toEqual([ranged]);
  expect(resolved.evidenceFingerprint).not.toBe(sourceFingerprint([source], [ref("e1")]));
  expect(
    evidenceMatches(
      [source],
      { sourceIds: [ranged], evidenceFingerprint: resolved.evidenceFingerprint },
      projectId,
    ),
  ).toBe(true);
  expect(
    evidenceMatches(
      [{ ...source, effectiveDigest: "2".repeat(64) }],
      { sourceIds: [ranged], evidenceFingerprint: resolved.evidenceFingerprint },
      projectId,
    ),
  ).toBe(false);
});

vitest("whole-entry evidence keeps the fingerprint it had before ranges existed", () => {
  const source = {
    reference: ref("e1"),
    entryId: "e1",
    rawDigest: "1".repeat(64),
    effectiveDigest: "1".repeat(64),
    omitted: false,
  };
  const expected = digest(
    JSON.stringify([
      { effectiveDigest: "1".repeat(64), entryId: "e1", omitted: false, rawDigest: "1".repeat(64) },
    ]),
  );
  expect(sourceFingerprint([source], ["e1"])).toBe(expected);
});

function fullReference(id: string): string {
  const [entryId = "", range] = id.split(":");
  return `tm1:${projectId}:session-1:${entryId}:${range ?? "0"}`;
}

vitest.for([
  { consumed: ["e1"], proposed: "e1:0-100", reusable: false },
  { consumed: ["e1:0-100", "e1:100-200"], proposed: "e1", reusable: true },
  { consumed: ["e1:0-100", "e1:100-200"], proposed: "e1:0-150", reusable: false },
  { consumed: ["e1:0-100", "e1:100-200"], proposed: "e1:150-250", reusable: true },
  { consumed: ["e1:0-100"], proposed: "e2:0-50", reusable: true },
])(
  "a deleted note consumed by $consumed may be recreated from $proposed: $reusable",
  ({ consumed, proposed, reusable }) => {
    expect(
      mayUseNote(
        { kind: "deleted", consumedSourceIds: consumed.map(fullReference) },
        [fullReference(proposed)],
        scope,
      ),
    ).toBe(reusable);
  },
);

vitest("estimateTextTokens divides UTF-16 length by four and rounds up", () => {
  expect(estimateTextTokens("")).toBe(0);
  expect(estimateTextTokens("abcde")).toBe(2);
});

vitest(
  "acceptObserverOutput rejects a label outside the assigned interval and names its path",
  () => {
    const result = accept(
      {
        observations: [{ kind: "request", text: "x", sources: ["S1", "S2"] }],
        workNote: emptyNote,
      },
      inputOf(intervalOf(span("e1", 0, "Do it."))),
    );
    expect(result).toEqual({
      kind: "rejected",
      rejection: { kind: "unknown-label", path: "/observations/0/sources/1", label: "S2" },
    });
  },
);

vitest("acceptObserverOutput rejects an observation that cites a previous-note reference", () => {
  const result = accept(
    { observations: [{ kind: "constraint", text: "x", sources: ["P1"] }], workNote: emptyNote },
    inputOf(intervalOf(span("e2", 1, "Next.")), {
      previousNote: { body: "Old.", references: [previousRef(ref("e1"))], checkpointIds: [] },
    }),
  );
  expect(result).toMatchObject({
    kind: "rejected",
    rejection: { kind: "unknown-label", path: "/observations/0/sources/0", label: "P1" },
  });
});

vitest("acceptObserverOutput drops an exact duplicate observation and renumbers the rest", () => {
  const interval = intervalOf(span("e1", 0, "Use pnpm."), span("e2", 1, "Run tests."));
  const result = accept(
    {
      observations: [
        { kind: "constraint", text: "Use pnpm.", sources: ["S1", "S2"] },
        { kind: "constraint", text: "Use pnpm.", sources: ["S2", "S1", "S1"] },
        { kind: "request", text: "Run tests.", sources: ["S2"] },
      ],
      workNote: emptyNote,
    },
    inputOf(interval),
  );
  if (result.kind !== "accepted") {
    throw new Error("Expected an accepted response.");
  }
  expect(result.observations.map(({ text, ordinal }) => [text, ordinal])).toEqual([
    ["Use pnpm.", 0],
    ["Run tests.", 1],
  ]);
  expect(result.observations[0]?.citations.map((citation) => citation.kind)).toEqual([
    "source",
    "source",
  ]);
});

vitest("acceptObserverOutput accepts an empty observation list", () => {
  expect(
    accept(
      { observations: [], workNote: { status: "empty" } },
      inputOf(intervalOf(span("e1", 0, "Hi."))),
    ),
  ).toEqual({ kind: "accepted", observations: [], workNote: { status: "empty" } });
});

vitest("accepted citations copy each span's order, recorded time, event time, and timezone", () => {
  const time = { recordedAt, eventTime: "yesterday", timezone: "Europe/Paris" };
  const result = accept(
    {
      observations: [{ kind: "outcome", text: "Deployed.", sources: ["S1"] }],
      workNote: emptyNote,
    },
    inputOf(intervalOf(span("e7", 7, "I deployed yesterday.", { time }))),
  );
  expect(result).toMatchObject({
    kind: "accepted",
    observations: [{ citations: [{ kind: "source", reference: ref("e7"), order: 7, time }] }],
  });
});

vitest("a retried interval yields equal observation identities", () => {
  const interval = intervalOf(span("e1", 0, "Do it."));
  const output: ObserverOutput = {
    observations: [{ kind: "request", text: "Do it.", sources: ["S1"] }],
    workNote: emptyNote,
  };
  const first = accept(output, inputOf(interval));
  const retry = accept(output, inputOf(interval));
  expect(first).toEqual(retry);
  expect(observationId([ref("e1")], fingerprint, 0)).toMatch(/^[a-f0-9]{64}$/u);
});

vitest(
  "re-observing edited text under the same references yields new observation identities",
  () => {
    const interval = intervalOf(span("e1", 0, "Do it."));
    const output: ObserverOutput = {
      observations: [{ kind: "request", text: "Do it.", sources: ["S1"] }],
      workNote: emptyNote,
    };
    const before = accept(output, inputOf(interval), 1024, "a".repeat(64));
    const after = accept(output, inputOf(interval), 1024, "b".repeat(64));
    if (before.kind !== "accepted" || after.kind !== "accepted") {
      throw new Error("Expected accepted responses.");
    }
    expect(after.observations[0]?.id).not.toBe(before.observations[0]?.id);
    expect(before.observations[0]?.id).toBe(
      "bd09de3fd82c476f46f8d128cd095e4abbd20289b2dd6f1ff069a8667f391b06",
    );
  },
);

vitest("two attempts with identical error text keep distinct identities and references", () => {
  const output: ObserverOutput = {
    observations: [{ kind: "outcome", text: "Error: ENOENT", sources: ["S1"] }],
    workNote: emptyNote,
  };
  const first = accept(output, inputOf(intervalOf(span("e1", 0, "Error: ENOENT"))));
  const second = accept(output, inputOf(intervalOf(span("e2", 1, "Error: ENOENT"))));
  if (first.kind !== "accepted" || second.kind !== "accepted") {
    throw new Error("Expected accepted responses.");
  }
  expect(first.observations[0]?.id).not.toBe(second.observations[0]?.id);
  expect(first.observations[0]?.citations).not.toEqual(second.observations[0]?.citations);
});

vitest("planIntervals keeps whole entries that fit as span 0 in one interval", () => {
  const intervals = planIntervals(
    [projected("e1", 0, "First."), projected("e2", 1, "Second.")],
    coverageOf([]),
    new Set(),
    { budgetTokens: 200, maxIntervals: 4 },
  );
  expect(intervals.map((interval) => interval.spans.map((item) => item.reference))).toEqual([
    [ref("e1"), ref("e2")],
  ]);
});

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

vitest("planIntervals moves a cut that lands inside a surrogate pair to the pair's start", () => {
  // After the one-unit prefix, every even offset is the low half of a pair, and every unadjusted
  // cut is a multiple of four from the segment start.
  const text = `x${"😀".repeat(300)}`;
  const intervals = planIntervals(
    [projected("e1", 0, text, { role: "toolResult" })],
    coverageOf([]),
    new Set(),
    { budgetTokens: 120, maxIntervals: 50 },
  );
  const spans = intervals.flatMap((interval) => interval.spans);
  expect(spans.length).toBeGreaterThan(1);
  expect(spans[0]?.range?.start).toBe(0);
  expect((spans[0]?.range?.end ?? 0) % 2).toBe(1);
  expect(spans.at(-1)?.range?.end).toBe(text.length);
  for (const [index, item] of spans.entries()) {
    const range = item.range ?? { start: -1, end: -1 };
    expect(item.text).toBe(text.slice(range.start, range.end));
    expect(isLowSurrogate(item.text.charCodeAt(0))).toBe(false);
    expect(isHighSurrogate(item.text.charCodeAt(item.text.length - 1))).toBe(false);
    expect(item.text.length).toBeLessThanOrEqual(120 * 4);
    expect(item.reference).toBe(
      `tm1:${projectId}:session-1:e1:${String(range.start)}-${String(range.end)}`,
    );
    if (index > 0) {
      expect(range.start).toBe(spans[index - 1]?.range?.end);
    }
  }
});

vitest(
  "every range of a failed split tool result keeps its call id, tool name, and failure",
  () => {
    const text = `${"log line\n".repeat(200)}Error: required failure`;
    const tool = { kind: "result", toolCallId: "call-7", toolName: "bash", isError: true } as const;
    const intervals = planIntervals(
      [projected("e1", 0, text, { role: "toolResult", tool })],
      coverageOf([]),
      new Set(),
      { budgetTokens: 150, maxIntervals: 50 },
    );
    const last = intervals.at(-1);
    if (last === undefined || intervals.length < 2) {
      throw new Error("Expected the result to span several intervals.");
    }
    const request = observerRequest(inputOf(last));
    expect(request.prompt).toContain("; tool result for call call-7 (bash), failed; characters ");
    expect(
      intervals.every((interval) =>
        interval.spans.every((item) =>
          renderSpanBlock("S1", item).includes("call call-7 (bash), failed"),
        ),
      ),
    ).toBe(true);
  },
);

vitest(
  "planIntervals assigns an error near the end of oversized output in its final ranges",
  () => {
    const text = `${"log line\n".repeat(200)}Error: required failure`;
    const intervals = planIntervals(
      [projected("e1", 0, text, { role: "toolResult" })],
      coverageOf([]),
      new Set(),
      { budgetTokens: 150, maxIntervals: 50 },
    );
    const spans = intervals.flatMap((interval) => interval.spans);
    expect(spans.map((item) => item.text).join("")).toBe(text);
    expect(spans.at(-1)?.range?.end).toBe(text.length);
    expect(
      spans
        .slice(-2)
        .map((item) => item.text)
        .join(""),
    ).toContain("Error: required failure");
  },
);

vitest("planIntervals assigns only the unprocessed remainder of a split entry", () => {
  const text = "a".repeat(1000);
  const coverage = coverageOf([ref("e1", { start: 0, end: 400 })]);
  const intervals = planIntervals([projected("e1", 0, text)], coverage, new Set(), {
    budgetTokens: 1000,
    maxIntervals: 4,
  });
  expect(intervals.flatMap((interval) => interval.spans.map((item) => item.range))).toEqual([
    { start: 400, end: 1000 },
  ]);
});

vitest(
  "planIntervals skips attachments, recalled excerpts, omitted entries, and claimed spans",
  () => {
    const sources = [
      projected("e1", 0, "Look at this image.", { attachments: 1 }),
      projected("e2", 1, "Recalled excerpt.", { role: "toolResult", excluded: "recall" }),
      projected("e3", 2, "", { omitted: true }),
      projected("e4", 3, "Queued already."),
      projected("e5", 4, "New."),
    ];
    const intervals = planIntervals(sources, coverageOf([]), new Set([ref("e4")]), {
      budgetTokens: 500,
      maxIntervals: 4,
    });
    expect(intervals.flatMap((interval) => interval.spans.map((item) => item.entryId))).toEqual([
      "e1",
      "e5",
    ]);
    expect(intervals[0]?.spans[0]?.text).toBe("Look at this image.");
  },
);

vitest("planIntervals keeps a tool call and its result in one interval when both fit", () => {
  const sources = [
    projected("e1", 0, "u".repeat(160)),
    projected("e2", 1, "Tool call: read", { role: "assistant" }),
    projected("e3", 2, "r".repeat(160), { role: "toolResult" }),
  ];
  const intervals = planIntervals(sources, coverageOf([]), new Set(), {
    budgetTokens: 140,
    maxIntervals: 4,
  });
  expect(intervals.map((interval) => interval.spans.map((item) => item.entryId))).toEqual([
    ["e1"],
    ["e2", "e3"],
  ]);
});

vitest("planIntervals returns at most maxIntervals and leaves later text unassigned", () => {
  const sources = [0, 1, 2].map((order) => projected(`e${String(order)}`, order, "t".repeat(300)));
  const intervals = planIntervals(sources, coverageOf([]), new Set(), {
    budgetTokens: 120,
    maxIntervals: 2,
  });
  expect(intervals.map((interval) => interval.spans.map((item) => item.entryId))).toEqual([
    ["e0"],
    ["e1"],
  ]);
});

vitest("coverageOf merges overlapping ranges and ignores bare ids", () => {
  const coverage = coverageOf([
    ref("e1", { start: 0, end: 10 }),
    ref("e1", { start: 5, end: 20 }),
    ref("e1", { start: 20, end: 30 }),
    ref("e2"),
    "e3",
  ]);
  expect([...coverage.entries]).toEqual([ref("e2")]);
  expect(coverage.ranges.get(ref("e1"))).toEqual([{ start: 0, end: 30 }]);
});

vitest(
  "processingGaps reports an intervening failed interval after a later interval commits",
  () => {
    const sources = [
      projected("e1", 0, "One."),
      projected("e2", 1, "Two."),
      projected("e3", 2, "Three."),
    ];
    expect(
      processingGaps(sources, coverageOf([ref("e1"), ref("e3")]), new Set([ref("e2")]), new Set()),
    ).toEqual([{ kind: "failed", reference: ref("e2") }]);
    expect(
      processingGaps(sources, coverageOf([ref("e1"), ref("e3")]), new Set(), new Set()),
    ).toEqual([{ kind: "unprocessed", reference: ref("e2") }]);
  },
);

vitest("processingGaps reports an attachment gap for an entry whose text is processed", () => {
  expect(
    processingGaps(
      [projected("e1", 0, "See image.", { attachments: 2 })],
      coverageOf([ref("e1")]),
      new Set(),
      new Set(),
    ),
  ).toEqual([{ kind: "attachment", reference: ref("e1"), count: 2 }]);
});

vitest("processingGaps reports a split entry's unprocessed remainder as partial", () => {
  const processed = { start: 0, end: 4 };
  expect(
    processingGaps(
      [projected("e1", 0, "abcdefgh")],
      coverageOf([ref("e1", processed)]),
      new Set(),
      new Set(),
    ),
  ).toEqual([{ kind: "partial", reference: ref("e1"), processed: [processed] }]);
  expect(
    processingGaps(
      [projected("e1", 0, "abcdefgh")],
      coverageOf([ref("e1", processed), ref("e1", { start: 4, end: 8 })]),
      new Set(),
      new Set(),
    ),
  ).toEqual([]);
});

vitest("processingGaps reports an entry whose processing was dropped for changed evidence", () => {
  const sources = [projected("e1", 0, "One."), projected("e2", 1, "Two.")];
  expect(processingGaps(sources, coverageOf([ref("e2")]), new Set(), new Set([ref("e1")]))).toEqual(
    [{ kind: "changed", reference: ref("e1") }],
  );
  expect(
    processingGaps(sources, coverageOf([]), new Set([ref("e1")]), new Set([ref("e1")])),
  ).toEqual([
    { kind: "failed", reference: ref("e1") },
    { kind: "unprocessed", reference: ref("e2") },
  ]);
});

vitest(
  "a split entry whose text shrank below its processed ranges yields no false partial gap or reversed segment",
  () => {
    const shrunk = [projected("e1", 0, "abcde")];
    const stale = coverageOf([ref("e1", { start: 0, end: 4 }), ref("e1", { start: 6, end: 9 })]);
    expect(processingGaps(shrunk, stale, new Set(), new Set())).toEqual([
      { kind: "partial", reference: ref("e1"), processed: [{ start: 0, end: 4 }] },
    ]);
    const beyond = coverageOf([ref("e1", { start: 6, end: 9 })]);
    expect(processingGaps(shrunk, beyond, new Set(), new Set())).toEqual([
      { kind: "unprocessed", reference: ref("e1") },
    ]);
    const planned = planIntervals(shrunk, stale, new Set(), { budgetTokens: 500, maxIntervals: 4 });
    expect(planned.flatMap((interval) => interval.spans.map((assigned) => assigned.range))).toEqual(
      [{ start: 4, end: 5 }],
    );
    expect(
      planIntervals(shrunk, beyond, new Set(), { budgetTokens: 500, maxIntervals: 4 }),
    ).toMatchObject([{ spans: [{ range: undefined, text: "abcde" }] }]);
  },
);

vitest(
  "sourceBoundary names the newest processed span rather than a contiguous prefix end, with its role and recorded time",
  () => {
    const sources = [
      projected("e1", 0, "One."),
      projected("e2", 1, "Two."),
      projected("e3", 2, "abcdefgh", { role: "bashExecution" }),
    ];
    expect(
      sourceBoundary(sources, coverageOf([ref("e1"), ref("e3", { start: 0, end: 4 })])),
    ).toEqual({
      reference: ref("e3", { start: 0, end: 4 }),
      order: 2,
      role: "bashExecution",
      recordedAt: "2026-03-01T09:30:00.000Z",
    });
    expect(
      sourceBoundary([projected("e1", 0, "One.", { time: {} })], coverageOf([ref("e1")])),
    ).toEqual({ reference: ref("e1"), order: 0, role: "user" });
    expect(sourceBoundary(sources, coverageOf([]))).toBeUndefined();
  },
);

vitest("observerRequest labels each span with its role, order, and available source time", () => {
  const request = observerRequest(
    inputOf(
      intervalOf(
        span("e1", 3, "Ship it.", {
          time: { recordedAt, eventTime: "2026-02-28", timezone: "UTC" },
        }),
        span("e2", 4, "Done.", { role: "assistant" }),
      ),
    ),
  );
  expect(request.prompt).toContain(
    `[S1] user entry e1, order 3; recorded ${recordedAt}; event time 2026-02-28; timezone UTC\nShip it.`,
  );
  expect(request.prompt).toContain("[S2] assistant entry e2, order 4;");
  expect([...request.labels.spans.keys()]).toEqual(["S1", "S2"]);
});

vitest("observerRequest marks missing or ambiguous date and timezone context as unknown", () => {
  const request = observerRequest(
    inputOf(intervalOf(span("e1", 0, "Yesterday it broke.", { time: {} }))),
  );
  expect(request.prompt).toContain("recorded unknown; event time unknown; timezone unknown");
});

vitest(
  "observerRequest distinguishes requests, questions, proposals, attempts, outcomes, corrections, and completion claims",
  () => {
    const { systemPrompt } = observerRequest(inputOf(intervalOf(span("e1", 0, "x"))));
    for (const kind of [
      '"request"',
      '"question"',
      '"proposal"',
      '"attempt"',
      '"outcome"',
      '"correction"',
      '"completion-claim"',
    ]) {
      expect(systemPrompt).toContain(kind);
    }
    expect(systemPrompt).toContain("A failed command is an attempt with a failed outcome");
    expect(systemPrompt).toContain("Keep exact identifiers");
  },
);

vitest("observerRequest anchors relative dates only to unambiguous source time", () => {
  const { systemPrompt } = observerRequest(inputOf(intervalOf(span("e1", 0, "x"))));
  expect(systemPrompt).toContain("only from that source's unambiguous time context");
  expect(systemPrompt).toContain("never invent a date or timezone");
  expect(systemPrompt).toContain("Later processing does not make older evidence newer");
});

vitest(
  "observerRequest includes the previous note, its references, and an applicable checkpoint",
  () => {
    const request = observerRequest(
      inputOf(intervalOf(span("e3", 2, "Continue.")), {
        previousNote: {
          body: "Fix the parser.",
          references: [previousRef(ref("e1"))],
          checkpointIds: ["c0"],
        },
        checkpoint: { entryId: "c9", summary: "Earlier: tests were paused." },
      }),
    );
    expect(request.prompt).toContain(
      "Previous current-work note (continuity state, not evidence):\nFix the parser.",
    );
    expect(request.prompt).toContain(
      "a retained claim cites only the P labels that support it:\n[P1] source " +
        ref("e1") +
        ", not on the active branch\n[P2] native checkpoint entry c0",
    );
    expect(request.prompt).toContain(
      "Native checkpoint [C1], entry c9:\nEarlier: tests were paused.",
    );
    expect([...request.labels.previous]).toEqual([
      ["P1", { kind: "source", reference: ref("e1") }],
      ["P2", { kind: "checkpoint", entryId: "c0" }],
    ]);
    expect([...request.labels.checkpoint]).toEqual([["C1", "c9"]]);
  },
);

vitest(
  "a delayed yesterday statement keeps its recorded time in input and committed citations",
  () => {
    const time = { recordedAt: "2026-01-10T08:00:00.000Z" };
    const input = inputOf(intervalOf(span("e1", 0, "The build broke yesterday.", { time })));
    expect(observerRequest(input).prompt).toContain("recorded 2026-01-10T08:00:00.000Z");
    const result = accept(
      {
        observations: [{ kind: "outcome", text: "The build broke yesterday.", sources: ["S1"] }],
        workNote: emptyNote,
      },
      input,
    );
    expect(result).toMatchObject({ observations: [{ citations: [{ time }] }] });
  },
);

vitest(
  "an older dated log after a confirmed current setting keeps its own source time and order",
  () => {
    const current = span("e1", 0, "Setting is now B.", {
      time: { recordedAt: "2026-02-02T00:00:00.000Z" },
    });
    const log = span("e2", 1, "2025-12-01: setting A", {
      role: "toolResult",
      time: { recordedAt: "2026-02-03T00:00:00.000Z", eventTime: "2025-12-01" },
    });
    const result = accept(
      {
        observations: [
          { kind: "decision", text: "Setting is B.", sources: ["S1"] },
          { kind: "outcome", text: "Old log shows A.", sources: ["S2"] },
        ],
        workNote: emptyNote,
      },
      inputOf(intervalOf(current, log)),
    );
    expect(result).toMatchObject({
      observations: [
        { citations: [{ order: 0, time: current.time }] },
        { citations: [{ order: 1, time: log.time }] },
      ],
    });
  },
);

function messageEntry(
  id: string,
  parentId: string | null,
  message: Extract<SessionEntry, { type: "message" }>["message"],
): SessionEntry {
  return { type: "message", id, parentId, timestamp: recordedAt, message };
}

const userMessage = (text: string): UserMessage => ({ role: "user", content: text, timestamp: 1 });

const assistantCall: AssistantMessage = {
  role: "assistant",
  content: [{ type: "toolCall", id: "call-1", name: "codemode", arguments: { script: "x" } }],
  api: "fixture",
  provider: "fixture",
  model: "fixture",
  usage: zeroUsage,
  stopReason: "toolUse",
  timestamp: 2,
};

const nestedCalls = {
  complete: false,
  calls: [
    {
      id: "call-1/1",
      name: "read",
      arguments: { path: "a.ts" },
      status: "ok" as const,
      durationMs: 3,
    },
    { id: "call-1/2", name: "bash", status: "error" as const, error: "exit 1" },
    { id: "call-1/3", name: "write", argumentsBytes: 900000, status: "unfinished" as const },
  ],
};

function toolResult(extra: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "codemode",
    content: [{ type: "text", text: "done" }],
    isError: false,
    timestamp: 3,
    ...extra,
  };
}

function branchWith(result: ToolResultMessage): SessionEntry[] {
  return [
    messageEntry("u1", null, userMessage("Run the script.")),
    messageEntry("a1", "u1", assistantCall),
    messageEntry("t1", "a1", result),
  ];
}

vitest("projectSources renders ok, error, unfinished, and omitted-argument nested calls", () => {
  const [, , tool] = projectSources(branchWith(toolResult({ nestedCalls })), scope, []);
  expect(tool?.effectiveText).toBe(
    [
      'Tool result: {"toolCallId":"call-1","toolName":"codemode","isError":false}',
      `Nested calls: {"complete":false,"calls":[{"id":"call-1/1","name":"read","arguments":{"path":"a.ts"},"status":"ok","durationMs":3},{"id":"call-1/2","name":"bash","status":"error","error":"exit 1"},{"id":"call-1/3","name":"write","argumentsBytes":900000,"status":"unfinished"}]}`,
      "done",
    ].join("\n"),
  );
});

vitest("projectSources renders an unrecognized nested-call record as one fixed line", () => {
  const newer = toolResult();
  Object.assign(newer, {
    nestedCalls: { complete: true, calls: [{ id: "x", name: "y", status: "queued" }] },
  });
  const [, , tool] = projectSources(branchWith(newer), scope, []);
  expect(tool?.effectiveText).toBe(
    [
      'Tool result: {"toolCallId":"call-1","toolName":"codemode","isError":false}',
      "Nested calls: unrecognized record",
      "done",
    ].join("\n"),
  );
});

vitest("projectSources attributes tool calls and tool results", () => {
  const [, assistant, tool] = projectSources(branchWith(toolResult({ isError: true })), scope, []);
  expect(assistant?.tool).toEqual({ kind: "calls", toolCallIds: ["call-1"] });
  expect(tool?.tool).toEqual({
    kind: "result",
    toolCallId: "call-1",
    toolName: "codemode",
    isError: true,
  });
});

const imageOnly: UserMessage = {
  role: "user",
  content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
  timestamp: 1,
};

vitest("an image-only message is projected as an attachment gap that is never assigned", () => {
  const [image] = projectSources([messageEntry("u1", null, imageOnly)], scope, []);
  expect(image).toMatchObject({ entryId: "u1", effectiveText: "", attachments: 1, omitted: false });
  const sources = image === undefined ? [] : [image];
  expect(processingGaps(sources, coverageOf([]), new Set(), new Set())).toEqual([
    { kind: "attachment", reference: ref("u1"), count: 1 },
  ]);
  expect(processingGaps(sources, coverageOf([ref("u1")]), new Set(), new Set())).toEqual([
    { kind: "attachment", reference: ref("u1"), count: 1 },
  ]);
  expect(
    planIntervals(sources, coverageOf([]), new Set(), { budgetTokens: 500, maxIntervals: 4 }),
  ).toEqual([]);
});

vitest("projectSources counts image attachments and excludes recall results as evidence", () => {
  const branch = [
    messageEntry("u1", null, {
      role: "user",
      content: [
        { type: "text", text: "See this." },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      timestamp: 1,
    }),
    messageEntry("a1", "u1", assistantCall),
    messageEntry("t1", "a1", toolResult({ toolName: "recall" })),
  ];
  const [user, , recall] = projectSources(branch, scope, []);
  expect(user).toMatchObject({ attachments: 1, effectiveText: "See this.", excluded: undefined });
  expect(recall).toMatchObject({ excluded: "recall" });
});

vitest("projectSources takes event time and timezone from registered records", () => {
  const [user] = projectSources(branchWith(toolResult()), scope, [
    { entryId: "u1", time: { recordedAt: "ignored", eventTime: "noon", timezone: "UTC" } },
  ]);
  expect(user?.time).toEqual({
    recordedAt: new Date(1).toISOString(),
    eventTime: "noon",
    timezone: "UTC",
  });
});

function managerFor(sessionId: string, branch: SessionEntry[]): SourceSessionManager {
  return {
    getSessionId: () => sessionId,
    getSessionFile: () => undefined,
    getHeader: () => null,
    getBranch: () => branch,
  };
}

test("a changed nested-call record changes the entry digests and invalidates a dependency", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const registry = await openRegistry(store);
  const before = await registry.current(
    managerFor(store.sessionId, branchWith(toolResult({ nestedCalls }))),
  );
  const changed = { ...nestedCalls, complete: true };
  const after = await registry.current(
    managerFor(store.sessionId, branchWith(toolResult({ nestedCalls: changed }))),
  );
  const ids = [before[2]?.reference ?? ""];
  const dependency = { sourceIds: ids, evidenceFingerprint: sourceFingerprint(before, ids) };
  expect(after[2]?.rawDigest).not.toBe(before[2]?.rawDigest);
  expect(evidenceMatches(before, dependency, store.projectId)).toBe(true);
  expect(evidenceMatches(after, dependency, store.projectId)).toBe(false);
});

test("registration records an image-only message with the digest of its empty text", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const registry = await openRegistry(store);
  const records = await registry.current(
    managerFor(store.sessionId, [messageEntry("u1", null, imageOnly)]),
  );
  expect(records).toMatchObject([{ entryId: "u1", rawDigest: digest(""), omitted: false }]);
});

test("tool results without nested calls keep their existing digests", async ({ makeRoot }) => {
  const store = await openStore(await makeRoot());
  const registry = await openRegistry(store);
  const records = await registry.current(managerFor(store.sessionId, branchWith(toolResult())));
  expect(records[2]?.rawDigest).toBe(
    digest('Tool result: {"toolCallId":"call-1","toolName":"codemode","isError":false}\ndone'),
  );
});

vitest("a successful nested-call status marks no nested output processed", () => {
  const succeeded = {
    complete: true,
    calls: [{ id: "call-1/1", name: "read", arguments: { path: "a.ts" }, status: "ok" as const }],
  };
  const sources = projectSources(
    [messageEntry("t1", null, toolResult({ nestedCalls: succeeded }))],
    scope,
    [],
  );
  expect(sources.map((source) => source.reference)).toEqual([ref("t1")]);
  expect(sources[0]?.effectiveText).toBe(
    [
      'Tool result: {"toolCallId":"call-1","toolName":"codemode","isError":false}',
      'Nested calls: {"complete":true,"calls":[{"id":"call-1/1","name":"read","arguments":{"path":"a.ts"},"status":"ok"}]}',
      "done",
    ].join("\n"),
  );
  expect(processingGaps(sources, coverageOf([]), new Set(), new Set())).toEqual([
    { kind: "unprocessed", reference: ref("t1") },
  ]);
  const intervals = planIntervals(sources, coverageOf([]), new Set(), {
    budgetTokens: 500,
    maxIntervals: 4,
  });
  const assigned = intervals.flatMap((interval) =>
    interval.spans.map((planned) => planned.reference),
  );
  expect(assigned).toEqual([ref("t1")]);
  const committed = coverageOf(assigned);
  expect([...committed.entries]).toEqual([ref("t1")]);
  expect([...committed.ranges.keys()]).toEqual([]);
  expect(processingGaps(sources, committed, new Set(), new Set())).toEqual([]);
});

function evidenceOf(
  store: Pick<TestStore, "projectId">,
  sessionId: string,
  texts: Readonly<Record<string, string>>,
): SourceEvidence[] {
  return Object.entries(texts).map(([entryId, text]) => ({
    reference: encodeReference({ projectId: store.projectId, sessionId, entryId, span: 0 }),
    entryId,
    rawDigest: digest(text),
    effectiveDigest: digest(text),
    omitted: false,
  }));
}

// Commits a parent revision over e1 and a range of e2, then a child revision over e3 based on it,
// each with the evidence fingerprint of `texts` as the child session registers them.
async function forkedChain(
  makeRoot: () => Promise<string>,
  texts: Readonly<Record<string, string>>,
): Promise<{
  child: TestStore;
  second: string;
  childRef: (entryId: string, range?: TextRange) => string;
}> {
  const root = await makeRoot();
  const parent = await openStore(root);
  const child = await openStore(root, { sessionId: "child" });
  const childRef = (entryId: string, range?: TextRange): string =>
    encodeSpanReference(
      { projectId: child.projectId, sessionId: "child", entryId, span: 0 },
      range,
    );
  const parentRef = (entryId: string, range?: TextRange): string =>
    encodeSpanReference(
      { projectId: parent.projectId, sessionId: parent.sessionId, entryId, span: 0 },
      range,
    );
  const evidence = evidenceOf(child, "child", texts);
  const ranged = { start: 0, end: 100 };
  const first = committedId(
    await parent.commit(
      baseProposal(parent, {
        sourceIds: [parentRef("e1"), parentRef("e2", ranged)],
        evidenceFingerprint: sourceFingerprint(evidence, [childRef("e1"), childRef("e2", ranged)]),
        observations: [
          {
            id: "o1",
            kind: "request",
            text: "Fix it.",
            ordinal: 0,
            citations: [{ kind: "source", reference: parentRef("e2", ranged), order: 1, time: {} }],
          },
        ],
      }),
    ),
  );
  const second = committedId(
    await child.commit(
      baseProposal(child, {
        sourceIds: [childRef("e3")],
        evidenceFingerprint: sourceFingerprint(evidence, [childRef("e3")]),
        baseRevision: { sessionId: parent.sessionId, revisionId: first },
        notes: {},
      }),
    ),
  );
  return { child, second, childRef };
}

const chainTexts = { e1: "One.", e2: "x".repeat(200), e3: "Three." };

test("readLineageRecords collects coverage through a fork ancestor's chain", async ({
  makeRoot,
}) => {
  const { child, second, childRef } = await forkedChain(makeRoot, chainTexts);
  const records = await child.run(
    readLineageRecords(
      child.store,
      { sessionId: "child", revisionId: second },
      evidenceOf(child, "child", chainTexts),
    ),
  );
  expect([...records.coverage.entries].toSorted()).toEqual(
    [childRef("e1"), childRef("e3")].toSorted(),
  );
  expect(records.coverage.ranges.get(childRef("e2"))).toEqual([{ start: 0, end: 100 }]);
  expect(records.changed).toEqual(new Set());
});

test("readLineageRecords drops the coverage of a revision whose evidence changed and reports its spans", async ({
  makeRoot,
}) => {
  const { child, second, childRef } = await forkedChain(makeRoot, chainTexts);
  const edited = { ...chainTexts, e2: "short" };
  const records = await child.run(
    readLineageRecords(
      child.store,
      { sessionId: "child", revisionId: second },
      evidenceOf(child, "child", edited),
    ),
  );
  expect([...records.coverage.entries]).toEqual([childRef("e3")]);
  expect(records.coverage.ranges.size).toBe(0);
  expect(records.changed).toEqual(
    new Set([childRef("e1"), childRef("e2", { start: 0, end: 100 })]),
  );
  const sources = [
    projected("e1", 0, "One.", { reference: childRef("e1") }),
    projected("e2", 1, "short", { reference: childRef("e2") }),
    projected("e3", 2, "Three.", { reference: childRef("e3") }),
  ];
  expect(processingGaps(sources, records.coverage, new Set(), records.changed)).toEqual([
    { kind: "changed", reference: childRef("e1") },
    { kind: "changed", reference: childRef("e2") },
  ]);
  const planned = planIntervals(sources, records.coverage, new Set(), {
    budgetTokens: 500,
    maxIntervals: 4,
  });
  expect(planned.flatMap((interval) => interval.spans.map((assigned) => assigned.text))).toEqual([
    "One.",
    "short",
  ]);
});

test("readLineageRecords returns empty records with no selection and rejects an unavailable revision", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const empty = await store.run(readLineageRecords(store.store, null, []));
  expect(empty.coverage.entries.size).toBe(0);
  expect(empty.changed.size).toBe(0);
  await expect(
    store.run(
      readLineageRecords(store.store, { sessionId: store.sessionId, revisionId: "missing" }, []),
    ),
  ).rejects.toThrow("Memory revision missing on the selected lineage is unavailable.");
});
