import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { SourceBoundary } from "../src/domain/intervals.ts";
import type { RevisionPointer } from "../src/domain/proposal.ts";
import { presentationHeaderTokens } from "../src/domain/settings.ts";
import {
  confirmPresentations,
  presentationMessageRenderer,
  presentationsIn,
  sendPresentation,
} from "../src/pi/presentation-log.ts";
import { captureFrame, proposalFrom } from "../src/pi/proposals.ts";
import {
  planPresentation,
  reconstructLog,
  suppressedInActingContext,
} from "../src/presentation/append-snapshots.ts";
import { presentationMessageType, readPresentationEntry } from "../src/presentation/entries.ts";
import type { MemoryComponent, PresentationEntry } from "../src/presentation/entries.ts";
import {
  estimatePresentationTokens,
  renderPresentation,
  summarizePresentation,
} from "../src/presentation/render.ts";
import type {
  ComponentState,
  PresentationLog,
  PresentationView,
} from "../src/presentation/types.ts";
import { fixtureMessage, fixtureModel } from "./pi-fixture.mts";
import type { ActingRequest, Fixture } from "./pi-fixture.mts";
import {
  branchRecords,
  commitNote,
  compactEverythingButTheLastTurn,
  contextOf,
  noteBlocks,
  payloadTexts,
  presentedNote,
  presenting,
  statusReport,
} from "./presentation-fixture.mts";
import {
  committedId,
  forkOnDisk,
  noteContent,
  sourceEntry,
  sourceReference,
  storeFor,
  test,
} from "./store-fixture.mts";

const projectId = "a".repeat(64);
const lineage = { projectId, sessionId: "session-1" };
const anchorId = "anchor";
const recordedAt = "2026-01-01T00:00:00.000Z";
const boundary: SourceBoundary = {
  reference: `tm1:${projectId}:session-1:e1:0`,
  order: 0,
  role: "user",
  recordedAt,
};
const laterBoundary: SourceBoundary = {
  reference: `tm1:${projectId}:session-1:e5:0`,
  order: 4,
  role: "assistant",
};
const edited = { kind: "curation", event: { kind: "edited", digest: "f".repeat(64) } } as const;
const r1: RevisionPointer = { sessionId: "session-1", revisionId: "r1" };
const r2: RevisionPointer = { sessionId: "session-1", revisionId: "r2" };

function state(
  component: MemoryComponent,
  body: string,
  revision: RevisionPointer = r1,
  sourceBoundary = boundary,
): ComponentState {
  return { component, revision, sourceBoundary, body, bodyDigest: digest(body) };
}

function componentEntry(
  id: string,
  component: MemoryComponent,
  body: string,
  revision: RevisionPointer = r1,
): Extract<PresentationEntry, { kind: "component" }> {
  return {
    version: 1,
    kind: "component",
    id,
    lineage,
    anchorId,
    component,
    revision,
    sourceBoundary: boundary,
    body,
    bodyDigest: digest(body),
  };
}

function viewOf(
  components: ComponentState[],
  invalidated: PresentationView["invalidated"] = [],
): PresentationView {
  return {
    lineage,
    anchorId,
    components: Object.fromEntries(components.map((item) => [item.component, item])),
    invalidated,
  };
}

function records(list: PresentationEntry[], confirmed: boolean) {
  return list.map((entry, index) => ({
    entry,
    entryId: confirmed ? `entry-${String(index)}` : undefined,
    confirmed,
    tokens: estimatePresentationTokens(entry),
  }));
}

const scope = { projectId, sessionIds: new Set(["session-1"]), branchIds: new Set([anchorId]) };

function logOf(entries: PresentationEntry[], pending: PresentationEntry[] = []): PresentationLog {
  return reconstructLog(records(entries, true), records(pending, false), scope, []);
}

function ids(): () => string {
  let next = 0;
  return () => `p${String(++next)}`;
}

function damagedPath(details: unknown): string | undefined {
  const read = readPresentationEntry(details);
  return read.kind === "damaged" ? read.path : undefined;
}

const note = componentEntry("c1", "work-note", "Fix the parser.");

const reset: Extract<PresentationEntry, { kind: "reset" }> = {
  version: 1,
  kind: "reset",
  id: "r",
  lineage,
  anchorId,
  components: [{ ...state("work-note", "Note."), id: "b1" }],
  superseded: ["c1"],
  reason: "budget",
  tokensBefore: 10,
  tokensAfter: 5,
};

test("readPresentationEntry accepts a valid component record", () => {
  expect(readPresentationEntry(note)).toEqual({ kind: "valid", entry: note });
});

test.for([
  { label: "an unsupported version", value: { ...note, version: 2 }, path: "/version" },
  { label: "an unknown kind", value: { ...note, kind: "other" }, path: "/kind" },
  { label: "a non-object record", value: "text", path: "/" },
  {
    label: "a component missing its body",
    value: Object.fromEntries(Object.entries(note).filter(([key]) => key !== "body")),
    path: "/body",
  },
  { label: "an invalid presentation identity", value: { ...note, id: "../x" }, path: "/id" },
  { label: "an unknown component", value: { ...note, component: "topics" }, path: "/component" },
  {
    label: "a boundary missing componentId",
    value: {
      version: 1,
      kind: "boundary",
      id: "b",
      lineage,
      anchorId,
      component: "work-note",
      bodyRevision: r1,
      bodyDigest: note.bodyDigest,
      revision: r1,
      sourceBoundary: boundary,
    },
    path: "/componentId",
  },
  {
    label: "a reset baseline component missing its id",
    value: {
      ...reset,
      components: [{ ...state("work-note", "Note."), id: undefined }],
    },
    path: "/components/0/id",
  },
  {
    label: "a wrong-typed tokensBefore",
    value: { ...reset, tokensBefore: "10" },
    path: "/tokensBefore",
  },
  {
    label: "a correction missing its cause",
    value: {
      version: 1,
      kind: "correction",
      id: "x",
      lineage,
      anchorId,
      component: "work-note",
      affectedRevision: r1,
    },
    path: "/cause",
  },
])("readPresentationEntry rejects $label at $path", ({ value, path }) => {
  expect(damagedPath(JSON.parse(JSON.stringify(value)))).toBe(path);
});

test("readPresentationEntry rejects an evidence correction without source ids", () => {
  const correction = {
    version: 1,
    kind: "correction",
    id: "x",
    lineage,
    anchorId,
    component: "work-note",
    affectedRevision: r1,
    cause: { kind: "evidence", sourceIds: [] },
  };
  expect(damagedPath(correction)).toMatch(/^\/cause/u);
});

