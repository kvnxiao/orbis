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
import type { ActivationEntry, ConfigurationEntry, EffectiveSettings } from "../domain/settings.ts";
import { fromPromise } from "../storage/files.ts";
import { liveStorage } from "../storage/services.ts";
import type { StorageServices } from "../storage/services.ts";
import type { MemoryStore, StoreCommitResult } from "../storage/store.ts";
import type { MemoryStorage } from "./canonical-memory.ts";
import {
  activationEntryType,
  branchConfiguration,
  configurationEntryType,
  expectedScope,
  loadSettingsFor,
  restoreOverride,
} from "./configuration.ts";
import type { BranchConfiguration, SettingsLoad } from "./configuration.ts";
import { Execution } from "./execution.ts";
import type { StorageScope } from "./execution.ts";
import { FreshnessMonitor } from "./freshness-monitor.ts";
import type { ProposalContent, RegistrationEvent } from "./lineage.ts";
import { resolveRoles } from "./models.ts";
import {
  captureProposal as captureStorageProposal,
  commitProposal as commitStorageProposal,
  lineageRefusal,
} from "./proposals.ts";
import type { CommitProgress } from "./proposals.ts";
import { StorageSessionOwner } from "./storage-session.ts";
import type { ConfigurationIdentity, OpenStorage, StorageSnapshot } from "./storage-session.ts";

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

const off = "Memory storage is unavailable while disabled or before it opens.";

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
 *   step, and its durable head as soon as it is written, only while the commit's storage scope is
 *   current.
 * - Storage-session work re-reads current storage after each await and merges its result into it,
 *   never into state read before the await, and changes nothing once its scope is not current.
 * - A role or activation change is a transition: storage is unready from its start until its own
 *   reconciliation publishes, and a superseded transition reconciles nothing.
 *
 * Branch restoration accepts only entries that match their schemas, and a configuration snapshot
 * only when its budgets are valid and its paths and trust state match the current session.
 */
