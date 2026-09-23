import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { resolveModel } from "./models.ts";
import type { ModelResolution } from "./models.ts";
import {
  defaultLimits,
  loadSettings,
  parseSettings,
  resolveProjectSettingsPath,
  validateBudgets,
} from "./settings.ts";
import type { EffectiveSettings, Limits } from "./settings.ts";

const activationEntry = "orbis-tiered-memory-activation";
const configurationEntry = "orbis-tiered-memory-configuration";

export class MemoryRuntime {
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  private configuration: EffectiveSettings | undefined;
  private override: boolean | undefined;
  private error: string | undefined;
  private revision = 0;
  private readonly ownedJobs = new Set<AbortController>();
  private roles: Record<"observer" | "consolidator", ModelResolution> | undefined;

  constructor(pi: Pick<ExtensionAPI, "appendEntry">) {
    this.pi = pi;
  }

  get snapshot(): {
    configuration: EffectiveSettings | undefined;
    override: boolean | undefined;
    error: string | undefined;
    revision: number;
    roles: Record<"observer" | "consolidator", ModelResolution> | undefined;
  } {
    return {
      configuration: this.configuration,
      override: this.override,
      error: this.error,
      revision: this.revision,
      roles: this.roles,
    };
  }

  get enabled(): boolean {
    return (
      this.configuration !== undefined && (this.override ?? this.configuration.settings.enabled)
    );
  }

  async start(ctx: ExtensionContext): Promise<void> {
    this.stop();
    const revision = this.revision;
    this.restoreBranch(ctx);
    let projectPath: string;
    try {
      projectPath = await resolveProjectSettingsPath(ctx.cwd);
    } catch (error) {
      if (this.revision === revision) {
        this.configuration = undefined;
        this.error = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    if (this.revision !== revision) {
      return;
    }
    let previous: EffectiveSettings | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") {
        continue;
      }
      if (
        entry.customType === configurationEntry &&
        isEffectiveSettings(entry.data, ctx, projectPath)
      ) {
        previous = entry.data.configuration;
      }
    }
    try {
      const loaded = await loadSettings(ctx.cwd, ctx.isProjectTrusted(), projectPath);
      if (this.revision !== revision) {
        return;
      }
      this.configuration = loaded;
      this.error = undefined;
      this.pi.appendEntry(configurationEntry, { version: 1, configuration: loaded });
    } catch (error) {
      if (this.revision !== revision) {
        return;
      }
      this.configuration = previous;
      this.error = error instanceof Error ? error.message : String(error);
    }
    await this.refreshRoles(ctx);
  }

  async selectBranch(ctx: ExtensionContext): Promise<void> {
    this.stop();
    this.restoreBranch(ctx);
    const revision = this.revision;
    const projectPath = await resolveProjectSettingsPath(ctx.cwd);
    if (this.revision !== revision) {
      return;
    }
    const current = this.configuration;
    if (
      current !== undefined &&
      isEffectiveSettings({ version: 1, configuration: current }, ctx, projectPath)
    ) {
      this.pi.appendEntry(configurationEntry, { version: 1, configuration: current });
    } else {
      this.configuration = undefined;
      this.error = "Settings need a reload for this project or trust state.";
    }
    await this.refreshRoles(ctx);
  }

  private restoreBranch(ctx: ExtensionContext): void {
    this.override = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") {
        continue;
      }
      if (entry.customType === activationEntry && isActivation(entry.data)) {
        this.override = entry.data.enabled;
      }
    }
  }

  async refreshRoles(ctx: ExtensionContext): Promise<void> {
    const config = this.configuration;
    if (config === undefined) {
      return;
    }
    const revision = ++this.revision;
    const [observer, consolidator] = await Promise.all([
      resolveModel(ctx, config.settings, "observer"),
      resolveModel(ctx, config.settings, "consolidator"),
    ]);
    if (this.revision === revision) {
      this.roles = { observer, consolidator };
    }
  }

  async setEnabled(enabled: boolean, ctx?: ExtensionContext): Promise<void> {
    this.override = enabled;
    this.pi.appendEntry(activationEntry, { version: 1, enabled });
    if (!enabled) {
      this.stop();
    } else {
      if (ctx === undefined) {
        throw new Error("An active Pi context is required to enable tiered memory.");
      }
      await this.refreshRoles(ctx);
    }
  }

  report(text: string): void {
    this.pi.appendEntry("orbis-tiered-memory-report", { version: 1, text });
  }

  ownJob(controller: AbortController): () => void {
    this.ownedJobs.add(controller);
    return () => this.ownedJobs.delete(controller);
  }

  stop(): void {
    this.revision++;
    this.roles = undefined;
    for (const job of this.ownedJobs) {
      job.abort(new Error("Tiered memory is disabled or the session ended."));
    }
    this.ownedJobs.clear();
  }
}

function isActivation(value: unknown): value is { version: 1; enabled: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
  );
}

function isEffectiveSettings(
  value: unknown,
  ctx: ExtensionContext,
  projectPath: string,
): value is { version: 1; configuration: EffectiveSettings } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("configuration" in value)
  ) {
    return false;
  }
  const config = value.configuration;
  if (
    typeof config !== "object" ||
    config === null ||
    !("settings" in config) ||
    !("sources" in config) ||
    !("personalPath" in config) ||
    !("projectPath" in config) ||
    !("projectTrusted" in config) ||
    !("ignoredProject" in config)
  ) {
    return false;
  }
  if (
    config.personalPath !== join(getAgentDir(), "tiered-memory.json") ||
    config.projectPath !== projectPath
  ) {
    return false;
  }
  if (
    config.projectTrusted !== ctx.isProjectTrusted() ||
    typeof config.ignoredProject !== "boolean"
  ) {
    return false;
  }
  try {
    const parsed = parseSettings(config.settings, "saved settings");
    if (
      parsed.enabled === undefined ||
      parsed.limits === undefined ||
      !hasAllLimits(parsed.limits)
    ) {
      return false;
    }
    validateBudgets(parsed.limits);
    const sources = config.sources;
    if (!isRecord(sources) || !isRecord(sources.limits)) {
      return false;
    }
    for (const field of ["enabled", "observerModel", "consolidatorModel"] as const) {
      if (!validSource(sources[field])) {
        return false;
      }
    }
    for (const key of Object.keys(defaultLimits)) {
      if (!validSource(sources.limits[key])) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasAllLimits(limits: Partial<Limits>): limits is Limits {
  return Object.keys(defaultLimits).every((key) => key in limits);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSource(source: unknown): boolean {
  return source === "default" || source === "personal" || source === "project";
}