test("readPresentationEntry rejects a body digest that does not match its body", () => {
  expect(damagedPath({ ...note, body: "Changed." })).toBe("/bodyDigest");
});

test("readPresentationEntry rejects a reset naming one component or identity twice", () => {
  const [first] = reset.components;
  if (first === undefined) {
    throw new Error("Missing baseline component.");
  }
  expect(damagedPath({ ...reset, components: [first, { ...first, id: "b2" }] })).toBe(
    "/components/1/component",
  );
  const index = { ...first, component: "index" };
  expect(damagedPath({ ...reset, components: [first, index] })).toBe("/components/1/id");
  expect(damagedPath({ ...reset, superseded: ["b1"] })).toBe("/superseded/0");
});

test("readPresentationEntry rejects a record that supersedes itself", () => {
  expect(damagedPath({ ...note, supersedes: "c1" })).toBe("/supersedes");
});

test("reconstructLog keeps only records of the scope's project, session lineage, and branch", () => {
  const foreign = { ...componentEntry("c2", "index", "Index."), anchorId: "elsewhere" };
  const otherProject = {
    ...componentEntry("c3", "index", "Other."),
    lineage: { ...lineage, projectId: "b".repeat(64) },
  };
  const otherSession = {
    ...componentEntry("c4", "index", "Unrelated."),
    lineage: { ...lineage, sessionId: "session-9" },
  };
  const log = logOf([note, foreign, otherProject, otherSession]);
  expect(log.records.map((record) => record.entry.id)).toEqual(["c1"]);
  expect(log.current["work-note"]).toMatchObject({ id: "c1" });
  expect(log.current.index).toBeUndefined();
});

test("reconstructLog suppresses superseded identities for pending and confirmed resets", () => {
  const pending = logOf([note], [reset]);
  expect(pending.suppressed).toEqual(new Set(["c1"]));
  expect(pending.accumulatedTokens).toBe(140);
  expect(pending.current["work-note"]).toMatchObject({ id: "b1" });
  const confirmed = logOf([note, reset]);
  expect(confirmed.suppressed).toEqual(new Set(["c1"]));
  expect(confirmed.current["work-note"]).toMatchObject({ id: "b1" });
});

test("planPresentation appends a full component for a first note", () => {
  const plan = planPresentation(viewOf([state("work-note", "Fix it.")]), logOf([]), 4096, ids());
  expect(plan).toMatchObject({
    kind: "append",
    records: [{ kind: "component", id: "p1", component: "work-note", body: "Fix it." }],
  });
  expect(plan.kind === "append" ? plan.records[0] : undefined).not.toHaveProperty("supersedes");
});

test("planPresentation appends a boundary record for an unchanged body with newer coverage", () => {
  const plan = planPresentation(
    viewOf([state("work-note", "Fix the parser.", r2, laterBoundary)]),
    logOf([note]),
    4096,
    ids(),
  );
  expect(plan).toEqual({
    kind: "append",
    records: [
      {
        version: 1,
        kind: "boundary",
        id: "p1",
        lineage,
        anchorId,
        component: "work-note",
        componentId: "c1",
        bodyRevision: r1,
        bodyDigest: note.bodyDigest,
        revision: r2,
        sourceBoundary: laterBoundary,
      },
    ],
  });
});

test("planPresentation appends only the component that changed when note and index differ", () => {
  const index = componentEntry("c2", "index", "Topics: parser.");
  const plan = planPresentation(
    viewOf([state("work-note", "Fix the parser."), state("index", "Topics: parser, docs.", r2)]),
    logOf([note, index]),
    4096,
    ids(),
  );
  expect(plan).toMatchObject({
    kind: "append",
    records: [{ kind: "component", component: "index", supersedes: "c2" }],
  });
});

test("planPresentation returns current for a repeated unchanged request", () => {
  expect(
    planPresentation(viewOf([state("work-note", "Fix the parser.")]), logOf([note]), 4096, ids()),
  ).toEqual({ kind: "current" });
});

test("planPresentation resets once when appending would exceed the presentation budget", () => {
  const old = componentEntry("c1", "work-note", "x".repeat(400));
  const view = viewOf([state("work-note", "y".repeat(400), r2), state("index", "Index.")]);
  const log = logOf([old]);
  const plan = planPresentation(view, log, 360, ids());
  if (plan.kind !== "reset") {
    throw new Error(`Expected a reset, received ${plan.kind}.`);
  }
  expect(plan.record.superseded).toEqual(["c1"]);
  expect(plan.record.components.map((component) => component.component)).toEqual([
    "work-note",
    "index",
  ]);
  expect(plan.record.tokensBefore).toBe(207 + 207 + 107);
  expect(plan.record.tokensBefore).toBeGreaterThan(360);
  expect(plan.record.tokensAfter).toBeGreaterThan(Math.ceil(400 / 4));
  expect(plan.record.tokensAfter).toBeLessThanOrEqual(360);
});

test("planPresentation lets the index yield when the full baseline does not fit", () => {
  const view = viewOf([state("work-note", "n".repeat(300)), state("index", "i".repeat(400))]);
  const plan = planPresentation(
    view,
    logOf([componentEntry("c1", "work-note", "old")]),
    260,
    ids(),
  );
  expect(plan).toMatchObject({
    kind: "reset",
    record: { components: [{ component: "work-note" }] },
  });
});

test("planPresentation reports over-budget when the baseline cannot fit after the index yields", () => {
  const view = viewOf([state("work-note", "n".repeat(800)), state("index", "Index.")]);
  const plan = planPresentation(view, logOf([]), 100, ids());
  expect(plan).toMatchObject({ kind: "over-budget", budgetTokens: 100 });
  expect(plan.kind === "over-budget" ? plan.requiredTokens : 0).toBeGreaterThan(100);
});

test("planPresentation does not reset again for an unchanged baseline that cannot fit", () => {
  const body = "n".repeat(800);
  const baseline: PresentationEntry = {
    ...reset,
    components: [{ ...state("work-note", body), id: "b1" }],
  };
  const plan = planPresentation(viewOf([state("work-note", body)]), logOf([baseline]), 100, ids());
  expect(plan.kind).toBe("over-budget");
});

