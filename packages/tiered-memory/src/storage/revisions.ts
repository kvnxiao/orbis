import { join } from "node:path";

import { Type } from "typebox";
import type { Static } from "typebox";

import { memoryProposalSchema } from "../domain/proposal.ts";
import {
  digestSchema,
  learningNameSchema,
  noteNameSchema,
  safeIdSchema,
} from "../domain/references.ts";
import { readText } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import { parseRecord } from "./records.ts";

/**
 * Validate a session identity record; a record naming another project, root, or session means the
 * directory is not this store's.
 */
export const identitySchema = Type.Object(
  {
    version: Type.Literal(1),
    projectId: digestSchema,
    projectRoot: Type.String({ minLength: 1 }),
    sessionId: safeIdSchema,
  },
  { additionalProperties: false },
);

/**
 * Validate the head pointer.
 *
 * `views` holds the digest of each managed view as the head's revision rendered it. `materialized`
 * is false from the head write until every view of the commit is written, so only an interrupted
 * commit's views are repaired on open.
 */
export const headSchema = Type.Object(
  {
    version: Type.Literal(1),
    revisionId: safeIdSchema,
    views: Type.Object(
      {
        notes: Type.Record(noteNameSchema, digestSchema, { additionalProperties: false }),
        learnings: Type.Record(learningNameSchema, digestSchema, { additionalProperties: false }),
      },
      { additionalProperties: false },
    ),
    materialized: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * Validate an immutable revision: a committed proposal with its full note snapshot.
 *
 * `parentRevisionId` is the head the proposal expected, and `sequence` is the project sequence the
 * commit advanced to. `notes` and `noteDependencies` hold every note of the snapshot, including
 * notes carried from the base revision.
 */
export const revisionSchema = Type.Object(
  {
    version: Type.Literal(1),
    id: safeIdSchema,
    parentRevisionId: Type.Union([safeIdSchema, Type.Null()]),
    sequence: Type.Integer({ minimum: 1 }),
    ...Type.Omit(memoryProposalSchema, ["expectedRevision"]).properties,
  },
  { additionalProperties: false },
);

/** Validate the project sequence counter that orders generated learnings across sessions. */
export const sequenceSchema = Type.Object(
  {
    version: Type.Literal(1),
    value: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

/** Define the `sessions/<session-id>/identity.json` payload. */
export type Identity = Static<typeof identitySchema>;
/** Define the `sessions/<session-id>/head.json` payload. */
export type Head = Static<typeof headSchema>;
/** Define the `sessions/<session-id>/revisions/<revision-id>.json` payload. */
export type Revision = Static<typeof revisionSchema>;
/** Define the `sessions/_project/sequence.json` payload. */
export type Sequence = Static<typeof sequenceSchema>;

function serialize(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Read a session's identity record, or `undefined` when none exists.
 *
 * @throws Error naming the path when the record is not JSON or fails `identitySchema`.
 */
export async function readIdentity(
  sessionDir: string,
  signal: AbortSignal,
): Promise<Identity | undefined> {
  const path = join(sessionDir, "identity.json");
  const text = await readText(path, signal);
  return text === undefined ? undefined : parseRecord(identitySchema, text, path);
}

/**
 * Write a session's identity record at first open, or confirm that the existing record matches.
 *
 * @throws Error naming the path when the existing record names another project, root, or session,
 *   or when it is not JSON or fails `identitySchema`.
 */
export async function ensureIdentity(
  sessionDir: string,
  identity: Identity,
  access: StorageAccess,
): Promise<void> {
  const path = join(sessionDir, "identity.json");
  const existing = await readIdentity(sessionDir, access.signal);
  if (existing === undefined) {
    await access.write(path, serialize(identity));
    return;
  }
  if (
    existing.projectId !== identity.projectId ||
    existing.projectRoot !== identity.projectRoot ||
    existing.sessionId !== identity.sessionId
  ) {
    throw new Error(
      `Session identity mismatch at ${path}: the directory belongs to another project or session.`,
    );
  }
}

/**
 * Read a session's head pointer, or `undefined` before the first commit.
 *
 * @throws Error naming the path when the record is not JSON or fails `headSchema`.
 */
export async function readHead(sessionDir: string, signal: AbortSignal): Promise<Head | undefined> {
  const path = join(sessionDir, "head.json");
  const text = await readText(path, signal);
  return text === undefined ? undefined : parseRecord(headSchema, text, path);
}

/** Replace a session's head pointer; callers write it only after its revision file is durable. */
export async function writeHead(
  sessionDir: string,
  head: Head,
  access: StorageAccess,
): Promise<void> {
  await access.write(join(sessionDir, "head.json"), serialize(head));
}

/**
 * Read a revision, or `undefined` when its file does not exist.
 *
 * `expected.revisionId` must satisfy `safeIdSchema`.
 *
 * @throws Error naming the path when the record is not JSON, fails `revisionSchema`, or names a
 *   different id, project, or session than `expected`.
 */
export async function readRevision(
  sessionDir: string,
  expected: { projectId: string; sessionId: string; revisionId: string },
  signal: AbortSignal,
): Promise<Revision | undefined> {
  const path = join(sessionDir, "revisions", `${expected.revisionId}.json`);
  const text = await readText(path, signal);
  if (text === undefined) {
    return undefined;
  }
  const revision = parseRecord(revisionSchema, text, path);
  if (
    revision.id !== expected.revisionId ||
    revision.projectId !== expected.projectId ||
    revision.sessionId !== expected.sessionId
  ) {
    throw new Error(
      `Invalid record at ${path}: /id: names a different revision, project, or session.`,
    );
  }
  return revision;
}

/**
 * Read the revision a head names.
 *
 * @throws Error when the revision file is missing, and the errors of `readRevision`.
 */
export async function requireRevision(
  sessionDir: string,
  expected: { projectId: string; sessionId: string; revisionId: string },
  signal: AbortSignal,
): Promise<Revision> {
  const revision = await readRevision(sessionDir, expected, signal);
  if (revision === undefined) {
    throw new Error(
      `Memory head names missing revision ${expected.revisionId}; files are preserved.`,
    );
  }
  return revision;
}

/**
 * Write a revision file once.
 *
 * Must run under the project lock.
 *
 * @throws Error when a revision file with the same id exists; revision files are never rewritten.
 */
export async function writeRevision(
  sessionDir: string,
  revision: Revision,
  access: StorageAccess,
): Promise<void> {
  const path = join(sessionDir, "revisions", `${revision.id}.json`);
  if ((await readText(path, access.signal)) !== undefined) {
    throw new Error(`Revision ${revision.id} already exists; revision files are never rewritten.`);
  }
  await access.write(path, serialize(revision));
}

/**
 * Advance the project sequence and return the new value, starting from 1.
 *
 * Must run under the project lock.
 *
 * @throws Error naming the path when the counter is not JSON, fails `sequenceSchema`, or would
 *   exceed `Number.MAX_SAFE_INTEGER`.
 */
export async function advanceSequence(baseDir: string, access: StorageAccess): Promise<number> {
  const path = join(baseDir, "sessions", "_project", "sequence.json");
  const text = await readText(path, access.signal);
  const current = text === undefined ? 0 : parseRecord(sequenceSchema, text, path).value;
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`Invalid record at ${path}: /value: the project sequence is exhausted.`);
  }
  const sequence: Sequence = { version: 1, value: next };
  access.signal.throwIfAborted();
  await access.write(path, serialize(sequence));
  return next;
}
