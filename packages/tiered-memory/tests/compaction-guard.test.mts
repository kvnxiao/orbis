import { chmod, writeFile } from "node:fs/promises";

import type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import { encodeReference } from "../src/domain/references.ts";
import { reportEntrySchema } from "../src/domain/settings.ts";
import { CompactionGuard, guardLines } from "../src/pi/compaction-guard.ts";
import type { ValidityMemory } from "../src/pi/note-validity.ts";
import { captureFrame, proposalFrom } from "../src/pi/proposals.ts";
import { presentationMessageType, readPresentationEntry } from "../src/presentation/entries.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import { readText } from "../src/storage/files.ts";
import { fixtureModel } from "./pi-fixture.mts";
import type { ActingRequest, ActingStep, Fixture } from "./pi-fixture.mts";
import {
  actingRequests,
  compactEverythingButTheLastTurn,
  noteBlocks,
  notePath,
  presentedNote,
  statusLines,
  summaryRequests,
} from "./presentation-fixture.mts";
import type { CreateFixture } from "./presentation-fixture.mts";
import { noteContent, test } from "./store-fixture.mts";

type EditPoint = "turn_end" | "input" | "tool" | "aborted";

interface Guarded {
  f: Fixture;
  script: ActingStep[];
  starts: string[];
  ends: { reason: string; aborted: boolean; summaries: number }[];
  arm: (point: EditPoint) => void;
  followUpOnFailure: () => void;
}

const edited = "Edited after the last check.\n";
const wideModel = { ...fixtureModel, id: "wide", name: "Wide", contextWindow: 64000 };

async function selectModel(f: Fixture, id: string): Promise<void> {
  const model = f.session.modelRuntime.getModel(fixtureModel.provider, id);
  if (model === undefined) {
    throw new Error(`Missing model ${id}.`);
  }
  await f.session.setModel(model);
}
const tool: ActingStep = { toolCalls: [{ name: "probe_tool", arguments: {} }] };
const heavy = { input: 13000, totalTokens: 13000 };
const overflowError = "prompt is too long: 70000 tokens > 64000 maximum";

function registerProbes(
  pi: ExtensionAPI,
  state: { armed: EditPoint | undefined; edit: () => Promise<void>; followUp: boolean },
  owner: () => Fixture | undefined,
): void {
  const fire = async (point: EditPoint): Promise<void> => {
    if (state.armed === point) {
      state.armed = undefined;
      await state.edit();
    }
  };
  pi.registerTool({
    name: "probe_tool",
    label: "Probe tool",
    description: "Probe tool",
    parameters: Type.Object({}),
    async execute() {
      await fire("tool");
      return { content: [{ type: "text", text: "tool ok" }], details: undefined };
    },
  });
  pi.on("input", async () => {
    await fire("input");
    return { action: "continue" };
  });
  pi.on("turn_end", async (event) => {
    const aborted = event.message.role === "assistant" && event.message.stopReason === "aborted";
    await fire(aborted ? "aborted" : "turn_end");
  });
  pi.on("session_compact_failed", async () => {
    const f = owner();
    if (state.followUp && f !== undefined) {
      state.followUp = false;
      await f.session.followUp("Follow-up task.");
    }
  });
}

