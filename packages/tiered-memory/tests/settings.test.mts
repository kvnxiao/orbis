import { Socket } from "node:net";

import { Value } from "typebox/value";
import { expect, test } from "vitest";

import {
  activationEntrySchema,
  configurationEntrySchema,
  defaultLimits,
  limitsSchema,
  mergeSettings,
  reportEntrySchema,
  settingsFileSchema,
  snapshotMatches,
  validateBudgets,
} from "../src/domain/settings.ts";
import type { EffectiveSettings, Limits } from "../src/domain/settings.ts";
import { parseRecord } from "../src/storage/records.ts";

const expectedDefaults = {
  queuedJobs: 8,
  workerInputTokens: 8192,
  workerOutputTokens: 2048,
  jobTimeoutMs: 60000,
  retries: 1,
  compactionWaitMs: 5000,
  workNoteTokens: 1024,
  consolidationThresholdTokens: 4096,
  activeObservationTokens: 8192,
  indexTokens: 512,
  checkpointTokens: 4096,
  recallTokens: 2048,
  recallBytes: 16384,
} satisfies Limits;

const defaultLimitSources = {
  queuedJobs: "default",
  workerInputTokens: "default",
  workerOutputTokens: "default",
  jobTimeoutMs: "default",
  retries: "default",
  compactionWaitMs: "default",
  workNoteTokens: "default",
  consolidationThresholdTokens: "default",
  activeObservationTokens: "default",
  indexTokens: "default",
  checkpointTokens: "default",
  recallTokens: "default",
  recallBytes: "default",
} as const;

const configuration: EffectiveSettings = {
  settings: { enabled: true, limits: expectedDefaults },
  sources: {
    enabled: "default",
    observerModel: "default",
    consolidatorModel: "default",
    limits: defaultLimitSources,
  },
  personalPath: "/agent/tiered-memory.json",
  projectPath: "/project/.pi/tiered-memory/settings.json",
  projectTrusted: true,
};

function parseSettingsFile(value: unknown): unknown {
  return parseRecord(settingsFileSchema, JSON.stringify(value), "fixture.json");
}

const rejectedSettings: { label: string; value: unknown; path: string }[] = [
  { label: "a non-boolean enabled value at /enabled", value: { enabled: "yes" }, path: "/enabled" },
  {
    label: "a model identifier without a provider at /observerModel",
    value: { observerModel: "no-provider" },
    path: "/observerModel",
  },
  {
    label: "a negative limit at /limits/workerInputTokens",
    value: { limits: { workerInputTokens: -1 } },
    path: "/limits/workerInputTokens",
  },
  {
    label: "a fractional limit at /limits/workerInputTokens",
    value: { limits: { workerInputTokens: 1.5 } },
    path: "/limits/workerInputTokens",
  },
  {
    label: "a zero queuedJobs limit at /limits/queuedJobs",
    value: { limits: { queuedJobs: 0 } },
    path: "/limits/queuedJobs",
  },
  {
    label: "a limit above the safe-integer range at /limits/workerOutputTokens",
    value: { limits: { workerOutputTokens: 1e300 } },
    path: "/limits/workerOutputTokens",
  },
  {
    label: "an unknown limit key such as toString under /limits",
    value: { limits: { toString: 1 } },
    path: "/limits",
  },
  { label: "an unknown top-level setting", value: { unexpected: true }, path: "/unexpected" },
  { label: "a null optional field at /enabled", value: { enabled: null }, path: "/enabled" },
];

test.for(rejectedSettings)("rejects $label", ({ value, path }) => {
  expect(() => parseSettingsFile(value)).toThrow(`Invalid record at fixture.json: ${path}`);
});

test("rejects invalid JSON with the file path and the SyntaxError as cause", () => {
  let failure: unknown;
  try {
    parseRecord(settingsFileSchema, "{", "fixture.json");
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ message: "Invalid JSON at fixture.json." });
  expect(failure instanceof Error && failure.cause).toBeInstanceOf(SyntaxError);
});

test("accepts provider model identifiers with nested model IDs and zero retries", () => {
  expect(
    parseSettingsFile({ observerModel: "openrouter/anthropic/claude", limits: { retries: 0 } }),
  ).toEqual({ observerModel: "openrouter/anthropic/claude", limits: { retries: 0 } });
});

test("configuration, activation, and report entries accept their valid fixtures", () => {
  expect(Value.Check(configurationEntrySchema, { version: 1, configuration })).toBe(true);
  expect(Value.Check(activationEntrySchema, { version: 1, enabled: false })).toBe(true);
  expect(Value.Check(reportEntrySchema, { version: 1, text: "Tiered memory: enabled" })).toBe(true);
});

