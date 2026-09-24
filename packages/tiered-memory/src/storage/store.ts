import { realpath } from "node:fs/promises";
import { join } from "node:path";

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
import { repairViews, writeCommit } from "./commit.ts";
import type { Snapshot } from "./commit.ts";
import { inheritForkCuration, inspectCuration, learningConflict } from "./curation.ts";
import type { CurationState } from "./curation.ts";
import { cancelledBy, readText, rejectSymlinks, writeDurable } from "./files.ts";
import type { DurableWriter, StorageAccess } from "./files.ts";
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

const namespace = join(".pi", "tiered-memory");

function isSafeId(value: string): boolean {
  return Value.Check(safeIdSchema, value);
}

/**
 * Own one session's memory directory in a project and serialize project mutations through the
 * project lock.
 *
 * Every read, open, mkdir, and lock poll observes `access.signal`, the signal the store was opened
 * with. Readers use only revisions a head names; a revision file left by an interrupted commit
 * stays unreferenced.
 */
export class MemoryStore {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly baseDir: string;
  readonly sessionDir: string;
  /** Carry the store's signal and durable writer to the storage modules that act on its directories. */
  readonly access: StorageAccess;

  private constructor(projectRoot: string, sessionId: string, access: StorageAccess) {
    this.projectRoot = projectRoot;
    this.projectId = digest(projectRoot);
    this.sessionId = sessionId;
    this.baseDir = join(projectRoot, namespace);
    this.sessionDir = join(this.baseDir, "sessions", sessionId);
    this.access = access;
  }

  /**
   * Open a session's store under a canonical project root, repairing an interrupted commit's views
   * first.
   *
   * `projectRoot` must come from `canonicalProjectRoot`. Under the project lock, rejects symlinked
   * managed directories and writes the identity record at first open. When the head is not marked
   * materialized, repairs its views: a note view whose digest matches needs nothing, an absent note
   * view or one equal to the parent revision's rendering is rewritten, and any other note content
   * is an external edit and is kept; an absent learning view is rewritten from the head's revision
   * and a present learning file is kept for the next commit's project curation inspection. `write`
   * defaults to `writeDurable`.
   *
   * @throws Error when `sessionId` is not a safe id, a managed directory is a symlink, the identity
   *   record names another project or session, or a head, revision, or identity record is damaged;
   *   `signal.reason` when the signal aborts.
   */
  static async open(
    projectRoot: string,
    sessionId: string,
    options: { signal: AbortSignal; write?: DurableWriter },
  ): Promise<MemoryStore> {
    if (!isSafeId(sessionId)) {
      throw new Error(`Invalid Pi session identity: ${sessionId}`);
    }
    const store = new MemoryStore(projectRoot, sessionId, {
      signal: options.signal,
      write: options.write ?? writeDurable,
    });
    await store.locked(store.access, async () => {
      await store.assertSafeLayout(store.access.signal);
      await repairViews(store, store.access);
      const identity: Identity = { version: 1, projectId: store.projectId, projectRoot, sessionId };
      await ensureIdentity(store.sessionDir, identity, store.access);
    });
    return store;
  }

