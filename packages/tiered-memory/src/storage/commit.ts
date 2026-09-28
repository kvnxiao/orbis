import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import type { ConflictReason, MemoryProposal, NoteDependency } from "../domain/proposal.ts";
import { safeIdSchema } from "../domain/references.ts";
import { publishProjectGenerated, readProjectCuration } from "./curation.ts";
import { fromPromise, readText, rejectSymlinks } from "./files.ts";
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
import type { DurableWrites } from "./services.ts";
import { writeText } from "./services.ts";

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

function firstFailure(exits: readonly Exit.Exit<void, unknown>[]): Effect.Effect<void, unknown> {
  let interruption: Cause.Cause<unknown> | undefined;
  for (const exit of exits) {
    if (Exit.isSuccess(exit)) {
      continue;
    }
    if (!Cause.hasInterruptsOnly(exit.cause)) {
      const failure = Cause.squash(exit.cause);
      return Effect.fail(
        failure instanceof Error
          ? failure
          : new Error("Memory view write failed.", { cause: failure }),
      );
    }
    interruption ??= exit.cause;
  }
  return interruption === undefined ? Effect.void : Effect.failCause(interruption);
}

// The phase is uninterruptible so a pending interruption cannot discard a sibling's failure: every
// write settles, then the first genuine failure in input order fails the phase.
function settlePhase<A, R>(
  items: readonly A[],
  write: (item: A) => Effect.Effect<void, unknown, R>,
): Effect.Effect<void, unknown, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.forEach(items, (item) => Effect.exit(restore(write(item))), {
      concurrency: "unbounded",
    }).pipe(Effect.flatMap(firstFailure)),
  );
}

const pendingHead = Effect.fnUntraced(function* (
  target: CommitTarget,
  sessionId: string,
): Effect.fn.Return<PendingHead | undefined, unknown> {
  const sessionDir = join(target.baseDir, "sessions", sessionId);
  const head = yield* readHead(sessionDir);
  if (head === undefined || head.materialized) {
    return undefined;
  }
  yield* rejectSymlinks([sessionDir, join(sessionDir, "current"), join(sessionDir, "revisions")]);
  const identity = yield* readIdentity(sessionDir);
  if (
    identity?.projectId !== target.projectId ||
    identity.projectRoot !== target.projectRoot ||
    identity.sessionId !== sessionId
  ) {
    return yield* Effect.fail(
      new Error(`Pending memory head in ${sessionDir} has no matching session identity.`),
    );
  }
  const revision = yield* requireRevision(sessionDir, {
    projectId: target.projectId,
    sessionId,
    revisionId: head.revisionId,
  });
  return { target: { ...target, sessionId, sessionDir }, revision };
});

const pendingHeads = Effect.fnUntraced(function* (
  target: CommitTarget,
): Effect.fn.Return<PendingHead[], unknown> {
  const sessions = join(target.baseDir, "sessions");
  const entries = yield* fromPromise(async () => await readdir(sessions, { withFileTypes: true }));
  const pending: PendingHead[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !Value.Check(safeIdSchema, entry.name) ||
      entry.name === "_project"
    ) {
      continue;
    }
    const head = yield* pendingHead(target, entry.name);
    if (head !== undefined) {
      pending.push(head);
    }
  }
  return pending;
});

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

/**
 * Repair connected unfinished learning publications from newest to oldest under the project lock.
 *
 * @throws Error when a pending head has no matching session identity or names a missing revision.
 * @throws The failures of `repairViews`.
 */
export const repairPendingLearnings = Effect.fnUntraced(function* (
  target: CommitTarget,
  learningNames: readonly string[],
): Effect.fn.Return<void, unknown, DurableWrites> {
  const ownHead = yield* readHead(target.sessionDir);
  const ownRevision =
    ownHead === undefined || ownHead.materialized
      ? undefined
      : yield* requireRevision(target.sessionDir, {
          projectId: target.projectId,
          sessionId: target.sessionId,
          revisionId: ownHead.revisionId,
        });
  const names = [...learningNames, ...Object.keys(ownRevision?.learnings ?? {})];
  if (names.length === 0) {
    return;
  }
  const pending = yield* pendingHeads(target);
  for (const head of overlappingHeads(pending, names)) {
    yield* repairViews(head.target);
  }
});

const publishCommit = Effect.fnUntraced(function* (
  target: CommitTarget,
  proposal: MemoryProposal,
  snapshot: Snapshot,
  committed: { head: Head; sequence: number; onHeadDurable: (revisionId: string) => void },
): Effect.fn.Return<void, unknown, DurableWrites> {
  const { head } = committed;
  yield* writeHead(target.sessionDir, head);
  committed.onHeadDurable(head.revisionId);
  yield* settlePhase(snapshot.materialize, (name) =>
    writeText(join(target.sessionDir, "current", name), snapshot.notes[name] ?? ""),
  );
  yield* settlePhase(Object.entries(proposal.learnings), ([name, content]) =>
    writeText(join(target.baseDir, "learnings", name), content),
  );
  yield* publishProjectGenerated(target.baseDir, {
    learnings: proposal.learnings,
    sourceIds: proposal.sourceIds,
    sequence: committed.sequence,
  });
  yield* writeHead(target.sessionDir, { ...head, materialized: true });
});

