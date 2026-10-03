import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Value } from "typebox/value";

import {
  activationEntrySchema,
  budgetsConflict,
  configurationEntrySchema,
  snapshotMatches,
} from "../domain/settings.ts";
import type { EffectiveSettings, ReportEntry, SnapshotScope } from "../domain/settings.ts";
import { resolveProjectSettingsPath } from "../storage/project-root.ts";
import { loadSettings, personalSettingsPath } from "../storage/settings.ts";

/** Name the custom entry type that records the session activation override. */
export const activationEntryType = "orbis-tiered-memory-activation";
/** Name the custom entry type that records an effective configuration snapshot. */
export const configurationEntryType = "orbis-tiered-memory-configuration";
const reportEntryType = "orbis-tiered-memory-report";

/** Append a report entry with rendered text, so the latest report stays inspectable. */
export function appendReport(pi: Pick<ExtensionAPI, "appendEntry">, text: string): void {
  pi.appendEntry(reportEntryType, { version: 1, text } satisfies ReportEntry);
}

/**
 * Report one settings load.
 *
 * `loaded` becomes current. `failed` keeps the scope it resolved, so the applying branch can fall
 * back to its latest matching snapshot. `unavailable` means the project root could not be resolved.
 * Each `error` is the failure's message.
 */
export type SettingsLoad =
  | { state: "loaded"; configuration: EffectiveSettings }
  | { state: "failed"; expected: SnapshotScope; error: string }
  | { state: "unavailable"; error: string };

/**
 * Describe what one branch step decides: the configuration to make current, the error to report,
 * and whether to append the configuration entry on the branch.
 */
export interface BranchConfiguration {
  configuration: EffectiveSettings | undefined;
  error: string | undefined;
  append: boolean;
}

/** Return an error's message, or the string form of a non-Error value. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveScope(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): Promise<{ expected: SnapshotScope } | { error: string }> {
  try {
    const projectPath = await resolveProjectSettingsPath(ctx.cwd);
    return {
      expected: {
        personalPath: personalSettingsPath(),
        projectPath,
        projectTrusted: ctx.isProjectTrusted(),
      },
    };
  } catch (error) {
    return { error: describeError(error) };
  }
}

async function loadFor(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): Promise<SettingsLoad> {
  const scope = await resolveScope(ctx);
  if ("error" in scope) {
    return { state: "unavailable", error: scope.error };
  }
  const { expected } = scope;
  try {
    return {
      state: "loaded",
      configuration: await loadSettings(expected, expected.projectTrusted),
    };
  } catch (error) {
    return { state: "failed", expected, error: describeError(error) };
  }
}

/** Resolve the paths and trust state settings would load from, or the lookup's error message. */
export function expectedScope(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): Effect.Effect<{ expected: SnapshotScope } | { error: string }> {
  return Effect.promise(async () => await resolveScope(ctx));
}

/**
 * Load personal and trusted project settings for the context and report the outcome.
 *
 * Writes nothing and changes no runtime state.
 */
export function loadSettingsFor(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): Effect.Effect<SettingsLoad> {
  return Effect.promise(async () => await loadFor(ctx));
}

/** Return the activation override of the newest valid activation entry on `branch`. */
export function restoreOverride(branch: readonly SessionEntry[]): boolean | undefined {
  let override: boolean | undefined;
  for (const entry of branch) {
    if (
      entry.type === "custom" &&
      entry.customType === activationEntryType &&
      Value.Check(activationEntrySchema, entry.data)
    ) {
      override = entry.data.enabled;
    }
  }
  return override;
}

function latestSnapshot(
  branch: readonly SessionEntry[],
  expected: SnapshotScope,
): EffectiveSettings | undefined {
  let latest: EffectiveSettings | undefined;
  for (const entry of branch) {
    if (
      entry.type === "custom" &&
      entry.customType === configurationEntryType &&
      Value.Check(configurationEntrySchema, entry.data) &&
      !budgetsConflict(entry.data.configuration.settings.limits) &&
      snapshotMatches(entry.data.configuration, expected)
    ) {
      latest = entry.data.configuration;
    }
  }
  return latest;
}

/**
 * Decide the configuration a branch step applies.
 *
 * - `load`: the first branch step after a settings load. A loaded configuration becomes current,
 *   clears the error, and is appended; a failed load falls back to the latest matching snapshot on
 *   `branch`; an unavailable project root leaves configuration unavailable.
 * - `navigation`: a later branch step. The current configuration stays and is appended only when it
 *   matches the resolved scope, keeping the current error; otherwise configuration becomes
 *   unavailable and the error is the lookup's, or asks for a reload.
 */
export function branchConfiguration(
  step:
    | { kind: "load"; load: SettingsLoad; branch: readonly SessionEntry[] }
    | {
        kind: "navigation";
        current: EffectiveSettings | undefined;
        error: string | undefined;
        scope: { expected: SnapshotScope } | { error: string };
      },
): BranchConfiguration {
  if (step.kind === "load") {
    const { load } = step;
    switch (load.state) {
      case "loaded":
        return { configuration: load.configuration, error: undefined, append: true };
      case "failed":
        return {
          configuration: latestSnapshot(step.branch, load.expected),
          error: load.error,
          append: false,
        };
      case "unavailable":
        return { configuration: undefined, error: load.error, append: false };
    }
  }
  const { current, scope } = step;
  if ("expected" in scope && current !== undefined && snapshotMatches(current, scope.expected)) {
    return { configuration: current, error: step.error, append: true };
  }
  return {
    configuration: undefined,
    error:
      "error" in scope ? scope.error : "Settings need a reload for this project or trust state.",
    append: false,
  };
}
