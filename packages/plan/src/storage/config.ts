import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { appearanceSchema, defaultAppearance } from "../tui/appearance.ts";
import type { PlanAppearance } from "../tui/appearance.ts";

/** Use Shift+Tab until personal or trusted project settings override it. */
export const defaultShortcut = "shift+tab";

/** Normalize key aliases, case, and modifier order. */
export function normalizePlanKey(value: string): string {
  return value
    .toLowerCase()
    .split("+")
    .map((part) => {
      if (part === "esc") {
        return "escape";
      }
      if (part === "return") {
        return "enter";
      }
      return part;
    })
    .toSorted()
    .join("+");
}

/** Accept Pi special keys and modified characters that do not consume ordinary typing. */
export function isPlanShortcut(value: string): value is KeyId {
  const parts = /^(?<modifiers>(?:(?:ctrl|alt|shift|super)\+)*)(?<key>.+)$/u.exec(value)?.groups;
  const key = parts?.key;
  if (key === undefined) {
    return false;
  }
  const modifiers = (parts?.modifiers ?? "").split("+").filter((part) => part.length > 0);
  if (
    new Set(modifiers).size !== modifiers.length ||
    key === "+" ||
    ((key === "escape" || key === "esc") && modifiers.length > 0)
  ) {
    return false;
  }
  const special = Object.values(Key).some(
    (candidate) => typeof candidate === "string" && candidate === key,
  );
  const character =
    key.length === 1 &&
    "abcdefghijklmnopqrstuvwxyz0123456789`-=\\[];',./!@#$%^&*()_+|~{}:<>?".includes(key);
  return (
    (special || character) && (!character || modifiers.some((modifier) => modifier !== "shift"))
  );
}

const settingsSchema = Type.Object(
  {
    planDirectory: Type.Optional(Type.String({ minLength: 1, pattern: "\\S" })),
    ...Type.Partial(appearanceSchema).properties,
    shortcut: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);
/** Represent file overrides; omitted fields inherit the lower settings scope. */
export type SettingsFields = Static<typeof settingsSchema>;
/** Resolve the default artifact directory against the session working directory. */
export const defaultPlanDirectory = ".pi/plans/";
/** Expose resolved settings with an absolute artifact directory. */
export interface PlanSettings extends PlanAppearance {
  planDirectory: string;
  showHints: boolean;
  shortcut: KeyId | null;
}

/** Return absent files as empty overrides; reject malformed fields with their file path. */
export async function readSettingsFile(
  path: string,
  signal?: AbortSignal,
): Promise<SettingsFields> {
  let text: string;
  try {
    text = await readFile(path, { encoding: "utf8", ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Cannot read planning settings ${path}: ${error instanceof Error ? error.message : String(error)}. Correct this file and retry.`,
      { cause: error },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Cannot parse planning settings ${path}. Correct this file and retry.`, {
      cause,
    });
  }
  if (!Value.Check(settingsSchema, value)) {
    const errors = Value.Errors(settingsSchema, value);
    throw new Error(
      `Invalid planning settings ${path}: ${errors.map((error) => `${error.instancePath.length === 0 ? "/" : error.instancePath}: ${error.message}`).join("; ")}. Correct this file and retry.`,
    );
  }
  if (value.planDirectory?.includes("\0") === true) {
    throw new Error(
      `Invalid planning settings ${path}: planDirectory contains a null character. Correct this file and retry.`,
    );
  }
  if (typeof value.shortcut === "string" && !isPlanShortcut(value.shortcut)) {
    throw new Error(
      `Invalid planning settings ${path}: shortcut must be a Pi special or modified key, or null to disable. Correct this file and retry.`,
    );
  }
  return value;
}

/** Merge personal and trusted project overrides onto defaults. */
export async function readSettings(
  agentDir: string,
  cwd: string,
  trusted: boolean,
  signal?: AbortSignal,
): Promise<PlanSettings> {
  const personal = await readSettingsFile(join(agentDir, "orbis-plan.json"), signal);
  const project = trusted ? await readSettingsFile(join(cwd, ".pi", "plan.json"), signal) : {};
  const settings = {
    planDirectory: defaultPlanDirectory,
    ...defaultAppearance,
    shortcut: defaultShortcut,
    ...personal,
    ...project,
  };
  return {
    planDirectory: resolve(cwd, settings.planDirectory),
    symbols: settings.symbols,
    border: settings.border,
    showHints: settings.showHints,
    shortcut:
      typeof settings.shortcut === "string" && isPlanShortcut(settings.shortcut)
        ? settings.shortcut
        : null,
  };
}

/** Serialize atomic file replacement with Pi’s mutation queue and preserve untouched fields. */
export async function writeSettings(path: string, fields: SettingsFields): Promise<void> {
  if (
    !Value.Check(settingsSchema, fields) ||
    fields.planDirectory?.includes("\0") === true ||
    (typeof fields.shortcut === "string" && !isPlanShortcut(fields.shortcut))
  ) {
    throw new Error(
      `Invalid planning settings for ${path}. Correct the directory, symbols, border, showHints, or shortcut and retry.`,
    );
  }
  await withFileMutationQueue(path, async () => {
    const previous = await readSettingsFile(path);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ ...previous, ...fields }, null, 2)}\n`, {
        flag: "wx",
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  });
}
