import { link, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect, vi } from "vitest";

import { selectedAs } from "../src/pi/lineage.ts";
import type { PendingReference, Reconciliation, SelectedRevision } from "../src/pi/lineage.ts";
import type { DamagedReference } from "../src/pi/revision-references.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { buildStatus, renderStatus } from "../src/pi/status.ts";
import type { StatusReport } from "../src/pi/status.ts";
import { ProcessLiveness } from "../src/storage/services.ts";
import { MemoryStore } from "../src/storage/store.ts";
import { fixtureModel, test } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import {
  blockedLine,
  committedId,
  noteContent,
  revisionEntryType,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  unrecordedLine,
  unresolvedLine,
} from "./store-fixture.mts";
import { noteReply, ScriptedObserver, workerFixture } from "./worker-fixture.mts";

const limitOrder = [
  "queuedJobs",
  "workerInputTokens",
  "workerOutputTokens",
  "jobTimeoutMs",
  "retries",
  "compactionWaitMs",
  "workNoteTokens",
  "consolidationThresholdTokens",
  "activeObservationTokens",
  "indexTokens",
  "presentationTokens",
  "checkpointTokens",
  "recallTokens",
  "recallBytes",
];

async function started(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options?: FixtureOptions,
): Promise<{ f: Fixture; runtime: MemoryRuntime; ctx: ExtensionContext }> {
  const f = await createFixture(options);
  const runtime = runtimeFor(f, {}, { appendEntry: () => undefined });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  return { f, runtime, ctx };
}

function configured(report: StatusReport): NonNullable<StatusReport["configuration"]> {
  if (report.configuration === undefined) {
    throw new Error("Expected a configured status report.");
  }
  return report.configuration;
}

test("status reports default activation, default limit sources, and no error for defaults", async ({
  createFixture,
}) => {
  const { runtime, ctx } = await started(createFixture);
  const report = buildStatus(runtime, ctx);
  expect(report).toMatchObject({ enabled: true, activationSource: "default", error: undefined });
  expect(configured(report).limits.every(({ source }) => source === "default")).toBe(true);
});

test("status reports the session override as the activation source", async ({ createFixture }) => {
  const { runtime, ctx } = await started(createFixture);
  runtime.disable();
  expect(buildStatus(runtime, ctx)).toMatchObject({ enabled: false, activationSource: "session" });
  await runtime.enable(ctx);
  expect(buildStatus(runtime, ctx)).toMatchObject({ enabled: true, activationSource: "session" });
});

test("status reports personal and project sources for supplied fields and limits", async ({
  createFixture,
}) => {
  const { runtime, ctx } = await started(createFixture, {
    personal: { enabled: false, limits: { queuedJobs: 3 } },
    project: { enabled: true, limits: { workerInputTokens: 5000 } },
  });
  const report = buildStatus(runtime, ctx);
  expect(report).toMatchObject({ enabled: true, activationSource: "project" });
  expect(configured(report).limits).toContainEqual({
    key: "queuedJobs",
    value: 3,
    source: "personal",
  });
  expect(configured(report).limits).toContainEqual({
    key: "workerInputTokens",
    value: 5000,
    source: "project",
  });
});

test("status omits configuration and reports unavailable activation without valid settings", async ({
  createFixture,
}) => {
  const { f, runtime, ctx } = await started(createFixture, { personal: "{" });
  const { storage, ...report } = buildStatus(runtime, ctx);
  expect(report).toEqual({
    enabled: false,
    activationSource: "unavailable",
    configurationRevision: 0,
    error: `Invalid JSON at ${join(f.agentDir, "tiered-memory.json")}.`,
    configuration: undefined,
    damagedReferences: [],
    worker: undefined,
    unavailable: ["consolidator", "pool", "compaction"],
  });
  expect(storage.state).toBe("open");
});

test("status reports the ignored project flag for an untrusted project", async ({
  createFixture,
}) => {
  const { f, runtime, ctx } = await started(createFixture, { trusted: false });
  expect(configured(buildStatus(runtime, ctx))).toMatchObject({
    personalPath: join(f.agentDir, "tiered-memory.json"),
    projectPath: join(f.cwd, ".pi", "tiered-memory", "settings.json"),
    ignoredProject: true,
  });
});

