import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { digest, stableStringify } from "./canonical.ts";
import type { ModelResolution, Role } from "./models.ts";
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
 */
export const noteDependencySchema = Type.Object(
  { sourceIds: Type.Array(sourceIdSchema), evidenceFingerprint: digestSchema },
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
 * Validate a memory proposal's shape; `validateProposal` adds the cross-field rules.
 *
 * `notes` holds only the notes the proposal writes; the other notes of `baseRevision` carry
 * forward. `expectedRevision` is the head the proposal was captured against, and `null` means no
 * revision existed. `excludedInheritedNotes` names carried notes to drop because their evidence or
 * curation invalidated them.
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
    consumedObservationIds: Type.Array(safeIdSchema),
    learnings: Type.Record(learningNameSchema, Type.String(), { additionalProperties: false }),
    expectedLearnings: Type.Record(learningNameSchema, expectedLearningSchema, {
      additionalProperties: false,
    }),
    excludedInheritedNotes: Type.Array(noteNameSchema),
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
 */
export type ConflictReason = "head" | "curation" | "learning" | "evidence" | "configuration";

/**
 * Report a commit's outcome.
 *
 * `committed` means the revision and the head naming it are durable; the branch reference may still
 * be pending. `conflict` carries the head the proposal expected and the head found under the lock,
 * which differ only for reason `head`. `cancelled` carries the abort reason of the signal that
 * fired before the head was written; a revision file already written stays unreferenced.
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
 * Beyond `memoryProposalSchema`, every `noteDependencies` key names a note in `notes` and every
 * `learnings` key has an `expectedLearnings` entry.
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
  return value;
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
