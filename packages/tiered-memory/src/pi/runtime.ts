import { isDeepStrictEqual } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

import type { ModelResolution, Role } from "../domain/models.ts";
import {
  activationEntrySchema,
  budgetsConflict,
  configurationEntrySchema,
  snapshotMatches,
} from "../domain/settings.ts";
import type {
  ActivationEntry,
  ConfigurationEntry,
  EffectiveSettings,
  ReportEntry,
  SnapshotScope,
} from "../domain/settings.ts";
import { resolveProjectSettingsPath } from "../storage/project-root.ts";
import { loadSettings, personalSettingsPath } from "../storage/settings.ts";
import { resolveModel } from "./models.ts";

const activationEntryType = "orbis-tiered-memory-activation";
const configurationEntryType = "orbis-tiered-memory-configuration";
const reportEntryType = "orbis-tiered-memory-report";

/**
 * Expose the runtime state that status reads.
 *
 * `configuration` is undefined while no valid effective settings are current. `override` is the
 * activation override on the active branch. `error` is the latest load or branch-selection failure.
 * `configurationRevision` increments when the effective settings change by value or when a role
 * check stores resolutions that differ by value from the last stored resolutions, which a stop or
 * disable does not clear; disabling, stopping, and a role check with identical results leave it
 * unchanged. `roles` is undefined from a stop or disable until the next role check completes.
 */
export interface RuntimeSnapshot {
  configuration: EffectiveSettings | undefined;
  override: boolean | undefined;
  error: string | undefined;
  configurationRevision: number;
  roles: Record<Role, ModelResolution> | undefined;
}

/**
 * Own one extension instance's configuration, activation override, role resolutions, and memory
 * jobs.
 *
 * A cancellation generation rejects results that complete after a stop, a disable, a later start,
 * or a later role check. Branch restoration accepts only entries that match their schemas, and a
 * configuration snapshot only when its budgets are valid and its paths and trust state match the
 * current session.
 */
export class MemoryRuntime {
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  private configuration: EffectiveSettings | undefined;
  private override: boolean | undefined;
  private error: string | undefined;
  private roles: Record<Role, ModelResolution> | undefined;
  private resolvedRoles: Record<Role, ModelResolution> | undefined;
  private generation = 0;
  private configurationRevision = 0;
  private readonly ownedJobs = new Set<AbortController>();

  constructor(pi: Pick<ExtensionAPI, "appendEntry">) {
    this.pi = pi;
  }

  /** Return a copy of runtime state that later runtime changes do not affect. */
  get snapshot(): RuntimeSnapshot {
    return {
      configuration: structuredClone(this.configuration),
      override: this.override,
      error: this.error,
      configurationRevision: this.configurationRevision,
      roles: structuredClone(this.roles),
    };
  }

  /**
   * Report whether automatic memory work may run: a configuration is current and the override, or
   * else the configured `enabled`, is true.
   */
  get enabled(): boolean {
    return (
      this.configuration !== undefined && (this.override ?? this.configuration.settings.enabled)
    );
  }

