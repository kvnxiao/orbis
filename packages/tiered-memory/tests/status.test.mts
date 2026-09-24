import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";

import { MemoryRuntime } from "../src/pi/runtime.ts";
import { buildStatus, renderStatus } from "../src/pi/status.ts";
import type { StatusReport } from "../src/pi/status.ts";
import { fixtureModel, test } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";

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
  "checkpointTokens",
  "recallTokens",
  "recallBytes",
];

async function started(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options?: FixtureOptions,
): Promise<{ f: Fixture; runtime: MemoryRuntime; ctx: ExtensionContext }> {
  const f = await createFixture(options);
  const runtime = new MemoryRuntime({ appendEntry: () => undefined });
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
  expect(buildStatus(runtime, ctx)).toEqual({
    enabled: false,
    activationSource: "unavailable",
    configurationRevision: 0,
    error: `Invalid JSON at ${join(f.agentDir, "tiered-memory.json")}.`,
    configuration: undefined,
    unavailable: ["workers", "memory", "compaction"],
  });
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

test("status lists workers, memory, and compaction as unavailable", async ({ createFixture }) => {
  const { runtime, ctx } = await started(createFixture);
  expect(buildStatus(runtime, ctx).unavailable).toEqual(["workers", "memory", "compaction"]);
});

const unavailableLines = [
  "Observer and consolidator jobs: unavailable in this version.",
  "Memory paths, revisions, source coverage, active pool, pending work, and recall: unavailable in this version.",
  "Custom compaction and usage reports: unavailable in this version; Pi native compaction remains available.",
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
    unavailable: ["workers", "memory", "compaction"],
  };
  expect(renderStatus(report)).toBe(
    [
      "Tiered memory: disabled (session override)",
      "Configuration revision: 3",
      "Configuration error: Settings need a reload for this project or trust state.",
      "Personal settings: /agent/tiered-memory.json",
      "Project settings: /project/.pi/tiered-memory/settings.json (ignored: project is untrusted)",
      "observer model: local/observer (personal); local/observer; suspended: No credentials.",
      "consolidator model: active session model (default); local/session; input cap 7000 estimated tokens, output cap 2048 tokens",
      "Acting model: local/session; mandatory work-note reserve 1024 estimated tokens; preliminary remaining capacity 9000 estimated tokens. Request fit is unverified.",
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
      unavailable: ["workers", "memory", "compaction"],
    }),
  ).toBe(
    [
      "Tiered memory: disabled (configuration unavailable)",
      "Configuration revision: 0",
      "Configuration error: Invalid JSON at /agent/tiered-memory.json.",
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
    line: "Acting model: mandatory work note does not fit remaining context; memory work is suspended. Free context or select a larger model.",
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
    unavailable: [],
  });
  expect(text.split("\n")).toContain(line);
  expect(text.split("\n")).toContain(
    "observer model: active session model (default); not resolved",
  );
});
