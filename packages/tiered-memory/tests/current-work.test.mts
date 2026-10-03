import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Message } from "@earendil-works/pi-ai";
import { expect, test as vitest } from "vitest";

import type { AssignedSpan } from "../src/domain/intervals.ts";
import {
  acceptObserverOutput,
  observerRequest,
  retainedReferenceLimit,
  retainedReferences,
} from "../src/domain/observer.ts";
import type { ObserverInput, ObserverOutput, PreviousReference } from "../src/domain/observer.ts";
import { noteDependencySchema } from "../src/domain/proposal.ts";
import { encodeSpanReference } from "../src/domain/references.ts";
import { intervalBudget } from "../src/pi/observer-planning.ts";
import { presentationsIn } from "../src/pi/presentation-log.ts";
import { proposalFrom } from "../src/pi/proposals.ts";
import type { ProposalFrame } from "../src/pi/proposals.ts";
import { fixtureModel } from "./pi-fixture.mts";
import type { ActingRequest, Fixture, FixtureOptions } from "./pi-fixture.mts";
import {
  baseProposal,
  committedId,
  noteContent,
  rejectionPaths,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storeFor,
  test,
} from "./store-fixture.mts";

const projectId = "a".repeat(64);
const scope = { projectId, sessionId: "session-1" };

function ref(entryId: string): string {
  return encodeSpanReference({ ...scope, entryId, span: 0 }, undefined);
}

function span(entryId: string, order: number, text: string): AssignedSpan {
  return {
    reference: ref(entryId),
    entryId,
    order,
    role: "user",
    time: {},
    range: undefined,
    entryLength: text.length,
    text,
  };
}

const input: ObserverInput = {
  interval: { spans: [span("e2", 1, "Now also update the docs.")], tokens: 0 },
  previousNote: {
    body: "Fix the parser.",
    references: [{ reference: ref("e1"), source: undefined }],
    checkpointIds: [],
  },
  checkpoint: { entryId: "c1", summary: "Paused: release notes." },
};

function accept(workNote: ObserverOutput["workNote"], workNoteTokens = 1024) {
  const { labels } = observerRequest(input);
  return acceptObserverOutput(
    { observations: [], workNote },
    { labels, interval: input.interval, evidenceFingerprint: "f".repeat(64) },
    workNoteTokens,
  );
}

vitest(
  "an updated note maps its labels to retained references, assigned spans, and checkpoints",
  () => {
    expect(
      accept({
        status: "updated",
        body: "Fix the parser; update docs.",
        sources: ["P1", "S1", "C1"],
      }),
    ).toEqual({
      kind: "accepted",
      observations: [],
      workNote: {
        status: "updated",
        body: "Fix the parser; update docs.",
        sourceIds: [ref("e1"), ref("e2")],
        checkpointIds: ["c1"],
      },
    });
  },
);

vitest("an explicitly unchanged note is accepted without a body", () => {
  expect(accept({ status: "unchanged" })).toMatchObject({ workNote: { status: "unchanged" } });
});

vitest("an explicitly empty note is accepted as an empty working state", () => {
  expect(accept({ status: "empty" })).toMatchObject({ workNote: { status: "empty" } });
});

vitest("an oversized note is rejected with its estimate and the reserve, not truncated", () => {
  expect(accept({ status: "updated", body: "x".repeat(41), sources: ["S1"] }, 10)).toEqual({
    kind: "rejected",
    rejection: { kind: "oversized-note", tokens: 11, limit: 10 },
  });
});

vitest("a note label the request did not assign is rejected with its path", () => {
  expect(accept({ status: "updated", body: "Note.", sources: ["S1", "P2"] })).toEqual({
    kind: "rejected",
    rejection: { kind: "unknown-label", path: "/workNote/sources/1", label: "P2" },
  });
});

vitest("noteDependencySchema accepts checkpoint citations and rejects a wrong-typed one", () => {
  const dependency = { sourceIds: [ref("e1")], evidenceFingerprint: "d".repeat(64) };
  expect(rejectionPaths(noteDependencySchema, { ...dependency, checkpointIds: ["c1"] })).toEqual(
    [],
  );
  expect(rejectionPaths(noteDependencySchema, { ...dependency, checkpointIds: [3] })).toContain(
    "/checkpointIds/0",
  );
});

function frameOf(): ProposalFrame {
  const {
    notes: _notes,
    observations: _observations,
    consumedObservationIds: _consumed,
    learnings: _learnings,
    expectedLearnings: _expected,
    noteDependencies: _dependencies,
    ...frame
  } = baseProposal(scope, { sourceIds: [ref("e2")] });
  return frame;
}

vitest("proposalFrom completes a frame with content and its note dependencies", () => {
  const dependency = { sourceIds: [ref("e1"), ref("e2")], evidenceFingerprint: "d".repeat(64) };
  const proposal = proposalFrom(frameOf(), noteContent({ "current-work.md": "Note.\n" }), {
    "current-work.md": dependency,
  });
  expect(proposal).toEqual(
    baseProposal(scope, {
      sourceIds: [ref("e2")],
      notes: { "current-work.md": "Note.\n" },
      noteDependencies: { "current-work.md": dependency },
    }),
  );
});