async function guarded(
  createFixture: CreateFixture,
  options: {
    virtual?: boolean;
    autoCompaction?: boolean;
    extensions?: ((pi: ExtensionAPI) => void)[];
  } = {},
): Promise<Guarded> {
  const script: ActingStep[] = [];
  const holder: { f?: Fixture } = {};
  let path = "";
  const state = {
    armed: undefined as EditPoint | undefined,
    edit: async () => {
      await writeFile(path, edited);
    },
    followUp: false,
  };
  const { f } = await presentedNote(createFixture, {
    models: [wideModel],
    acting: () => script.shift(),
    extensions: [
      (pi) => {
        registerProbes(pi, state, () => holder.f);
        if (options.virtual === true) {
          pi.registerVirtualModel({
            provider: fixtureModel.provider,
            id: "auto",
            name: "Auto",
            contextWindow: 32000,
            maxTokens: 2000,
            route: () => ({ model: fixtureModel, thinkingLevel: "off" }),
          });
        }
      },
      ...(options.extensions ?? []),
    ],
  });
  holder.f = f;
  path = await notePath(f);
  // A later turn moves the presented note out of the retained tail and into the summarized input.
  await f.session.prompt("Keep going.");
  const starts: string[] = [];
  const ends: Guarded["ends"] = [];
  f.session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "compaction_start") {
      starts.push(event.reason);
    } else if (event.type === "compaction_end") {
      ends.push({
        reason: event.reason,
        aborted: event.aborted,
        summaries: summaryRequests(f).length,
      });
    }
  });
  if (options.virtual === true) {
    await selectModel(f, "auto");
  }
  f.settings.applyOverrides({
    compaction: {
      enabled: options.autoCompaction ?? true,
      keepRecentTokens: 1,
      reserveTokens: 4000,
    },
  });
  return {
    f,
    script,
    starts,
    ends,
    arm(point) {
      state.armed = point;
    },
    followUpOnFailure() {
      state.followUp = true;
    },
  };
}

function reports(f: Fixture): string[] {
  return f.session.sessionManager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "custom" &&
      entry.customType === "orbis-tiered-memory-report" &&
      Value.Check(reportEntrySchema, entry.data)
        ? [entry.data.text]
        : [],
    );
}

function rawComponents(f: Fixture): number {
  return f.session.sessionManager.getBranch().filter((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return false;
    }
    const read = readPresentationEntry(entry.details);
    return read.kind === "valid" && read.entry.kind === "component";
  }).length;
}

function cancellations(g: Guarded): number {
  return g.ends.filter((end) => end.aborted).length;
}

function compactions(f: Fixture): number {
  return f.session.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length;
}

function correctionPositions(f: Fixture): { correction: number; firstKept: number } {
  const branch = f.session.sessionManager.getBranch();
  const correction = branch.findIndex((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return false;
    }
    const read = readPresentationEntry(entry.details);
    return read.kind === "valid" && read.entry.kind === "correction";
  });
  const compaction = branch.findLast((entry) => entry.type === "compaction");
  const firstKept =
    compaction?.type === "compaction"
      ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
      : -1;
  return { correction, firstKept };
}

// The compaction that proceeds either summarizes the correction after the note or keeps it.
function expectCorrectionIncluded(f: Fixture, summaries: readonly ActingRequest[]): void {
  const text = JSON.stringify(summaries.map((request) => request.messages));
  const note = text.indexOf("Use the blue setting.");
  const correction = text.indexOf("[Tiered memory: correction]");
  const { correction: at, firstKept } = correctionPositions(f);
  expect(at).toBeGreaterThan(-1);
  const summarized = correction > note && note > -1;
  const kept = firstKept > -1 && at >= firstKept;
  expect(summarized || kept).toBe(true);
}

const cancelNotice = (origin: string, next: string) =>
  `Tiered memory cancelled the ${origin} compaction because the current-work note in its input is no longer current: its file was edited outside tiered memory. The correction that says so was not yet saved in the session. ${next}`;
const manualNext = "Run /compact again to compact with the correction.";
const automaticNext =
  "Pi runs automatic compaction again at a later check, no later than the next prompt.";
const retryNext =
  "Pi does not retry the request that overflowed; send it again to compact with the correction and continue.";

function expectCancelledOnce(g: Guarded, notice: string): void {
  expect(cancellations(g)).toBe(1);
  expect(g.ends.find((end) => end.aborted)?.summaries).toBe(0);
  expect(g.f.notifications).toContainEqual({ message: notice, type: "warning" });
  expect(reports(g.f)).toContain(notice);
}

interface CancelPath {
  name: string;
  virtual?: boolean;
  drive: (g: Guarded) => Promise<{ notice: string; summariesBefore: number }>;
}