test("status reports the load error alongside a retained configuration", async ({
  createFixture,
}) => {
  const { f, runtime, ctx } = await started(createFixture, {
    personal: { limits: { queuedJobs: 3 } },
  });
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{");
  await runtime.start(ctx);
  const report = buildStatus(runtime, ctx);
  expect(report.error).toBe(`Invalid JSON at ${join(f.agentDir, "tiered-memory.json")}.`);
  expect(configured(report).limits).toContainEqual({
    key: "queuedJobs",
    value: 3,
    source: "personal",
  });
});

test("status reports ready and suspended role resolutions with configured ids and sources", async ({
  createFixture,
}) => {
  const { runtime, ctx } = await started(createFixture, {
    personal: { observerModel: "unknown/missing" },
  });
  expect(configured(buildStatus(runtime, ctx)).roles).toEqual({
    observer: {
      configuredId: "unknown/missing",
      source: "personal",
      resolution: {
        state: "suspended",
        id: "unknown/missing",
        reason: "Model identifier is unresolved.",
      },
    },
    consolidator: {
      configuredId: undefined,
      source: "default",
      resolution: {
        state: "ready",
        id: "tiered-fixture/fixture",
        inputTokens: 8192,
        outputTokens: 2048,
      },
    },
  });
});

test("status reports unresolved roles after disable", async ({ createFixture }) => {
  const { runtime, ctx } = await started(createFixture);
  runtime.disable();
  const { roles } = configured(buildStatus(runtime, ctx));
  expect(roles.observer.resolution).toBeUndefined();
  expect(roles.consolidator.resolution).toBeUndefined();
});

test.for([
  {
    label: "an acting model whose context cannot hold the work note",
    change: { model: { ...fixtureModel, contextWindow: 512 } },
    expected: { state: "insufficient" },
  },
  {
    label: "the acting model reserve with unknown remaining context",
    change: { getContextUsage: () => undefined },
    expected: {
      state: "available",
      id: "tiered-fixture/fixture",
      reserveTokens: 1024,
      remainingTokens: undefined,
    },
  },
  {
    label: "the acting model reserve with estimated remaining context",
    change: { getContextUsage: () => ({ tokens: 1000, contextWindow: 16000, percent: 6.25 }) },
    expected: {
      state: "available",
      id: "tiered-fixture/fixture",
      reserveTokens: 1024,
      remainingTokens: 15000,
    },
  },
  {
    label: "no acting model when none is selected",
    change: { model: undefined },
    expected: { state: "none" },
  },
] satisfies {
  label: string;
  change: Partial<ExtensionContext>;
  expected: NonNullable<StatusReport["configuration"]>["actingModel"];
}[])("status reports $label", async ({ change, expected }, { createFixture }) => {
  const { runtime, ctx } = await started(createFixture);
  expect(configured(buildStatus(runtime, { ...ctx, ...change })).actingModel).toEqual(expected);
});

test("status lists every limit in schema order with its source", async ({ createFixture }) => {
  const { runtime, ctx } = await started(createFixture);
  expect(configured(buildStatus(runtime, ctx)).limits.map(({ key }) => key)).toEqual(limitOrder);
});

test("status lists the consolidator, the active pool, and compaction as unavailable", async ({
  createFixture,
}) => {
  const { runtime, ctx } = await started(createFixture);
  expect(buildStatus(runtime, ctx).unavailable).toEqual(["consolidator", "pool", "compaction"]);
});

const editedEvent = { kind: "edited", digest: "f".repeat(64) } as const;

const unavailableLines = [
  "Consolidator jobs: unavailable in this version.",
  "Active pool and recall: unavailable in this version.",
  "Custom compaction and its usage reports: unavailable in this version; Pi native compaction remains available.",
];

test("renders the full wording of a configured report", () => {
  const report: StatusReport = {
    enabled: false,
    activationSource: "session",
    configurationRevision: 3,
    error: "Settings need a reload for this project or trust state.",
    configuration: {
      personalPath: "/agent/tiered-memory.json",
      projectPath: "/project/.pi/tiered-memory/settings.json",
      ignoredProject: true,
      roles: {
        observer: {
          configuredId: "local/observer",
          source: "personal",
          resolution: { state: "suspended", id: "local/observer", reason: "No credentials." },
        },
        consolidator: {
          configuredId: undefined,
          source: "default",
          resolution: {
            state: "ready",
            id: "local/session",
            inputTokens: 7000,
            outputTokens: 2048,
          },
        },
      },
      actingModel: {
        state: "available",
        id: "local/session",
        reserveTokens: 1024,
        remainingTokens: 9000,
      },
      limits: [
        { key: "queuedJobs", value: 3, source: "project" },
        { key: "retries", value: 0, source: "personal" },
      ],
    },
    storage: {
      state: "open",
      projectRoot: "/project",
      selected: {
        state: "selected",
        revisionId: "revision-1",
        sessionId: "session-1",
        invalidNotes: ["current-work.md"],
        invalidReason: "curation",
      },
      latestRevision: "revision-2",
      registration: { sources: 3, curatedNotes: 1, event: "session_tree" },
      error: "Refresh failed.",
      blockingReference: undefined,
      reconciliation: "current",
      pending: { state: "none" },
      unavailableEntryId: undefined,
      workNote: { state: "invalid", revisionId: "revision-1", reason: "curation" },
      freshness: {
        validity: { state: "invalid", cause: { kind: "curation", event: editedEvent } },
        observation: { state: "verified", at: 0 },
        detection: {
          sessionDir: "/project/.pi/tiered-memory/sessions/session-1",
          event: editedEvent,
          revision: null,
          persistence: "pending",
          error: "Disk full.",
        },
      },
      processing: {
        state: "available",
        gaps: [
          { kind: "unprocessed", reference: "tm1:a" },
          { kind: "failed", reference: "tm1:b" },
          { kind: "attachment", reference: "tm1:b", count: 1 },
        ],
      },
    },
    damagedReferences: [],
    worker: {
      queued: 2,
      running: undefined,
      deferred: 1,
      exhausted: new Set(["tm1:b"]),
      last: {
        kind: "exhausted",
        failures: [{ kind: "provider", message: "Rate limited." }],
        deadline: true,
        commit: false,
      },
      usage: {
        attempts: 3,
        reported: 2,
        input: 1200,
        output: 300,
        cacheRead: 0,
        cacheWrite: undefined,
        cost: 0.25,
      },
      planningStall: 40,
      planningDeferral: {
        state: "unknown",
        reason: "its file has not been inspected",
        origin: "inspection",
      },
    },
    compaction: {
      cancellation: { reason: "overflow", cause: "its file was edited outside tiered memory" },
      gap: {
        reason: "manual",
        cause: "its file was edited outside tiered memory",
        gap: "not durable",
      },
      error: "Disk full.",
    },
    unavailable: ["consolidator", "pool", "compaction"],
  };
  expect(renderStatus(report)).toBe(
    [
      "Tiered memory: disabled (session override)",
      "Configuration revision: 3",
      "Configuration error: Settings need a reload for this project or trust state.",
      "Memory project root: /project",
      "Selected memory revision: revision-1",
      "Selected memory validity: invalid: Selected revision contains an externally curated note. Invalid notes: current-work.md.",
      "Latest durable revision: revision-2",
      "Registered original sources: 3 (session_tree)",
      "Curated session notes: 1 (session_tree)",
      "Storage error: Refresh failed.",
      "Current-work note: revision revision-1 is invalid: Selected revision contains an externally curated note.",
      "Current-work note freshness: not current because its file was edited outside tiered memory.",
      "Current-work note curation: the detected edit awaits recording; memory proposals are refused until it is recorded. Recording failed (Disk full.); the next inspection retries it.",
      "Processing coverage: 3 gaps (1 unprocessed, 1 failed, 1 with unsupported attachments)",
      "Observer jobs: 2 queued, none running, 1 deferred offers, 1 exhausted spans; last outcome: exhausted after 1 failed attempts; the job deadline passed; last failure: provider error: Rate limited.",
      "Observer usage (provider-reported): 2 of 3 attempts reported usage; input 1200 tokens, output 300 tokens, cache read 0 tokens, cache write unknown, cost 0.25",
      "Observer outcomes and usage cover this session since tiered memory last loaded, switched sessions, or navigated the tree.",
      "Observer planning: deferred because the current-work note's freshness is unknown: its file has not been inspected. Check that current-work.md is readable, then run /reload.",
      "Observer planning: stalled; after the instructions, the previous note at its reserve, and its references, the observer input cap leaves 40 estimated tokens for sources, which no source span fits, even without a native checkpoint. Raise limits.workerInputTokens, lower limits.workNoteTokens, or select an observer model with a larger context window.",
      "Latest correction cancellation: the automatic overflow compaction, because the current-work note in its input is no longer current: its file was edited outside tiered memory.",
      "Latest correction gap: the manual compaction proceeded while the correction was not durable; the current-work note in its input is no longer current: its file was edited outside tiered memory.",
      "Correction cancellation check failed (Disk full.); the compaction proceeded.",
      "Personal settings: /agent/tiered-memory.json",
      "Project settings: /project/.pi/tiered-memory/settings.json (ignored: project is untrusted)",
      "observer model: local/observer (personal); local/observer; suspended: No credentials.",
      "consolidator model: active session model (default); local/session; input cap 7000 estimated tokens, output cap 2048 tokens",
      "Acting model: local/session; mandatory work-note reserve 1024 estimated tokens; preliminary remaining capacity 9000 estimated tokens. See Request capacity for the latest request's fit check.",
      "limits.queuedJobs: 3 (project)",
      "limits.retries: 0 (personal)",
      ...unavailableLines,
    ].join("\n"),
  );
});

test("renders the wording of a report without configuration", () => {
  expect(
    renderStatus({
      enabled: false,
      activationSource: "unavailable",
      configurationRevision: 0,
      error: "Invalid JSON at /agent/tiered-memory.json.",
      configuration: undefined,
      storage: {
        state: "unavailable",
        error: "Invalid JSON at /project/identity.json.",
        freshness: undefined,
      },
      damagedReferences: [],
      worker: undefined,
      unavailable: ["consolidator", "pool", "compaction"],
    }),
  ).toBe(
    [
      "Tiered memory: disabled (configuration unavailable)",
      "Configuration revision: 0",
      "Configuration error: Invalid JSON at /agent/tiered-memory.json.",
      "Memory storage: unavailable",
      "Storage error: Invalid JSON at /project/identity.json.",
      "Automatic work: suspended; native Pi remains available.",
      ...unavailableLines,
    ].join("\n"),
  );
});

test.for([
  {
    acting: { state: "none" },
    line: "Acting model: suspended; no active model is selected.",
  },
  {
    acting: { state: "insufficient" },
    line: "Acting model: mandatory work note does not fit remaining context; a request that presents the note stops before dispatch. Run /compact, or select a model with a larger context window.",
  },
  {
    acting: { state: "available", id: "local/m", reserveTokens: 1024, remainingTokens: undefined },
    line: "Acting model: local/m; mandatory work-note reserve 1024 estimated tokens; remaining context unknown.",
  },
] satisfies {
  acting: NonNullable<StatusReport["configuration"]>["actingModel"];
  line: string;
}[])("renders the $acting.state acting-model line", ({ acting, line }) => {
  const text = renderStatus({
    enabled: true,
    activationSource: "default",
    configurationRevision: 1,
    error: undefined,
    configuration: {
      personalPath: "/agent/tiered-memory.json",
      projectPath: "/project/.pi/tiered-memory/settings.json",
      ignoredProject: false,
      roles: {
        observer: { configuredId: undefined, source: "default", resolution: undefined },
        consolidator: { configuredId: undefined, source: "default", resolution: undefined },
      },
      actingModel: acting,
      limits: [],
    },
    storage: { state: "unavailable", error: undefined, freshness: undefined },
    damagedReferences: [],
    worker: undefined,
    unavailable: [],
  });
  expect(text.split("\n")).toContain(line);
  expect(text.split("\n")).toContain(
    "observer model: active session model (default); not resolved",
  );
});

function lineageReport(
  selected: SelectedRevision,
  damagedReferences: StatusReport["damagedReferences"],
  blockingReference: DamagedReference | undefined,
): StatusReport {
  return {
    enabled: true,
    activationSource: "default",
    configurationRevision: 1,
    error: undefined,
    configuration: undefined,
    storage: {
      state: "open",
      projectRoot: "/project",
      selected,
      latestRevision: "revision-2",
      registration: undefined,
      error: undefined,
      blockingReference,
      reconciliation: "current",
      pending: { state: "none" },
      unavailableEntryId: undefined,
      workNote: { state: "absent", curation: undefined },
      freshness: { validity: { state: "absent" }, observation: undefined, detection: undefined },
      processing: { state: "available", gaps: [] },
    },
    damagedReferences,
    worker: undefined,
    unavailable: [],
  };
}

const firstDamaged = { entryId: "7f3a", path: "/version" };
const damagedPair = [firstDamaged, { entryId: "9c1e", path: "/revisionId" }];
const damagedLine =
  "Damaged revision references on the active branch: 2 excluded from lineage selection (entry 7f3a at /version, entry 9c1e at /revisionId)";

test("renders the damaged-reference line, uncertain validity, and blocked-commits line for a current selected revision", () => {
  const report = lineageReport(selectedAs("revision-1", "session-1"), damagedPair, firstDamaged);
  expect(renderStatus(report)).toBe(
    [
      "Tiered memory: enabled (default)",
      "Configuration revision: 1",
      "Memory project root: /project",
      "Selected memory revision: revision-1",
      "Selected memory validity: uncertain: damaged revision references follow the selected revision",
      "Latest durable revision: revision-2",
      "Registered original sources: not registered",
      "Curated session notes: not inspected",
      damagedLine,
      "Memory commits: blocked by damaged revision reference entry 7f3a. Navigate with /tree to a point before that entry to remove this lineage block.",
      "Current-work note: none",
      "Processing coverage: no gaps",
      "Automatic work: suspended; native Pi remains available.",
    ].join("\n"),
  );
});

test("renders uncertain validity after the invalid reason and invalid notes", () => {
  const invalid: SelectedRevision = {
    ...selectedAs("revision-1", "session-1"),
    invalidNotes: ["current-work.md"],
    invalidReason: "curation",
  };
  expect(renderStatus(lineageReport(invalid, damagedPair, firstDamaged)).split("\n")).toContain(
    "Selected memory validity: invalid: Selected revision contains an externally curated note. Invalid notes: current-work.md. Uncertain: damaged revision references follow the selected revision.",
  );
});

test("renders the damaged-reference line with current validity and no blocked line while nothing blocks", () => {
  const report = lineageReport(selectedAs("revision-1", "session-1"), damagedPair, undefined);
  const lines = renderStatus(report).split("\n");
  expect(lines).toContain("Selected memory validity: current");
  expect(lines).toContain(damagedLine);
  expect(lines.filter((line) => line.startsWith("Memory commits:"))).toEqual([]);
});

test("renders the damaged-reference line after the storage error while storage is unavailable", () => {
  const lines = renderStatus({
    ...lineageReport({ state: "none" }, damagedPair, undefined),
    storage: {
      state: "unavailable",
      error: "Invalid JSON at /sources.json.",
      freshness: undefined,
    },
  }).split("\n");
  expect(lines.slice(2, 5)).toEqual([
    "Memory storage: unavailable",
    "Storage error: Invalid JSON at /sources.json.",
    damagedLine,
  ]);
});

const readinessLines = {
  reconciling:
    "Memory commits: blocked while memory reconciles with the current settings and models.",
  failed:
    "Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.",
};
const unsavedLine =
  "Memory commits: blocked until the branch reference to revision revision-3 is saved in the session file. Pi saves a new session file after its first assistant response.";

function readinessReport(
  enabled: boolean,
  reconciliation: Reconciliation,
  pending: PendingReference,
  unavailable?: { entryId: string | undefined },
): StatusReport {
  const selected: SelectedRevision =
    unavailable === undefined
      ? { state: "none" }
      : { state: "unavailable", revisionId: "revision-1", sessionId: "s", reason: "Missing." };
  const report = lineageReport(selected, [firstDamaged], firstDamaged);
  const unavailableEntryId = unavailable?.entryId;
  return report.storage.state === "open"
    ? {
        ...report,
        enabled,
        storage: { ...report.storage, reconciliation, pending, unavailableEntryId },
      }
    : report;
}

test.for([
  {
    label: "with its reference entry while enabled",
    enabled: true,
    entryId: "8d2c",
    expected: [
      "Memory commits: blocked because the selected revision is unavailable. Navigate with /tree to a point before entry 8d2c to continue memory work without it.",
      readinessLines.failed,
    ],
  },
  {
    label: "without a reference entry while disabled",
    enabled: false,
    entryId: undefined,
    expected: ["Memory commits: blocked because the selected revision is unavailable."],
  },
])(
  "renders the unavailable-selection line $label after the damaged-reference line and before the readiness line",
  ({ enabled, entryId, expected }) => {
    const report = readinessReport(enabled, "failed", { state: "none" }, { entryId });
    const lines = renderStatus(report).split("\n");
    expect(lines.filter((line) => line.startsWith("Memory commits:"))).toEqual([
      blockedLine(firstDamaged.entryId),
      ...expected,
    ]);
  },
);

test.for([
  {
    label: "reconciling while enabled",
    enabled: true,
    reconciliation: "reconciling",
    pending: {
      state: "unresolved",
      revisionId: "revision-3",
      anchorId: "5b2e",
      reason: "evidence",
    },
    expected: [readinessLines.reconciling],
  },
  {
    label: "failed while enabled",
    enabled: true,
    reconciliation: "failed",
    pending: { state: "none" },
    expected: [readinessLines.failed],
  },
  {
    label: "unresolved while enabled",
    enabled: true,
    reconciliation: "current",
    pending: {
      state: "unresolved",
      revisionId: "revision-3",
      anchorId: "5b2e",
      reason: "evidence",
    },
    expected: [
      unresolvedLine(
        "revision-3",
        "5b2e",
        "its evidence or curated notes changed after it was committed",
      ),
    ],
  },
  {
    label: "unrecorded while enabled",
    enabled: true,
    reconciliation: "current",
    pending: { state: "unappended", revisionId: "revision-3" },
    expected: [unrecordedLine("revision-3")],
  },
  {
    label: "reconciling and unsaved while enabled",
    enabled: true,
    reconciliation: "reconciling",
    pending: { state: "appended", revisionId: "revision-3" },
    expected: [readinessLines.reconciling, unsavedLine],
  },
  {
    label: "reconciling and unsaved while disabled",
    enabled: false,
    reconciliation: "reconciling",
    pending: { state: "appended", revisionId: "revision-3" },
    expected: [unsavedLine],
  },
  {
    label: "failed and unrecorded while disabled",
    enabled: false,
    reconciliation: "failed",
    pending: { state: "unappended", revisionId: "revision-3" },
    expected: [unrecordedLine("revision-3")],
  },
  {
    label: "unresolved while disabled",
    enabled: false,
    reconciliation: "current",
    pending: {
      state: "unresolved",
      revisionId: "revision-3",
      anchorId: "5b2e",
      reason: "evidence",
    },
    expected: [],
  },
] satisfies {
  label: string;
  enabled: boolean;
  reconciliation: Reconciliation;
  pending: PendingReference;
  expected: string[];
}[])(
  "renders the damaged-reference block line, then $label, as the documented blocked lines",
  ({ enabled, reconciliation, pending, expected }) => {
    const lines = renderStatus(readinessReport(enabled, reconciliation, pending)).split("\n");
    expect(lines.filter((line) => line.startsWith("Memory commits:"))).toEqual([
      blockedLine(firstDamaged.entryId),
      ...expected,
    ]);
  },
);

test("status reports storage unavailable with the error that stopped opening", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const sessionDir = join(
    f.cwd,
    ".pi",
    "tiered-memory",
    "sessions",
    f.session.sessionManager.getSessionId(),
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "identity.json"), "damaged");
  const runtime = runtimeFor(f, {}, { appendEntry: () => undefined });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  expect(buildStatus(runtime, ctx).storage).toEqual({
    state: "unavailable",
    error: `Invalid JSON at ${join(sessionDir, "identity.json")}.`,
  });
});