vitest("proposalFrom rejects content whose observation cites a span outside the frame", () => {
  const content = {
    ...noteContent({}),
    observations: [
      {
        id: "o1",
        kind: "request" as const,
        text: "x",
        ordinal: 0,
        citations: [{ kind: "source" as const, reference: ref("e9"), order: 9, time: {} }],
      },
    ],
  };
  expect(() => proposalFrom(frameOf(), content, {})).toThrow(
    "/observations/0/citations/0/reference names a span outside /sourceIds",
  );
});

test("Pi captureProposal binds the branch leaf, the captured source, and no base on a fresh session", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Keep the frame.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const reference = await sourceReference(f, "Keep the frame.");
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept.\n" }), [
    reference,
  ]);
  expect(proposal).toMatchObject({
    sessionId: f.session.sessionManager.getSessionId(),
    anchorId: f.session.sessionManager.getLeafId(),
    sourceIds: [reference],
    expectedRevision: null,
    baseRevision: null,
    excludedInheritedNotes: [],
    notes: { "current-work.md": "Kept.\n" },
    observations: [],
  });
  expect(proposal.noteDependencies["current-work.md"]?.sourceIds).toEqual([reference]);
});

vitest("an unchanged note is rejected when the request supplied no previous note", () => {
  const request = observerRequest({ ...input, previousNote: undefined });
  expect(
    acceptObserverOutput(
      { observations: [], workNote: { status: "unchanged" } },
      { labels: request.labels, interval: input.interval, evidenceFingerprint: "f".repeat(64) },
      1024,
    ),
  ).toEqual({ kind: "rejected", rejection: { kind: "unchanged-without-note" } });
});

vitest("an unchanged note is accepted when the previous note has no references", () => {
  const request = observerRequest({
    ...input,
    previousNote: { body: "Waiting.", references: [], checkpointIds: [] },
  });
  expect(
    acceptObserverOutput(
      { observations: [], workNote: { status: "unchanged" } },
      { labels: request.labels, interval: input.interval, evidenceFingerprint: "f".repeat(64) },
      1024,
    ),
  ).toMatchObject({ kind: "accepted", workNote: { status: "unchanged" } });
});

function located(entryId: string, order: number): PreviousReference {
  return {
    reference: ref(entryId),
    source: {
      entryId,
      role: "user",
      order,
      time: { recordedAt: "2026-03-01T09:30:00.000Z" },
      range: order === 0 ? { start: 0, end: 4 } : undefined,
    },
  };
}

vitest("each previous-note label renders its role, branch order, recorded time, and range", () => {
  const request = observerRequest({
    ...input,
    previousNote: {
      body: "Fix the parser.",
      references: [located("e0", 0), located("e1", 3)],
      checkpointIds: ["c1"],
    },
  });
  expect(request.prompt).toContain(
    [
      "Previous note references; a retained claim cites only the P labels that support it:",
      "[P1] user entry e0, order 0; recorded 2026-03-01T09:30:00.000Z; characters 0-4",
      "[P2] user entry e1, order 3; recorded 2026-03-01T09:30:00.000Z",
      "[P3] native checkpoint entry c1",
    ].join("\n"),
  );
  expect(request.systemPrompt).toContain("A retained claim cites only the P labels");
});

vitest("retained previous-note references keep the newest 64 by branch order", () => {
  const references = [
    { reference: ref("off-branch"), source: undefined },
    ...Array.from({ length: 70 }, (_, order) => located(`e${String(order)}`, order)),
  ];
  const kept = retainedReferences(references);
  expect(retainedReferenceLimit).toBe(64);
  expect(kept.map((reference) => reference.source?.order)).toEqual(
    Array.from({ length: 64 }, (_, index) => index + 6),
  );
  const request = observerRequest({
    ...input,
    previousNote: { body: "Note.", references, checkpointIds: [] },
  });
  expect(request.labels.previous.size).toBe(64);
  expect(request.labels.previous.get("P1")).toEqual({ kind: "source", reference: ref("e6") });
});

vitest("an updated note also depends on every previous reference the request did not label", () => {
  const references = Array.from({ length: 70 }, (_, order) => located(`e${String(order)}`, order));
  const request = observerRequest({
    ...input,
    previousNote: { body: "Note.", references, checkpointIds: [] },
  });
  const accepted = acceptObserverOutput(
    { observations: [], workNote: { status: "updated", body: "Newer note.", sources: ["S1"] } },
    { labels: request.labels, interval: input.interval, evidenceFingerprint: "f".repeat(64) },
    1024,
  );
  expect(accepted).toMatchObject({
    kind: "accepted",
    workNote: {
      status: "updated",
      sourceIds: [ref("e2"), ref("e0"), ref("e1"), ref("e3"), ref("e4"), ref("e5")],
    },
  });
});