test("planPresentation appends a correction for an invalidated note and revives no older one", () => {
  const older = componentEntry("c0", "work-note", "Older note.", {
    sessionId: "session-1",
    revisionId: "r0",
  });
  const current = { ...note, supersedes: "c0" };
  const cause = edited;
  const view = viewOf([], [{ component: "work-note", revision: r1, cause }]);
  const plan = planPresentation(view, logOf([older, current]), 4096, ids());
  expect(plan).toEqual({
    kind: "append",
    records: [
      {
        version: 1,
        kind: "correction",
        id: "p1",
        lineage,
        anchorId,
        component: "work-note",
        affectedRevision: r1,
        presented: { id: "c1", bodyRevision: r1 },
        cause,
      },
    ],
  });
  const corrected = logOf([older, current, ...(plan.kind === "append" ? plan.records : [])]);
  expect(corrected.current["work-note"]).toBeUndefined();
  expect(planPresentation(view, corrected, 4096, ids())).toEqual({ kind: "current" });
});

test("a correction of a later revision suppresses every earlier copy of its component, not later ones", () => {
  const r0: RevisionPointer = { sessionId: "session-1", revisionId: "r0" };
  const older = componentEntry("c0", "work-note", "Older note.", r0);
  const olderBoundary: PresentationEntry = {
    version: 1,
    kind: "boundary",
    id: "e0",
    lineage,
    anchorId,
    component: "work-note",
    componentId: "c0",
    bodyRevision: r0,
    bodyDigest: older.bodyDigest,
    revision: r0,
    sourceBoundary: laterBoundary,
  };
  const current = { ...note, supersedes: "c0" };
  const index = componentEntry("c2", "index", "Index.");
  const correction: PresentationEntry = {
    version: 1,
    kind: "correction",
    id: "x1",
    lineage,
    anchorId,
    component: "work-note",
    affectedRevision: r1,
    presented: { id: "c1", bodyRevision: r1 },
    cause: edited,
  };
  const valid = { ...componentEntry("c3", "work-note", "Valid again.", r2), supersedes: "c1" };
  const log = logOf([older, olderBoundary, current, index, correction, valid]);
  expect(suppressedInActingContext(older, log)).toBe(true);
  expect(suppressedInActingContext(olderBoundary, log)).toBe(true);
  expect(suppressedInActingContext(current, log)).toBe(true);
  expect(suppressedInActingContext(index, log)).toBe(false);
  expect(suppressedInActingContext(valid, log)).toBe(false);
  expect(log.current["work-note"]).toMatchObject({ id: "c3" });
  expect(renderPresentation(correction)).toContain(
    "and every earlier current-work note representation are no longer current",
  );
});

test("suppressedInActingContext hides superseded and corrected records and keeps the reset and later records", () => {
  const index = componentEntry("c2", "index", "Index.");
  const correction: PresentationEntry = {
    version: 1,
    kind: "correction",
    id: "x1",
    lineage,
    anchorId,
    component: "index",
    affectedRevision: r1,
    cause: edited,
  };
  const later = componentEntry("c4", "index", "New.", r2);
  const log = logOf([note, index, reset, correction, later]);
  expect(suppressedInActingContext(note, log)).toBe(true);
  expect(suppressedInActingContext(index, log)).toBe(true);
  expect(suppressedInActingContext(reset, log)).toBe(false);
  expect(suppressedInActingContext(correction, log)).toBe(false);
  expect(suppressedInActingContext(later, log)).toBe(false);
});

test("renderPresentation states a readable source boundary with its exact reference, user-instruction precedence, and supersession", () => {
  expect(renderPresentation(note)).toBe(
    [
      "[Tiered memory: current-work note, revision r1 of session session-1]",
      `Source boundary: this note covers the conversation through the user message recorded at 2026-01-01T00:00:00.000Z (reference tm1:${projectId}:session-1:e1:0).`,
      "Newer user instructions retained in the conversation take precedence over this note. It supersedes every earlier current-work note representation.",
      "",
      "Fix the parser.",
    ].join("\n"),
  );
  expect(renderPresentation(componentEntry("e", "work-note", ""))).toContain(
    "No active work is identified.",
  );
});

test("renderPresentation states an unknown recorded time and a shell-command boundary readably", () => {
  const shell = {
    ...note,
    sourceBoundary: { reference: boundary.reference, order: 3, role: "bashExecution" as const },
  };
  expect(renderPresentation(shell)).toContain(
    `through the user shell command recorded at an unknown time (reference tm1:${projectId}:session-1:e1:0).`,
  );
});

test("a boundary record and the collapsed lines state the readable boundary", () => {
  const extension: PresentationEntry = {
    version: 1,
    kind: "boundary",
    id: "b1",
    lineage,
    anchorId,
    component: "work-note",
    componentId: "c1",
    bodyRevision: r1,
    bodyDigest: note.bodyDigest,
    revision: r2,
    sourceBoundary: boundary,
  };
  expect(renderPresentation(extension)).toBe(
    `[Tiered memory: current-work note update] The current-work note shown for revision r1 of session session-1 is unchanged and is current at revision r2 of session session-1. It now covers the conversation through the user message recorded at 2026-01-01T00:00:00.000Z (reference tm1:${projectId}:session-1:e1:0). Newer user instructions retained in the conversation take precedence over this note.`,
  );
  expect(summarizePresentation(extension)).toBe(
    "Tiered memory current-work note update: revision r2 of session session-1, through the user message recorded at 2026-01-01T00:00:00.000Z",
  );
  expect(summarizePresentation(reset)).toBe(
    "Tiered memory reset: current-work note, through the user message recorded at 2026-01-01T00:00:00.000Z; estimated 10 to 5 tokens",
  );
});

test("a correction naming a boundary-extended revision suppresses the original body and its boundary", () => {
  const extended = planPresentation(
    viewOf([state("work-note", "Fix the parser.", r2, laterBoundary)]),
    logOf([note]),
    4096,
    ids(),
  );
  const boundaryRecords = extended.kind === "append" ? extended.records : [];
  const cause = edited;
  const corrected = planPresentation(
    viewOf([], [{ component: "work-note", revision: r2, cause }]),
    logOf([note, ...boundaryRecords]),
    4096,
    ids(),
  );
  expect(corrected).toMatchObject({
    kind: "append",
    records: [
      { kind: "correction", affectedRevision: r2, presented: { id: "c1", bodyRevision: r1 } },
    ],
  });
  const log = logOf([
    note,
    ...boundaryRecords,
    ...(corrected.kind === "append" ? corrected.records : []),
  ]);
  expect(log.current["work-note"]).toBeUndefined();
  expect(suppressedInActingContext(note, log)).toBe(true);
  for (const record of boundaryRecords) {
    expect(suppressedInActingContext(record, log)).toBe(true);
  }
});