test("status reports the project root, selected and latest revisions, cached counts, and their event", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status evidence.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const reference = await sourceReference(f, "Status evidence.");
  const revisionId = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [reference]),
    ),
  );
  const branch = f.session.sessionManager.getBranch();
  const evidence = sourceEntry(f, "Status evidence.");
  const order = branch.findIndex((entry) => entry.id === evidence.id);
  const recordedAt =
    evidence.type === "message" ? new Date(evidence.message.timestamp).toISOString() : "missing";
  const assistantId = branch.find(
    (entry) => entry.type === "message" && entry.message.role === "assistant",
  )?.id;
  if (assistantId === undefined) {
    throw new Error("Missing assistant source.");
  }
  const verifiedAt = runtime.memoryStorage(ctx)?.freshness.observation?.at;
  expect(verifiedAt).toBeGreaterThan(0);
  expect(buildStatus(runtime, ctx).storage).toEqual({
    state: "open",
    projectRoot: await realpath(f.cwd),
    selected: {
      state: "selected",
      revisionId,
      sessionId: f.session.sessionManager.getSessionId(),
      invalidNotes: [],
    },
    latestRevision: revisionId,
    registration: { sources: 2, curatedNotes: 0, event: "commit" },
    error: undefined,
    blockingReference: undefined,
    reconciliation: "current",
    pending: { state: "none" },
    unavailableEntryId: undefined,
    workNote: {
      state: "valid",
      revisionId,
      sourceBoundary: { reference, order, role: "user", recordedAt },
      unobserved: 1,
    },
    freshness: {
      validity: { state: "valid" },
      observation: { state: "verified", at: verifiedAt },
      detection: undefined,
    },
    processing: {
      state: "available",
      gaps: [
        {
          kind: "unprocessed",
          reference: reference.replace(sourceEntry(f, "Status evidence.").id, assistantId),
        },
      ],
    },
  });
});

