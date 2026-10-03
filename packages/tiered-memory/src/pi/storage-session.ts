import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { recoverFailure } from "../storage/files.ts";
import type { StorageServices } from "../storage/services.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { MemoryStore } from "../storage/store.ts";
import { readCanonicalMemory, workNoteName } from "./canonical-memory.ts";
import type { CanonicalMemory } from "./canonical-memory.ts";
import { describeError } from "./configuration.ts";
import type { StorageScope } from "./execution.ts";
import { refreshLineage, selectFromBranch } from "./lineage.ts";
import type {
  LineageState,
  ProposalBinding,
  Reconciliation,
  Registration,
  RegistrationEvent,
  RegistrationUpdate,
} from "./lineage.ts";
import { curationCorrectedOn, NoteFreshness } from "./note-freshness.ts";
import type { NoteInspection } from "./note-inspection.ts";
import { attachCommitted } from "./proposals.ts";
import { attachProject, openStorageSession } from "./storage-binding.ts";
import type { StorageSession } from "./storage-binding.ts";

/**
 * Expose the storage state that status reads.
 *
 * `stopped` holds before the first start and after shutdown; `opening` lasts from start until the
 * store and source registry are open; `failed` keeps the error that stopped opening; `open` carries
 * the canonical project root, the project ID, the lineage state, the head seen by the latest
 * refresh, the source count and event of the registration that refresh used, the curated-note count
 * of the curation it inspected, the error of the latest failed refresh, and whether reconciliation
 * completed for the current configuration.
 */
export type StorageSnapshot =
  | { state: "stopped" }
  | { state: "opening" }
  | { state: "failed"; error: string }
  | {
      state: "open";
      projectRoot: string;
      projectId: string;
      lineage: LineageState;
      latestRevision: string | null;
      registration: Registration | undefined;
      error: string | undefined;
      reconciliation: Reconciliation;
    };

interface ReadinessIdentity extends ConfigurationIdentity {
  transition: number;
}

type Readiness =
  | { state: "reconciling" }
  | { state: "reconciled" | "failed"; identity: ReadinessIdentity };

/**
 * Carry open storage with the scope that owns it, the session it opened, the newest completed
 * source registration of that session, which the next refresh uses, its readiness record, and the
 * canonical memory of its selection, which start and each reconciliation, including the refresh
 * after a commit, replace whole through `readCanonicalMemory`.
 */
export type OpenStorage = Omit<
  Extract<StorageSnapshot, { state: "open" }>,
  "projectRoot" | "projectId" | "reconciliation"
> & {
  scope: StorageScope;
  session: StorageSession;
  newestRegistration: RegistrationUpdate;
  readiness: Readiness;
  canonical: CanonicalMemory;
};

type StorageState =
  | Extract<StorageSnapshot, { state: "stopped" | "opening" | "failed" }>
  | OpenStorage;

function reconciliationOf(readiness: Readiness, current: ReadinessIdentity): Reconciliation {
  if (
    readiness.state === "reconciling" ||
    readiness.identity.transition !== current.transition ||
    readiness.identity.configurationRevision !== current.configurationRevision ||
    readiness.identity.dependencyFingerprint !== current.dependencyFingerprint
  ) {
    return "reconciling";
  }
  return readiness.state === "failed" ? "failed" : "current";
}

/** Report the configuration revision and dependency fingerprint current for a store. */
export interface ConfigurationIdentity {
  configurationRevision: number;
  dependencyFingerprint: string | undefined;
}

type RoleCheck = { state: "pending" } | { state: "done" } | { state: "failed"; error: string };

/**
 * Own one runtime's storage state and the transition count that orders its reconciliations.
 *
 * A transition is a role or activation change that makes storage unready until its own
 * reconciliation completes. The owner tracks the role check of the latest transition as pending,
 * failed, or done. Reconciliation appends a recovered reference and publishes `reconciled` only
 * while its scope is current, no later transition began, that transition's role check finished, and
 * the configuration revision it ran for is unchanged; otherwise it appends no reference and
 * publishes nothing. A startup always publishes open storage with its lineage, as `reconciling`
 * when a transition superseded it or its role check is pending, and as `failed` when that role
 * check failed. Work re-reads current storage after each await and merges its result into it.
 *
 * The owner also owns the managed note's freshness: each storage start, transition, durable head of
 * this process, and canonical-memory publication advances it, so an inspection read across one is
 * discarded; and each start and reconciliation records a verified observation.
 */
