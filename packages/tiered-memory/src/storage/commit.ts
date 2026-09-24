import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import type { ConflictReason, MemoryProposal, NoteDependency } from "../domain/proposal.ts";
import { safeIdSchema } from "../domain/references.ts";
import { publishProjectGenerated, readProjectCuration } from "./curation.ts";
import { readText, rejectSymlinks } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import {
  advanceSequence,
  readHead,
  readIdentity,
  readRevision,
  requireRevision,
  writeHead,
  writeRevision,
} from "./revisions.ts";
import type { Head, Revision } from "./revisions.ts";

/** Name the session a commit or view repair writes and the project directory it publishes to. */
export interface CommitTarget {
  projectRoot: string;
  projectId: string;
  sessionId: string;
  baseDir: string;
  sessionDir: string;
}

interface PendingHead {
  target: CommitTarget;
  revision: Revision;
}

/** Carry the notes a commit records; `materialize` names the notes whose views it writes. */
export interface Snapshot {
  notes: Record<string, string>;
  noteDependencies: Record<string, NoteDependency>;
  materialize: string[];
}

function digests(contents: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(contents).map(([name, content]) => [name, digest(content)]),
  );
}

async function settleWrites(writes: readonly Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error("Memory view write failed.", { cause: failed.reason });
  }
}

async function pendingHeads(target: CommitTarget, access: StorageAccess): Promise<PendingHead[]> {
  const sessions = join(target.baseDir, "sessions");
  const entries = await readdir(sessions, { withFileTypes: true });
  const pending: PendingHead[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !Value.Check(safeIdSchema, entry.name) ||
      entry.name === "_project"
    ) {
      continue;
    }
    const sessionDir = join(sessions, entry.name);
    // oxlint-disable-next-line no-await-in-loop -- Each session head is inspected under the project lock.
    const head = await readHead(sessionDir, access.signal);
    if (head === undefined || head.materialized) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Only an unfinished session is opened for repair.
    await rejectSymlinks(
      [sessionDir, join(sessionDir, "current"), join(sessionDir, "revisions")],
      access.signal,
    );
    // oxlint-disable-next-line no-await-in-loop -- Identity and revision must match the pending head.
    const identity = await readIdentity(sessionDir, access.signal);
    if (
      identity?.projectId !== target.projectId ||
      identity.projectRoot !== target.projectRoot ||
      identity.sessionId !== entry.name
    ) {
      throw new Error(`Pending memory head in ${sessionDir} has no matching session identity.`);
    }
    // oxlint-disable-next-line no-await-in-loop -- The revision names the learnings this head accepted.
    const revision = await requireRevision(
      sessionDir,
      { projectId: target.projectId, sessionId: entry.name, revisionId: head.revisionId },
      access.signal,
    );
    pending.push({
      target: { ...target, sessionId: entry.name, sessionDir },
      revision,
    });
  }
  return pending;
}

function overlappingHeads(
  pending: readonly PendingHead[],
  initialNames: readonly string[],
): PendingHead[] {
  const names = new Set(initialNames);
  const selected = new Set<PendingHead>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const head of pending) {
      const learnings = Object.keys(head.revision.learnings);
      if (!selected.has(head) && learnings.some((name) => names.has(name))) {
        selected.add(head);
        for (const name of learnings) {
          names.add(name);
        }
        changed = true;
      }
    }
  }
  return [...selected].toSorted((left, right) => right.revision.sequence - left.revision.sequence);
}

/** Repair connected unfinished learning publications from newest to oldest under the project lock. */
export async function repairPendingLearnings(
  target: CommitTarget,
  learningNames: readonly string[],
  access: StorageAccess,
): Promise<void> {
  const ownHead = await readHead(target.sessionDir, access.signal);
  const ownRevision =
    ownHead === undefined || ownHead.materialized
      ? undefined
      : await requireRevision(
          target.sessionDir,
          {
            projectId: target.projectId,
            sessionId: target.sessionId,
            revisionId: ownHead.revisionId,
          },
          access.signal,
        );
  const names = [...learningNames, ...Object.keys(ownRevision?.learnings ?? {})];
  if (names.length === 0) {
    return;
  }
  const pending = await pendingHeads(target, access);
  for (const head of overlappingHeads(pending, names)) {
    // oxlint-disable-next-line no-await-in-loop -- Publication sequence determines repair order.
    await repairViews(head.target, access);
  }
}

/**
 * Record an accepted proposal as the next revision and write its views; return the revision id.
 *
 * Must run under the project lock after every commit check passed; `head` is the head those checks
 * read. Advances the project sequence, then writes the revision, the head marked unmaterialized,
 * the notes in `snapshot.materialize`, the proposal's learnings, and their provenance, then marks
 * the head materialized. The caller's validation runs again immediately before the head write.
 * Cancellation is observed until the head is written. Started view writes finish before the project
 * lock is released, including after a sibling write fails.
 *
 * @throws `access.signal.reason` when it aborts before the head is written; the original error of
 *   any failed write, which after the head write leaves a committed revision for open to repair.
 */