  /**
   * Commit a proposal as a new revision under the project lock.
   *
   * Checks in order that the head equals `expectedRevision`, curation permits every written note,
   * learning digests and sequences equal `expectedLearnings`, and `validate` returns `undefined`;
   * `validate` must not write, and a reason it returns becomes the conflict's reason. Then advances
   * the sequence and writes the revision, the head, the changed note views, the learning views, and
   * learning provenance. `proposal` must satisfy `validateProposal`. `signal` is observed together
   * with the store's signal until the head is written.
   *
   * @throws Error when the proposal belongs to another project or session, or when the head's
   *   revision or the base revision is unavailable. A rejection after the head is durable, from a
   *   failed view, learning, or provenance write, leaves a committed revision that the next open
   *   repairs and that reconciliation attaches to the branch on the next start.
   */
  async commit(
    proposal: MemoryProposal,
    options: { validate: () => ConflictReason | undefined; signal?: AbortSignal },
  ): Promise<CommitResult> {
    const captured = validateProposal(structuredClone(proposal));
    if (captured.sessionId !== this.sessionId || captured.projectId !== this.projectId) {
      throw new Error("The memory proposal belongs to another project or session.");
    }
    const signal =
      options.signal === undefined
        ? this.access.signal
        : AbortSignal.any([this.access.signal, options.signal]);
    const access: StorageAccess = { signal, write: this.access.write };
    try {
      return await this.locked(
        access,
        async () => await this.commitLocked(captured, access, options.validate),
      );
    } catch (error) {
      if (cancelledBy(signal, error)) {
        return { kind: "cancelled", reason: signal.reason };
      }
      throw error;
    }
  }

  /**
   * Read a revision of this session, or `undefined` when no such revision file exists.
   *
   * @throws Error naming the path when the revision is damaged.
   */
  async readRevision(revisionId: string): Promise<Revision | undefined> {
    if (!isSafeId(revisionId)) {
      return undefined;
    }
    return await readRevisionFile(
      this.sessionDir,
      { projectId: this.projectId, sessionId: this.sessionId, revisionId },
      this.access.signal,
    );
  }

  /**
   * Return the head's revision id, or `null` before the first commit; reads without the lock, so a
   * concurrent commit may advance it.
   */
  async currentHead(): Promise<string | null> {
    return (await readHead(this.sessionDir, this.access.signal))?.revisionId ?? null;
  }

  /**
   * Read a revision of this session or of a fork ancestor.
   *
   * Returns `undefined` when the revision file does not exist, an id is not a safe id, or the
   * ancestor's identity record does not name this canonical project.
   *
   * @throws Error naming the path when the revision or the ancestor's identity is damaged.
   */
  async inheritRevision(pointer: RevisionPointer): Promise<Revision | undefined> {
    if (pointer.sessionId === this.sessionId) {
      return await this.readRevision(pointer.revisionId);
    }
    if (!isSafeId(pointer.sessionId) || !isSafeId(pointer.revisionId)) {
      return undefined;
    }
    const directory = join(this.baseDir, "sessions", pointer.sessionId);
    const identity = await readIdentity(directory, this.access.signal);
    if (
      identity?.projectId !== this.projectId ||
      identity.projectRoot !== this.projectRoot ||
      identity.sessionId !== pointer.sessionId
    ) {
      return undefined;
    }
    return await readRevisionFile(
      directory,
      { projectId: this.projectId, sessionId: pointer.sessionId, revisionId: pointer.revisionId },
      this.access.signal,
    );
  }

  /**
   * Record external curation of this session's notes under the project lock and return it.
   *
   * When `base` names a fork ancestor's revision, first merges the ancestor lineage's curation into
   * this session's record with ancestor references rebound to this session, so exclusions survive
   * the fork.
   *
   * @throws Error naming the path when a curation, head, or revision record is damaged.
   */
  async inspectCuration(base: RevisionPointer | null): Promise<CurationState> {
    return await this.locked(this.access, async () => {
      const own = await this.inspectOwnCuration(this.access);
      return base === null || base.sessionId === this.sessionId
        ? own
        : await this.inheritLineageCuration(base, this.access);
    });
  }

  private async locked<T>(access: StorageAccess, action: () => Promise<T>): Promise<T> {
    return await withProjectLock(join(this.baseDir, "sessions"), access, action);
  }

  private async assertSafeLayout(signal: AbortSignal): Promise<void> {
    const sessions = join(this.baseDir, "sessions");
    await rejectSymlinks(
      [
        join(this.projectRoot, ".pi"),
        this.baseDir,
        sessions,
        join(sessions, "_project"),
        join(this.baseDir, "learnings"),
        ...this.sessionLayout(this.sessionId),
      ],
      signal,
    );
  }

