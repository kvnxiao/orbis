import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { Type } from "typebox";
import type { Static } from "typebox";

import { digest } from "../domain/canonical.ts";
import { curationRecordSchema, mayUseNote } from "../domain/evidence.ts";
import type { CurationRecord } from "../domain/evidence.ts";
import type { MemoryProposal, NoteDependency, RevisionPointer } from "../domain/proposal.ts";
import {
  digestSchema,
  learningNameSchema,
  noteNameSchema,
  rebindReference,
  sourceIdSchema,
} from "../domain/references.ts";
import { readText } from "./files.ts";
import type { StorageAccess } from "./files.ts";
import { parseRecord } from "./records.ts";
import { readHead } from "./revisions.ts";
import type { Head, Revision } from "./revisions.ts";

const lineageLimit = 128;

/** Validate a session curation record, keyed by note name. */
export const curationSchema = Type.Object(
  {
    version: Type.Literal(1),
    notes: Type.Record(noteNameSchema, curationRecordSchema, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/**
 * Validate a generated learning's provenance: the digest it was written with, the evidence it
 * consumed, and the sequence that wrote it.
 */
export const generatedLearningSchema = Type.Object(
  {
    digest: digestSchema,
    consumedSourceIds: Type.Array(sourceIdSchema),
    sequence: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Validate project curation: generated-learning provenance and exclusions for externally edited or
 * deleted learnings.
 */
export const projectCurationSchema = Type.Object(
  {
    version: Type.Literal(1),
    generated: Type.Record(learningNameSchema, generatedLearningSchema, {
      additionalProperties: false,
    }),
    curated: Type.Record(learningNameSchema, curationRecordSchema, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/** Define the `sessions/<session-id>/curation.json` payload. */
export type CurationState = Static<typeof curationSchema>;
/** Define one `generated` entry of the `sessions/_project/state.json` payload. */
export type GeneratedLearning = Static<typeof generatedLearningSchema>;
/** Define the `sessions/_project/state.json` payload. */
export type ProjectCurationState = Static<typeof projectCurationSchema>;

function curationPath(sessionDir: string): string {
  return join(sessionDir, "curation.json");
}

function projectStatePath(baseDir: string): string {
  return join(baseDir, "sessions", "_project", "state.json");
}

async function loadCuration(path: string, signal: AbortSignal): Promise<CurationState> {
  const text = await readText(path, signal);
  return text === undefined ? { version: 1, notes: {} } : parseRecord(curationSchema, text, path);
}

async function loadProjectCuration(
  path: string,
  signal: AbortSignal,
): Promise<ProjectCurationState> {
  const text = await readText(path, signal);
  return text === undefined
    ? { version: 1, generated: {}, curated: {} }
    : parseRecord(projectCurationSchema, text, path);
}

async function save(path: string, state: unknown, access: StorageAccess): Promise<void> {
  access.signal.throwIfAborted();
  await access.write(path, `${JSON.stringify(state)}\n`);
}

function recordFor(
  content: string | undefined,
  consumed: readonly string[],
  previous: CurationRecord | undefined,
): CurationRecord {
  const consumedSourceIds = [...new Set([...consumed, ...(previous?.consumedSourceIds ?? [])])];
  return content === undefined
    ? { kind: "deleted", consumedSourceIds }
    : { kind: "edited", digest: digest(content), consumedSourceIds };
}

async function reconcileRecords(
  records: Record<string, CurationRecord>,
  generated: readonly { name: string; path: string; digest: string; consumed: readonly string[] }[],
  signal: AbortSignal,
): Promise<boolean> {
  const contents = await Promise.all(
    generated.map(async ({ path }) => await readText(path, signal)),
  );
  let changed = false;
  for (const [index, { name, digest: expected, consumed }] of generated.entries()) {
    const content = contents[index];
    if (content !== undefined && digest(content) === expected) {
      continue;
    }
    const previous = records[name];
    const record = recordFor(content, consumed, previous);
    if (!isDeepStrictEqual(previous, record)) {
      records[name] = record;
      changed = true;
    }
  }
  return changed;
}

/**
 * Record external edits and deletions of a session's generated notes and return the session's
 * curation.
 *
 * Compares each note digest in `views` with the file under `current/`: a different digest records
 * `edited` and a missing file records `deleted`, each consuming the note's dependency sources
 * together with any earlier record's. Writes `curation.json` only when a record changes. Must run
 * under the project lock.
 *
 * @throws Error naming the path when `curation.json` is not JSON or fails `curationSchema`; its
 *   bytes are preserved.
 */
export async function inspectCuration(
  sessionDir: string,
  views: Head["views"]["notes"],
  noteDependencies: Readonly<Record<string, NoteDependency>>,
  access: StorageAccess,
): Promise<CurationState> {
  const path = curationPath(sessionDir);
  const state = await loadCuration(path, access.signal);
  const generated = Object.entries(views).map(([name, viewDigest]) => ({
    name,
    path: join(sessionDir, "current", name),
    digest: viewDigest,
    consumed: noteDependencies[name]?.sourceIds ?? [],
  }));
  if (await reconcileRecords(state.notes, generated, access.signal)) {
    await save(path, state, access);
  }
  return state;
}

/**
 * Record external edits and deletions of generated learnings and return the project curation.
 *
 * Writes `sessions/_project/state.json` only when a record changes. Must run under the project
 * lock.
 *
 * @throws Error naming the path when `state.json` is not JSON or fails `projectCurationSchema`; its
 *   bytes are preserved.
 */
export async function inspectProjectCuration(
  baseDir: string,
  access: StorageAccess,
): Promise<ProjectCurationState> {
  const path = projectStatePath(baseDir);
  const state = await loadProjectCuration(path, access.signal);
  const generated = Object.entries(state.generated).map(([name, learning]) => ({
    name,
    path: join(baseDir, "learnings", name),
    digest: learning.digest,
    consumed: learning.consumedSourceIds,
  }));
  if (await reconcileRecords(state.curated, generated, access.signal)) {
    await save(path, state, access);
  }
  return state;
}

/**
 * Record provenance for the learnings a committed revision wrote.
 *
 * Records nothing when any of `learnings` no longer holds the committed content, and keeps an entry
 * whose sequence is newer than `sequence`. Must run under the project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 */
export async function publishProjectGenerated(
  baseDir: string,
  committed: {
    learnings: Readonly<Record<string, string>>;
    sourceIds: readonly string[];
    sequence: number;
  },
  access: StorageAccess,
): Promise<void> {
  const learnings = Object.entries(committed.learnings);
  if (learnings.length === 0) {
    return;
  }
  const path = projectStatePath(baseDir);
  const state = await loadProjectCuration(path, access.signal);
  const contents = await Promise.all(
    learnings.map(
      async ([name]) => await readText(join(baseDir, "learnings", name), access.signal),
    ),
  );
  if (learnings.some(([, content], index) => contents[index] !== content)) {
    return;
  }
  for (const [name, content] of learnings) {
    if ((state.generated[name]?.sequence ?? 0) <= committed.sequence) {
      state.generated[name] = {
        digest: digest(content),
        consumedSourceIds: [...committed.sourceIds],
        sequence: committed.sequence,
      };
    }
  }
  await save(path, state, access);
}

/**
 * Merge a fork ancestor's curation records into this session's curation.
 *
 * Unites the consumed source ids of records for the same note and keeps this session's record kind.
 * Writes `curation.json` only when a record changes. Must run under the project lock.
 *
 * @throws Error naming the path when `curation.json` is damaged; its bytes are preserved.
 */
export async function inheritCuration(
  sessionDir: string,
  inherited: Readonly<Record<string, CurationRecord>>,
  access: StorageAccess,
): Promise<CurationState> {
  const path = curationPath(sessionDir);
  const state = await loadCuration(path, access.signal);
  let changed = false;
  for (const [name, record] of Object.entries(inherited)) {
    const previous = state.notes[name];
    const merged: CurationRecord =
      previous === undefined
        ? structuredClone(record)
        : {
            ...previous,
            consumedSourceIds: [
              ...new Set([...previous.consumedSourceIds, ...record.consumedSourceIds]),
            ],
          };
    if (!isDeepStrictEqual(previous, merged)) {
      state.notes[name] = merged;
      changed = true;
    }
  }
  if (changed) {
    await save(path, state, access);
  }
  return state;
}

/**
 * Check a proposal's learnings against project curation and the state the proposer expected.
 *
 * Returns `curation` when a learning is curated against the proposal's evidence or exists without
 * generated provenance, `learning` when its digest or generated sequence differs from
 * `expectedLearnings`, and `undefined` when every learning may be written. Must run under the
 * project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 */
export async function learningConflict(
  baseDir: string,
  proposal: Pick<MemoryProposal, "learnings" | "expectedLearnings" | "sourceIds">,
  access: StorageAccess,
): Promise<"curation" | "learning" | undefined> {
  const names = Object.keys(proposal.learnings);
  if (names.length === 0) {
    return undefined;
  }
  const project = await inspectProjectCuration(baseDir, access);
  const disks = await Promise.all(
    names.map(async (name) => await readText(join(baseDir, "learnings", name), access.signal)),
  );
  for (const [index, name] of names.entries()) {
    const disk = disks[index];
    if (
      !mayUseNote(project.curated[name], proposal.sourceIds) ||
      (disk !== undefined && project.generated[name] === undefined)
    ) {
      return "curation";
    }
    const expected = proposal.expectedLearnings[name];
    if (
      expected === undefined ||
      (disk === undefined ? null : digest(disk)) !== expected.digest ||
      (project.generated[name]?.sequence ?? null) !== expected.sequence
    ) {
      return "learning";
    }
  }
  return undefined;
}

async function lineageOf(
  revision: Revision,
  lineage: Set<string>,
  readRevision: (pointer: RevisionPointer) => Promise<Revision | undefined>,
  depth: number,
): Promise<Set<string>> {
  const next = revision.baseRevision;
  if (next === null) {
    return lineage;
  }
  if (depth >= lineageLimit) {
    throw new Error("Damaged ancestor memory lineage; files are preserved for review.");
  }
  const ancestor = await readRevision(next);
  if (ancestor === undefined) {
    return lineage;
  }
  lineage.add(next.sessionId);
  return await lineageOf(ancestor, lineage, readRevision, depth + 1);
}

/**
 * Merge a fork ancestor lineage's curation into this session's curation and return it.
 *
 * Records the ancestor session's own external curation first, then rebinds consumed references of
 * every session in the pointed revision's base lineage to `fork.childSessionId` and merges them
 * with `inheritCuration`. `readRevision` must return a revision only when its session belongs to
 * `fork.projectId`. Must run under the project lock.
 *
 * @throws Error when the ancestor's head names a missing revision or the lineage exceeds 128
 *   revisions, and Error naming the path for a damaged record.
 */
export async function inheritForkCuration(
  fork: { baseDir: string; projectId: string; sessionDir: string; childSessionId: string },
  pointer: RevisionPointer,
  readRevision: (pointer: RevisionPointer) => Promise<Revision | undefined>,
  access: StorageAccess,
): Promise<CurationState> {
  const selected = await readRevision(pointer);
  if (selected === undefined) {
    return await inheritCuration(fork.sessionDir, {}, access);
  }
  const directory = join(fork.baseDir, "sessions", pointer.sessionId);
  const head = await readHead(directory, access.signal);
  const generated =
    head === undefined
      ? undefined
      : await readRevision({ sessionId: pointer.sessionId, revisionId: head.revisionId });
  if (head !== undefined && generated === undefined) {
    throw new Error(`Ancestor memory head in ${directory} is unavailable; files are preserved.`);
  }
  const ancestor = await inspectCuration(
    directory,
    head?.views.notes ?? {},
    generated?.noteDependencies ?? {},
    access,
  );
  const lineage = await lineageOf(selected, new Set([pointer.sessionId]), readRevision, 0);
  const rebind = { projectId: fork.projectId, lineage, childSessionId: fork.childSessionId };
  const relevant = Object.fromEntries(
    Object.entries(ancestor.notes).map(([name, record]) => [
      name,
      {
        ...record,
        consumedSourceIds: [
          ...new Set(record.consumedSourceIds.flatMap((id) => [id, rebindReference(id, rebind)])),
        ],
      },
    ]),
  );
  return await inheritCuration(fork.sessionDir, relevant, access);
}
