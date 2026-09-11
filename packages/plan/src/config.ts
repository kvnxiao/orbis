import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
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

const settingsSchema = Type.Object(
  {
    planDirectory: Type.Optional(Type.String({ minLength: 1, pattern: "\\S" })),
    symbols: Type.Optional(symbolsSchema),
    border: Type.Optional(borderSchema),
    showHints: Type.Optional(Type.Boolean()),
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
}

export async function readSettingsFile(path: string): Promise<SettingsFields> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Value.Check(settingsSchema, value) || value.planDirectory?.includes("\0") === true) {
      throw new Error(
        "planDirectory must be a nonempty path; symbols must be unicode or emoji; border must be rounded, square, double, ascii, or none; showHints must be boolean; unknown fields are rejected",
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
    ...personal,
    ...project,
  };
  return {
    planDirectory: resolve(cwd, settings.planDirectory),
    symbols: settings.symbols,
    border: settings.border,
    showHints: settings.showHints,
  };
}

export async function writeSettings(path: string, fields: SettingsFields): Promise<void> {
  if (!Value.Check(settingsSchema, fields) || fields.planDirectory?.includes("\0") === true) {
    throw new Error(
      `Invalid planning settings for ${path}. Correct the directory, symbols, border, or showHints and retry.`,
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