test("status reports an invalid selected revision with its invalid notes and reason", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status evidence.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
        await sourceReference(f, "Status evidence."),
      ]),
    ),
  );
  const store = await storeFor(f);
  await writeFile(join(store.sessionDir, "current", "current-work.md"), "User edit\n");
  await runtime.selectBranch(ctx);
  const storage = buildStatus(runtime, ctx).storage;
  expect(storage.state === "open" ? storage.selected : undefined).toMatchObject({
    state: "selected",
    invalidNotes: ["current-work.md"],
    invalidReason: "curation",
  });
});

test("status reports an unavailable selected revision with its reason and the entry to navigate before", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const store = await storeFor(f);
  f.session.sessionManager.appendCustomEntry("orbis-tiered-memory-revision", {
    version: 1,
    projectId: store.projectId,
    sessionId: store.sessionId,
    revisionId: "missing-revision",
  });
  const entryId = f.session.sessionManager.getLeafId();
  await f.session.prompt("Persist the reference.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const report = buildStatus(runtime, ctx);
  expect(report.storage).toMatchObject({
    selected: {
      state: "unavailable",
      revisionId: "missing-revision",
      sessionId: store.sessionId,
      reason: "Selected revision missing-revision is unavailable.",
    },
    unavailableEntryId: entryId,
  });
  expect(renderStatus(report).split("\n")).toEqual(
    expect.arrayContaining([
      "Selected memory revision: unavailable (Selected revision missing-revision is unavailable.)",
      `Memory commits: blocked because the selected revision is unavailable. Navigate with /tree to a point before entry ${String(entryId)} to continue memory work without it.`,
    ]),
  );
});

