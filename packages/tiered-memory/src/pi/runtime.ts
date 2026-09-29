import { isDeepStrictEqual } from "node:util";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as Layer from "effect/Layer";

import type { ModelResolution, Role } from "../domain/models.ts";
import { dependencyFingerprint } from "../domain/proposal.ts";
import type { CommitResult, MemoryProposal } from "../domain/proposal.ts";
import type {
  ActivationEntry,
  ConfigurationEntry,
  EffectiveSettings,
  ReportEntry,
} from "../domain/settings.ts";
import { fromPromise, recoverFailure } from "../storage/files.ts";
import { liveStorage } from "../storage/services.ts";
import type { StorageServices } from "../storage/services.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { MemoryStore, StoreCommitResult } from "../storage/store.ts";
import {
  activationEntryType,
  branchConfiguration,
  configurationEntryType,
  describeError,
  expectedScope,
  loadSettingsFor,
  restoreOverride,
} from "./configuration.ts";
import type { BranchConfiguration, SettingsLoad } from "./configuration.ts";
import { Execution } from "./execution.ts";
import type { StorageScope } from "./execution.ts";
import { attachProject, refreshLineage, selectFromBranch } from "./lineage.ts";
import type { ProposalBinding, ProposalContent, RegistrationEvent } from "./lineage.ts";
import { resolveRoles } from "./models.ts";
import {
  attachCommitted,
  captureProposal as captureStorageProposal,
  commitProposal as commitStorageProposal,
} from "./proposals.ts";
import type { CommitProgress } from "./proposals.ts";
import { openStorageSession, storageSnapshot } from "./storage-session.ts";
import type { OpenStorage, StorageSnapshot, StorageState } from "./storage-session.ts";

const reportEntryType = "orbis-tiered-memory-report";

/**
 * Expose the runtime state that status reads.
 *
 * `configuration` is undefined while no valid effective settings are current. `override` is the
 * activation override on the active branch. `error` is the latest load or branch-selection failure.
 * `configurationRevision` increments when the effective settings change by value or when a role
 * check stores resolutions that differ by value from the last stored resolutions, which shutdown
 * and disable do not clear; disabling, shutdown, and a role check with identical results leave it
 * unchanged. `roles` is undefined from a replacement, shutdown, or disable until the next role
 * check completes.
 */
export interface RuntimeSnapshot {
  configuration: EffectiveSettings | undefined;
  override: boolean | undefined;
  error: string | undefined;
  configurationRevision: number;
  roles: Record<Role, ModelResolution> | undefined;
  storage: StorageSnapshot;
}

function sessionChange(): Error {
  return new Error("Tiered memory storage stopped for a session change or shutdown.");
}

/**
 * Own one extension instance's configuration, activation override, role resolutions, and storage
 * state, and expose them to Pi as Promise methods and plain values.
 *
 * State changes follow these rules, so work that a later transition interrupted or replaced cannot
 * apply a late result:
 *
 * - Settings, role, and storage-startup results apply inside their owning fiber after the await that
 *   produced them.
 * - A commit publishes its source registration synchronously from the registry's cache-replacing
 *   step, and only while the commit's storage scope is current.
 * - Storage-session work re-reads current storage after each await and merges its result into it,
 *   never into state read before the await, and changes nothing once its scope is not current.
 *
 * Branch restoration accepts only entries that match their schemas, and a configuration snapshot
 * only when its budgets are valid and its paths and trust state match the current session.
 */
export class MemoryRuntime {
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  private readonly execution: Execution;
  private configuration: EffectiveSettings | undefined;
  private override: boolean | undefined;
  private error: string | undefined;
  private roles: Record<Role, ModelResolution> | undefined;
  private resolvedRoles: Record<Role, ModelResolution> | undefined;
  private configurationRevision = 0;
  private storage: StorageState = { state: "stopped" };
  private unappliedLoad: Fiber.Fiber<SettingsLoad, unknown> | undefined;

  /**
   * Create the runtime and its execution owner.
   *
   * `services` supplies the storage capabilities and must build synchronously.
   */
  constructor(
    pi: Pick<ExtensionAPI, "appendEntry">,
    services: Layer.Layer<StorageServices> = liveStorage,
  ) {
    this.pi = pi;
    this.execution = new Execution(services);
  }

