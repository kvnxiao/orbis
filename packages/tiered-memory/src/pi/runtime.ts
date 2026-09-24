import { isDeepStrictEqual } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

import type { ModelResolution, Role } from "../domain/models.ts";
import { dependencyFingerprint } from "../domain/proposal.ts";
import type { CommitResult, MemoryProposal } from "../domain/proposal.ts";
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
import { attachProject, refreshLineage, selectFromBranch } from "./lineage.ts";
import type {
  LineageState,
  ProposalBinding,
  ProposalContent,
  Registration,
  RegistrationEvent,
  RegistrationUpdate,
} from "./lineage.ts";
import { resolveModel } from "./models.ts";
import {
  captureProposal as captureStorageProposal,
  commitProposal as commitStorageProposal,
} from "./proposals.ts";
import { StorageSession } from "./storage-session.ts";

const activationEntryType = "orbis-tiered-memory-activation";
const configurationEntryType = "orbis-tiered-memory-configuration";
const reportEntryType = "orbis-tiered-memory-report";

/**
 * Expose the storage state that status reads.
 *
 * `stopped` holds before the first start and after a stop; `opening` lasts from start until the
 * store and source registry are open; `failed` keeps the error that stopped opening; `open` carries
 * the canonical project root, the lineage state, the head seen by the latest refresh, the counts of
 * the latest registration, and the error of the latest failed refresh.
 */
export type StorageSnapshot =
  | { state: "stopped" }
  | { state: "opening" }
  | { state: "failed"; error: string }
  | {
      state: "open";
      projectRoot: string;
      lineage: LineageState;
      latestRevision: string | null;
      registration: Registration | undefined;
      error: string | undefined;
    };

type OpenStorage = Omit<Extract<StorageSnapshot, { state: "open" }>, "projectRoot"> & {
  session: StorageSession;
};

type StorageState =
  | Extract<StorageSnapshot, { state: "stopped" | "failed" }>
  | { state: "opening"; controller: AbortController }
  | OpenStorage;

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
  storage: StorageSnapshot;
}

