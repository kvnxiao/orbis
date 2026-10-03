import { join } from "node:path";

import * as Effect from "effect/Effect";
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
import { parseRecord } from "./records.ts";
import type { DurableWrites } from "./services.ts";
import { writeRecord } from "./services.ts";

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

/**
 * Read a session's identity record, or `undefined` when none exists.
 *
 * @throws Error naming the path when the record is not JSON or fails `identitySchema`.
 * @throws The original read error other than `ENOENT`.
 */
export const readIdentity = Effect.fnUntraced(function* (
  sessionDir: string,
): Effect.fn.Return<Identity | undefined, unknown> {
  const path = join(sessionDir, "identity.json");
  const text = yield* readText(path);
  return text === undefined ? undefined : parseRecord(identitySchema, text, path);
});

/**
 * Write a session's identity record at first open, or confirm that the existing record matches.
 *
 * @throws Error naming the path when the existing record names another project, root, or session,
 *   or when it is not JSON or fails `identitySchema`.
 * @throws The original read or write error.
 */
export const ensureIdentity = Effect.fnUntraced(function* (
  sessionDir: string,
  identity: Identity,
): Effect.fn.Return<void, unknown, DurableWrites> {
  const path = join(sessionDir, "identity.json");
  const existing = yield* readIdentity(sessionDir);
  if (existing === undefined) {
    yield* writeRecord(path, identity);
  } else if (
    existing.projectId !== identity.projectId ||
    existing.projectRoot !== identity.projectRoot ||
    existing.sessionId !== identity.sessionId
  ) {
    yield* Effect.fail(
      new Error(
        `Session identity mismatch at ${path}: the directory belongs to another project or session.`,
      ),
    );
  }
});

/**
 * Read a session's head pointer, or `undefined` before the first commit.
 *
 * @throws Error naming the path when the record is not JSON or fails `headSchema`.
 * @throws The original read error other than `ENOENT`.
 */
export const readHead = Effect.fnUntraced(function* (
  sessionDir: string,
): Effect.fn.Return<Head | undefined, unknown> {
  const path = join(sessionDir, "head.json");
  const text = yield* readText(path);
  return text === undefined ? undefined : parseRecord(headSchema, text, path);
});

/**
 * Replace a session's head pointer; callers write it only after its revision file is durable.
 *
 * @throws The original write error.
 */
export function writeHead(
  sessionDir: string,
  head: Head,
): Effect.Effect<void, unknown, DurableWrites> {
  return writeRecord(join(sessionDir, "head.json"), head);
}

/**
 * Read a revision, or `undefined` when its file does not exist.
 *
 * `expected.revisionId` must satisfy `safeIdSchema`.
 *
 * @throws Error naming the path when the record is not JSON, fails `revisionSchema`, or names a
 *   different id, project, or session than `expected`.
 * @throws The original read error other than `ENOENT`.
 */
export const readRevision = Effect.fnUntraced(function* (
  sessionDir: string,
  expected: { projectId: string; sessionId: string; revisionId: string },
): Effect.fn.Return<Revision | undefined, unknown> {
  const path = join(sessionDir, "revisions", `${expected.revisionId}.json`);
  const text = yield* readText(path);
  if (text === undefined) {
    return undefined;
  }
  const revision = parseRecord(revisionSchema, text, path);
  if (
    revision.id !== expected.revisionId ||
    revision.projectId !== expected.projectId ||
    revision.sessionId !== expected.sessionId
  ) {
    return yield* Effect.fail(
      new Error(`Invalid record at ${path}: /id: names a different revision, project, or session.`),
    );
  }
  return revision;
});

/**
 * Read the revision a head names.
 *
 * @throws Error naming `sessionDir` and the revision id when the revision file is missing.
 * @throws The failures of `readRevision`.
 */
export const requireRevision = Effect.fnUntraced(function* (
  sessionDir: string,
  expected: { projectId: string; sessionId: string; revisionId: string },
): Effect.fn.Return<Revision, unknown> {
  const revision = yield* readRevision(sessionDir, expected);
  if (revision === undefined) {
    return yield* Effect.fail(
      new Error(
        `Memory head in ${sessionDir} names missing revision ${expected.revisionId}; files are preserved.`,
      ),
    );
  }
  return revision;
});

/**
 * Write a revision file once.
 *
 * Must run under the project lock.
 *
 * @throws Error when a revision file with the same id exists; revision files are never rewritten.
 * @throws The original read or write error.
 */
export const writeRevision = Effect.fnUntraced(function* (
  sessionDir: string,
  revision: Revision,
): Effect.fn.Return<void, unknown, DurableWrites> {
  const path = join(sessionDir, "revisions", `${revision.id}.json`);
  if ((yield* readText(path)) !== undefined) {
    yield* Effect.fail(
      new Error(`Revision ${revision.id} already exists; revision files are never rewritten.`),
    );
    return;
  }
  yield* writeRecord(path, revision);
});

/**
 * Advance the project sequence and return the new value, starting from 1.
 *
 * Must run under the project lock.
 *
 * @throws Error naming the path when the counter is not JSON, fails `sequenceSchema`, or would
 *   exceed `Number.MAX_SAFE_INTEGER`.
 * @throws The original read or write error.
 */
export const advanceSequence = Effect.fnUntraced(function* (
  baseDir: string,
): Effect.fn.Return<number, unknown, DurableWrites> {
  const path = join(baseDir, "sessions", "_project", "sequence.json");
  const text = yield* readText(path);
  const current = text === undefined ? 0 : parseRecord(sequenceSchema, text, path).value;
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    return yield* Effect.fail(
      new Error(`Invalid record at ${path}: /value: the project sequence is exhausted.`),
    );
  }
  const sequence: Sequence = { version: 1, value: next };
  yield* writeRecord(path, sequence);
  return next;
});

/**
 * Return which of `names` the notes of a session's earlier revisions list, reading the chain of
 * `parentRevisionId` predecessors from `revisionId` until every name is found or the chain ends. A
 * missing predecessor ends the chain.
 *
 * @throws The failures of `readOwn`, such as a damaged revision.
 */
export const earlierNoteNames = Effect.fnUntraced(function* (
  names: ReadonlySet<string>,
  revisionId: string | null,
  readOwn: (revisionId: string) => Effect.Effect<Revision | undefined, unknown>,
): Effect.fn.Return<ReadonlySet<string>, unknown> {
  const found = new Set<string>();
  const visited = new Set<string>();
  let next = revisionId;
  while (next !== null && found.size < names.size && !visited.has(next)) {
    visited.add(next);
    const revision = yield* readOwn(next);
    if (revision === undefined) {
      break;
    }
    for (const name of Object.keys(revision.notes)) {
      if (names.has(name)) {
        found.add(name);
      }
    }
    next = revision.parentRevisionId;
  }
  return found;
});
