import { join } from "node:path";

import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";

import { digest } from "../domain/canonical.ts";
import { curationRecordSchema, mayUseNote } from "../domain/evidence.ts";
import type { MemoryProposal } from "../domain/proposal.ts";
import {
  decodeSpanReference,
  digestSchema,
  learningNameSchema,
  sourceIdSchema,
} from "../domain/references.ts";
import { lineageOf, readAll, reconcileRecords, withReboundSources } from "./curation.ts";
import type { RevisionReader } from "./curation.ts";
import { readText } from "./files.ts";
import { parseRecord } from "./records.ts";
import type { DurableWrites } from "./services.ts";
import { writeRecord } from "./services.ts";

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

/** Define one `generated` entry of the `sessions/_project/state.json` payload. */
export type GeneratedLearning = Static<typeof generatedLearningSchema>;
/** Define the `sessions/_project/state.json` payload. */
export type ProjectCurationState = Static<typeof projectCurationSchema>;

function projectStatePath(baseDir: string): string {
  return join(baseDir, "sessions", "_project", "state.json");
}

const loadProjectCuration = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<ProjectCurationState, unknown> {
  const text = yield* readText(path);
  return text === undefined
    ? { version: 1, generated: {}, curated: {} }
    : parseRecord(projectCurationSchema, text, path);
});

/**
 * Read validated project learning provenance without reconciling disk views.
 *
 * @throws Error naming the path when `state.json` is not JSON or fails `projectCurationSchema`.
 * @throws The original read error other than `ENOENT`.
 */
export function readProjectCuration(baseDir: string): Effect.Effect<ProjectCurationState, unknown> {
  return loadProjectCuration(projectStatePath(baseDir));
}

/**
 * Record external edits and deletions of generated learnings and return the project curation.
 *
 * Writes `sessions/_project/state.json` only when a record changes. Must run under the project
 * lock.
 *
 * @throws Error naming the path when `state.json` is not JSON or fails `projectCurationSchema`; its
 *   bytes are preserved.
 * @throws The original read or write error.
 */
export const inspectProjectCuration = Effect.fnUntraced(function* (
  baseDir: string,
): Effect.fn.Return<ProjectCurationState, unknown, DurableWrites> {
  const path = projectStatePath(baseDir);
  const state = yield* loadProjectCuration(path);
  const generated = Object.entries(state.generated).map(([name, learning]) => ({
    name,
    path: join(baseDir, "learnings", name),
    digest: learning.digest,
    consumed: learning.consumedSourceIds,
  }));
  if (yield* reconcileRecords(state.curated, generated)) {
    yield* writeRecord(path, state);
  }
  return state;
});

/**
 * Record provenance for the learnings a committed revision wrote.
 *
 * Records provenance for each learning whose file still has the committed content, and keeps an
 * entry whose sequence is newer than `sequence`. Must run under the project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 * @throws The original read or write error.
 */
export const publishProjectGenerated = Effect.fnUntraced(function* (
  baseDir: string,
  committed: {
    learnings: Readonly<Record<string, string>>;
    sourceIds: readonly string[];
    sequence: number;
  },
): Effect.fn.Return<void, unknown, DurableWrites> {
  const learnings = Object.entries(committed.learnings);
  if (learnings.length === 0) {
    return;
  }
  const path = projectStatePath(baseDir);
  const state = yield* loadProjectCuration(path);
  const contents = yield* readAll(learnings.map(([name]) => join(baseDir, "learnings", name)));
  let changed = false;
  for (const [index, [name, content]] of learnings.entries()) {
    if (
      contents[index] === content &&
      (state.generated[name]?.sequence ?? 0) <= committed.sequence
    ) {
      state.generated[name] = {
        digest: digest(content),
        consumedSourceIds: [...committed.sourceIds],
        sequence: committed.sequence,
      };
      changed = true;
    }
  }
  if (changed) {
    yield* writeRecord(path, state);
  }
});

/**
 * Check a proposal's learnings against project curation and the state the proposer expected.
 *
 * Returns `curation` when a learning is curated against the proposal's evidence or exists without
 * generated provenance, `learning` when its digest or generated sequence differs from
 * `expectedLearnings`, and `undefined` when every learning may be written. Must run under the
 * project lock.
 *
 * @throws Error naming the path when `state.json` is damaged; its bytes are preserved.
 * @throws Error when the base lineage has a cycle or names a missing revision.
 * @throws The original read or write error.
 */
export const learningConflict = Effect.fnUntraced(function* (
  baseDir: string,
  proposal: Pick<
    MemoryProposal,
    "learnings" | "expectedLearnings" | "sourceIds" | "projectId" | "sessionId" | "baseRevision"
  >,
  readRevision: RevisionReader,
): Effect.fn.Return<"curation" | "learning" | undefined, unknown, DurableWrites> {
  const names = Object.keys(proposal.learnings);
  if (names.length === 0) {
    return undefined;
  }
  const project = yield* inspectProjectCuration(baseDir);
  const proposedEntries = new Set(
    proposal.sourceIds.map((id) => decodeSpanReference(id)?.location.entryId ?? id),
  );
  const needsRebind = names.some(
    (name) =>
      project.curated[name]?.consumedSourceIds.some((id) => {
        const location = decodeSpanReference(id)?.location;
        return (
          location?.projectId === proposal.projectId &&
          location.sessionId !== proposal.sessionId &&
          proposedEntries.has(location.entryId)
        );
      }) ?? false,
  );
  const base =
    needsRebind && proposal.baseRevision !== null
      ? yield* readRevision(proposal.baseRevision)
      : undefined;
  const lineage =
    base === undefined || proposal.baseRevision === null
      ? undefined
      : yield* lineageOf(base, new Set([proposal.baseRevision.sessionId]), readRevision);
  const disks = yield* readAll(names.map((name) => join(baseDir, "learnings", name)));
  for (const [index, name] of names.entries()) {
    const disk = disks[index];
    const curated = project.curated[name];
    const comparable =
      curated === undefined || lineage === undefined
        ? curated
        : withReboundSources(curated, {
            projectId: proposal.projectId,
            lineage,
            childSessionId: proposal.sessionId,
          });
    if (
      !mayUseNote(comparable, proposal.sourceIds, proposal) ||
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
});
