import { realpath } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import { mayUseNote } from "../domain/evidence.ts";
import { validateProposal } from "../domain/proposal.ts";
import type {
  CommitResult,
  ConflictReason,
  MemoryProposal,
  RevisionPointer,
} from "../domain/proposal.ts";
import { safeIdSchema } from "../domain/references.ts";
import { repairPendingLearnings, repairViews, writeCommit } from "./commit.ts";
import type { Snapshot } from "./commit.ts";
import { inheritForkCuration, inspectCuration, learningConflict } from "./curation.ts";
import type { CurationState } from "./curation.ts";
import { fromPromise, readText, rejectSymlinks } from "./files.ts";
import { withProjectLock } from "./lock.ts";
import { resolveProjectRoot } from "./project-root.ts";
import {
  ensureIdentity,
  readHead,
  readIdentity,
  readRevision as readRevisionFile,
  requireRevision,
} from "./revisions.ts";
import type { Head, Identity, Revision } from "./revisions.ts";
import type { DurableWrites, StorageServices } from "./services.ts";

const namespace = join(".pi", "tiered-memory");

function isSafeId(value: string): boolean {
  return Value.Check(safeIdSchema, value);
}

/** Report a commit decided under the lock; cancellation is interruption, never a returned value. */
export type StoreCommitResult = Exclude<CommitResult, { kind: "cancelled" }>;

/**
 * Own one session's memory directory in a project and serialize project mutations through the
 * project lock.
 *
 * Readers use only revisions a head names; a revision file left by an interrupted commit stays
 * unreferenced. Interruption abandons reads; durable writes finish before it takes effect.
 */
export class MemoryStore {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly baseDir: string;
  readonly sessionDir: string;

  private constructor(projectRoot: string, sessionId: string) {
    this.projectRoot = projectRoot;
    this.projectId = digest(projectRoot);
    this.sessionId = sessionId;
    this.baseDir = join(projectRoot, namespace);
    this.sessionDir = join(this.baseDir, "sessions", sessionId);
  }

  /**
   * Open a session's store under a canonical project root, repairing overlapping pending learning
   * publications in sequence order and then this session's unfinished views.
   *
   * `projectRoot` must come from `canonicalProjectRoot`. Rejects symlinked managed directories
   * before taking the project lock and again under it; writes the identity record at first open.
   * For an unfinished head, restores absent note views and views equal to their parent revision's
   * rendering, while preserving external edits. Restores learning files only when they still match
   * the expected predecessor; newer publications and external curation remain.
   *
   * @throws Error when `sessionId` is not a safe id, a managed directory is a symlink, the identity
   *   record names another project or session, or a head, revision, or identity record is damaged.
   * @throws The failures of `withProjectLock`, including the busy error.
   */
  static open(
    projectRoot: string,
    sessionId: string,
  ): Effect.Effect<MemoryStore, unknown, StorageServices> {
    if (!isSafeId(sessionId)) {
      return Effect.fail(new Error(`Invalid Pi session identity: ${sessionId}`));
    }
    const store = new MemoryStore(projectRoot, sessionId);
    const identity: Identity = {
      version: 1,
      projectId: store.projectId,
      projectRoot,
      sessionId,
    };
    return store
      .locked(
        Effect.gen(function* () {
          yield* store.assertSafeLayout();
          yield* repairPendingLearnings(store, []);
          yield* repairViews(store);
          yield* ensureIdentity(store.sessionDir, identity);
        }),
      )
      .pipe(Effect.as(store));
  }

  /**
   * Commit a proposal as a new revision under the project lock.
   *
   * Repairs prior accepted heads for the proposal's learning names before checking that the head
   * equals `expectedRevision`, curation permits every written note, learning digests and sequences
   * equal `expectedLearnings`, and `validate` returns `undefined`; `validate` must not write and
   * runs again before head publication. A returned reason becomes the conflict's reason. Then
   * writes the commit through `writeCommit`, which calls `onHeadDurable` as soon as the head is
   * durable. `proposal` must satisfy `validateProposal`.
   *
   * @throws Error when the proposal belongs to another project or session, or when the head's
   *   revision or the base revision is unavailable.
   * @throws The original error of a failed write; after the head is durable the committed revision
   *   stays for the next open to repair and for reconciliation to attach.
   * @throws The failures of `withProjectLock`.
   */
  commit(
    proposal: MemoryProposal,
    options: {
      validate: Effect.Effect<ConflictReason | undefined, unknown>;
      onHeadDurable: (revisionId: string) => void;
    },
  ): Effect.Effect<StoreCommitResult, unknown, StorageServices> {
    return Effect.suspend(() => {
      const captured = validateProposal(structuredClone(proposal));
      if (captured.sessionId !== this.sessionId || captured.projectId !== this.projectId) {
        return Effect.fail(new Error("The memory proposal belongs to another project or session."));
      }
      return this.locked(this.commitLocked(captured, options.validate, options.onHeadDurable));
    });
  }

