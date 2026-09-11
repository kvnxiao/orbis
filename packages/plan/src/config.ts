import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const settingsSchema = Type.Object(
  {
    interface: Type.Optional(Type.Union([Type.Literal("terminal"), Type.Literal("browser")])),
    planDirectory: Type.Optional(Type.String({ minLength: 1, pattern: "\\S" })),
  },
  { additionalProperties: false },
);
export type SettingsFields = Static<typeof settingsSchema>;
export interface PlanSettings {
  planDirectory: string;
}

export async function readSettingsFile(path: string): Promise<SettingsFields> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Value.Check(settingsSchema, value) || value.planDirectory?.includes("\0") === true) {
      throw new Error(
        "interface must be terminal or browser; planDirectory must be a nonempty path; unknown fields are rejected",
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
    planDirectory: ".pi/plans/",
    ...personal,
    ...project,
  };
  return { planDirectory: resolve(cwd, settings.planDirectory) };
}

export async function writeSettings(path: string, fields: SettingsFields): Promise<void> {
  if (!Value.Check(settingsSchema, fields) || fields.planDirectory?.includes("\0") === true) {
    throw new Error(
      `Invalid planning settings for ${path}. Correct interface or planDirectory and retry.`,
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