export class StorageSessionOwner {
  /** Own the managed note's freshness observations and detected curation. */
  readonly freshness = new NoteFreshness();
  private readonly pi: Pick<ExtensionAPI, "appendEntry">;
  private readonly configurationOf: (store: MemoryStore) => ConfigurationIdentity;
  private storage: StorageState = { state: "stopped" };
  private transition = 0;
  private roleCheck: RoleCheck = { state: "done" };

  /** Create the owner; `configurationOf` reads the runtime's current configuration identity. */
  constructor(
    pi: Pick<ExtensionAPI, "appendEntry">,
    configurationOf: (store: MemoryStore) => ConfigurationIdentity,
  ) {
    this.pi = pi;
    this.configurationOf = configurationOf;
  }

  /**
   * Return a copy of the state that names the canonical project root and project ID instead of the
   * scope, session, and newest registration, with its current reconciliation.
   */
  get snapshot(): StorageSnapshot {
    const storage = this.storage;
    if (storage.state !== "open") {
      return structuredClone(storage);
    }
    const {
      scope: _scope,
      session,
      newestRegistration: _n,
      readiness,
      canonical: _c,
      ...state
    } = storage;
    const { projectRoot, projectId } = session.store;
    const reconciliation = reconciliationOf(readiness, this.identity(session.store));
    return structuredClone({ ...state, projectRoot, projectId, reconciliation });
  }

  /** Return open storage, or `undefined` while storage is not open. */
  get open(): OpenStorage | undefined {
    return this.storage.state === "open" ? this.storage : undefined;
  }

  /**
   * Mark storage `opening` for a replacement session; a failed role check stops blocking, since the
   * replacement's own role check and startup reconcile again.
   */
  replace(): void {
    this.freshness.advance();
    this.storage = { state: "opening" };
    if (this.roleCheck.state === "failed") {
      this.roleCheck = { state: "done" };
    }
  }

  /** Mark storage `stopped` for shutdown. */
  stop(): void {
    this.storage = { state: "stopped" };
  }

  /** Return open storage when `scope` owns it. */
  openIn(scope: StorageScope): OpenStorage | undefined {
    const storage = this.storage;
    return storage.state === "open" && storage.scope === scope ? storage : undefined;
  }

  /** Return the state a proposal of `scope` binds to; `reconciling` when `scope` is not current. */
  binding(scope: StorageScope, store: MemoryStore): ProposalBinding {
    const open = this.openIn(scope);
    const identity = this.identity(store);
    return {
      configurationRevision: identity.configurationRevision,
      dependencyFingerprint: identity.dependencyFingerprint,
      lineage: open?.lineage ?? { selected: { state: "none" }, pending: { state: "none" } },
      latestRevision: open?.latestRevision ?? null,
      reconciliation:
        open === undefined ? "reconciling" : reconciliationOf(open.readiness, identity),
      pendingCuration: this.freshness.blocksProposals,
    };
  }

  /**
   * Begin a transition with a pending role check, mark open storage `reconciling`, and return the
   * transition's count.
   */
  beginTransition(): number {
    this.freshness.advance();
    this.transition++;
    this.roleCheck = { state: "pending" };
    const storage = this.storage;
    if (storage.state === "open") {
      this.storage = { ...storage, readiness: { state: "reconciling" } };
    }
    return this.transition;
  }

  /** Report whether no later transition began after `transition`. */
  isCurrentTransition(transition: number): boolean {
    return this.transition === transition;
  }

  /** Mark the role check of `transition` done unless it failed or a later transition began. */
  finishRoleCheck(transition: number): void {
    if (this.transition === transition && this.roleCheck.state === "pending") {
      this.roleCheck = { state: "done" };
    }
  }

  /**
   * Record `error` as the failed role check of `transition` while it is the latest transition, and
   * publish open storage as `failed` with that error; a startup still running publishes it.
   */
  failTransition(transition: number, error: unknown): void {
    if (this.transition !== transition) {
      return;
    }
    const message = describeError(error);
    this.roleCheck = { state: "failed", error: message };
    const open = this.open;
    if (open !== undefined) {
      const identity = this.identity(open.session.store);
      this.storage = { ...open, error: message, readiness: { state: "failed", identity } };
    }
  }

