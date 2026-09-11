import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const symbolsSchema = Type.Union([Type.Literal("unicode"), Type.Literal("emoji")]);
export const borderSchema = Type.Union([
  Type.Literal("rounded"),
  Type.Literal("square"),
  Type.Literal("double"),
  Type.Literal("ascii"),
  Type.Literal("none"),
]);

export const defaultShortcut = "shift+tab";

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
    symbols: Type.Optional(symbolsSchema),
    border: Type.Optional(borderSchema),
    showHints: Type.Optional(Type.Boolean()),
    shortcut: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);
export type SettingsFields = Static<typeof settingsSchema>;
export type PlanAppearance = Required<Pick<SettingsFields, "symbols" | "border">> &
  Pick<SettingsFields, "showHints">;
export const defaultAppearance = {
  symbols: "unicode",
  border: "rounded",
  showHints: true,
} satisfies PlanAppearance;
export const defaultPlanDirectory = ".pi/plans/";
export interface PlanSettings extends PlanAppearance {
  planDirectory: string;
  showHints: boolean;
  shortcut: KeyId | null;
}

export async function readSettingsFile(path: string): Promise<SettingsFields> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !Value.Check(settingsSchema, value) ||
      value.planDirectory?.includes("\0") === true ||
      (typeof value.shortcut === "string" && !isPlanShortcut(value.shortcut))
    ) {
      throw new Error(
        "planDirectory must be a nonempty path; symbols must be unicode or emoji; border must be rounded, square, double, ascii, or none; showHints must be boolean; shortcut must be a Pi special or modified key, or null to disable; unknown fields are rejected",
      );
    }
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Cannot read planning settings ${path}: ${error instanceof Error ? error.message : String(error)}. Correct this file and retry.`,
      { cause: error },
    );
  }
}

export async function readSettings(
  agentDir: string,
  cwd: string,
  trusted: boolean,
): Promise<PlanSettings> {
  const personal = await readSettingsFile(join(agentDir, "orbis-plan.json"));
  const project = trusted ? await readSettingsFile(join(cwd, ".pi", "plan.json")) : {};
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