const cancelPaths: CancelPath[] = [
  {
    name: "manual compaction while idle",
    async drive(g) {
      await writeFile(await notePath(g.f), edited);
      await expect(g.f.session.compact()).rejects.toThrow("Compaction cancelled");
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.compact();
      return { notice: cancelNotice("manual", manualNext), summariesBefore };
    },
  },
  {
    name: "manual compaction while streaming",
    async drive(g) {
      const held = Promise.withResolvers<undefined>();
      g.script.push({ text: "Held.", wait: held.promise });
      g.arm("aborted");
      const before = g.f.requests.length;
      const run = g.f.session.prompt("Long task.");
      await expect.poll(() => g.f.requests.length).toBe(before + 1);
      await expect(g.f.session.compact()).rejects.toThrow("Compaction cancelled");
      held.resolve(undefined);
      await run;
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.compact();
      return { notice: cancelNotice("manual", manualNext), summariesBefore };
    },
  },
  {
    name: "pre-prompt threshold compaction",
    async drive(g) {
      await selectModel(g.f, wideModel.id);
      g.script.push({ text: "Large answer.", usage: heavy });
      await g.f.session.prompt("Grow the context.");
      await selectModel(g.f, fixtureModel.id);
      g.arm("input");
      g.script.push({ text: "Second large answer.", usage: heavy });
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.prompt("Prompt after the edit.");
      return { notice: cancelNotice("automatic threshold", automaticNext), summariesBefore };
    },
  },
  {
    name: "post-run threshold compaction",
    async drive(g) {
      g.arm("turn_end");
      g.script.push({ text: "Large answer.", usage: heavy });
      await g.f.session.prompt("Grow the context.");
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.prompt("Next prompt.");
      return { notice: cancelNotice("automatic threshold", automaticNext), summariesBefore };
    },
  },
  {
    name: "between-turn threshold compaction",
    async drive(g) {
      g.arm("turn_end");
      g.script.push({ ...tool, usage: heavy }, { ...tool, usage: heavy }, { text: "Loop done." });
      await g.f.session.prompt("Run the loop.");
      return {
        notice: cancelNotice("automatic threshold", automaticNext),
        summariesBefore: 0,
      };
    },
  },
  {
    name: "routed virtual threshold compaction",
    virtual: true,
    async drive(g) {
      g.arm("turn_end");
      g.script.push({ ...tool, usage: heavy }, { ...tool, usage: heavy }, { text: "Loop done." });
      await g.f.session.prompt("Run the routed loop.");
      return {
        notice: cancelNotice("automatic threshold", automaticNext),
        summariesBefore: 0,
      };
    },
  },
  {
    name: "overflow compaction with retry",
    async drive(g) {
      g.arm("turn_end");
      g.script.push({ errorMessage: overflowError });
      const acting = actingRequests(g.f).length;
      await g.f.session.prompt("Overflow now.");
      expect(actingRequests(g.f)).toHaveLength(acting + 1);
      g.script.push({ errorMessage: overflowError }, { text: "After retry." });
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.prompt("Overflow now, sent again.");
      expect(g.f.session.sessionManager.getBranch().at(-1)).toMatchObject({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "After retry." }] },
      });
      return { notice: cancelNotice("automatic overflow", retryNext), summariesBefore };
    },
  },
  {
    name: "overflow compaction without retry",
    async drive(g) {
      g.arm("turn_end");
      g.script.push({ text: "Over the window.", usage: { input: 17000, totalTokens: 17000 } });
      await g.f.session.prompt("Overflow without retry.");
      const summariesBefore = summaryRequests(g.f).length;
      await g.f.session.prompt("Next prompt.");
      return { notice: cancelNotice("automatic overflow", automaticNext), summariesBefore };
    },
  },
];