  /** Record a storage-session work failure as the storage error while `scope` is current. */
  recordFailure(scope: StorageScope, error: unknown): void {
    const open = this.openIn(scope);
    if (open !== undefined) {
      this.storage = { ...open, error: describeError(error) };
    }
  }

  /** Keep a commit's source registration as the newest one while `scope` is current. */
  publishRegistration(scope: StorageScope, sources: readonly SourceRecord[]): void {
    const open = this.openIn(scope);
    if (open !== undefined) {
      this.storage = { ...open, newestRegistration: { sources, event: "commit" } };
    }
  }

  /** Record a durable head as the latest head with an unappended reference while `scope` is current. */
  publishDurableHead(scope: StorageScope, revisionId: string): void {
    const open = this.openIn(scope);
    if (open !== undefined) {
      this.freshness.advance();
      const pending = { state: "unappended", revisionId } as const;
      this.storage = { ...open, latestRevision: revisionId, lineage: { ...open.lineage, pending } };
    }
  }

  /**
   * Open the store and source registry, record the curation that the branch's newest curation
   * correction describes and a detection of this session that awaits recording, select the branch's
   * revision, register sources, and reconcile, then publish open storage; a failure other than
   * interruption publishes `failed`.
   */
  readonly start = Effect.fnUntraced(
    function* (
      this: StorageSessionOwner,
      ctx: ExtensionContext,
      event: Exclude<RegistrationEvent, "commit">,
      scope: StorageScope,
    ): Effect.fn.Return<void, unknown, StorageServices> {
      const session = yield* openStorageSession(ctx);
      attachProject(this.pi, ctx.sessionManager.getBranch(), session.store);
      this.freshness.open(session.store.sessionDir);
      const corrected = curationCorrectedOn(ctx.sessionManager.getBranch(), session.store);
      if (corrected !== undefined) {
        yield* session.store.recordCuration(workNoteName, corrected.event, corrected.revision);
      }
      yield* this.recordDetected(session.store);
      const started = { recorded: this.freshness.recorded, observed: this.freshness.observed };
      const lineage = yield* selectFromBranch(session.store, ctx);
      const sources = yield* session.sources.register(ctx.sessionManager);
      const update = { sources, event };
      const identity = this.identity(session.store);
      const binding = { ...this.binding(scope, session.store), lineage };
      const current = (): boolean => this.mayRecover(identity, session.store);
      const refreshed = yield* refreshLineage(
        this.pi,
        session.store,
        ctx,
        binding,
        { effective: sources, newest: update },
        current,
      );
      const branch = ctx.sessionManager.getBranch();
      const canonical = yield* readCanonicalMemory(session, refreshed.lineage.selected, branch);
      const roleCheck = this.roleCheck;
      let readiness: Readiness = { state: "reconciled", identity };
      if (roleCheck.state === "failed") {
        readiness = { state: "failed", identity: this.identity(session.store) };
      } else if (!current() || roleCheck.state === "pending") {
        readiness = { state: "reconciling" };
      }
      const error = roleCheck.state === "failed" ? roleCheck.error : undefined;
      const opened = { scope, session, newestRegistration: update, readiness, canonical };
      const now = yield* Clock.currentTimeMillis;
      this.storage = { state: "open", ...opened, ...refreshed, error };
      this.freshness.reconciled(started, now);
    },
    Effect.catchCause((cause) =>
      recoverFailure(cause, (failure) => {
        this.storage = { state: "failed", error: describeError(failure) };
      }),
    ),
  );

  /**
   * Apply an inspection of `scope`'s managed note file that started at freshness generation
   * `started` and completed at `at`, with the selected revision, whether canonical memory holds its
   * note as current, and the latest head; returns whether it applied.
   */
  applyInspection(
    scope: StorageScope,
    started: number,
    inspection: NoteInspection,
    at: number,
  ): boolean {
    const open = this.openIn(scope);
    if (open === undefined) {
      return false;
    }
    const sessionDir = open.session.store.sessionDir;
    const revision = open.canonical.revision ?? null;
    const current = open.canonical.workNote !== undefined;
    const latest = open.latestRevision;
    return this.freshness.apply(started, inspection, { sessionDir, revision, current, latest, at });
  }

