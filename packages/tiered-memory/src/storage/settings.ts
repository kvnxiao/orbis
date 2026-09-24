import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { mergeSettings, settingsFileSchema } from "../domain/settings.ts";
import type { EffectiveSettings, SettingsFile } from "../domain/settings.ts";
import { parseRecord, readOptional } from "./records.ts";

/** Return `tiered-memory.json` in Pi's resolved agent directory. */
export function personalSettingsPath(): string {
  return join(getAgentDir(), "tiered-memory.json");
}

/**
 * Load personal and trusted project settings and merge them over the defaults.
 *
 * The project file is not read while `projectTrusted` is false. A missing file counts as an empty
 * file. Writes nothing.
 *
 * @throws Error naming the file path when a file is not JSON or does not match
 *   `settingsFileSchema`.
 * @throws The original read error for any other file failure.
 * @throws Error from `validateBudgets` when the merged limits conflict.
 */
export async function loadSettings(
  paths: { personalPath: string; projectPath: string },
  projectTrusted: boolean,
): Promise<EffectiveSettings> {
  const personal = await readSettingsFile(paths.personalPath);
  const project = projectTrusted ? await readSettingsFile(paths.projectPath) : {};
  const { settings, sources } = mergeSettings([
    { scope: "personal", overrides: personal },
    { scope: "project", overrides: project },
  ]);
  return {
    settings,
    sources,
    personalPath: paths.personalPath,
    projectPath: paths.projectPath,
    projectTrusted,
  };
}

async function readSettingsFile(path: string): Promise<SettingsFile> {
  const text = await readOptional(path);
  return text === undefined ? {} : parseRecord(settingsFileSchema, text, path);
}