test("a boundary extending a reset baseline component is suppressed when that component is corrected", () => {
  const extend: PresentationEntry = {
    version: 1,
    kind: "boundary",
    id: "e1",
    lineage,
    anchorId,
    component: "work-note",
    componentId: "b1",
    bodyRevision: r1,
    bodyDigest: digest("Note."),
    revision: r2,
    sourceBoundary: laterBoundary,
  };
  const correction: PresentationEntry = {
    version: 1,
    kind: "correction",
    id: "x1",
    lineage,
    anchorId,
    component: "work-note",
    affectedRevision: r2,
    presented: { id: "b1", bodyRevision: r1 },
    cause: edited,
  };
  const log = logOf([reset, extend, correction]);
  expect(suppressedInActingContext(extend, log)).toBe(true);
  expect(log.current["work-note"]).toBeUndefined();
});

test("boundary and correction text name the revision label the model saw with the body", () => {
  const boundaryText = renderPresentation({
    version: 1,
    kind: "boundary",
    id: "e1",
    lineage,
    anchorId,
    component: "work-note",
    componentId: "c1",
    bodyRevision: r1,
    bodyDigest: note.bodyDigest,
    revision: r2,
    sourceBoundary: laterBoundary,
  });
  expect(boundaryText).toContain("shown for revision r1 of session session-1 is unchanged");
  expect(boundaryText).toContain("current at revision r2 of session session-1");
  expect(boundaryText).not.toContain("c1");
  const correctionText = renderPresentation({
    version: 1,
    kind: "correction",
    id: "x1",
    lineage,
    anchorId,
    component: "work-note",
    affectedRevision: r2,
    presented: { id: "c1", bodyRevision: r1 },
    cause: edited,
  });
  expect(correctionText).toContain(
    "The current-work note shown for revision r1 of session session-1, every update extending it to revision r2 of session session-1, and every earlier current-work note representation are no longer current because its file was edited outside tiered memory. Do not rely on them as current state.",
  );
});

test("an index that yielded to a note-only reset does not cause another reset on later requests", () => {
  const view = viewOf([state("work-note", "n".repeat(300)), state("index", "i".repeat(400))]);
  const next = ids();
  const plans: string[] = [];
  const entries: PresentationEntry[] = [componentEntry("c1", "work-note", "old")];
  for (let request = 0; request < 3; request++) {
    const plan = planPresentation(view, logOf(entries), 260, next);
    plans.push(plan.kind);
    if (plan.kind === "reset") {
      entries.push(plan.record);
    }
  }
  expect(plans).toEqual(["reset", "current", "current"]);
});

test("suppressedInActingContext hides damaged, foreign, off-branch, and edited records", () => {
  const log = logOf([note]);
  expect(suppressedInActingContext(note, log)).toBe(false);
  expect(suppressedInActingContext({ ...note, version: 9 }, log)).toBe(true);
  expect(
    suppressedInActingContext(
      { ...note, id: "c5", lineage: { ...lineage, projectId: "b".repeat(64) } },
      log,
    ),
  ).toBe(true);
  expect(
    suppressedInActingContext(
      { ...note, id: "c6", lineage: { ...lineage, sessionId: "other" } },
      log,
    ),
  ).toBe(true);
  expect(suppressedInActingContext({ ...note, id: "c7", anchorId: "elsewhere" }, log)).toBe(true);
  const editedRecords = presentationsIn([
    presentationMessage("m1", note),
    contextEdit("x1", "m1", "m1", "Replaced."),
  ]);
  const editedLog = reconstructLog(
    editedRecords.records.map(({ entry }) => ({
      entry,
      entryId: "m1",
      confirmed: true,
      tokens: 1,
    })),
    [],
    scope,
    editedRecords.damaged,
  );
  expect(suppressedInActingContext(note, editedLog)).toBe(true);
});

test("maximal component, reset, boundary, and correction headers fit presentationHeaderTokens", () => {
  const longId = "a".repeat(128);
  const revision = { sessionId: "s".repeat(128), revisionId: "r".repeat(128) };
  const sourceBoundary = {
    reference: `tm1:${projectId}:${"s".repeat(128)}:${"e".repeat(128)}:999999999999998-999999999999999`,
    order: Number.MAX_SAFE_INTEGER,
    role: "bashExecution" as const,
    recordedAt: "9".repeat(32),
  };
  const wide = { projectId, sessionId: longId };
  const component = (name: MemoryComponent, body: string) => ({
    id: longId,
    component: name,
    revision,
    sourceBoundary,
    body,
    bodyDigest: digest(body),
  });
  for (const name of ["work-note", "index"] as const) {
    const record: PresentationEntry = {
      version: 1,
      kind: "component",
      lineage: wide,
      anchorId: longId,
      ...component(name, ""),
    };
    expect(estimatePresentationTokens(record)).toBeLessThanOrEqual(presentationHeaderTokens);
  }
  const noteBody = "n".repeat(4000);
  const indexBody = "i".repeat(2000);
  const baseline: PresentationEntry = {
    version: 1,
    kind: "reset",
    id: longId,
    lineage: wide,
    anchorId: longId,
    components: [
      component("work-note", noteBody),
      { ...component("index", indexBody), id: "b".repeat(128) },
    ],
    superseded: [],
    reason: "budget",
    tokensBefore: 0,
    tokensAfter: 0,
  };
  expect(estimatePresentationTokens(baseline)).toBeLessThanOrEqual(
    3 * presentationHeaderTokens + 4000 / 4 + 2000 / 4,
  );
  const boundaryRecord: PresentationEntry = {
    version: 1,
    kind: "boundary",
    id: longId,
    lineage: wide,
    anchorId: longId,
    component: "work-note",
    componentId: "b".repeat(128),
    bodyRevision: revision,
    bodyDigest: digest(""),
    revision,
    sourceBoundary,
  };
  expect(estimatePresentationTokens(boundaryRecord)).toBeLessThanOrEqual(
    2 * presentationHeaderTokens,
  );
});

function presentationMessage(
  id: string,
  details: unknown,
  customType = presentationMessageType,
  parentId: string | null = null,
): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType,
    content: "text",
    display: false,
    details,
  };
}

test("presentationsIn returns valid records in branch order and lists damaged ones", () => {
  const branch = [
    presentationMessage("m0", note, "other"),
    presentationMessage("m1", note, presentationMessageType, "m0"),
    presentationMessage("m2", { ...note, version: 9 }, presentationMessageType, "m1"),
  ];
  expect(presentationsIn(branch)).toEqual({
    records: [{ entryId: "m1", entry: note }],
    damaged: [{ entryId: "m2", path: "/version" }],
    edited: [],
  });
});