  /**
   * Record a pending detected curation in `curation.json`, then refresh as `refresh` does; a failed
   * recording stays pending with its error for a later inspection to retry.
   */
  readonly recordDetection = Effect.fnUntraced(function* (
    this: StorageSessionOwner,
    scope: StorageScope,
    ctx: Pick<ExtensionContext, "sessionManager">,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    const open = this.openIn(scope);
    if (open === undefined) {
      return;
    }
    yield* this.recordDetected(open.session.store);
    if (this.freshness.view.detection?.persistence === "recorded") {
      yield* this.refresh(scope, ctx);
    }
  });

  /** Append and confirm a committed revision's branch reference, then refresh as `refresh` does. */
  readonly applyCommitted = Effect.fnUntraced(function* (
    this: StorageSessionOwner,
    scope: StorageScope,
    ctx: Pick<ExtensionContext, "sessionManager">,
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
    yield* this.refresh(scope, ctx);
  });

  /**
   * Reconcile after a commit for the latest transition, only while readiness is `reconciled`: a
   * transition in flight reconciles after its role check, and a failure stays until `/reload`, tree
   * navigation, a role check, or enabling memory reconciles successfully.
   */
  readonly refresh = Effect.fnUntraced(function* (
    this: StorageSessionOwner,
    scope: StorageScope,
    ctx: Pick<ExtensionContext, "sessionManager">,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    if (this.openIn(scope)?.readiness.state === "reconciled") {
      yield* this.reconcile(scope, ctx, this.transition);
    }
  });

  /**
   * Refresh lineage for `transition` from the active branch's current effective sources, projected
   * without writing the registry, and publish it as `reconciled`; status counts stay those of the
   * newest registration.
   *
   * Does nothing once `scope` is not current or a later transition began. Marks storage
   * `reconciling` while it runs, and on a failure of the projection or the refresh records `failed`
   * before propagating the error.
   */
  readonly reconcile = Effect.fnUntraced(function* (
    this: StorageSessionOwner,
    scope: StorageScope,
    ctx: Pick<ExtensionContext, "sessionManager">,
    transition: number,
  ): Effect.fn.Return<void, unknown, StorageServices> {
    const before = this.openIn(scope);
    if (before === undefined || this.transition !== transition) {
      return;
    }
    this.storage = { ...before, readiness: { state: "reconciling" } };
    const started = { recorded: this.freshness.recorded, observed: this.freshness.observed };
    const store = before.session.store;
    const identity = this.identity(store);
    const current = (): boolean =>
      this.openIn(scope) !== undefined && this.mayRecover(identity, store);
    const newest = before.newestRegistration;
    const binding = this.binding(scope, store);
    const { session } = before;
    const refreshed = yield* session.sources.current(ctx.sessionManager).pipe(
      Effect.flatMap((effective) =>
        refreshLineage(this.pi, store, ctx, binding, { effective, newest }, current),
      ),
      Effect.flatMap((result) =>
        readCanonicalMemory(session, result.lineage.selected, ctx.sessionManager.getBranch()).pipe(
          Effect.map((canonical) => ({ ...result, canonical })),
        ),
      ),
      Effect.tapCause(() =>
        Effect.sync(() => {
          const open = this.openIn(scope);
          if (open !== undefined && current()) {
            this.storage = { ...open, readiness: { state: "failed", identity } };
          }
        }),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    const published = this.openIn(scope);
    if (published !== undefined && current()) {
      const readiness: Readiness = { state: "reconciled", identity };
      this.storage = { ...published, ...refreshed, error: undefined, readiness };
      this.freshness.reconciled(started, now);
    }
  });

  private readonly recordDetected = Effect.fnUntraced(function* (
    this: StorageSessionOwner,
    store: MemoryStore,
  ): Effect.fn.Return<void, never, StorageServices> {
    const detection = this.freshness.startRecording();
    if (detection === undefined) {
      return;
    }
    yield* store.recordCuration(workNoteName, detection.event, detection.revision).pipe(
      Effect.match({
        onSuccess: () => {
          this.freshness.finishRecording();
        },
        onFailure: (error) => {
          this.freshness.failRecording(describeError(error));
        },
      }),
    );
  });

  private identity(store: MemoryStore): ReadinessIdentity {
    return { transition: this.transition, ...this.configurationOf(store) };
  }

  // Recovery and a ready result need the transition to be current with its role check finished,
  // since a pending check can still change the configuration the decision depends on.
  private mayRecover(identity: ReadinessIdentity, store: MemoryStore): boolean {
    return (
      this.transition === identity.transition &&
      this.roleCheck.state === "done" &&
      this.configurationOf(store).configurationRevision === identity.configurationRevision
    );
  }
}