test("status reports the latest refresh error while storage stays open", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status evidence.");
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
    await sourceReference(f, "Status evidence."),
  ]);
  const inspect = vi
    .spyOn(MemoryStore.prototype, "inspectCuration")
    .mockReturnValueOnce(Effect.fail(new Error("Curation unreadable.")));
  onTestFinished(() => {
    inspect.mockRestore();
  });
  expect((await runtime.commitProposal(ctx, proposal)).kind).toBe("committed");
  expect(storageOf(runtime).error).toBe("Curation unreadable.");
  expect(buildStatus(runtime, ctx).storage).toMatchObject({
    state: "open",
    error: "Curation unreadable.",
  });
});

function appendDamaged(f: Fixture, data: unknown): string {
  const manager = f.session.sessionManager;
  manager.appendCustomEntry(revisionEntryType, data);
  const entryId = manager.getLeafId();
  if (entryId === null) {
    throw new Error("Missing damaged entry.");
  }
  return entryId;
}

test("status lists a damaged reference appended after the latest refresh", async ({
  createFixture,
}) => {
  const { f, runtime, ctx } = await started(createFixture);
  const entryId = appendDamaged(f, { junk: true });
  expect(buildStatus(runtime, ctx).damagedReferences).toEqual([{ entryId, path: "/version" }]);
});

