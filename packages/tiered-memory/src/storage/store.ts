import { realpath } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import { curationEventOf, mayUseNote } from "../domain/evidence.ts";
import type { CurationEvent } from "../domain/evidence.ts";
import { validateProposal } from "../domain/proposal.ts";
import type {
  CommitResult,
  ConflictReason,
  MemoryProposal,
  RevisionPointer,
} from "../domain/proposal.ts";
import { rebindToSession, safeIdSchema } from "../domain/references.ts";
import { repairPendingLearnings, repairViews, writeCommit } from "./commit.ts";
import type { CommitTarget, Snapshot } from "./commit.ts";
import { inheritForkCuration, inspectCuration, recordObservedCuration } from "./curation.ts";
import type { CurationState } from "./curation.ts";
import { fromPromise, readText, rejectSymlinks } from "./files.ts";
import { learningConflict } from "./learning-curation.ts";
import { withProjectLock } from "./lock.ts";
import { resolveProjectRoot } from "./project-root.ts";
import {
  earlierNoteNames,
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
  private curated: Readonly<Record<string, CurationEvent>> = {};

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
   * equal `expectedLearnings`, and `validate` returns `undefined`. A written note whose curation
   * record is absent from the proposal's `curatedNotes` conflicts with reason `curation`: the
   * record appeared after capture, so the proposal is based on older content. A note the proposal
   * knew as curated keeps the evidence rule of `mayUseNote`; `validate` must not write and runs
   * again before head publication. A returned reason becomes the conflict's reason. A base in a
   * fork ancestor's session has the ancestor's pending head repaired before curation is inspected,
   * as `inspectCuration` does; the snapshot still inherits the base revision's notes. Then writes
   * the commit through `writeCommit`, which calls `onHeadDurable` as soon as the head is durable.
   * `proposal` must satisfy `validateProposal`.
   *
   * @throws Error when the proposal belongs to another project or session, when the head's revision
   *   or the base revision is unavailable, or when an ancestor session directory is a symlink.
   * @throws The original error of a failed ancestor repair write, before curation is inspected or
   *   written and before any revision is written.
   * @throws The failures of `repairPendingLearnings` and `repairViews`, for this session and for a
   *   fork base's ancestor session.
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
   * Return the external change every curation record this store last found for the session's notes
   * describes, from the latest curation inspection, recording, or commit snapshot; empty before the
   * first inspection.
   *
   * A proposal records these names when it is captured, so a commit can tell curation it knew from
   * curation that appeared after capture.
   */
  get curatedNotes(): Readonly<Record<string, CurationEvent>> {
    return structuredClone(this.curated);
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
   * First repairs overlapping pending learning publications and this session's unfinished views as
   * `open` does, so curation never records a half-written head's absent views as deletions. When
   * `base` names a fork ancestor's revision, rejects symlinked ancestor session directories, then,
   * when `inheritRevision` returns the base, repairs the ancestor's pending head the same way under
   * the same lock. Only then inspects this session's curation and merges the ancestor lineage's
   * curation into it with ancestor references rebound to this session, so exclusions survive the
   * fork. An unavailable base repairs nothing and inherits nothing.
   *
   * @throws Error when an ancestor session directory is a symlink.
   * @throws Error naming the path when a curation, head, or revision record is damaged.
   * @throws The original error of a failed repair write, before either session's curation is
   *   inspected or written; completed repair writes stay for the next repair.
   * @throws The failures of `repairPendingLearnings` and `repairViews`, for this session and for a
   *   fork base's ancestor session.
   * @throws The failures of `withProjectLock`.
   */
  inspectCuration(
    base: RevisionPointer | null,
  ): Effect.Effect<CurationState, unknown, StorageServices> {
    return this.locked(
      repairPendingLearnings(this, []).pipe(
        Effect.andThen(repairViews(this)),
        Effect.andThen(this.inspectCurationFrom(base)),
      ),
    );
  }

  /**
   * Record an observed external change of a session note under the project lock, as
   * `recordObservedCuration` does, and return the session's curation.
   *
   * The change consumes the note dependency sources of `revision`, rebound to this session, or none
   * when `revision` is `null` or unavailable.
   *
   * @throws Error naming the path when a curation or revision record is damaged.
   * @throws The original read or write error, and the failures of `withProjectLock`.
   */
  recordCuration(
    name: string,
    event: CurationEvent,
    revision: RevisionPointer | null,
  ): Effect.Effect<CurationState, unknown, StorageServices> {
    return this.locked(
      Effect.gen({ self: this }, function* () {
        const source = revision === null ? undefined : yield* this.inheritRevision(revision);
        const consumed = rebindToSession(source?.noteDependencies[name]?.sourceIds ?? [], this);
        const observed = { name, event, consumed };
        return this.remember(yield* recordObservedCuration(this.sessionDir, observed, this));
      }),
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
    const curation = yield* this.inspectCurationFrom(proposal.baseRevision);
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
      const record = curation.notes[name];
      const unknown = record !== undefined && !proposal.curatedNotes.includes(name);
      const blocked = !mayUseNote(record, dependency.sourceIds, {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      const foreign =
        head?.views.notes[name] === undefined && disk !== undefined && disk !== content;
      if (explicit && (blocked || foreign || unknown)) {
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
      (names) =>
        earlierNoteNames(names, revision?.parentRevisionId ?? null, (id) => this.readRevision(id)),
    );
  });

  private readonly inspectCurationFrom = Effect.fnUntraced(function* (
    this: MemoryStore,
    pointer: RevisionPointer | null,
  ): Effect.fn.Return<CurationState, unknown, DurableWrites> {
    if (pointer === null || pointer.sessionId === this.sessionId) {
      return this.remember(yield* this.inspectOwnCuration());
    }
    yield* rejectSymlinks(this.sessionLayout(pointer.sessionId));
    if ((yield* this.inheritRevision(pointer)) !== undefined) {
      const ancestor: CommitTarget = {
        projectRoot: this.projectRoot,
        projectId: this.projectId,
        sessionId: pointer.sessionId,
        baseDir: this.baseDir,
        sessionDir: join(this.baseDir, "sessions", pointer.sessionId),
      };
      yield* repairPendingLearnings(ancestor, []);
      yield* repairViews(ancestor);
    }
    yield* this.inspectOwnCuration();
    const inherited = yield* inheritForkCuration(
      {
        baseDir: this.baseDir,
        projectId: this.projectId,
        sessionDir: this.sessionDir,
        childSessionId: this.sessionId,
      },
      pointer,
      (next) => this.inheritRevision(next),
    );
    return this.remember(inherited);
  });

  private remember(curation: CurationState): CurationState {
    this.curated = Object.fromEntries(
      Object.entries(curation.notes).map(([name, record]) => [name, curationEventOf(record)]),
    );
    return curation;
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
