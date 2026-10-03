import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { digest, stableStringify } from "./canonical.ts";
import type { ModelResolution, Role } from "./models.ts";
import { observationRecordSchema } from "./observations.ts";
import {
  digestSchema,
  learningNameSchema,
  noteNameSchema,
  safeIdSchema,
  sourceIdSchema,
} from "./references.ts";
import type { Settings } from "./settings.ts";

/**
 * Bind a note to the evidence it was generated from; later revisions carry the binding unchanged
 * with the note's body.
 *
 * `checkpointIds` names native compaction entries whose claims the note carries without their
 * original spans being processed; absence means the note carries none. Evidence checks read only
 * `sourceIds`.
 */
export const noteDependencySchema = Type.Object(
  {
    sourceIds: Type.Array(sourceIdSchema),
    evidenceFingerprint: digestSchema,
    checkpointIds: Type.Optional(Type.Array(safeIdSchema)),
  },
  { additionalProperties: false },
);

/**
 * Record a learning file's digest and generated sequence as the proposer observed them; `null`
 * means absent or never generated.
 */
export const expectedLearningSchema = Type.Object(
  {
    digest: Type.Union([digestSchema, Type.Null()]),
    sequence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/**
 * Name a revision by session; the session differs from the proposal's when the revision belongs to
 * a fork ancestor.
 */
export const revisionPointerSchema = Type.Object(
  { sessionId: safeIdSchema, revisionId: safeIdSchema },
  { additionalProperties: false },
);

/**
 * Report whether two revision pointers name the same revision; `null`, meaning no revision, equals
 * only `null`.
 */
export function sameRevision(left: RevisionPointer | null, right: RevisionPointer | null): boolean {
  return left === null || right === null
    ? left === right
    : left.sessionId === right.sessionId && left.revisionId === right.revisionId;
}

/**
 * Validate a memory proposal's shape; `validateProposal` adds the cross-field rules.
 *
 * `notes` holds only the notes the proposal writes; the other notes of `baseRevision` carry
 * forward. `sourceIds` is the processed interval: committing the proposal records processing
 * coverage for exactly these spans. `observations` holds only the observations this proposal
 * accepts; earlier observations stay in the revisions of the base lineage. `expectedRevision` is
 * the head the proposal was captured against, and `null` means no revision existed.
 * `excludedInheritedNotes` names carried notes to drop because their evidence or curation
 * invalidated them. `curatedNotes` names the notes whose curation records the store had found when
 * the proposal was captured; a commit rejects a written note with a record not named there.
 */
export const memoryProposalSchema = Type.Object(
  {
    sessionId: safeIdSchema,
    projectId: digestSchema,
    anchorId: safeIdSchema,
    sourceIds: Type.Array(sourceIdSchema),
    evidenceFingerprint: digestSchema,
    dependencyFingerprint: digestSchema,
    configurationRevision: Type.Integer({ minimum: 0 }),
    expectedRevision: Type.Union([safeIdSchema, Type.Null()]),
    baseRevision: Type.Union([revisionPointerSchema, Type.Null()]),
    notes: Type.Record(noteNameSchema, Type.String(), { additionalProperties: false }),
    noteDependencies: Type.Record(noteNameSchema, noteDependencySchema, {
      additionalProperties: false,
    }),
    observations: Type.Array(observationRecordSchema),
    consumedObservationIds: Type.Array(safeIdSchema),
    learnings: Type.Record(learningNameSchema, Type.String(), { additionalProperties: false }),
    expectedLearnings: Type.Record(learningNameSchema, expectedLearningSchema, {
      additionalProperties: false,
    }),
    excludedInheritedNotes: Type.Array(noteNameSchema),
    curatedNotes: Type.Array(noteNameSchema),
  },
  { additionalProperties: false },
);

/** Define one `noteDependencies` entry of a proposal and of its revision file. */
export type NoteDependency = Static<typeof noteDependencySchema>;
/** Define one `expectedLearnings` entry of a proposal and of its revision file. */
export type ExpectedLearning = Static<typeof expectedLearningSchema>;
/** Define the `baseRevision` pointer of a proposal and of its revision file. */
export type RevisionPointer = Static<typeof revisionPointerSchema>;
/**
 * Define the proposal that `captureProposal` returns; its revision file keeps every field except
 * `expectedRevision`.
 */
export type MemoryProposal = Static<typeof memoryProposalSchema>;

/**
 * Name the check that rejected a proposal under the project lock.
 *
 * `configuration` means the configuration revision or dependency fingerprint changed after capture.
 * `lineage` means one of these holds for the active branch:
 *
 * - A damaged revision reference can hide a revision newer than the selected one.
 * - A committed revision's branch reference is still pending.
 * - The selected revision is unavailable.
 * - The selection does not name the proposal's base revision.
 *
 * `curation` also means a written note gained a curation record after capture.
 */
export type ConflictReason =
  | "head"
  | "curation"
  | "learning"
  | "evidence"
  | "configuration"
  | "lineage";

/**
 * Report a commit's outcome.
 *
 * `committed` means the revision and the head naming it are durable; the branch reference may still
 * be pending. `conflict` carries the head the proposal expected and the head found under the lock,
 * which differ only for reason `head`. `cancelled` carries the first cancellation reason among the
 * host signal, a disable, a replacement, and shutdown, recorded before the head was written; a
 * revision file already written stays unreferenced.
 */
export type CommitResult =
  | { kind: "committed"; revisionId: string }
  | {
      kind: "conflict";
      expectedRevision: string | null;
      actualRevision: string | null;
      reason: ConflictReason;
    }
  | { kind: "cancelled"; reason: unknown };

/**
 * Check a proposal's shape and its cross-field rules.
 *
 * Beyond `memoryProposalSchema`, every `noteDependencies` key names a note in `notes`, every
 * `learnings` key has an `expectedLearnings` entry, and every `source` citation of an observation
 * names a reference in `sourceIds`.
 *
 * @throws Error listing each failing instance path when the shape is invalid, or naming the
 *   violated cross-field rule.
 */
export function validateProposal(value: unknown): MemoryProposal {
  if (!Value.Check(memoryProposalSchema, value)) {
    const detail = Value.Errors(memoryProposalSchema, value)
      .map(
        (error) =>
          `${error.instancePath.length === 0 ? "/" : error.instancePath}: ${error.message}`,
      )
      .join("; ");
    throw new Error(`Invalid memory proposal: ${detail}`);
  }
  const undeclared = Object.keys(value.noteDependencies).find(
    (name) => !Object.hasOwn(value.notes, name),
  );
  if (undeclared !== undefined) {
    throw new Error(
      `Invalid memory proposal: /noteDependencies/${undeclared} names a note the proposal does not write.`,
    );
  }
  const unexpected = Object.keys(value.learnings).find(
    (name) => !Object.hasOwn(value.expectedLearnings, name),
  );
  if (unexpected !== undefined) {
    throw new Error(
      `Invalid memory proposal: /learnings/${unexpected} has no /expectedLearnings entry.`,
    );
  }
  const outside = outsideCitation(value);
  if (outside !== undefined) {
    throw new Error(`Invalid memory proposal: ${outside} names a span outside /sourceIds.`);
  }
  return value;
}

function outsideCitation(proposal: MemoryProposal): string | undefined {
  const assigned = new Set(proposal.sourceIds);
  for (const [index, observation] of proposal.observations.entries()) {
    for (const [position, citation] of observation.citations.entries()) {
      if (citation.kind === "source" && !assigned.has(citation.reference)) {
        return `/observations/${String(index)}/citations/${String(position)}/reference`;
      }
    }
  }
  return undefined;
}

/**
 * Fingerprint the settings, roles, and project root a proposal depends on, independently of key
 * order.
 */
export function dependencyFingerprint(dependencies: {
  settings: Settings;
  roles: Record<Role, ModelResolution> | undefined;
  projectRoot: string;
}): string {
  return digest(stableStringify(dependencies));
}