test("status lists several damaged references in branch order", async ({ createFixture }) => {
  const { f, runtime, ctx } = await started(createFixture);
  const first = appendDamaged(f, { junk: true });
  const second = appendDamaged(f, "junk");
  expect(buildStatus(runtime, ctx).damagedReferences).toEqual([
    { entryId: first, path: "/version" },
    { entryId: second, path: "/" },
  ]);
});

test("status lists a damaged reference whose data names another project", async ({
  createFixture,
}) => {
  const { f, runtime, ctx } = await started(createFixture);
  const entryId = appendDamaged(f, {
    version: 1,
    projectId: "b".repeat(64),
    sessionId: 5,
    revisionId: "revision-1",
  });
  expect(buildStatus(runtime, ctx).damagedReferences).toEqual([{ entryId, path: "/sessionId" }]);
});

test("status lists damaged references while storage failed to open on a damaged sources.json", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status evidence.");
  const sources = join((await storeFor(f)).sessionDir, "sources.json");
  await writeFile(sources, "damaged");
  const entryId = appendDamaged(f, { junk: true });
  const runtime = runtimeFor(f, {}, { appendEntry: () => undefined });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const report = buildStatus(runtime, ctx);
  expect(report.storage).toEqual({ state: "unavailable", error: `Invalid JSON at ${sources}.` });
  expect(report.damagedReferences).toEqual([{ entryId, path: "/version" }]);
});