function contextEdit(
  id: string,
  parentId: string,
  targetId: string,
  content: string | null,
): SessionEntry {
  return {
    type: "context_edit",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    targetId,
    replacement: content === null ? null : { content },
  };
}

test("presentationsIn lists records that a context edit omitted or replaced as edited, not presented", () => {
  const index = componentEntry("c2", "index", "Index.");
  const branch = [
    presentationMessage("m1", note),
    presentationMessage("m2", index, presentationMessageType, "m1"),
    contextEdit("x1", "m2", "m1", null),
    contextEdit("x2", "x1", "m2", "Replaced text."),
  ];
  expect(presentationsIn(branch)).toEqual({ records: [], damaged: [], edited: ["m1", "m2"] });
});

test("confirmPresentations returns only requested presentation entries in the session file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbis-tiered-memory-presentation-"));
  try {
    const file = join(directory, "session.jsonl");
    const header = {
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: directory,
    };
    const lines = [header, presentationMessage("m1", note), presentationMessage("m2", note)];
    await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const confirmed = await Effect.runPromise(confirmPresentations(file, ["m1", "m3"]));
    expect([...confirmed]).toEqual(["m1"]);
    expect([...(await Effect.runPromise(confirmPresentations(undefined, ["m1"])))]).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sendPresentation sends the rendered record without triggering a turn or choosing delivery", () => {
  const sent: Parameters<ExtensionAPI["sendMessage"]>[] = [];
  sendPresentation(
    {
      sendMessage: (...args) => {
        sent.push(args);
      },
    },
    note,
  );
  expect(sent).toEqual([
    [
      {
        customType: presentationMessageType,
        content: [
          "[Tiered memory: current-work note, revision r1 of session session-1]",
          `Source boundary: this note covers the conversation through the user message recorded at 2026-01-01T00:00:00.000Z (reference tm1:${projectId}:session-1:e1:0).`,
          "Newer user instructions retained in the conversation take precedence over this note. It supersedes every earlier current-work note representation.",
          "",
          "Fix the parser.",
        ].join("\n"),
        display: true,
        details: note,
      },
      { triggerTurn: false },
    ],
  ]);
});

test("sendPresentation rejects an invalid record and sends nothing", () => {
  const sent: unknown[] = [];
  const host = {
    sendMessage: (...args: unknown[]) => {
      sent.push(args);
    },
  };
  expect(() => {
    sendPresentation(host, { ...note, body: "x" });
  }).toThrow("Invalid presentation record at /bodyDigest");
  expect(sent).toEqual([]);
});

// Commits a note citing `sourceText` that also carries the claims of the latest native checkpoint,
// as an observer refresh after native fallback records them.
async function commitNoteFromCheckpoint(
  f: Fixture,
  body: string,
  sourceText: string,
): Promise<string> {
  await f.reload();
  const { runtime } = f.memory();
  const ctx = f.session.extensionRunner.createContext();
  const storage = runtime.memoryStorage(ctx);
  const compaction = f.session.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "compaction");
  if (storage === undefined || compaction === undefined) {
    throw new Error("Missing open storage or native compaction.");
  }
  const frame = captureFrame(storage.session, ctx, storage.binding, [
    await sourceReference(f, sourceText),
  ]);
  const proposal = proposalFrom(frame, noteContent({ "current-work.md": body }), {
    "current-work.md": {
      sourceIds: frame.sourceIds,
      evidenceFingerprint: frame.evidenceFingerprint,
      checkpointIds: [compaction.id],
    },
  });
  return committedId(await runtime.commitProposal(ctx, proposal));
}

test("Pi scripted provider payloads include the current note exactly once", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture);
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  await f.session.prompt("Continue the work.");
  const pending = f.requests.at(-1);
  expect(noteBlocks(pending)).toHaveLength(1);
  expect(payloadTexts(pending).at(-1)).toContain("Use the blue setting.");
  expect(branchRecords(f)).toMatchObject([{ kind: "component", body: "Use the blue setting." }]);
  await f.session.prompt("Keep going.");
  const confirmed = f.requests.at(-1);
  expect(noteBlocks(confirmed)).toHaveLength(1);
  expect(payloadTexts(confirmed).at(-1)).toBe("Keep going.");
  expect(branchRecords(f)).toHaveLength(1);
});

function statusOf(f: Fixture) {
  return f.memory().presentation.status(contextOf(f));
}

function rawPresentationEntryIds(f: Fixture): string[] {
  return f.session.sessionManager
    .getBranch()
    .filter(
      (entry) => entry.type === "custom_message" && entry.customType === presentationMessageType,
    )
    .map((entry) => entry.id);
}

function noteIndex(request: ActingRequest | undefined): number {
  return payloadTexts(request).findIndex((text) =>
    text.startsWith("[Tiered memory: current-work note,"),
  );
}

test("Pi unchanged requests keep existing presentation messages at stable positions", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const entryIds = rawPresentationEntryIds(f);
  await f.session.prompt("First unchanged request.");
  const first = f.requests.at(-1);
  await f.session.prompt("Second unchanged request.");
  const second = f.requests.at(-1);
  expect(rawPresentationEntryIds(f)).toEqual(entryIds);
  expect(noteIndex(first)).toBeGreaterThan(0);
  expect(noteIndex(second)).toBe(noteIndex(first));
  expect(noteBlocks(second)).toHaveLength(1);
});

test("Pi a queued append is pending during its request and confirmed in the session file afterward", async ({
  createFixture,
}) => {
  const seen: { pending: number | undefined; unconfirmed: number | undefined }[] = [];
  let owner: Fixture | undefined;
  const f = await presenting(createFixture, {
    extensions: [
      (pi) => {
        pi.on("context_with_system", (_event, ctx) => {
          const status = owner?.memory().presentation.status(ctx);
          seen.push({ pending: status?.pending, unconfirmed: status?.unconfirmed });
        });
      },
    ],
  });
  owner = f;
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  owner = f;
  seen.length = 0;
  await f.session.prompt("Continue the work.");
  expect(seen.at(-1)).toEqual({ pending: 1, unconfirmed: 0 });
  await f.memory().presentation.settle(contextOf(f));
  expect(statusOf(f)).toMatchObject({ pending: 0, unconfirmed: 0 });
  const [entryId] = rawPresentationEntryIds(f);
  const file = f.session.sessionManager.getSessionFile() ?? "";
  expect(await readFile(file, "utf8")).toContain(`"id":"${entryId ?? "missing"}"`);
});