function referenceContext(count: number, first = 0): Omit<ObserverInput, "interval"> {
  return {
    previousNote: {
      body: "Note.",
      references: Array.from({ length: count }, (_, index) =>
        located(`e${String(first + index)}`, first + index),
      ),
      checkpointIds: [],
    },
    checkpoint: undefined,
  };
}

vitest("the interval budget counts the previous note's reference labels", () => {
  const context = referenceContext;
  const none = intervalBudget(8000, context(0), 1024);
  const thirty = intervalBudget(8000, context(30), 1024);
  const labelLine = "[P30] user entry e29, order 29; recorded 2026-03-01T09:30:00.000Z";
  expect(none - thirty).toBeGreaterThanOrEqual(Math.floor((30 * labelLine.length) / 4) - 30);
  expect(intervalBudget(8000, context(100, 100), 1024)).toBe(
    intervalBudget(8000, context(64, 136), 1024),
  );
});

async function commitNote(f: Fixture, body: string, sourceText: string): Promise<void> {
  await f.reload();
  const { runtime } = f.memory();
  const ctx = f.session.extensionRunner.createContext();
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": body }), [
    await sourceReference(f, sourceText),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
}

function payloadTexts(request: ActingRequest | undefined): string[] {
  return (request?.messages ?? []).map((message: Message) =>
    typeof message.content === "string"
      ? message.content
      : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
  );
}

function noteBlockCount(request: ActingRequest | undefined): number {
  return payloadTexts(request).filter((text) =>
    text.startsWith("[Tiered memory: current-work note,"),
  ).length;
}

async function presented(createFixture: (options?: FixtureOptions) => Promise<Fixture>) {
  const f = await createFixture({ services: {} });
  await f.session.prompt("Remember the blue setting.");
  await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  await f.session.prompt("Continue the work.");
  return f;
}

test("Pi an explicit unchanged note after that commit adds no duplicate presentation", async ({
  createFixture,
}) => {
  const f = await presented(createFixture);
  await commitNote(f, "Use the blue setting.", "Continue the work.");
  await f.session.prompt("Keep the same note.");
  const kinds = presentationsIn(f.session.sessionManager.getBranch()).records.map(
    ({ entry }) => entry.kind,
  );
  expect(kinds).toEqual(["component", "boundary"]);
  expect(noteBlockCount(f.requests.at(-1))).toBe(1);
  expect(payloadTexts(f.requests.at(-1)).at(-1)).toContain(
    "is unchanged and is current at revision",
  );
});

test("Pi subsequent requests expose the latest valid note once, before newer user instructions, with a readable source boundary", async ({
  createFixture,
}) => {
  const f = await presented(createFixture);
  await f.session.prompt("Switch to the green setting now.");
  const texts = payloadTexts(f.requests.at(-1));
  const note = texts.findIndex((text) => text.startsWith("[Tiered memory: current-work note,"));
  expect(noteBlockCount(f.requests.at(-1))).toBe(1);
  expect(note).toBeGreaterThan(-1);
  expect(note).toBeLessThan(texts.indexOf("Switch to the green setting now."));
  const source = sourceEntry(f, "Remember the blue setting.");
  const recorded =
    source.type === "message" ? new Date(source.message.timestamp).toISOString() : "missing";
  const reference = await sourceReference(f, "Remember the blue setting.");
  expect(texts[note]).toContain(
    `Source boundary: this note covers the conversation through the user message recorded at ${recorded} (reference ${reference}).`,
  );
  expect(texts[note]).toContain(
    "Newer user instructions retained in the conversation take precedence over this note.",
  );
});

test("Pi an outdated note after native fallback stays stored but is not presented as current", async ({
  createFixture,
}) => {
  const f = await presented(createFixture);
  await f.session.prompt("More work after the note.");
  const before = f.memory().runtime.memoryStorage(f.session.extensionRunner.createContext());
  f.settings.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
  await f.session.compact();
  await f.session.prompt("Continue after compaction.");
  expect(noteBlockCount(f.requests.at(-1))).toBe(0);
  expect(
    f.memory().runtime.memoryStorage(f.session.extensionRunner.createContext())?.canonical,
  ).toMatchObject({
    revision: before?.canonical.revision,
    workNote: { body: "Use the blue setting." },
  });
});

test("Pi an absent or invalid note permits ordinary continuation without a capacity stop", async ({
  createFixture,
}) => {
  const small = {
    ...fixtureModel,
    id: "small",
    name: "Small",
    contextWindow: 3000,
    maxTokens: 500,
  };
  const f = await createFixture({ services: {}, models: [small] });
  await f.session.prompt("Remember the setting.");
  await commitNote(f, `Working state: ${"w".repeat(12000)}`, "Remember the setting.");
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "Edited by hand.\n");
  await f.reload();
  const model = f.session.modelRuntime.getModel(fixtureModel.provider, "small");
  if (model === undefined) {
    throw new Error("Missing small model.");
  }
  await f.session.setModel(model);
  const before = f.requests.length;
  await f.session.prompt("Continue without the invalid note.");
  expect(f.requests).toHaveLength(before + 1);
  await f.command("status");
  expect(f.report()).not.toContain("Capacity stop");
});