export async function writeCommit(
  target: CommitTarget,
  proposal: MemoryProposal,
  head: Head | undefined,
  snapshot: Snapshot,
  access: StorageAccess,
  validateBeforeHead: () => Promise<ConflictReason | undefined>,
): Promise<{ revisionId: string } | { conflict: ConflictReason }> {
  access.signal.throwIfAborted();
  const sequence = await advanceSequence(target.baseDir, access);
  const { expectedRevision, ...fields } = proposal;
  const revision: Revision = {
    version: 1,
    id: randomUUID(),
    parentRevisionId: expectedRevision,
    sequence,
    ...fields,
    notes: snapshot.notes,
    noteDependencies: snapshot.noteDependencies,
  };
  access.signal.throwIfAborted();
  await writeRevision(target.sessionDir, revision, access);
  access.signal.throwIfAborted();
  const nextHead: Head = {
    version: 1,
    revisionId: revision.id,
    views: {
      notes: digests(snapshot.notes),
      learnings: { ...head?.views.learnings, ...digests(proposal.learnings) },
    },
    materialized: false,
  };
  const conflict = await validateBeforeHead();
  if (conflict !== undefined) {
    return { conflict };
  }
  access.signal.throwIfAborted();
  await writeHead(target.sessionDir, nextHead, access);
  // The head is durable, so the rest of the commit ignores cancellation.
  const committed: StorageAccess = { signal: new AbortController().signal, write: access.write };
  await settleWrites(
    snapshot.materialize.map(async (name) => {
      await committed.write(join(target.sessionDir, "current", name), snapshot.notes[name] ?? "");
    }),
  );
  await settleWrites(
    Object.entries(proposal.learnings).map(async ([name, content]) => {
      await committed.write(join(target.baseDir, "learnings", name), content);
    }),
  );
  await publishProjectGenerated(
    target.baseDir,
    { learnings: proposal.learnings, sourceIds: proposal.sourceIds, sequence },
    committed,
  );
  await writeHead(target.sessionDir, { ...nextHead, materialized: true }, committed);
  return { revisionId: revision.id };
}

/**
 * Finish the views and learning provenance of a commit interrupted after its head was written.
 *
 * Must run under the project lock. Does nothing when there is no head or the head is materialized.
 * A note view whose digest matches the head is kept; an absent note view, or one equal to the
 * parent revision's rendering of the same note, is rewritten from the head's revision; any other
 * note content is an external edit and is kept. A learning is written only when its current file
 * still holds the predecessor named in the revision, or the revision created an absent learning.
 * Newer publications and external edits or deletions are kept. Then records provenance for the
 * revision's learning files that hold its content and marks the head materialized.
 *
 * @throws Error when the head names a missing revision or a record is damaged;
 *   `access.signal.reason` when it aborts before the head is marked.
 */
export async function repairViews(target: CommitTarget, access: StorageAccess): Promise<void> {
  const { signal } = access;
  const head = await readHead(target.sessionDir, signal);
  if (head === undefined || head.materialized) {
    return;
  }
  const identity = { projectId: target.projectId, sessionId: target.sessionId };
  const revision = await requireRevision(
    target.sessionDir,
    { ...identity, revisionId: head.revisionId },
    signal,
  );
  const parent =
    revision.parentRevisionId === null
      ? undefined
      : await readRevision(
          target.sessionDir,
          { ...identity, revisionId: revision.parentRevisionId },
          signal,
        );
  await settleWrites(
    Object.keys(head.views.notes).map(async (name) => {
      const content = revision.notes[name];
      const path = join(target.sessionDir, "current", name);
      const disk = await readText(path, signal);
      if (
        content === undefined ||
        (disk !== undefined && digest(disk) === head.views.notes[name])
      ) {
        return;
      }
      if (disk === undefined || disk === parent?.notes[name]) {
        await access.write(path, content);
      }
    }),
  );
  const learnings = Object.entries(revision.learnings);
  const project =
    learnings.length === 0 ? undefined : await readProjectCuration(target.baseDir, signal);
  await settleWrites(
    learnings.map(async ([name, content]) => {
      const path = join(target.baseDir, "learnings", name);
      const disk = await readText(path, signal);
      const expected = revision.expectedLearnings[name];
      const previous = project?.generated[name];
      if (
        disk === content ||
        (previous?.sequence ?? 0) > revision.sequence ||
        expected === undefined ||
        (previous?.sequence ?? null) !== expected.sequence ||
        (previous?.digest ?? null) !== expected.digest
      ) {
        return;
      }
      if (
        (disk === undefined && expected.digest === null) ||
        (disk !== undefined && digest(disk) === expected.digest)
      ) {
        await access.write(path, content);
      }
    }),
  );
  signal.throwIfAborted();
  await publishProjectGenerated(
    target.baseDir,
    { learnings: revision.learnings, sourceIds: revision.sourceIds, sequence: revision.sequence },
    access,
  );
  signal.throwIfAborted();
  await writeHead(target.sessionDir, { ...head, materialized: true }, access);
}