export class MemoryRuntime {
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  /** Own the instance's Effect runtime and storage scopes; automatic memory work forks into them. */
  readonly execution: Execution;
  /** Inspect the managed current-work note file for the storage session's freshness. */
  readonly freshness: FreshnessMonitor;
  private readonly storage: StorageSessionOwner;
  private configuration: EffectiveSettings | undefined;
  private override: boolean | undefined;
  private error: string | undefined;
  private roles: Record<Role, ModelResolution> | undefined;
  private resolvedRoles: Record<Role, ModelResolution> | undefined;
  private configurationRevision = 0;
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
    this.storage = new StorageSessionOwner(pi, (store) => this.configurationIdentity(store));
    this.freshness = new FreshnessMonitor(this.execution, this.storage, async (scope, work) => {
      await this.runStorageWork(scope, work);
    });
  }

  /** Return a copy of runtime state that later runtime changes do not affect. */
  get snapshot(): RuntimeSnapshot {
    return {
      configuration: structuredClone(this.configuration),
      override: this.override,
      error: this.error,
      configurationRevision: this.configurationRevision,
      roles: structuredClone(this.roles),
      storage: this.storage.snapshot,
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
   * @throws The original error of a failed role check or entry append, after storage opened; a
   *   failed role check also leaves storage reporting a failed reconciliation.
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
   * @throws The original error of a failed role check or entry append, after storage opened; a
   *   failed role check also leaves storage reporting a failed reconciliation.
   */
  async selectBranch(ctx: ExtensionContext): Promise<void> {
    await this.replaceSession(ctx, "session_tree");
  }

  /**
   * Resolve both roles against the current configuration, store the results, and reconcile open
   * storage for them.
   *
   * Does nothing without a current configuration or after shutdown started. Otherwise makes storage
   * unready before any await, replaces any running role check, and resolves after the
   * reconciliation as storage-session work, which waits for a storage startup in progress. Between
   * a replacement and the creation of its storage scope, it resolves before storage opens, and that
   * startup reconciles for the stored roles. A check that a later transition, a disable, a
   * replacement, or shutdown supersedes resolves without storing results or reconciling. A failed
   * reconciliation records the storage error, which status reports, and does not reject.
   *
   * @throws The original error of a failed role check, which status reports as a failed
   *   reconciliation.
   */
  async refreshRoles(ctx: ExtensionContext): Promise<void> {
    if (this.configuration === undefined) {
      return;
    }
    await this.transitionRoles(ctx);
  }

  /**
   * Set the session activation override to enabled, append an activation entry, resolve roles, and
   * reconcile open storage as `refreshRoles` does.
   *
   * After shutdown started, records the override and skips the role check.
   */
  async enable(ctx: ExtensionContext): Promise<void> {
    this.setOverride(true);
    await this.transitionRoles(ctx);
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
      this.storage.binding(open.scope, open.session.store),
      content,
      sourceIds,
    );
  }

  /**
   * Return open storage with its session, cached canonical memory, and a copy of the note's
   * freshness, without a capture check.
   */
  get openStorage(): Pick<MemoryStorage, "session" | "canonical" | "freshness"> | undefined {
    const open = this.storage.open;
    return open === undefined ? undefined : { ...open, freshness: this.storage.freshness.view };
  }

  /**
   * Return open storage with its cached canonical memory, the binding a frame captured now records,
   * and the reason capture would refuse a proposal on the active branch, or `undefined` while
   * storage is not open.
   */
  memoryStorage(ctx: Pick<ExtensionContext, "sessionManager">): MemoryStorage | undefined {
    const open = this.storage.open;
    if (open === undefined) {
      return undefined;
    }
    const { scope, session, canonical } = open;
    const binding = this.storage.binding(scope, session.store);
    const branch = ctx.sessionManager.getBranch();
    const refusal = this.enabled ? lineageRefusal(binding, branch, session.store.projectId) : off;
    const freshness = this.storage.freshness.view;
    return { scope, session, canonical, freshness, binding, refusal };
  }

  /**
   * Commit a proposal as a job of the open storage scope, then apply its lineage in that scope.
   *
   * The job waits for the scope's storage-session turn before registering sources and holds it
   * until the job ends. As soon as the head is durable, storage records it as the latest head with
   * a pending reference.
   *
   * Outcomes:
   *
   * - `committed` when the head became durable, including when cancellation arrived after it.
   * - `cancelled` with the first reason when `ctx.signal`, a disable, a replacement, or shutdown
   *   cancelled the job before the head, including while it waited for its turn; a pre-aborted
   *   `ctx.signal` starts no work.
   * - `conflict` from the checks under the lock.
   *
   * After `committed`, the branch-reference append, confirmation, and refresh run as work of the
   * commit's original storage scope. After `conflict`, or `cancelled` once the registration write
   * succeeded, a refresh runs as that work instead; a rejected commit runs none. Each refresh reads
   * the scope's newest completed registration when it starts. The scope runs its commits and such
   * work one at a time, so no registration completes while a refresh runs. A disable does not stop
   * it, and a replacement or shutdown discards it without changing the result. A failure of that
   * work records `storage.error` while the scope is current and leaves the result unchanged.
   *
   * @throws Error when memory is disabled, storage is not open, or shutdown has started.
   * @throws The original error of a failed commit, including a failed view write after the head.
   */
  async commitProposal(
    ctx: Pick<ExtensionContext, "sessionManager" | "signal">,
    proposal: MemoryProposal,
  ): Promise<CommitResult> {
    const { scope, session } = this.proposalStorage();
    const job = await this.execution.runJob<StoreCommitResult, CommitProgress>(
      scope,
      ctx.signal,
      (record) =>
        commitStorageProposal(
          session,
          ctx,
          () => this.storage.binding(scope, session.store),
          proposal,
          (progress) => {
            record(progress);
            if (progress.stage === "registered") {
              this.storage.publishRegistration(scope, progress.records);
            } else {
              this.storage.publishDurableHead(scope, progress.revisionId);
            }
          },
        ),
    );
    const progress = job.outcome;
    if (progress?.stage === "committed") {
      await this.runStorageWork(
        scope,
        this.storage.applyCommitted(scope, ctx, progress.revisionId),
      );
      return { kind: "committed", revisionId: progress.revisionId };
    }
    if (progress !== undefined) {
      await this.runStorageWork(scope, this.storage.refresh(scope, ctx));
    }
    return job.kind === "completed" ? job.value : { kind: "cancelled", reason: job.reason };
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
      this.storage.stop();
    }
    await this.execution.shutdown(sessionChange());
  }

  private async replaceSession(
    ctx: ExtensionContext,
    event: Exclude<RegistrationEvent, "commit">,
  ): Promise<void> {
    this.execution.replace(sessionChange());
    this.roles = undefined;
    this.storage.replace();
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
    yield* this.execution.openStorage((scope) => this.storage.start(ctx, event, scope));
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
    const transition = this.storage.beginTransition();
    yield* this.execution.runRoleWork(this.roleCheck(ctx)).pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause)) {
            this.storage.failTransition(transition, Cause.squash(cause));
          }
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.storage.finishRoleCheck(transition);
        }),
      ),
    );
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

  private async transitionRoles(ctx: ExtensionContext): Promise<void> {
    const transition = this.storage.beginTransition();
    try {
      await this.execution.run(this.execution.runRoleWork(this.roleCheck(ctx)));
    } catch (error) {
      this.storage.failTransition(transition, error);
      throw error;
    } finally {
      // An interrupted check also finishes, so a later startup does not wait for it forever.
      this.storage.finishRoleCheck(transition);
    }
    // A scope whose startup still runs admits this work after the startup publishes.
    const scope = this.execution.currentScope;
    if (
      scope !== undefined &&
      this.roles !== undefined &&
      this.storage.isCurrentTransition(transition)
    ) {
      await this.runStorageWork(scope, this.storage.reconcile(scope, ctx, transition));
    }
  }

  private async runStorageWork(
    scope: StorageScope,
    work: Effect.Effect<void, unknown, StorageServices>,
  ): Promise<void> {
    await this.execution.runInStorage(scope, work).catch((error: unknown) => {
      this.storage.recordFailure(scope, error);
    });
  }

  private proposalStorage(): OpenStorage {
    const open = this.storage.open;
    if (!this.enabled || open === undefined) {
      throw new Error(off);
    }
    return open;
  }

  private configurationIdentity(store: MemoryStore): ConfigurationIdentity {
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