test("Pi a request renders the newest note at the tail while its append is pending", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  await commitNote(f, "Use the green setting instead.", "Continue the work.");
  await f.session.prompt("Proceed with the change.");
  const request = f.requests.at(-1);
  const blocks = noteBlocks(request);
  expect(blocks).toHaveLength(2);
  expect(blocks.at(-1)).toContain("Use the green setting instead.");
  expect(payloadTexts(request).at(-1)).toContain("Use the green setting instead.");
  const latest = branchRecords(f).at(-1);
  expect(latest?.kind === "component" ? latest.supersedes : undefined).toBeDefined();
});

test("Pi a presentation record left on an abandoned branch is not counted on the selected branch", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const before = sourceEntry(f, "Continue the work.");
  await f.session.navigateTree(before.parentId ?? "", { summarize: false });
  expect(branchRecords(f)).toEqual([]);
  expect(statusOf(f).estimatedTokens).toBe(0);
  await f.session.prompt("Work on the other branch.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
  expect(branchRecords(f)).toHaveLength(1);
});

const budgetLimits = {
  limits: { workNoteTokens: 200, indexTokens: 100, presentationTokens: 1100 },
};

// Commits changed notes until one request resets presentation; returns the turn texts.
async function resetPresentation(f: Fixture): Promise<string[]> {
  const turns = ["Turn 1."];
  await f.session.prompt("Turn 1.");
  for (
    let turn = 2;
    turn <= 8 && !branchRecords(f).some((entry) => entry.kind === "reset");
    turn++
  ) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn presents the previous turn's note.
    await commitNote(f, `Note ${String(turn)}: ${"n".repeat(1200)}`, turns.at(-1) ?? "");
    const text = `Turn ${String(turn)}.`;
    turns.push(text);
    // oxlint-disable-next-line no-await-in-loop -- Requests run in order.
    await f.session.prompt(text);
  }
  return turns;
}

test("Pi a reset keeps current mandatory state, conversation, and session records without a model call", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, { personal: budgetLimits });
  const turns = await resetPresentation(f);
  const presentedRecords = branchRecords(f);
  expect(presentedRecords.filter((entry) => entry.kind === "reset")).toHaveLength(1);
  const request = f.requests.at(-1);
  const texts = payloadTexts(request);
  const latestReset = presentedRecords.findLast((entry) => entry.kind === "reset");
  const kept = latestReset?.kind === "reset" ? (latestReset.components[0]?.body ?? "") : "";
  expect(texts.filter((text) => text.includes(kept))).toHaveLength(1);
  for (const text of turns) {
    expect(texts).toContain(text);
  }
  const supersededBodies = presentedRecords.flatMap((entry) =>
    entry.kind === "component" && entry.body !== kept ? [entry.body] : [],
  );
  for (const body of supersededBodies) {
    expect(texts.some((text) => text.includes(body))).toBe(false);
  }
  expect(f.requests).toHaveLength(turns.length);
  expect(f.session.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(
    false,
  );
  expect(f.settings.getCompactionEnabled()).toBe(false);
});

test("Pi resume after a reset reconstructs presentation without reappending or restoring suppressed copies", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, { personal: budgetLimits });
  await resetPresentation(f);
  const entryIds = rawPresentationEntryIds(f);
  await f.reload();
  await f.session.prompt("Resume after the reset.");
  expect(rawPresentationEntryIds(f)).toEqual(entryIds);
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(
    payloadTexts(f.requests.at(-1)).filter((text) =>
      text.startsWith("[Tiered memory: presentation reset]"),
    ),
  ).toHaveLength(1);
  expect(await statusReport(f)).toContain("Presentation resets: 1, last for budget from ");
});

test("Pi a forced reset records one event and no duplicate event after resume", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, { personal: budgetLimits });
  await resetPresentation(f);
  await f.reload();
  await f.session.prompt("Another request.");
  await f.reload();
  const status = statusOf(f);
  expect(status.resets).toBe(1);
  expect(status.lastReset?.tokensBefore).toBeGreaterThan(1100 - 400);
  expect(status.lastReset?.tokensAfter).toBeLessThanOrEqual(1100);
});

test("Pi fork or tree navigation keeps an abandoned branch's reset out of the selection", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, { personal: budgetLimits });
  await resetPresentation(f);
  const entryIds = rawPresentationEntryIds(f);
  const child = await forkOnDisk(
    f,
    async (options) => await createFixture({ ...options, services: {} }),
  );
  await child.session.prompt("Continue in the fork.");
  expect(rawPresentationEntryIds(child)).toEqual(entryIds);
  expect(statusOf(child).resets).toBe(1);
  const resetId = presentationsIn(f.session.sessionManager.getBranch()).records.find(
    ({ entry }) => entry.kind === "reset",
  )?.entryId;
  const parentOfReset = f.session.sessionManager.getEntry(resetId ?? "")?.parentId ?? "";
  await f.session.navigateTree(parentOfReset, { summarize: false });
  expect(statusOf(f).resets).toBe(0);
});

test("Pi curation invalidation reaches native compaction while injection is disabled", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "Edited by hand.\n");
  await f.reload();
  expect(branchRecords(f).at(-1)).toMatchObject({
    kind: "correction",
    cause: { kind: "curation", event: { kind: "edited", digest: digest("Edited by hand.\n") } },
  });
  await f.session.prompt("Proceed after the edit.");
  const texts = payloadTexts(f.requests.at(-1));
  expect(texts.filter((text) => text.startsWith("[Tiered memory: correction]"))).toHaveLength(1);
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  await f.command("off");
  compactEverythingButTheLastTurn(f);
  const start = f.requests.length;
  await f.session.compact();
  const summaries = f.requests.slice(start).flatMap((request) => payloadTexts(request));
  expect(summaries.join("\n")).toContain("[Tiered memory: correction]");
});

test("Pi a damaged presentation record is preserved, excluded, and listed in status", async ({
  createFixture,
}) => {
  let api: ExtensionAPI | undefined;
  const f = await presenting(createFixture, {
    extensions: [
      (pi) => {
        api = pi;
      },
    ],
  });
  await f.session.prompt("Start.");
  api?.sendMessage(
    {
      customType: presentationMessageType,
      content: "Damaged.",
      display: true,
      details: { version: 9 },
    },
    { triggerTurn: false },
  );
  await f.session.prompt("After the damaged record.");
  expect(payloadTexts(f.requests.at(-1))).not.toContain("Damaged.");
  expect(await statusReport(f)).toMatch(
    /Damaged presentation records on the active branch: 1 excluded \(entry \S+ at \/kind\)/u,
  );
  const file = f.session.sessionManager.getSessionFile() ?? "";
  expect(await readFile(file, "utf8")).toContain('"content":"Damaged."');
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

test("Pi the context transform returns a new array and never mutates frozen incoming messages", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  await commitNote(f, "Use the green setting instead.", "Continue the work.");
  const messages = deepFreeze(
    f.session.sessionManager
      .buildSessionContext()
      .messages.map((message) => structuredClone(message)),
  );
  const result = f.memory().presentation.transform({ type: "context", messages }, contextOf(f));
  expect(result?.messages).not.toBe(messages);
  expect(result?.messages?.slice(0, messages.length)).toEqual(messages);
  const tail = result?.messages?.at(-1);
  expect(tail?.role === "custom" ? tail.content : undefined).toContain(
    "Use the green setting instead.",
  );
});

test("Pi native compaction sends no presentation record from session_before_compact", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const entryIds = rawPresentationEntryIds(f);
  compactEverythingButTheLastTurn(f);
  await f.session.compact();
  expect(rawPresentationEntryIds(f)).toEqual(entryIds);
});

