import { Type } from "typebox";
import type { Static } from "typebox";

import { digest, stableStringify } from "./canonical.ts";
import type { MemoryProposal, NoteDependency } from "./proposal.ts";
import {
  decodeReference,
  digestSchema,
  encodeReference,
  safeIdSchema,
  sourceIdSchema,
  sourceReferenceSchema,
} from "./references.ts";

/**
 * Validate the fields of a registered source that evidence checks read; `effectiveDigest` is `null`
 * exactly when `omitted` is true.
 */
export const sourceEvidenceSchema = Type.Object(
  {
    reference: sourceReferenceSchema,
    entryId: safeIdSchema,
    rawDigest: digestSchema,
    effectiveDigest: Type.Union([digestSchema, Type.Null()]),
    omitted: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * Validate a note or learning curation record.
 *
 * `edited` keeps the digest of the externally edited content; `consumedSourceIds` lists evidence
 * that must not recreate or replace the note.
 */
export const curationRecordSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("edited"),
      digest: digestSchema,
      consumedSourceIds: Type.Array(sourceIdSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("deleted"), consumedSourceIds: Type.Array(sourceIdSchema) },
    { additionalProperties: false },
  ),
]);

/** Define the evidence fields of one `sources` record in `sessions/<session-id>/sources.json`. */
export type SourceEvidence = Static<typeof sourceEvidenceSchema>;
/**
 * Define one note record of `sessions/<session-id>/curation.json` or one `curated` learning record
 * of `sessions/_project/state.json`.
 */
export type CurationRecord = Static<typeof curationRecordSchema>;

/**
 * Name why a selected revision is not current: a note's evidence changed, a note was curated
 * externally, or the revision's assigned evidence changed.
 */
export type InvalidReason = "note-evidence" | "curation" | "assigned-evidence";

function fingerprintOf(sources: readonly SourceEvidence[]): string {
  return digest(
    stableStringify(
      sources.map((source) => ({
        entryId: source.entryId,
        rawDigest: source.rawDigest,
        effectiveDigest: source.effectiveDigest,
        omitted: source.omitted,
      })),
    ),
  );
}

function indexSources(sources: readonly SourceEvidence[]): Map<string, SourceEvidence> {
  const index = new Map<string, SourceEvidence>();
  for (const source of sources) {
    for (const key of [source.reference, source.entryId]) {
      if (!index.has(key)) {
        index.set(key, source);
      }
    }
  }
  return index;
}

function sourceIdentity(id: string, scope: { projectId: string; sessionId: string }): string {
  const location = decodeReference(id);
  if (location === undefined) {
    return encodeReference({ ...scope, entryId: id, span: 0 });
  }
  return id;
}

function matches(
  index: ReadonlyMap<string, SourceEvidence>,
  dependency: NoteDependency,
  projectId: string,
): boolean {
  const matched: SourceEvidence[] = [];
  for (const id of dependency.sourceIds) {
    const location = decodeReference(id);
    const source =
      index.get(id) ??
      (location?.projectId === projectId ? index.get(location.entryId) : undefined);
    if (source === undefined) {
      return false;
    }
    matched.push(source);
  }
  return fingerprintOf(matched) === dependency.evidenceFingerprint;
}

/**
 * Fingerprint the named sources in caller order from their entry ids, digests, and omission state.
 *
 * Each id is a registered reference or entry id.
 *
 * @throws Error naming the first id that no entry of `sources` registers.
 */
export function sourceFingerprint(
  sources: readonly SourceEvidence[],
  ids: readonly string[],
): string {
  const index = indexSources(sources);
  return fingerprintOf(
    ids.map((id) => {
      const source = index.get(id);
      if (source === undefined) {
        throw new Error(`Unregistered source: ${id}`);
      }
      return source;
    }),
  );
}

/** Resolve registered source ids once for a proposal's references and evidence fingerprint. */
export function sourceReferences(
  sources: readonly SourceEvidence[],
  ids: readonly string[],
): { references: string[]; evidenceFingerprint: string } {
  const index = indexSources(sources);
  const selected = ids.map((id) => {
    const source = index.get(id);
    if (source === undefined) {
      throw new Error(`Unregistered source: ${id}`);
    }
    return source;
  });
  return {
    references: selected.map((source) => source.reference),
    evidenceFingerprint: fingerprintOf(selected),
  };
}

/**
 * Report whether a dependency's sources still produce its captured fingerprint.
 *
 * A `tm1:` reference absent from `sources` matches by entry id when it belongs to `projectId`,
 * which admits references rebound from a fork ancestor. An id that still matches no source yields
 * `false`.
 */
export function evidenceMatches(
  sources: readonly SourceEvidence[],
  dependency: NoteDependency,
  projectId: string,
): boolean {
  return matches(indexSources(sources), dependency, projectId);
}

/**
 * Report which notes of a revision are no longer current and why.
 *
 * A note is invalid when its dependency's evidence changed or its curation record forbids its
 * evidence. `invalidReason` reports the first applicable of note evidence, curation, then the
 * revision's assigned evidence, and is `undefined` when every check passes.
 */
export function assessRevision(
  sources: readonly SourceEvidence[],
  curation: Readonly<Record<string, CurationRecord>>,
  revision: Pick<MemoryProposal, "sourceIds" | "evidenceFingerprint" | "noteDependencies">,
  projectId: string,
  sessionId: string,
): { invalidNotes: string[]; invalidReason: InvalidReason | undefined } {
  const index = indexSources(sources);
  const dependencies = Object.entries(revision.noteDependencies);
  const changed = dependencies
    .filter(([, dependency]) => !matches(index, dependency, projectId))
    .map(([name]) => name);
  const curated = dependencies
    .filter(
      ([name, dependency]) =>
        !mayUseNote(curation[name], dependency.sourceIds, { projectId, sessionId }),
    )
    .map(([name]) => name);
  const invalidNotes = [...new Set([...changed, ...curated])];
  let invalidReason: InvalidReason | undefined;
  if (changed.length > 0) {
    invalidReason = "note-evidence";
  } else if (curated.length > 0) {
    invalidReason = "curation";
  } else if (!matches(index, revision, projectId)) {
    invalidReason = "assigned-evidence";
  }
  return { invalidNotes, invalidReason };
}

/**
 * Report whether content generated from `sourceIds` may replace or recreate a curated note.
 *
 * An edited note is never replaced. A deleted note may be recreated only when at least one of
 * `sourceIds` is absent from its consumed evidence. Bare entry ids resolve in `scope.sessionId`;
 * full references retain their encoded session identity.
 */
export function mayUseNote(
  record: CurationRecord | undefined,
  sourceIds: readonly string[],
  scope: { projectId: string; sessionId: string },
): boolean {
  if (record === undefined) {
    return true;
  }
  if (record.kind === "edited") {
    return false;
  }
  const consumed = new Set(record.consumedSourceIds.map((id) => sourceIdentity(id, scope)));
  return sourceIds.some((id) => !consumed.has(sourceIdentity(id, scope)));
}
