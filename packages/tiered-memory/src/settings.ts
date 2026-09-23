import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const defaultLimits = {
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
} as const;

export type Limits = { -readonly [K in keyof typeof defaultLimits]: number };
export type SettingSource = "default" | "personal" | "project";
const execFileAsync = promisify(execFile);
export interface Settings {
  enabled: boolean;
  observerModel?: string;
  consolidatorModel?: string;
  limits: Limits;
}
export interface EffectiveSettings {
  settings: Settings;
  sources: Record<"enabled" | "observerModel" | "consolidatorModel", SettingSource> & {
    limits: Record<keyof Limits, SettingSource>;
  };
  personalPath: string;
  projectPath: string;
  projectTrusted: boolean;
  ignoredProject: boolean;
}

type SettingOverrides = Partial<Omit<Settings, "limits">> & { limits?: Partial<Limits> };

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLimitKey(key: string): key is keyof Limits {
  return Object.hasOwn(defaultLimits, key);
}

export function parseSettings(value: unknown, path: string): SettingOverrides {
  const data = object(value, path);
  for (const key of Object.keys(data)) {
    if (!["enabled", "observerModel", "consolidatorModel", "limits"].includes(key)) {
      throw new Error(`${path}: unknown setting ${key}.`);
    }
  }
  const result: SettingOverrides = {};
  if ("enabled" in data) {
    if (typeof data.enabled !== "boolean") {
      throw new Error(`${path}: enabled must be boolean.`);
    }
    result.enabled = data.enabled;
  }
  for (const role of ["observerModel", "consolidatorModel"] as const) {
    if (!(role in data)) {
      continue;
    }
    const modelId = data[role];
    if (typeof modelId !== "string" || !/^[^\s/]+\/[^\s]+$/.test(modelId)) {
      throw new Error(`${path}: ${role} must be a provider/model identifier.`);
    }
    result[role] = modelId;
  }
  if ("limits" in data) {
    const limits = object(data.limits, `${path}: limits`);
    const parsed: Partial<Limits> = {};
    for (const [key, amount] of Object.entries(limits)) {
      if (!isLimitKey(key)) {
        throw new Error(`${path}: unknown limit ${key}.`);
      }
      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        (key !== "retries" && amount === 0)
      ) {
        throw new Error(
          `${path}: limits.${key} must be a ${key === "retries" ? "nonnegative" : "positive"} integer.`,
        );
      }
      parsed[key] = amount;
    }
    result.limits = parsed;
  }
  return result;
}

async function readSettings(path: string): Promise<SettingOverrides | undefined> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  try {
    return parseSettings(JSON.parse(contents) as unknown, path);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path}: invalid JSON.`, { cause: error });
    }
    throw error;
  }
}

export async function resolveProjectSettingsPath(cwd: string): Promise<string> {
  let root: string;
  try {
    const result = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      timeout: 2000,
      maxBuffer: 16_384,
      env: { ...process.env, LC_ALL: "C" },
    });
    root = result.stdout.replace(/\r?\n$/u, "");
    if (root.length === 0) {
      throw new Error("Git returned an empty worktree root.");
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      (error.stderr.includes("not a git repository") ||
        error.stderr.includes("must be run in a work tree"))
    ) {
      root = resolve(cwd);
    } else {
      throw new Error("Unable to determine the project worktree root.", { cause: error });
    }
  }
  return join(root, ".pi", "tiered-memory", "settings.json");
}

export async function loadSettings(
  cwd: string,
  trusted: boolean,
  resolvedProjectPath?: string,
): Promise<EffectiveSettings> {
  const personalPath = join(getAgentDir(), "tiered-memory.json");
  const projectPath = resolvedProjectPath ?? (await resolveProjectSettingsPath(cwd));
  const personal = await readSettings(personalPath);
  const project = trusted ? await readSettings(projectPath) : undefined;
  const sources: EffectiveSettings["sources"] = {
    enabled: "default",
    observerModel: "default",
    consolidatorModel: "default",
    limits: {
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
    },
  };
  const settings: Settings = { enabled: true, limits: { ...defaultLimits } };
  for (const [scope, overrides] of [
    ["personal", personal],
    ["project", project],
  ] as const) {
    if (overrides === undefined) {
      continue;
    }
    if (overrides.enabled !== undefined) {
      settings.enabled = overrides.enabled;
      sources.enabled = scope;
    }
    if (overrides.observerModel !== undefined) {
      settings.observerModel = overrides.observerModel;
      sources.observerModel = scope;
    }
    if (overrides.consolidatorModel !== undefined) {
      settings.consolidatorModel = overrides.consolidatorModel;
      sources.consolidatorModel = scope;
    }
    for (const key of Object.keys(defaultLimits).filter(isLimitKey)) {
      const amount = overrides.limits?.[key];
      if (amount === undefined) {
        continue;
      }
      settings.limits[key] = amount;
      sources.limits[key] = scope;
    }
  }
  validateBudgets(settings.limits);
  return {
    settings,
    sources,
    personalPath,
    projectPath,
    projectTrusted: trusted,
    ignoredProject: !trusted,
  };
}

export function validateBudgets(limits: Limits): void {
  if (
    limits.workNoteTokens > limits.checkpointTokens ||
    limits.workNoteTokens > limits.workerOutputTokens ||
    limits.consolidationThresholdTokens > limits.activeObservationTokens ||
    limits.workNoteTokens + limits.indexTokens > limits.workerInputTokens
  ) {
    throw new Error(
      "Tiered-memory limits conflict: the work note, threshold, or index exceeds its containing budget.",
    );
  }
}