test("status lists damaged references while storage failed to open on a busy lock", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status evidence.");
  const entryId = appendDamaged(f, { junk: true });
  const blocker = 2 ** 30;
  let publications = 0;
  let now = 0;
  const runtime = runtimeFor(
    f,
    {
      now: () => (now += 1000),
      isRunning: (pid) => pid === blocker || ProcessLiveness.live.isRunning(pid),
      lock: {
        publish: async (source, ticket) => {
          publications++;
          if (publications > 1) {
            await writeFile(ticket, JSON.stringify({ version: 1, pid: blocker, token: "other" }));
          }
          await link(source, ticket);
        },
      },
    },
    { appendEntry: () => undefined },
  );
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const report = buildStatus(runtime, ctx);
  expect(report.storage).toEqual({
    state: "unavailable",
    error: "Tiered memory project lock is busy. Retry after the other writer finishes.",
  });
  expect(report.damagedReferences).toEqual([{ entryId, path: "/version" }]);
});

test.for([
  {
    label: "a none selection",
    selection: ["Selected memory revision: none"],
  },
  {
    label: "an unavailable selection",
    arrange: async (f: Fixture) => {
      const store = await storeFor(f);
      f.session.sessionManager.appendCustomEntry(revisionEntryType, {
        version: 1,
        projectId: store.projectId,
        sessionId: store.sessionId,
        revisionId: "missing-revision",
      });
    },
    selection: [
      "Selected memory revision: unavailable (Selected revision missing-revision is unavailable.)",
    ],
  },
  {
    label: "an invalid selected revision",
    arrange: async (f: Fixture) => {
      const runtime = runtimeFor(f);
      const ctx = f.session.extensionRunner.createContext();
      await runtime.start(ctx);
      committedId(
        await runtime.commitProposal(
          ctx,
          runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
            await sourceReference(f, "Status evidence."),
          ]),
        ),
      );
      const store = await storeFor(f);
      await writeFile(join(store.sessionDir, "current", "current-work.md"), "User edit\n");
    },
    selection: [
      "Selected memory validity: invalid: Selected revision contains an externally curated note. Invalid notes: current-work.md. Uncertain: damaged revision references follow the selected revision.",
    ],
  },
] satisfies { label: string; arrange?: (f: Fixture) => Promise<void>; selection: string[] }[])(
  "status reports the lineage block beside $label and keeps its selection diagnostics",
  async ({ arrange, selection }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Status evidence.");
    await arrange?.(f);
    const entryId = appendDamaged(f, { junk: true });
    const runtime = runtimeFor(f);
    const ctx = f.session.extensionRunner.createContext();
    await runtime.start(ctx);
    const lines = renderStatus(buildStatus(runtime, ctx)).split("\n");
    expect(lines).toEqual(expect.arrayContaining([...selection, blockedLine(entryId)]));
  },
);