test.for(
  cancelPaths.flatMap((path) => [
    { ...path, memory: "enabled" as const },
    { ...path, memory: "disabled" as const },
  ]),
)(
  "Pi a stale note after the last turn-boundary check cancels the $name once with memory $memory, then the next compaction includes the correction",
  async ({ drive, virtual, memory }, { createFixture }) => {
    const g = await guarded(createFixture, virtual === undefined ? {} : { virtual });
    if (memory === "disabled") {
      await g.f.command("off");
    }
    const components = rawComponents(g.f);
    const { notice, summariesBefore } = await drive(g);
    expectCancelledOnce(g, notice);
    expect(compactions(g.f)).toBe(1);
    expectCorrectionIncluded(g.f, summaryRequests(g.f).slice(summariesBefore));
    expect(rawComponents(g.f)).toBe(components);
    expect(await statusLines(g.f)).toContain(
      notice.startsWith("Tiered memory cancelled the manual")
        ? "Latest correction cancellation: the manual compaction, because the current-work note in its input is no longer current: its file was edited outside tiered memory."
        : `Latest correction cancellation: the ${notice.includes("overflow") ? "automatic overflow" : "automatic threshold"} compaction, because the current-work note in its input is no longer current: its file was edited outside tiered memory.`,
    );
  },
);

test.for([
  [
    "post-run threshold",
    (g: Guarded) => {
      g.script.push({ ...tool }, { text: "Large answer.", usage: heavy });
    },
  ],
  [
    "between-turn threshold",
    (g: Guarded) => {
      g.script.push({ ...tool }, { ...tool }, { ...tool, usage: heavy }, { text: "Done." });
    },
  ],
  [
    "overflow with retry",
    (g: Guarded) => {
      g.script.push({ ...tool }, { errorMessage: overflowError }, { text: "After retry." });
    },
  ],
] as const)(
  "Pi an edit detected at a turn's end publishes the correction before %s compaction, which proceeds without a cancellation",
  async ([, plan], { createFixture }) => {
    const g = await guarded(createFixture);
    plan(g);
    g.arm("tool");
    await g.f.session.prompt("Run the loop.");
    expect(cancellations(g)).toBe(0);
    expect(compactions(g.f)).toBe(1);
    const summarized = JSON.stringify(summaryRequests(g.f).map((request) => request.messages));
    expect(summarized.indexOf("[Tiered memory: correction]")).toBeGreaterThan(
      summarized.indexOf("Use the blue setting."),
    );
    expect(summarized.indexOf("Use the blue setting.")).toBeGreaterThan(-1);
    expect(
      g.f.notifications.some((note) => note.message.startsWith("Tiered memory cancelled")),
    ).toBe(false);
  },
);

test("Pi a retried overflow after an edit detected at a turn's end keeps Pi's retry", async ({
  createFixture,
}) => {
  const g = await guarded(createFixture);
  g.script.push({ ...tool }, { errorMessage: overflowError }, { text: "After retry." });
  g.arm("tool");
  await g.f.session.prompt("Run the loop.");
  expect(g.ends.map(({ reason, aborted }) => ({ reason, aborted }))).toEqual([
    { reason: "overflow", aborted: false },
  ]);
  expect(g.f.session.sessionManager.getBranch().at(-1)).toMatchObject({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text: "After retry." }] },
  });
});

test("Pi under a virtual selection a follow-up queued during a post-run cancellation gets a second cancellation, then the third preparation proceeds with the correction", async ({
  createFixture,
}) => {
  const g = await guarded(createFixture, { virtual: true });
  g.arm("turn_end");
  g.followUpOnFailure();
  g.script.push(
    { text: "Large answer.", usage: heavy },
    { text: "Follow-up answer.", usage: heavy },
  );
  await g.f.session.prompt("Grow the context.");
  expect(cancellations(g)).toBe(2);
  expect(g.starts).toEqual(["threshold", "threshold", "threshold"]);
  expect(compactions(g.f)).toBe(1);
  expectCorrectionIncluded(g.f, summaryRequests(g.f));
});

test("Pi a correction that cannot be saved cancels once, then compaction proceeds and reports that it is not durable", async ({
  createFixture,
}) => {
  const g = await guarded(createFixture);
  const file = g.f.session.sessionManager.getSessionFile() ?? "";
  await writeFile(await notePath(g.f), edited);
  await chmod(file, 0o444);
  try {
    await expect(g.f.session.compact()).rejects.toThrow("Compaction cancelled");
  } finally {
    await chmod(file, 0o644);
  }
  await g.f.session.compact();
  expect(cancellations(g)).toBe(1);
  expect(compactions(g.f)).toBe(1);
  const gap =
    "Tiered memory let the manual compaction proceed although the current-work note in its input is no longer current: its file was edited outside tiered memory. Its correction is not durable, which cancelling the compaction would not change.";
  expect(g.f.notifications).toContainEqual({ message: gap, type: "warning" });
  expect(reports(g.f)).toContain(gap);
  expect(await statusLines(g.f)).toContain(
    "Latest correction gap: the manual compaction proceeded while the correction was not durable; the current-work note in its input is no longer current: its file was edited outside tiered memory.",
  );
});