/**
 * Record an accepted proposal as the next revision, write its views, and return the revision id.
 *
 * Must run under the project lock after every commit check passed; `head` is the head those checks
 * read. The sequence advance, the revision write, and `validateBeforeHead` are interruptible
 * between durable writes; a conflict from `validateBeforeHead` returns before the head write and
 * leaves only an unreferenced revision file. From the head write on, one uninterruptible region
 * writes the head marked unmaterialized, calls `onHeadDurable` with the revision id, writes the
 * note views, the learning views, and the learning provenance, and marks the head materialized.
 * Each view phase settles every started write before failing.
 *
 * @throws The original error of a failed write; after `onHeadDurable` the committed revision stays
 *   for the next open to repair.
 */
export const writeCommit = Effect.fnUntraced(function* (
  target: CommitTarget,
  proposal: MemoryProposal,
  head: Head | undefined,
  snapshot: Snapshot,
  validateBeforeHead: Effect.Effect<ConflictReason | undefined, unknown>,
  onHeadDurable: (revisionId: string) => void,
): Effect.fn.Return<{ revisionId: string } | { conflict: ConflictReason }, unknown, DurableWrites> {
  const sequence = yield* advanceSequence(target.baseDir);
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
  yield* writeRevision(target.sessionDir, revision);
  const conflict = yield* validateBeforeHead;
  if (conflict !== undefined) {
    return { conflict };
  }
  const nextHead: Head = {
    version: 1,
    revisionId: revision.id,
    views: {
      notes: digests(snapshot.notes),
      learnings: { ...head?.views.learnings, ...digests(proposal.learnings) },
    },
    materialized: false,
  };
  yield* Effect.uninterruptible(
    publishCommit(target, proposal, snapshot, { head: nextHead, sequence, onHeadDurable }),
  );
  return { revisionId: revision.id };
});

function repairNotes(
  target: CommitTarget,
  head: Head,
  revision: Revision,
  parent: Revision | undefined,
): Effect.Effect<void, unknown, DurableWrites> {
  return settlePhase(Object.keys(head.views.notes), (name) =>
    Effect.gen(function* () {
      const content = revision.notes[name];
      const path = join(target.sessionDir, "current", name);
      const disk = yield* readText(path);
      if (
        content === undefined ||
        (disk !== undefined && digest(disk) === head.views.notes[name])
      ) {
        return;
      }
      if (disk === undefined || disk === parent?.notes[name]) {
        yield* writeText(path, content);
      }
    }),
  );
}

const repairLearnings = Effect.fnUntraced(function* (
  target: CommitTarget,
  revision: Revision,
): Effect.fn.Return<void, unknown, DurableWrites> {
  const learnings = Object.entries(revision.learnings);
  const project = learnings.length === 0 ? undefined : yield* readProjectCuration(target.baseDir);
  yield* settlePhase(learnings, ([name, content]) =>
    Effect.gen(function* () {
      const path = join(target.baseDir, "learnings", name);
      const disk = yield* readText(path);
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
        yield* writeText(path, content);
      }
    }),
  );
});

/**
 * Finish the views and learning provenance of a commit interrupted after its head was written.
 *
 * Must run under the project lock. Does nothing when there is no head or the head is materialized.
 * A note view whose digest matches the head is kept; an absent note view, or one equal to the
 * parent revision's rendering of the same note, is rewritten from the head's revision; any other
 * note content is an external edit and is kept. A learning is written only when its current file
 * still has the predecessor named in the revision, or the revision created an absent learning.
 * Newer publications and external edits or deletions are kept. Then records provenance for the
 * revision's learning files that have its content and marks the head materialized. Each phase
 * settles every started write before the next phase or a failure.
 *
 * @throws Error when the head names a missing revision.
 * @throws Error naming the path when a record is damaged.
 * @throws The original error of the first failed write in input order.
 */
export const repairViews = Effect.fnUntraced(function* (
  target: CommitTarget,
): Effect.fn.Return<void, unknown, DurableWrites> {
  const head = yield* readHead(target.sessionDir);
  if (head === undefined || head.materialized) {
    return;
  }
  const identity = { projectId: target.projectId, sessionId: target.sessionId };
  const revision = yield* requireRevision(target.sessionDir, {
    ...identity,
    revisionId: head.revisionId,
  });
  const parent =
    revision.parentRevisionId === null
      ? undefined
      : yield* readRevision(target.sessionDir, {
          ...identity,
          revisionId: revision.parentRevisionId,
        });
  yield* repairNotes(target, head, revision, parent);
  yield* repairLearnings(target, revision);
  yield* publishProjectGenerated(target.baseDir, {
    learnings: revision.learnings,
    sourceIds: revision.sourceIds,
    sequence: revision.sequence,
  });
  yield* writeHead(target.sessionDir, { ...head, materialized: true });
});
