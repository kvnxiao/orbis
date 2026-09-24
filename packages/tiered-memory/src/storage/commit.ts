import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { digest } from "../domain/canonical.ts";
import type { MemoryProposal, NoteDependency } from "../domain/proposal.ts";
import { publishProjectGenerated } from "./curation.ts";
import { readText } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import {
  advanceSequence,
  readHead,
  readRevision,
  requireRevision,
  writeHead,
  writeRevision,
} from "./revisions.ts";
import type { Head, Revision } from "./revisions.ts";

/** Name the session a commit or view repair writes and the project directory it publishes to. */
export interface CommitTarget {
  projectId: string;
  sessionId: string;
  baseDir: string;
  sessionDir: string;
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

/**
 * Record an accepted proposal as the next revision and write its views; return the revision id.
 *
 * Must run under the project lock after every commit check passed; `head` is the head those checks
 * read. Advances the project sequence, then writes the revision, the head marked unmaterialized,
 * the notes in `snapshot.materialize`, the proposal's learnings, and their provenance, then marks
 * the head materialized. Cancellation is observed until the head is written.
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
): Promise<string> {
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
  await writeHead(target.sessionDir, nextHead, access);
  // The head is durable, so the rest of the commit ignores cancellation.
  const committed: StorageAccess = { signal: new AbortController().signal, write: access.write };
  await Promise.all(
    snapshot.materialize.map(async (name) => {
      await committed.write(join(target.sessionDir, "current", name), snapshot.notes[name] ?? "");
    }),
  );
  await Promise.all(
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
  return revision.id;
}

/**
 * Finish the views and learning provenance of a commit interrupted after its head was written.
 *
 * Must run under the project lock. Does nothing when there is no head or the head is materialized.
 * A note view whose digest matches the head is kept; an absent note view, or one equal to the
 * parent revision's rendering of the same note, is rewritten from the head's revision; any other
 * note content is an external edit and is kept. An absent learning view is rewritten and a present
 * one is kept. Then records provenance for the revision's learnings under its sequence and marks
 * the head materialized.
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
  await Promise.all(
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
  await Promise.all(
    Object.keys(head.views.learnings).map(async (name) => {
      const content = revision.learnings[name];
      const path = join(target.baseDir, "learnings", name);
      if (content !== undefined && (await readText(path, signal)) === undefined) {
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