test("Pi with native auto-compaction disabled nothing compacts automatically, the setting stays off, and manual compaction cancels once and proceeds", async ({
  createFixture,
}) => {
  const g = await guarded(createFixture, { autoCompaction: false });
  g.script.push(
    { text: "Large answer.", usage: heavy },
    { ...tool, usage: heavy },
    { text: "Loop done.", usage: heavy },
    { errorMessage: overflowError },
  );
  await g.f.session.prompt("Grow the context.");
  await g.f.session.prompt("Run the loop.");
  await g.f.session.prompt("Overflow now.");
  expect(g.starts).toEqual([]);
  expect(g.f.session.autoCompactionEnabled).toBe(false);
  await writeFile(await notePath(g.f), edited);
  await expect(g.f.session.compact()).rejects.toThrow("Compaction cancelled");
  await g.f.session.compact();
  expect(g.starts).toEqual(["manual", "manual"]);
  expect(cancellations(g)).toBe(1);
  expect(compactions(g.f)).toBe(1);
  expect(g.f.session.autoCompactionEnabled).toBe(false);
});

test("Pi a note citing a response that Pi's overflow recovery omits is invalid, the following overflow compaction cancels once, and the resent request does not present the note", async ({
  createFixture,
}) => {
  let commitOnError = false;
  const holder: { f?: Fixture } = {};
  const g = await guarded(createFixture, {
    extensions: [
      (pi) => {
        pi.on("turn_end", async (event, ctx) => {
          const { f } = holder;
          if (!commitOnError || f === undefined) {
            return;
          }
          commitOnError = false;
          const { runtime } = f.memory();
          const storage = runtime.memoryStorage(ctx);
          if (storage === undefined) {
            throw new Error("Missing open storage.");
          }
          const evidence = await Effect.runPromise(
            storage.session.sources.current(ctx.sessionManager),
          );
          const reference = encodeReference({
            projectId: storage.session.store.projectId,
            sessionId: storage.session.store.sessionId,
            entryId: event.messageEntryId,
            span: 0,
          });
          const frame = captureFrame(storage.session, ctx, storage.binding, [reference], evidence);
          const proposal = proposalFrom(
            frame,
            noteContent({ "current-work.md": "Use the blue setting; keep the partial answer." }),
            {
              "current-work.md": {
                sourceIds: frame.sourceIds,
                evidenceFingerprint: frame.evidenceFingerprint,
              },
            },
          );
          await runtime.commitProposal(ctx, proposal);
        });
      },
    ],
  });
  holder.f = g.f;
  commitOnError = true;
  g.script.push({ text: "Partial answer.", errorMessage: overflowError });
  await g.f.session.prompt("Overflow with a partial answer.");
  expect(cancellations(g)).toBe(1);
  expect(g.ends.find((end) => end.aborted)).toMatchObject({ reason: "overflow", summaries: 0 });
  expect(g.f.notifications).toContainEqual({
    message:
      "Tiered memory cancelled the automatic overflow compaction because the current-work note in its input is no longer current: the evidence it relied on changed. The correction that says so was not yet saved in the session. Pi does not retry the request that overflowed; send it again to compact with the correction and continue.",
    type: "warning",
  });
  g.script.push({ text: "Answered after the resend." });
  await g.f.session.prompt("Overflow with a partial answer, sent again.");
  const resent = actingRequests(g.f).at(-1);
  expect(noteBlocks(resent)).toEqual([]);
  expect(JSON.stringify(resent?.messages)).not.toContain("keep the partial answer");
  expect(correctionPositions(g.f).correction).toBeGreaterThan(-1);
});