  /**
   * Load settings for a new, resumed, or reloaded session, then resolve roles.
   *
   * Stops prior work first and restores the activation override from the active branch. A
   * successful load becomes current and is appended as a configuration entry. A failed load records
   * the error and keeps the latest matching snapshot on the branch, or leaves configuration
   * unavailable when none matches. A failed project-root lookup records its error and leaves
   * configuration unavailable. Neither failure rejects.
   */
  async start(ctx: ExtensionContext): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.restoreActivation(ctx);
    let expected: SnapshotScope | undefined;
    try {
      expected = await this.expectedSnapshot(ctx);
      if (generation !== this.generation) {
        return;
      }
      const loaded = await loadSettings(expected, expected.projectTrusted);
      if (generation !== this.generation) {
        return;
      }
      this.replaceConfiguration(loaded);
      this.error = undefined;
      this.appendConfiguration(loaded);
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.replaceConfiguration(
        expected === undefined ? undefined : this.latestSnapshot(ctx, expected),
      );
      this.error = describe(error);
    }
    await this.refreshRoles(ctx);
  }

  /**
   * Re-establish state after tree navigation, then resolve roles.
   *
   * Stops prior work and restores the activation override from the destination branch. The current
   * configuration stays current and is appended on the destination branch when its paths and trust
   * state still match; otherwise configuration becomes unavailable and the error asks for a reload.
   * A failed project-root lookup records its error and leaves configuration unavailable without
   * rejecting. Reads no settings files.
   */
  async selectBranch(ctx: ExtensionContext): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.restoreActivation(ctx);
    let expected: SnapshotScope;
    try {
      expected = await this.expectedSnapshot(ctx);
    } catch (error) {
      if (generation === this.generation) {
        this.replaceConfiguration(undefined);
        this.error = describe(error);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    const current = this.configuration;
    if (current !== undefined && snapshotMatches(current, expected)) {
      this.appendConfiguration(current);
    } else {
      this.replaceConfiguration(undefined);
      this.error = "Settings need a reload for this project or trust state.";
    }
    await this.refreshRoles(ctx);
  }

  /**
   * Resolve both roles against the current configuration and store the results.
   *
   * Does nothing without a current configuration. Starts a new generation, so a stop, a disable, or
   * a later role check that begins before this one completes discards its results.
   */
  async refreshRoles(ctx: ExtensionContext): Promise<void> {
    const configuration = this.configuration;
    if (configuration === undefined) {
      return;
    }
    const generation = ++this.generation;
    const [observer, consolidator] = await Promise.all([
      resolveModel(ctx, configuration.settings, "observer"),
      resolveModel(ctx, configuration.settings, "consolidator"),
    ]);
    if (generation !== this.generation) {
      return;
    }
    const roles = { observer, consolidator };
    if (!isDeepStrictEqual(roles, this.resolvedRoles)) {
      this.configurationRevision++;
    }
    this.resolvedRoles = roles;
    this.roles = roles;
  }

  /** Set the session activation override to enabled, append an activation entry, and resolve roles. */
  async enable(ctx: ExtensionContext): Promise<void> {
    this.setOverride(true);
    await this.refreshRoles(ctx);
  }

  /**
   * Set the session activation override to disabled, append an activation entry, and stop owned
   * work.
   */
  disable(): void {
    this.setOverride(false);
    this.stop();
  }

  /** Append a report entry holding rendered status text. */
  report(text: string): void {
    const entry: ReportEntry = { version: 1, text };
    this.pi.appendEntry(reportEntryType, entry);
  }

  /**
   * Abort `controller` on the next stop or disable; the returned function unregisters it without
   * aborting.
   */
  ownJob(controller: AbortController): () => void {
    this.ownedJobs.add(controller);
    return () => {
      this.ownedJobs.delete(controller);
    };
  }

  /** Abort owned jobs, clear roles, and discard pending role checks; repeated calls are harmless. */
  stop(): void {
    this.generation++;
    this.roles = undefined;
    for (const job of this.ownedJobs) {
      job.abort(new Error("Tiered memory is disabled or the session ended."));
    }
    this.ownedJobs.clear();
  }

  private setOverride(enabled: boolean): void {
    this.override = enabled;
    const entry: ActivationEntry = { version: 1, enabled };
    this.pi.appendEntry(activationEntryType, entry);
  }

  private replaceConfiguration(configuration: EffectiveSettings | undefined): void {
    if (!isDeepStrictEqual(configuration, this.configuration)) {
      this.configurationRevision++;
    }
    this.configuration = configuration;
  }

  private appendConfiguration(configuration: EffectiveSettings): void {
    const entry: ConfigurationEntry = { version: 1, configuration };
    this.pi.appendEntry(configurationEntryType, entry);
  }

  private async expectedSnapshot(ctx: ExtensionContext): Promise<SnapshotScope> {
    return {
      personalPath: personalSettingsPath(),
      projectPath: await resolveProjectSettingsPath(ctx.cwd),
      projectTrusted: ctx.isProjectTrusted(),
    };
  }

  private restoreActivation(ctx: ExtensionContext): void {
    this.override = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "custom" &&
        entry.customType === activationEntryType &&
        Value.Check(activationEntrySchema, entry.data)
      ) {
        this.override = entry.data.enabled;
      }
    }
  }

  private latestSnapshot(
    ctx: ExtensionContext,
    expected: SnapshotScope,
  ): EffectiveSettings | undefined {
    let latest: EffectiveSettings | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
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
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