  /** Return a copy of runtime state that later runtime changes do not affect. */
  get snapshot(): RuntimeSnapshot {
    return {
      configuration: structuredClone(this.configuration),
      override: this.override,
      error: this.error,
      configurationRevision: this.configurationRevision,
      roles: structuredClone(this.roles),
      storage: storageSnapshot(this.storage),
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
   * Replace the session's work for a new, resumed, or reloaded session and run its branch step.
   *
   * Starts a settings load that replaces any previous load, then runs a branch step that restores
   * the activation override, applies the load result, appends the configuration entry for a
   * successful load, resolves roles, and opens storage after the old storage scope closed. A failed
   * load keeps the latest matching snapshot on the branch; a project-root failure leaves
   * configuration unavailable. Neither rejects, and storage opens in both cases. Resolves when a
   * later transition supersedes this one.
   *
   * @throws Error when shutdown has started, before any state changes.
   * @throws The original error of a failed role check or entry append, after storage opened.
   */
  async start(ctx: ExtensionContext): Promise<void> {
    await this.replaceSession(ctx, "session_start");
  }

  /**
   * Replace the session's work after tree navigation and run its branch step.
   *
   * Leaves a settings load in flight running and waits for it. The first branch step after a load
   * applies the load result as `start` does, on the destination branch. A later branch step keeps
   * the current configuration and appends it on the destination branch only when its paths and
   * trust state still match; otherwise configuration becomes unavailable and the error asks for a
   * reload. Reads no settings files; storage opens after the old storage scope closed.
   *
   * @throws Error when shutdown has started, before any state changes.
   * @throws The original error of a failed role check or entry append, after storage opened.
   */
  async selectBranch(ctx: ExtensionContext): Promise<void> {
    await this.replaceSession(ctx, "session_tree");
  }

  /**
   * Resolve both roles against the current configuration and store the results.
   *
   * Does nothing without a current configuration or after shutdown started. Replaces any running
   * role check; a check that a later check, a disable, a replacement, or shutdown supersedes
   * resolves without storing results.
   */
  async refreshRoles(ctx: ExtensionContext): Promise<void> {
    if (this.configuration === undefined) {
      return;
    }
    await this.execution.run(this.execution.runRoleWork(this.roleCheck(ctx)));
  }

  /**
   * Set the session activation override to enabled, append an activation entry, and resolve roles.
   *
   * After shutdown started, records the override and skips the role check.
   */
  async enable(ctx: ExtensionContext): Promise<void> {
    this.setOverride(true);
    await this.execution.run(this.execution.runRoleWork(this.roleCheck(ctx)));
  }

  /**
   * Set the session activation override to disabled, append an activation entry, clear roles, and
   * cancel role work and jobs.
   *
   * Leaves the settings load, the branch step, and storage running, so a load in flight still
   * becomes current.
   */
  disable(): void {
    this.setOverride(false);
    this.roles = undefined;
    this.execution.cancelActiveWork(new Error("Tiered memory is disabled."));
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
    const open = this.proposalStorage();
    return captureStorageProposal(
      open.session,
      ctx,
      this.binding(open.scope, open.session.store),
      content,
      sourceIds,
    );
  }

  /**
   * Commit a proposal as a job of the open storage scope, then apply its lineage in that scope.
   *
   * Outcomes:
   *
   * - `committed` when the head became durable, including when cancellation arrived after it.
   * - `cancelled` with the first reason when `ctx.signal`, a disable, a replacement, or shutdown
   *   cancelled the job before the head; a pre-aborted `ctx.signal` starts no work.
   * - `conflict` from the checks under the lock.
   *
   * After `committed`, the branch-reference append, confirmation, and refresh run as work of the
   * commit's original storage scope. After `conflict`, or `cancelled` once the registration write
   * succeeded, a refresh runs as that work instead; a rejected commit runs none. Each refresh reads
   * the scope's newest completed registration when it starts; a registration that completes during
   * the refresh waits for the next one. The scope runs such work one at a time. A disable does not
   * stop it, and a replacement or shutdown discards it without changing the result. A failure of
   * that work records `storage.error` while the scope is current and leaves the result unchanged.
   *
   * @throws Error when memory is disabled, storage is not open, or shutdown has started.
   * @throws The original error of a failed commit, including a failed view write after the head.
   */
  async commitProposal(ctx: ExtensionContext, proposal: MemoryProposal): Promise<CommitResult> {
    const { scope, session } = this.proposalStorage();
    const job = await this.execution.runJob<StoreCommitResult, CommitProgress>(
      scope,
      ctx.signal,
      (record) =>
        commitStorageProposal(
          session,
          ctx,
          () => this.binding(scope, session.store),
          proposal,
          (progress) => {
            record(progress);
            if (progress.stage === "registered") {
              this.publishRegistration(scope, progress.records);
            }
          },
        ),
    );
    const progress = job.outcome;
    if (progress?.stage === "committed") {
      await this.runStorageWork(scope, this.applyCommitted(scope, ctx, progress.revisionId));
      return { kind: "committed", revisionId: progress.revisionId };
    }
    if (progress !== undefined) {
      await this.runStorageWork(scope, this.refreshIn(scope, ctx));
    }
    return job.kind === "completed" ? job.value : { kind: "cancelled", reason: job.reason };
  }

  /** Append a report entry with rendered status text. */
  report(text: string): void {
    this.pi.appendEntry(reportEntryType, { version: 1, text } satisfies ReportEntry);
  }

  /**
   * Cancel all work, close storage, and dispose the runtime; repeated calls share one shutdown.
   *
   * Resolves after the storage scope closed, which waits for durable writes already in progress,
   * and the runtime is disposed. Does not wait for settings or credential lookups. Later
   * transitions reject or resolve without starting work.
   */
  async shutdown(): Promise<void> {
    if (!this.execution.stopped) {
      this.roles = undefined;
      this.storage = { state: "stopped" };
    }
    await this.execution.shutdown(sessionChange());
  }

  private async replaceSession(
    ctx: ExtensionContext,
    event: Exclude<RegistrationEvent, "commit">,
  ): Promise<void> {
    this.execution.replace(sessionChange());
    this.roles = undefined;
    this.storage = { state: "opening" };
    if (event === "session_start") {
      this.unappliedLoad = this.execution.startSettingsLoad(loadSettingsFor(ctx));
    }
    await this.execution.run(this.execution.runBranchStep(this.branchStep(ctx, event)));
  }

  private readonly branchStep = Effect.fnUntraced(function* (
    this: MemoryRuntime,
    ctx: ExtensionContext,
    event: Exclude<RegistrationEvent, "commit">,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    const prepared = yield* Effect.exit(this.prepareBranch(ctx));
    if (Exit.isFailure(prepared) && Cause.hasInterruptsOnly(prepared.cause)) {
      return yield* prepared;
    }
    yield* this.execution.openStorage((storage) => this.startStorage(ctx, event, storage));
    return yield* prepared;
  });

  private readonly prepareBranch = Effect.fnUntraced(function* (
    this: MemoryRuntime,
    ctx: ExtensionContext,
  ): Effect.fn.Return<void, unknown> {
    this.override = restoreOverride(ctx.sessionManager.getBranch());
    const load = this.unappliedLoad;
    if (load === undefined) {
      const scope = yield* expectedScope(ctx);
      const current = { current: this.configuration, error: this.error };
      this.applyConfiguration(branchConfiguration({ kind: "navigation", ...current, scope }));
    } else {
      const result = yield* Fiber.join(load);
      this.unappliedLoad = undefined;
      const branch = ctx.sessionManager.getBranch();
      this.applyConfiguration(branchConfiguration({ kind: "load", load: result, branch }));
    }
    yield* this.execution.runRoleWork(this.roleCheck(ctx));
  });

  private applyConfiguration(decision: BranchConfiguration): void {
    this.replaceConfiguration(decision.configuration);
    this.error = decision.error;
    if (decision.append && decision.configuration !== undefined) {
      const entry: ConfigurationEntry = { version: 1, configuration: decision.configuration };
      this.pi.appendEntry(configurationEntryType, entry);
    }
  }

  private readonly roleCheck = Effect.fnUntraced(function* (
    this: MemoryRuntime,
    ctx: ExtensionContext,
  ): Effect.fn.Return<void, unknown> {
    const configuration = this.configuration;
    if (configuration === undefined) {
      return;
    }
    const roles = yield* fromPromise(async () => await resolveRoles(ctx, configuration.settings));
    if (!isDeepStrictEqual(roles, this.resolvedRoles)) {
      this.configurationRevision++;
    }
    this.resolvedRoles = roles;
    this.roles = roles;
  });

  private readonly startStorage = Effect.fnUntraced(
    function* (
      this: MemoryRuntime,
      ctx: ExtensionContext,
      event: Exclude<RegistrationEvent, "commit">,
      storage: StorageScope,
    ): Effect.fn.Return<void, unknown, StorageServices> {
      const session = yield* openStorageSession(ctx);
      attachProject(this.pi, ctx.sessionManager.getBranch(), session.store);
      const lineage = yield* selectFromBranch(session.store, ctx);
      const sources = yield* session.sources.register(ctx.sessionManager);
      const update = { sources, event };
      const binding = { ...this.binding(storage, session.store), lineage };
      const refreshed = yield* refreshLineage(this.pi, session.store, ctx, binding, update);
      const opened = { scope: storage, session, newestRegistration: update };
      this.storage = { state: "open", ...opened, ...refreshed, error: undefined };
    },
    Effect.catchCause((cause) =>
      recoverFailure(cause, (failure) => {
        this.storage = { state: "failed", error: describeError(failure) };
      }),
    ),
  );

  private readonly applyCommitted = Effect.fnUntraced(function* (
    this: MemoryRuntime,
    scope: StorageScope,
    ctx: ExtensionContext,
    revisionId: string,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    const before = this.openIn(scope);
    if (before === undefined) {
      return;
    }
    const { session } = before;
    const lineage = yield* attachCommitted(this.pi, session, ctx, before.lineage, revisionId);
    const attached = this.openIn(scope);
    if (attached === undefined) {
      return;
    }
    this.storage = { ...attached, lineage };
    yield* this.refreshIn(scope, ctx);
  });

  private readonly refreshIn = Effect.fnUntraced(function* (
    this: MemoryRuntime,
    scope: StorageScope,
    ctx: ExtensionContext,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    const before = this.openIn(scope);
    if (before === undefined) {
      return;
    }
    const store = before.session.store;
    const binding = this.binding(scope, store);
    const update = before.newestRegistration;
    const refreshed = yield* refreshLineage(this.pi, store, ctx, binding, update);
    const current = this.openIn(scope);
    if (current !== undefined) {
      this.storage = { ...current, ...refreshed, error: undefined };
    }
  });

  private async runStorageWork(
    scope: StorageScope,
    work: Effect.Effect<void, unknown, StorageServices>,
  ): Promise<void> {
    await this.execution.runInStorage(scope, work).catch((error: unknown) => {
      const open = this.openIn(scope);
      if (open !== undefined) {
        this.storage = { ...open, error: describeError(error) };
      }
    });
  }

  private publishRegistration(scope: StorageScope, sources: readonly SourceRecord[]): void {
    const open = this.openIn(scope);
    if (open !== undefined) {
      this.storage = { ...open, newestRegistration: { sources, event: "commit" } };
    }
  }

  private proposalStorage(): OpenStorage {
    if (!this.enabled || this.storage.state !== "open") {
      throw new Error("Memory storage is unavailable while disabled or before it opens.");
    }
    return this.storage;
  }

  private openIn(scope: StorageScope): OpenStorage | undefined {
    const storage = this.storage;
    return storage.state === "open" && storage.scope === scope ? storage : undefined;
  }

  private binding(scope: StorageScope, store: MemoryStore): ProposalBinding {
    const open = this.openIn(scope);
    const configuration = this.configuration;
    return {
      configurationRevision: this.configurationRevision,
      dependencyFingerprint:
        configuration === undefined
          ? undefined
          : dependencyFingerprint({
              settings: configuration.settings,
              roles: this.roles,
              projectRoot: store.projectRoot,
            }),
      lineage: open?.lineage ?? { selected: { state: "none" }, pending: { state: "none" } },
      latestRevision: open?.latestRevision ?? null,
    };
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
}