  /**
   * Run `action` under the project lock after rejecting symlinked managed directories.
   *
   * `action` must not take the lock again.
   *
   * @throws Error when a managed directory is a symlink.
   * @throws The failures of `withProjectLock` and of `action`, unchanged.
   */
  locked<A, R>(
    action: Effect.Effect<A, unknown, R>,
  ): Effect.Effect<A, unknown, R | StorageServices> {
    return this.assertSafeLayout().pipe(
      Effect.andThen(withProjectLock(join(this.baseDir, "sessions"), action)),
    );
  }

  /**
   * Read a revision of this session, or `undefined` when no such revision file exists.
   *
   * @throws Error naming the path when the revision is damaged.
   */
  readRevision(revisionId: string): Effect.Effect<Revision | undefined, unknown> {
    if (!isSafeId(revisionId)) {
      return Effect.succeed(undefined);
    }
    return readRevisionFile(this.sessionDir, {
      projectId: this.projectId,
      sessionId: this.sessionId,
      revisionId,
    });
  }

  /**
   * Return the head's revision id, or `null` before the first commit; reads without the lock, so a
   * concurrent commit may advance it.
   *
   * @throws Error naming the path when the head is damaged.
   */
  currentHead(): Effect.Effect<string | null, unknown> {
    return readHead(this.sessionDir).pipe(Effect.map((head) => head?.revisionId ?? null));
  }

  /**
   * Read a revision of this session or of a fork ancestor.
   *
   * Returns `undefined` when the revision file does not exist, an id is not a safe id, or the
   * ancestor's identity record does not name this canonical project.
   *
   * @throws Error naming the path when the revision or the ancestor's identity is damaged.
   */
  inheritRevision(pointer: RevisionPointer): Effect.Effect<Revision | undefined, unknown> {
    if (pointer.sessionId === this.sessionId) {
      return this.readRevision(pointer.revisionId);
    }
    if (!isSafeId(pointer.sessionId) || !isSafeId(pointer.revisionId)) {
      return Effect.succeed(undefined);
    }
    const directory = join(this.baseDir, "sessions", pointer.sessionId);
    return Effect.gen({ self: this }, function* () {
      const identity = yield* readIdentity(directory);
      if (
        identity?.projectId !== this.projectId ||
        identity.projectRoot !== this.projectRoot ||
        identity.sessionId !== pointer.sessionId
      ) {
        return undefined;
      }
      return yield* readRevisionFile(directory, {
        projectId: this.projectId,
        sessionId: pointer.sessionId,
        revisionId: pointer.revisionId,
      });
    });
  }

  /**
   * Record external curation of this session's notes under the project lock and return it.
   *
   * When `base` names a fork ancestor's revision, first merges the ancestor lineage's curation into
   * this session's record with ancestor references rebound to this session, so exclusions survive
   * the fork.
   *
   * @throws Error naming the path when a curation, head, or revision record is damaged.
   * @throws The failures of `withProjectLock`.
   */
  inspectCuration(
    base: RevisionPointer | null,
  ): Effect.Effect<CurationState, unknown, StorageServices> {
    return this.locked(
      base === null || base.sessionId === this.sessionId
        ? this.inspectOwnCuration()
        : this.inspectOwnCuration().pipe(Effect.andThen(this.inheritLineageCuration(base))),
    );
  }

  private assertSafeLayout(): Effect.Effect<void, unknown> {
    const sessions = join(this.baseDir, "sessions");
    return rejectSymlinks([
      join(this.projectRoot, ".pi"),
      this.baseDir,
      sessions,
      join(sessions, "_project"),
      join(this.baseDir, "learnings"),
      ...this.sessionLayout(this.sessionId),
    ]);
  }

  private sessionLayout(sessionId: string): string[] {
    const directory = join(this.baseDir, "sessions", sessionId);
    return [directory, join(directory, "current"), join(directory, "revisions")];
  }

  private readonly commitLocked = Effect.fnUntraced(function* (
    this: MemoryStore,
    proposal: MemoryProposal,
    validate: Effect.Effect<ConflictReason | undefined, unknown>,
    onHeadDurable: (revisionId: string) => void,
  ): Effect.fn.Return<StoreCommitResult, unknown, DurableWrites> {
    yield* this.assertSafeLayout();
    yield* repairPendingLearnings(this, Object.keys(proposal.learnings));
    yield* repairViews(this);
    const head = yield* readHead(this.sessionDir);
    const actualRevision = head?.revisionId ?? null;
    const conflict = (reason: ConflictReason): StoreCommitResult => ({
      kind: "conflict",
      expectedRevision: proposal.expectedRevision,
      actualRevision,
      reason,
    });
    if (actualRevision !== proposal.expectedRevision) {
      return conflict("head");
    }
    const snapshot = yield* this.prepareSnapshot(proposal, head);
    if (snapshot === undefined) {
      return conflict("curation");
    }
    const learning = yield* learningConflict(this.baseDir, proposal, (pointer) =>
      this.inheritRevision(pointer),
    );
    if (learning !== undefined) {
      return conflict(learning);
    }
    const reason = yield* validate;
    if (reason !== undefined) {
      return conflict(reason);
    }
    const result = yield* writeCommit(this, proposal, head, snapshot, validate, onHeadDurable);
    return "conflict" in result
      ? conflict(result.conflict)
      : { kind: "committed", revisionId: result.revisionId };
  });