const guardProject = "a".repeat(64);
const guardLineage = { projectId: guardProject, sessionId: "s" };
const guardRevision = { sessionId: "s", revisionId: "r1" };
const editedNote = { kind: "edited", digest: "e".repeat(64) } as const;

const presentedRecord: PresentationEntry = {
  version: 1,
  kind: "component",
  id: "note-record",
  lineage: guardLineage,
  anchorId: "anchor",
  component: "work-note",
  revision: guardRevision,
  sourceBoundary: { reference: `tm1:${guardProject}:s:anchor:0`, order: 0, role: "user" },
  body: "Use the blue setting.",
  bodyDigest: digest("Use the blue setting."),
};

const correctionRecord: PresentationEntry = {
  version: 1,
  kind: "correction",
  id: "correction-record",
  lineage: guardLineage,
  anchorId: "anchor",
  component: "work-note",
  affectedRevision: guardRevision,
  presented: { id: "note-record", bodyRevision: guardRevision },
  cause: { kind: "curation", event: editedNote },
};

function recordMessage(entry: PresentationEntry) {
  return {
    role: "custom" as const,
    customType: presentationMessageType,
    content: "rendered",
    display: true,
    details: entry,
    timestamp: 0,
  };
}

function recordEntry(id: string, parentId: string | null, entry: PresentationEntry): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    customType: presentationMessageType,
    content: "rendered",
    display: true,
    details: entry,
  };
}