/**
 * Own one extension instance's configuration, activation override, role resolutions, and memory
 * jobs.
 *
 * A cancellation generation rejects role results that complete after a stop, a disable, a later
 * start, or a later role check; a storage session created per start rejects storage results the
 * same way. Branch restoration accepts only entries that match their schemas, and a configuration
 * snapshot only when its budgets are valid and its paths and trust state match the current
 * session.
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
  private storage: StorageState = { state: "stopped" };
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
      storage: this.storageSnapshot(),
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
   * Load settings for a new, resumed, or reloaded session, resolve roles, and open storage.
   *
   * Stops prior work first and restores the activation override from the active branch. A
   * successful load becomes current and is appended as a configuration entry. A failed load records
   * the error and keeps the latest matching snapshot on the branch, or leaves configuration
   * unavailable when none matches. A failed project-root lookup records its error and leaves
   * configuration unavailable. Neither failure rejects; storage opens unless a stop aborts it.
   */
  async start(ctx: ExtensionContext): Promise<void> {
    this.stop();
    const storage = this.beginStorage();
    const generation = this.generation;
    this.restoreActivation(ctx);
    try {
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
    } finally {
      await this.startStorage(ctx, storage, "session_start");
    }
  }

  /**
   * Re-establish state after tree navigation, resolve roles, and reopen storage.
   *
   * Stops prior work and restores the activation override from the destination branch. The current
   * configuration stays current and is appended on the destination branch when its paths and trust
   * state still match; otherwise configuration becomes unavailable and the error asks for a reload.
   * A failed project-root lookup records its error and leaves configuration unavailable without
   * rejecting. Reads no settings files; storage opens unless a stop aborts it.
   */
  async selectBranch(ctx: ExtensionContext): Promise<void> {
    this.stop();
    const storage = this.beginStorage();
    const generation = this.generation;
    this.restoreActivation(ctx);
    let expected: SnapshotScope | undefined;
    let failure: string | undefined;
    try {
      expected = await this.expectedSnapshot(ctx);
    } catch (error) {
      failure = describe(error);
    }
    try {
      if (generation !== this.generation) {
        return;
      }
      const current = this.configuration;
      if (expected !== undefined && current !== undefined && snapshotMatches(current, expected)) {
        this.appendConfiguration(current);
      } else {
        this.replaceConfiguration(undefined);
        this.error = failure ?? "Settings need a reload for this project or trust state.";
      }
      await this.refreshRoles(ctx);
    } finally {
      await this.startStorage(ctx, storage, "session_tree");
    }
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
    this.stopWork();
  }

  /**
   * Capture a proposal bound to the branch leaf, its evidence, the configuration, and the latest
   * head.
   *
   * @throws Error when memory is disabled or storage is not open, and the errors of
   *   `captureProposal` in `proposals.ts`.
   */
  captureProposal(
    ctx: ExtensionContext,
    content: ProposalContent,
    sourceIds: readonly string[],
  ): MemoryProposal {
    const session = this.proposalSession();
    return captureStorageProposal(session, ctx, this.binding(session), content, sourceIds);
  }

  /**
   * Commit a proposal through the open storage session and apply the lineage state it produces.
   *
   * Returns `cancelled` when the storage session stops or `ctx.signal` aborts first. A result that
   * completes after its storage session stopped is returned without changing runtime state.
   *
   * @throws Error when storage is not open, and the errors of `commitProposal` in `proposals.ts`.
   */
  async commitProposal(ctx: ExtensionContext, proposal: MemoryProposal): Promise<CommitResult> {
    const session = this.proposalSession();
    const job = new AbortController();
    const release = this.ownJob(job);
    try {
      const signal =
        ctx.signal === undefined ? job.signal : AbortSignal.any([ctx.signal, job.signal]);
      const outcome = await commitStorageProposal(
        this.pi,
        session,
        { sessionManager: ctx.sessionManager, signal },
        () => this.binding(session),
        proposal,
      );
      const open = this.openStorage(session);
      if (open !== undefined && outcome.records !== undefined) {
        this.storage = { ...open, lineage: outcome.lineage };
        await this.refreshOpenStorage(session, ctx, { sources: outcome.records, event: "commit" });
      }
      return outcome.result;
    } finally {
      release();
    }
  }

  /** Append a report entry holding rendered status text. */
  report(text: string): void {
    this.pi.appendEntry(reportEntryType, { version: 1, text } satisfies ReportEntry);
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

  /**
   * Abort owned jobs and the storage session, clear roles, and discard pending role checks;
   * repeated calls are harmless.
   */
  stop(): void {
    this.stopWork();
    const storage = this.storage;
    const reason = new Error("Tiered memory storage stopped for a session change or shutdown.");
    if (storage.state === "opening") {
      storage.controller.abort(reason);
    } else if (storage.state === "open") {
      storage.session.stop(reason);
    }
    this.storage = { state: "stopped" };
  }

  private stopWork(): void {
    this.generation++;
    this.roles = undefined;
    for (const job of this.ownedJobs) {
      job.abort(new Error("Tiered memory is disabled or the session ended."));
    }
    this.ownedJobs.clear();
  }

  private beginStorage(): AbortController {
    const controller = new AbortController();
    this.storage = { state: "opening", controller };
    return controller;
  }

  private async startStorage(
    ctx: ExtensionContext,
    controller: AbortController,
    event: RegistrationEvent,
  ): Promise<void> {
    try {
      const session = await StorageSession.open(ctx, controller);
      attachProject(this.pi, ctx.sessionManager.getBranch(), session.store);
      const lineage = await selectFromBranch(session, ctx);
      const sources = await session.sources.register(ctx.sessionManager);
      const binding = { ...this.binding(session), lineage };
      const refreshed = await refreshLineage(this.pi, session, ctx, binding, { sources, event });
      if (!controller.signal.aborted) {
        this.storage = { state: "open", session, ...refreshed, error: undefined };
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.storage = { state: "failed", error: describe(error) };
      }
    }
  }

  private async refreshOpenStorage(
    session: StorageSession,
    ctx: ExtensionContext,
    update: RegistrationUpdate,
  ): Promise<void> {
    try {
      const refreshed = await refreshLineage(this.pi, session, ctx, this.binding(session), update);
      const open = this.openStorage(session);
      if (open !== undefined) {
        this.storage = { ...open, ...refreshed, error: undefined };
      }
    } catch (error) {
      const open = this.openStorage(session);
      if (open !== undefined && !session.signal.aborted) {
        this.storage = { ...open, error: describe(error) };
      }
    }
  }

  private proposalSession(): StorageSession {
    if (!this.enabled || this.storage.state !== "open") {
      throw new Error("Memory storage is unavailable while disabled or before it opens.");
    }
    return this.storage.session;
  }

  private openStorage(session: StorageSession): OpenStorage | undefined {
    const storage = this.storage;
    return storage.state === "open" && storage.session === session ? storage : undefined;
  }

  private binding(session: StorageSession): ProposalBinding {
    const open = this.openStorage(session);
    const configuration = this.configuration;
    return {
      configurationRevision: this.configurationRevision,
      dependencyFingerprint:
        configuration === undefined
          ? undefined
          : dependencyFingerprint({
              settings: configuration.settings,
              roles: this.roles,
              projectRoot: session.store.projectRoot,
            }),
      lineage: open?.lineage ?? { selected: { state: "none" }, pending: { state: "none" } },
      latestRevision: open?.latestRevision ?? null,
    };
  }

  private storageSnapshot(): StorageSnapshot {
    const storage = this.storage;
    if (storage.state !== "open") {
      return storage.state === "opening" ? { state: "opening" } : structuredClone(storage);
    }
    const { session, ...state } = storage;
    return structuredClone({ ...state, projectRoot: session.store.projectRoot });
  }

  private setOverride(enabled: boolean): void {
    this.override = enabled;
    this.pi.appendEntry(activationEntryType, { version: 1, enabled } satisfies ActivationEntry);
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