  private readonly prepareSnapshot = Effect.fnUntraced(function* (
    this: MemoryStore,
    proposal: MemoryProposal,
    head: Head | undefined,
  ): Effect.fn.Return<Snapshot | undefined, unknown, DurableWrites> {
    const base = yield* this.baseOf(proposal.baseRevision);
    let curation = yield* this.inspectOwnCuration();
    if (proposal.baseRevision !== null && proposal.baseRevision.sessionId !== this.sessionId) {
      curation = yield* this.inheritLineageCuration(proposal.baseRevision);
    }
    const excluded = new Set(
      proposal.excludedInheritedNotes.filter((name) => !Object.hasOwn(proposal.notes, name)),
    );
    const candidates = Object.entries({ ...base?.notes, ...proposal.notes }).filter(
      ([name]) => !excluded.has(name),
    );
    const disks = yield* Effect.forEach(
      candidates,
      ([name]) => readText(join(this.sessionDir, "current", name)),
      { concurrency: "unbounded" },
    );
    return this.selectSnapshot(proposal, head, base, curation, candidates, disks);
  });

  private selectSnapshot(
    proposal: MemoryProposal,
    head: Head | undefined,
    base: Revision | undefined,
    curation: CurationState,
    candidates: readonly [string, string][],
    disks: readonly (string | undefined)[],
  ): Snapshot | undefined {
    const snapshot: Snapshot = { notes: {}, noteDependencies: {}, materialize: [] };
    for (const [index, [name, content]] of candidates.entries()) {
      const explicit = Object.hasOwn(proposal.notes, name);
      const dependency = (explicit
        ? proposal.noteDependencies[name]
        : base?.noteDependencies[name]) ?? {
        sourceIds: proposal.sourceIds,
        evidenceFingerprint: proposal.evidenceFingerprint,
      };
      const disk = disks[index];
      const blocked = !mayUseNote(curation.notes[name], dependency.sourceIds, {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      const foreign =
        head?.views.notes[name] === undefined && disk !== undefined && disk !== content;
      if (explicit && (blocked || foreign)) {
        return undefined;
      }
      if (blocked && !foreign) {
        continue;
      }
      snapshot.notes[name] = content;
      snapshot.noteDependencies[name] = structuredClone(dependency);
      if (!foreign && disk !== content) {
        snapshot.materialize.push(name);
      }
    }
    return snapshot;
  }

  private baseOf(pointer: RevisionPointer | null): Effect.Effect<Revision | undefined, unknown> {
    if (pointer === null) {
      return Effect.succeed(undefined);
    }
    return this.inheritRevision(pointer).pipe(
      Effect.flatMap((base) =>
        base === undefined
          ? Effect.fail(
              new Error(`The proposal's base revision ${pointer.revisionId} is unavailable.`),
            )
          : Effect.succeed(base),
      ),
    );
  }

  private readonly inspectOwnCuration = Effect.fnUntraced(function* (
    this: MemoryStore,
  ): Effect.fn.Return<CurationState, unknown, DurableWrites> {
    const head = yield* readHead(this.sessionDir);
    const revision =
      head === undefined
        ? undefined
        : yield* requireRevision(this.sessionDir, {
            projectId: this.projectId,
            sessionId: this.sessionId,
            revisionId: head.revisionId,
          });
    return yield* inspectCuration(
      this.sessionDir,
      head?.views.notes ?? {},
      revision?.noteDependencies ?? {},
    );
  });

  private inheritLineageCuration(
    pointer: RevisionPointer,
  ): Effect.Effect<CurationState, unknown, DurableWrites> {
    return rejectSymlinks(this.sessionLayout(pointer.sessionId)).pipe(
      Effect.andThen(
        inheritForkCuration(
          {
            baseDir: this.baseDir,
            projectId: this.projectId,
            sessionDir: this.sessionDir,
            childSessionId: this.sessionId,
          },
          pointer,
          (next) => this.inheritRevision(next),
        ),
      ),
    );
  }
}

/**
 * Resolve the canonical project root for a working directory: the `.git` walk's result with
 * symbolic links resolved.
 *
 * @throws The original `realpath` or `stat` error.
 */
export function canonicalProjectRoot(cwd: string): Effect.Effect<string, unknown> {
  return fromPromise(async () => await realpath(await resolveProjectRoot(cwd)));
}