test("Pi a cancelled compaction establishes no presentation baseline", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture, {
    extensions: [
      (pi) => {
        pi.on("session_before_compact", () => ({ cancel: true }));
      },
    ],
  });
  const entryIds = rawPresentationEntryIds(f);
  compactEverythingButTheLastTurn(f);
  await f.session.compact().catch(() => undefined);
  expect(f.session.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(
    false,
  );
  await f.session.prompt("After the cancelled compaction.");
  expect(rawPresentationEntryIds(f)).toEqual(entryIds);
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
});

test("Pi after a native summary outdates the note, a valid newer note is presented once", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  compactEverythingButTheLastTurn(f);
  await f.session.compact();
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  await commitNoteFromCheckpoint(f, "Use the blue setting after compaction.", "After compaction.");
  await f.session.prompt("Next request.");
  const blocks = noteBlocks(f.requests.at(-1));
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toContain("Use the blue setting after compaction.");
});

test("Pi a superseded revision retained after compaction does not regain current authority", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  await commitNote(f, "Use the green setting instead.", "Continue the work.");
  compactEverythingButTheLastTurn(f);
  await f.session.compact();
  await f.session.prompt("After compaction.");
  const texts = payloadTexts(f.requests.at(-1));
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(texts.some((text) => text.includes("Use the blue setting."))).toBe(false);
  expect(texts.filter((text) => text.startsWith("[Tiered memory: correction]"))).toHaveLength(1);
  expect(branchRecords(f).at(-1)).toMatchObject({
    kind: "correction",
    cause: { kind: "fallback" },
  });
});

test("Pi a commit landing between context and dispatch appears only in the next request", async ({
  createFixture,
}) => {
  let owner: Fixture | undefined;
  let commitDuringRequest = false;
  const f = await presenting(createFixture, {
    extensions: [
      (pi) => {
        pi.on("context_with_system", async (_event, ctx) => {
          if (!commitDuringRequest || owner === undefined) {
            return;
          }
          commitDuringRequest = false;
          const { runtime } = owner.memory();
          const proposal = runtime.captureProposal(
            ctx,
            noteContent({ "current-work.md": "Use the red setting." }),
            [await sourceReference(owner, "Remember the blue setting.")],
          );
          await runtime.commitProposal(ctx, proposal);
        });
      },
    ],
  });
  owner = f;
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  owner = f;
  commitDuringRequest = true;
  await f.session.prompt("Continue the work.");
  expect(noteBlocks(f.requests.at(-1)).join("\n")).toContain("Use the blue setting.");
  expect(noteBlocks(f.requests.at(-1)).join("\n")).not.toContain("Use the red setting.");
  expect(branchRecords(f).map((entry) => (entry.kind === "component" ? entry.body : ""))).toEqual([
    "Use the blue setting.",
  ]);
  await f.session.prompt("Next request.");
  expect(noteBlocks(f.requests.at(-1)).at(-1)).toContain("Use the red setting.");
});

test("Pi status reports the representation, effective budget, estimates, and resets apart from compactions and cache usage", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture, {
    personal: { limits: { presentationTokens: 6000 } },
  });
  const report = await statusReport(f);
  expect(report).toMatch(
    /Presentation: complete appended revisions; budget 6000 estimated tokens \(personal\); \d+ estimated tokens presented, 0 pending, \d+ unconfirmed\./u,
  );
  expect(report).toContain("Presentation resets: 0; compactions are counted separately.");
  expect(report).toContain("limits.presentationTokens: 6000 (personal)");
  expect(report).toContain("Acting provider cache reads and writes: unknown in this version.");
});

test("Pi note and index changes each append only the changed component", async ({
  createFixture,
}) => {
  const { f, revision } = await presentedNote(createFixture);
  const store = await storeFor(f);
  const indexBoundary = {
    reference: await sourceReference(f, "Remember the blue setting."),
    order: 0,
    role: "user" as const,
  };
  let body = "Topics: settings.";
  f.memory().presentation.provideIndex(() => ({
    revision: { sessionId: store.sessionId, revisionId: revision },
    sourceBoundary: indexBoundary,
    body,
  }));
  await f.session.prompt("Add the index.");
  body = "Topics: settings, colors.";
  await f.session.prompt("Change the index.");
  const components = branchRecords(f).map((entry) =>
    entry.kind === "component" ? `${entry.component}:${entry.body}` : entry.kind,
  );
  expect(components).toEqual([
    "work-note:Use the blue setting.",
    "index:Topics: settings.",
    "index:Topics: settings, colors.",
  ]);
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
});

test("Pi a fork before any reset recognizes inherited presentation without re-presenting", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const entryIds = rawPresentationEntryIds(f);
  const child = await forkOnDisk(
    f,
    async (options) => await createFixture({ ...options, services: {} }),
  );
  await child.session.prompt("Continue in the fork.");
  expect(rawPresentationEntryIds(child)).toEqual(entryIds);
  expect(noteBlocks(child.requests.at(-1))).toHaveLength(1);
  expect(statusOf(child).resets).toBe(0);
});

const plainTheme = {
  fg: (_color: string, text: string) => text,
};

test("presentationMessageRenderer collapses to one summary line and expands to the full text", () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The renderer reads only `fg`.
  const theme = plainTheme as unknown as Parameters<typeof presentationMessageRenderer>[2];
  const message = {
    role: "custom" as const,
    customType: presentationMessageType,
    content: renderPresentation(note),
    display: true,
    details: note,
    timestamp: 0,
  };
  const collapsed = presentationMessageRenderer(message, { expanded: false, outputPad: 0 }, theme);
  expect(collapsed?.render(400).map((line) => line.trimEnd())).toEqual([
    "Tiered memory current-work note: revision r1 of session session-1, through the user message recorded at 2026-01-01T00:00:00.000Z",
  ]);
  const expanded = presentationMessageRenderer(message, { expanded: true, outputPad: 0 }, theme);
  const lines = (expanded?.render(400) ?? []).map((line) => line.trimEnd());
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.at(-1)).toBe("Fix the parser.");
  const narrow = presentationMessageRenderer(message, { expanded: false, outputPad: 0 }, theme);
  expect(narrow?.render(20)).toHaveLength(1);
});