function outcomes(lines: string[]): string[] {
  return lines.filter(
    (line) => line.startsWith("Observer jobs:") || line.startsWith("Observer usage"),
  );
}

test.for(["a reload", "a session switch", "tree navigation"] as const)(
  "Pi observer outcomes and usage start empty after %s",
  async (change, { createFixture }) => {
    const observer = new ScriptedObserver();
    const f = await workerFixture(createFixture, observer);
    await f.session.prompt("Remember the blue setting.");
    const first = await observer.next();
    first.reply(noteReply("Use the blue setting.", first.call));
    await f.memory().work.idle();
    await f.command("status");
    expect(outcomes(f.report().split("\n"))).toEqual([
      expect.stringMatching(/last outcome: committed revision /u),
      "Observer usage (provider-reported): 1 of 1 attempts reported usage; input 0 tokens, output 0 tokens, cache read 0 tokens, cache write 0 tokens, cost 0",
    ]);
    if (change === "a reload") {
      await f.reload();
    } else if (change === "a session switch") {
      await f.session.extensionRunner.emit({ type: "session_start", reason: "resume" });
    } else {
      const response = f.session.sessionManager
        .getBranch()
        .findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
      await f.session.navigateTree(response?.id ?? "", { summarize: false });
    }
    await f.command("status");
    expect(outcomes(f.report().split("\n"))).toEqual([
      expect.stringMatching(/ 0 exhausted spans; last outcome: none$/u),
      "Observer usage (provider-reported): no attempts",
    ]);
  },
);