test.for([
  {
    label: "configuration entry rejects an unsupported version at /version",
    schema: configurationEntrySchema,
    value: { version: 2, configuration },
    path: "/version",
  },
  {
    label: "configuration entry rejects a missing configuration property",
    schema: configurationEntrySchema,
    value: { version: 1 },
    path: "/: must have required properties configuration",
  },
  {
    label:
      "configuration entry rejects a wrong-typed limit at /configuration/settings/limits/queuedJobs",
    schema: configurationEntrySchema,
    value: {
      version: 1,
      configuration: {
        ...configuration,
        settings: { enabled: true, limits: { ...expectedDefaults, queuedJobs: "8" } },
      },
    },
    path: "/configuration/settings/limits/queuedJobs",
  },
  {
    label: "activation entry rejects an unsupported version at /version",
    schema: activationEntrySchema,
    value: { version: 2, enabled: true },
    path: "/version",
  },
  {
    label: "activation entry rejects a missing enabled property",
    schema: activationEntrySchema,
    value: { version: 1 },
    path: "/: must have required properties enabled",
  },
  {
    label: "activation entry rejects a wrong-typed enabled value at /enabled",
    schema: activationEntrySchema,
    value: { version: 1, enabled: "yes" },
    path: "/enabled",
  },
  {
    label: "report entry rejects an unsupported version at /version",
    schema: reportEntrySchema,
    value: { version: 2, text: "status" },
    path: "/version",
  },
  {
    label: "report entry rejects a missing text property",
    schema: reportEntrySchema,
    value: { version: 1 },
    path: "/: must have required properties text",
  },
  {
    label: "report entry rejects a wrong-typed text value at /text",
    schema: reportEntrySchema,
    value: { version: 1, text: 1 },
    path: "/text",
  },
])("$label", ({ schema, value, path }) => {
  expect(() => parseRecord(schema, JSON.stringify(value), "entry.json")).toThrow(
    `Invalid record at entry.json: ${path}`,
  );
});

test("default limits satisfy the limits schema and budget checks", () => {
  expect(defaultLimits).toEqual(expectedDefaults);
  expect(Value.Check(limitsSchema, defaultLimits)).toBe(true);
  expect(() => {
    validateBudgets(defaultLimits);
  }).not.toThrow();
});

test("merge applies project fields over personal fields and records each winning scope", () => {
  const merged = mergeSettings([
    {
      scope: "personal",
      overrides: {
        enabled: false,
        observerModel: "local/observer",
        limits: { queuedJobs: 3, retries: 0 },
      },
    },
    { scope: "project", overrides: { enabled: true, limits: { queuedJobs: 2 } } },
  ]);
  expect(merged).toEqual({
    settings: {
      enabled: true,
      observerModel: "local/observer",
      limits: { ...expectedDefaults, queuedJobs: 2, retries: 0 },
    },
    sources: {
      enabled: "project",
      observerModel: "personal",
      consolidatorModel: "default",
      limits: { ...defaultLimitSources, queuedJobs: "project", retries: "personal" },
    },
  });
});

test("merge keeps the default value and source for omitted fields and limits", () => {
  expect(
    mergeSettings([
      { scope: "personal", overrides: {} },
      { scope: "project", overrides: { limits: {} } },
    ]),
  ).toEqual({
    settings: { enabled: true, limits: expectedDefaults },
    sources: configuration.sources,
  });
});

test.for([
  { label: "work note exceeds output", limits: { workNoteTokens: 3000 } },
  {
    label: "work note exceeds checkpoint",
    limits: { workNoteTokens: 5000, workerOutputTokens: 6000 },
  },
  { label: "threshold exceeds active pool", limits: { consolidationThresholdTokens: 9000 } },
  { label: "note and index exceed input", limits: { workerInputTokens: 1200 } },
])("merge rejects the $label budget conflict", ({ limits }) => {
  expect(() => mergeSettings([{ scope: "personal", overrides: { limits } }])).toThrow(
    "Tiered-memory limits conflict",
  );
});

test("snapshot matches only the same personal path, project path, and trust state", () => {
  const expected = {
    personalPath: configuration.personalPath,
    projectPath: configuration.projectPath,
    projectTrusted: true,
  };
  expect(snapshotMatches(configuration, expected)).toBe(true);
  expect(snapshotMatches(configuration, { ...expected, personalPath: "/other/agent.json" })).toBe(
    false,
  );
  expect(snapshotMatches(configuration, { ...expected, projectPath: "/other/settings.json" })).toBe(
    false,
  );
  expect(snapshotMatches(configuration, { ...expected, projectTrusted: false })).toBe(false);
});

test("fixture blocks external fetch and socket connections before dispatch", async () => {
  await expect(fetch("https://example.com")).rejects.toThrow(
    "External network connections are disabled",
  );
  expect(() => new Socket().connect(443, "example.com")).toThrow(
    "External network connections are disabled",
  );
});