  private sessionLayout(sessionId: string): string[] {
    const directory = join(this.baseDir, "sessions", sessionId);
    return [directory, join(directory, "current"), join(directory, "revisions")];
  }

  private async commitLocked(
    proposal: MemoryProposal,
    access: StorageAccess,
    validate: () => ConflictReason | undefined,
  ): Promise<CommitResult> {
    await this.assertSafeLayout(access.signal);
    const head = await readHead(this.sessionDir, access.signal);
    const actualRevision = head?.revisionId ?? null;
    const conflict = (reason: ConflictReason): CommitResult => ({
      kind: "conflict",
      expectedRevision: proposal.expectedRevision,
      actualRevision,
      reason,
    });
    if (actualRevision !== proposal.expectedRevision) {
      return conflict("head");
    }
    const snapshot = await this.prepareSnapshot(proposal, head, access);
    if (snapshot === undefined) {
      return conflict("curation");
    }
    const learning = await learningConflict(this.baseDir, proposal, access);
    if (learning !== undefined) {
      return conflict(learning);
    }
    const reason = validate();
    if (reason !== undefined) {
      return conflict(reason);
    }
    const revisionId = await writeCommit(this, proposal, head, snapshot, access);
    return { kind: "committed", revisionId };
  }

  private async prepareSnapshot(
    proposal: MemoryProposal,
    head: Head | undefined,
    access: StorageAccess,
  ): Promise<Snapshot | undefined> {
    const base = await this.baseOf(proposal.baseRevision);
    let curation = await this.inspectOwnCuration(access);
    if (proposal.baseRevision !== null && proposal.baseRevision.sessionId !== this.sessionId) {
      curation = await this.inheritLineageCuration(proposal.baseRevision, access);
    }
    const excluded = new Set(
      proposal.excludedInheritedNotes.filter((name) => !Object.hasOwn(proposal.notes, name)),
    );
    const candidates = Object.entries({ ...base?.notes, ...proposal.notes }).filter(
      ([name]) => !excluded.has(name),
    );
    const disks = await Promise.all(
      candidates.map(
        async ([name]) => await readText(join(this.sessionDir, "current", name), access.signal),
      ),
    );
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
      const blocked = !mayUseNote(curation.notes[name], dependency.sourceIds);
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

  private async baseOf(pointer: RevisionPointer | null): Promise<Revision | undefined> {
    if (pointer === null) {
      return undefined;
    }
    const base = await this.inheritRevision(pointer);
    if (base === undefined) {
      throw new Error(`The proposal's base revision ${pointer.revisionId} is unavailable.`);
    }
    return base;
  }

  private async inspectOwnCuration(access: StorageAccess): Promise<CurationState> {
    const head = await readHead(this.sessionDir, access.signal);
    const revision =
      head === undefined
        ? undefined
        : await requireRevision(
            this.sessionDir,
            { projectId: this.projectId, sessionId: this.sessionId, revisionId: head.revisionId },
            access.signal,
          );
    return await inspectCuration(
      this.sessionDir,
      head?.views.notes ?? {},
      revision?.noteDependencies ?? {},
      access,
    );
  }

  private async inheritLineageCuration(
    pointer: RevisionPointer,
    access: StorageAccess,
  ): Promise<CurationState> {
    await rejectSymlinks(this.sessionLayout(pointer.sessionId), access.signal);
    return await inheritForkCuration(
      {
        baseDir: this.baseDir,
        projectId: this.projectId,
        sessionDir: this.sessionDir,
        childSessionId: this.sessionId,
      },
      pointer,
      async (next) => await this.inheritRevision(next),
      access,
    );
  }
}

/**
 * Resolve the canonical project root for a working directory: the `.git` walk's result with
 * symbolic links resolved.
 *
 * @throws The original `realpath` error.
 */
export async function canonicalProjectRoot(cwd: string): Promise<string> {
  return await realpath(await resolveProjectRoot(cwd));
}