const smallModel = {
  ...fixtureModel,
  id: "small",
  name: "Small",
  contextWindow: 3000,
  maxTokens: 500,
};

test("Pi invalidating the latest note hides every earlier note copy and never stops the request", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, {
    models: [smallModel],
    personal: { limits: { presentationTokens: 100000 } },
  });
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, `Blue: ${"a".repeat(8000)}`, "Remember the blue setting.");
  await f.session.prompt("Continue the work.");
  await commitNote(f, `Green: ${"g".repeat(8000)}`, "Continue the work.");
  await f.session.prompt("Present the green note.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(2);
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "Edited by hand.\n");
  await f.reload();
  await f.session.prompt("Proceed after the edit.");
  const texts = payloadTexts(f.requests.at(-1));
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(texts.some((text) => text.includes("Blue: aaa") || text.includes("Green: ggg"))).toBe(
    false,
  );
  expect(texts.filter((text) => text.startsWith("[Tiered memory: correction]"))).toHaveLength(1);
  const model = f.session.modelRuntime.getModel(fixtureModel.provider, "small");
  if (model === undefined) {
    throw new Error("Missing small model.");
  }
  await f.session.setModel(model);
  const before = f.requests.length;
  await f.session.prompt("Continue on the small model.");
  expect(f.requests).toHaveLength(before + 1);
  expect(await statusReport(f)).not.toContain("Capacity stop");
});

test("Pi a correction recorded while memory is disabled reaches native compaction", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  await f.command("off");
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "Edited by hand.\n");
  await f.reload();
  expect(branchRecords(f).map((entry) => entry.kind)).toEqual(["component", "correction"]);
  await f.session.prompt("Continue while disabled.");
  compactEverythingButTheLastTurn(f);
  const start = f.requests.length;
  await f.session.compact();
  const summaries = f.requests.slice(start).flatMap((request) => payloadTexts(request));
  expect(summaries.join("\n")).toContain("[Tiered memory: correction]");
});

test("Pi a reset that compaction summarized still counts after reload", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture, { personal: budgetLimits });
  await resetPresentation(f);
  await f.session.prompt("After the reset.");
  expect(statusOf(f).resets).toBe(1);
  compactEverythingButTheLastTurn(f);
  await f.session.compact();
  const branch = f.session.sessionManager.getBranch();
  const compaction = branch.findLast((entry) => entry.type === "compaction");
  const kept = branch.findIndex(
    (entry) => compaction?.type === "compaction" && entry.id === compaction.firstKeptEntryId,
  );
  const resetIndex = branch.findIndex((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return false;
    }
    const read = readPresentationEntry(entry.details);
    return read.kind === "valid" && read.entry.kind === "reset";
  });
  expect(resetIndex).toBeGreaterThan(-1);
  expect(resetIndex).toBeLessThan(kept);
  await f.reload();
  expect(statusOf(f).resets).toBe(1);
});

test("Pi a compaction whose last discarded message is not a source keeps a covering note presented", async ({
  createFixture,
}) => {
  const f = await presenting(createFixture);
  await f.session.prompt("Start.");
  const manager = f.session.sessionManager;
  manager.appendMessage({
    role: "user",
    content: "Remember the blue setting.",
    timestamp: Date.now(),
  });
  await f.reload();
  const { runtime } = f.memory();
  const ctx = contextOf(f);
  const registered = runtime.memoryStorage(ctx)?.session.sources.sources ?? [];
  expect(registered).toHaveLength(3);
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Use the blue setting." }),
    registered.map((source) => source.reference),
  );
  committedId(await runtime.commitProposal(ctx, proposal));
  manager.appendMessage(fixtureMessage(""));
  const kept = manager.appendMessage({
    role: "user",
    content: "Kept request.",
    timestamp: Date.now(),
  });
  manager.appendCompaction("Summary: the blue setting was requested.", kept, 100);
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
  expect(branchRecords(f).some((entry) => entry.kind === "correction")).toBe(false);
});

test("Pi a just-flushed record that an agent_before_settle draft omits is neither rendered at the tail again nor counted", async ({
  createFixture,
}) => {
  let omit = false;
  const f = await presenting(createFixture, {
    extensions: [
      (pi) => {
        pi.on("agent_before_settle", (event, ctx) => {
          const record = ctx.sessionManager
            .getBranch()
            .findLast(
              (entry) =>
                entry.type === "custom_message" && entry.customType === presentationMessageType,
            );
          if (!omit || record === undefined) {
            return undefined;
          }
          omit = false;
          const edit = { type: "context_edit" as const, targetId: record.id, replacement: null };
          return { entries: [...event.entries, edit] };
        });
      },
    ],
  });
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  omit = true;
  await f.session.prompt("Continue the work.");
  const [omitted] = rawPresentationEntryIds(f);
  expect(presentationsIn(f.session.sessionManager.getBranch()).edited).toEqual([omitted]);
  expect(statusOf(f)).toMatchObject({ estimatedTokens: 0, pending: 0 });
  await f.session.prompt("Next request.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
  const entryIds = rawPresentationEntryIds(f);
  expect(entryIds).toHaveLength(2);
  expect(entryIds[0]).toBe(omitted);
  expect(branchRecords(f)).toMatchObject([{ kind: "component", body: "Use the blue setting." }]);
});

test.for(["disabled", "storage not open"] as const)(
  "Pi with memory %s, status keeps the reset count and the last reset's reason",
  async (condition, { createFixture }) => {
    const f = await presenting(createFixture, { personal: budgetLimits });
    await resetPresentation(f);
    const before = statusOf(f);
    expect(before.resets).toBe(1);
    if (condition === "disabled") {
      await f.command("off");
    } else {
      const store = await storeFor(f);
      await writeFile(join(store.sessionDir, "sources.json"), "damaged");
      await f.reload();
    }
    expect(f.memory().runtime.snapshot.storage.state).toBe(
      condition === "disabled" ? "open" : "failed",
    );
    const after = statusOf(f);
    expect(after.resets).toBe(1);
    expect(after.lastReset).toEqual(before.lastReset);
  },
);