// A guard whose note is invalid by curation and whose collaborators are scripted.
function scriptedGuard(options: { queued?: boolean; inspect?: () => Promise<void> }): {
  guard: CompactionGuard;
  ctx: ExtensionContext;
  notices: string[];
  persisted: string[];
  sent: () => number;
} {
  const notices: string[] = [];
  const persisted: string[] = [];
  let sends = 0;
  const memory = {
    session: { store: { projectId: guardProject, sessionId: "s" } },
    canonical: {
      revision: guardRevision,
      invalidNotes: ["current-work.md"],
      invalidReason: "curation",
      coverage: { state: "available", processed: { entries: new Set(), ranges: new Map() } },
      curation: { "current-work.md": editedNote },
      sourceBoundary: undefined,
      workNote: undefined,
    },
    freshness: { observation: undefined, detection: undefined },
  };
  const guard = new CompactionGuard(
    {
      appendEntry: (_type: string, data: unknown) => {
        persisted.push(Value.Check(reportEntrySchema, data) ? data.text : "");
      },
    },
    {
      freshness: {
        inspect:
          options.inspect ??
          (async () => {
            await Promise.resolve();
          }),
      },
      presentation: {
        queuedCorrection: () => options.queued === true,
        sendCorrections: () => {
          sends++;
        },
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test supplies only the members validity reads before it returns.
      memory: () => memory as unknown as ValidityMemory,
    },
  );
  const context = {
    sessionManager: { getSessionFile: () => undefined, getSessionId: () => "s" },
    ui: {
      notify: (message: string) => {
        notices.push(message);
      },
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test supplies only the members the guard reads.
  const ctx = context as unknown as ExtensionContext;
  return { guard, ctx, notices, persisted, sent: () => sends };
}

function preparedEvent(branchEntries: SessionEntry[]): SessionBeforeCompactEvent {
  const event = {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "kept",
      messagesToSummarize: [recordMessage(presentedRecord)],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 100,
    },
    branchEntries,
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test supplies only the preparation members the guard reads.
  return event as unknown as SessionBeforeCompactEvent;
}

const keptEntry: SessionEntry = {
  type: "message",
  id: "kept",
  parentId: "correction",
  timestamp: new Date(0).toISOString(),
  message: { role: "user", content: "Kept.", timestamp: 0 },
};

const failure = {
  type: "session_compact_failed",
  reason: "manual",
  aborted: true,
  willRetry: false,
  fromExtension: false,
} as const;

test("CompactionGuard lets a compaction whose correction is outside its input proceed at once and reports the gap", async () => {
  const { guard, ctx, notices, persisted } = scriptedGuard({});
  const branch = [
    recordEntry("note", null, presentedRecord),
    recordEntry("correction", "note", correctionRecord),
    keptEntry,
  ];
  expect(await guard.beforeCompact(preparedEvent(branch), ctx)).toBeUndefined();
  guard.compacted(ctx);
  const gap =
    "Tiered memory let the manual compaction proceed although the current-work note in its input is no longer current: its file was edited outside tiered memory. Its correction is not included in the compaction input, which cancelling the compaction would not change.";
  expect(notices).toEqual([gap]);
  expect(persisted).toEqual([gap]);
  expect(guard.status.cancellation).toBeUndefined();
  expect(guard.status.gap).toEqual({
    reason: "manual",
    cause: "its file was edited outside tiered memory",
    gap: "not included in the compaction input",
  });
});

test("CompactionGuard cancels once for a correction Pi still queues, without sending it again, then lets the next compaction proceed", async () => {
  const { guard, ctx, notices, sent } = scriptedGuard({ queued: true });
  const branch = [recordEntry("note", null, presentedRecord), keptEntry];
  expect(await guard.beforeCompact(preparedEvent(branch), ctx)).toEqual({ cancel: true });
  guard.failed(failure, ctx);
  expect(sent()).toBe(0);
  expect(notices).toEqual([
    "Tiered memory cancelled the manual compaction because the current-work note in its input is no longer current: its file was edited outside tiered memory. The correction that says so was sent, but Pi has not yet saved it in the session. Run /compact again to compact with the correction.",
  ]);
  expect(await guard.beforeCompact(preparedEvent(branch), ctx)).toBeUndefined();
  guard.compacted(ctx);
  expect(notices.at(-1)).toBe(
    "Tiered memory let the manual compaction proceed although the current-work note in its input is no longer current: its file was edited outside tiered memory. Its correction is not durable, and the cancellation limit for this change is reached.",
  );
});

test("CompactionGuard notifies and persists a failure of its own check and lets the compaction proceed", async () => {
  const { guard, ctx, notices, persisted } = scriptedGuard({
    inspect: async () => {
      await Promise.reject(new Error("Inspection defect."));
    },
  });
  const branch = [recordEntry("note", null, presentedRecord), keptEntry];
  expect(await guard.beforeCompact(preparedEvent(branch), ctx)).toBeUndefined();
  const notice =
    "Tiered memory could not check whether the current-work note in the manual compaction's input is still current (Inspection defect.); the compaction proceeded.";
  expect(notices).toEqual([notice]);
  expect(persisted).toEqual([notice]);
  expect(guardLines(guard.status)).toEqual([
    "Correction cancellation check failed (Inspection defect.); the compaction proceeded.",
  ]);
});

test("Pi a compaction the user aborts while the guard's inspection is in flight records no cancellation and no notice", async ({
  createFixture,
}) => {
  let hold: { entered: () => void; released: Promise<undefined> } | undefined;
  const { f } = await presentedNote(createFixture, {
    services: {
      async read(path) {
        const gate = path.endsWith("head.json") ? hold : undefined;
        hold = undefined;
        gate?.entered();
        await gate?.released;
        return await Effect.runPromise(readText(path));
      },
    },
  });
  await f.session.prompt("Keep going.");
  compactEverythingButTheLastTurn(f);
  await writeFile(await notePath(f), edited);
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  hold = {
    entered: () => {
      entered.resolve(undefined);
    },
    released: released.promise,
  };
  const compacting = f.session.compact();
  await entered.promise;
  f.session.abortCompaction();
  released.resolve(undefined);
  await expect(compacting).rejects.toThrow("This operation was aborted");
  expect(f.notifications.some((note) => note.message.startsWith("Tiered memory"))).toBe(false);
  expect(reports(f)).toEqual([]);
  await expect(f.session.compact()).rejects.toThrow("Compaction cancelled");
  expect(
    f.notifications.filter((note) => note.message.startsWith("Tiered memory cancelled")),
  ).toHaveLength(1);
  await f.session.compact();
  expect(compactions(f)).toBe(1);
});
