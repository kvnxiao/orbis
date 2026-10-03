import { Type } from "typebox";
import type { Static } from "typebox";

import { digest, stableStringify } from "./canonical.ts";
import { coverageOf } from "./intervals.ts";
import type { ProcessedCoverage } from "./intervals.ts";
import type { MemoryProposal, NoteDependency } from "./proposal.ts";
import {
  decodeSpanReference,
  digestSchema,
  encodeReference,
  encodeSpanReference,
  safeIdSchema,
  sourceIdSchema,
  sourceReferenceSchema,
} from "./references.ts";
import type { TextRange } from "./references.ts";

/**
 * Validate a source's time context as `sources.json` and accepted observations record it; an absent
 * member means unknown and is never invented.
 */
export const sourceTimeSchema = Type.Object(
  {
    recordedAt: Type.Optional(Type.String()),
    eventTime: Type.Optional(Type.String({ maxLength: 256 })),
    timezone: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);

/** Define a source's supplied or recorded time context. */
export type SourceTime = Static<typeof sourceTimeSchema>;

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

/**
 * Validate an observed external change of a managed note file: an edit, with the digest of the
 * edited bytes, or a deletion.
 */
export const curationEventSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("edited"), digest: digestSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("deleted") }, { additionalProperties: false }),
]);

/** Define the evidence fields of one `sources` record in `sessions/<session-id>/sources.json`. */
export type SourceEvidence = Static<typeof sourceEvidenceSchema>;
/**
 * Define one note record of `sessions/<session-id>/curation.json` or one `curated` learning record
 * of `sessions/_project/state.json`.
 */
export type CurationRecord = Static<typeof curationRecordSchema>;
/** Define an observed external edit or deletion of a managed note file. */
export type CurationEvent = Static<typeof curationEventSchema>;

/** Return the external change a curation record describes, without its consumed evidence. */
export function curationEventOf(record: CurationRecord): CurationEvent {
  return record.kind === "edited" ? { kind: "edited", digest: record.digest } : { kind: "deleted" };
}

/**
 * Name why a selected revision is not current: a note's evidence changed, a note was curated
 * externally, or the revision's assigned evidence changed.
 */
export type InvalidReason = "note-evidence" | "curation" | "assigned-evidence";

interface ResolvedSource {
  source: SourceEvidence;
  range: TextRange | undefined;
}

// A whole-entry item serializes without `range`, so fingerprints of span-0 evidence are unchanged.
function fingerprintOf(resolved: readonly ResolvedSource[]): string {
  return digest(
    stableStringify(
      resolved.map(({ source, range }) => ({
        entryId: source.entryId,
        rawDigest: source.rawDigest,
        effectiveDigest: source.effectiveDigest,
        omitted: source.omitted,
        range,
      })),
    ),
  );
}

// Resolves a registered reference or entry id, and a range reference to its entry's record; with
// `projectId`, an unregistered same-project reference also resolves by entry id.
function resolve(
  index: ReadonlyMap<string, SourceEvidence>,
  id: string,
  projectId?: string,
): ResolvedSource | undefined {
  const direct = index.get(id);
  if (direct !== undefined) {
    return { source: direct, range: undefined };
  }
  const decoded = decodeSpanReference(id);
  if (decoded === undefined) {
    return undefined;
  }
  const source =
    index.get(encodeReference(decoded.location)) ??
    (decoded.location.projectId === projectId ? index.get(decoded.location.entryId) : undefined);
  return source === undefined ? undefined : { source, range: decoded.range };
}

function requireResolved(index: ReadonlyMap<string, SourceEvidence>, id: string): ResolvedSource {
  const resolved = resolve(index, id);
  if (resolved === undefined) {
    throw new Error(`Unregistered source: ${id}`);
  }
  return resolved;
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
  if (decodeSpanReference(id) === undefined) {
    return encodeReference({ ...scope, entryId: id, span: 0 });
  }
  return id;
}

function matches(
  index: ReadonlyMap<string, SourceEvidence>,
  dependency: NoteDependency,
  projectId: string,
): boolean {
  const matched: ResolvedSource[] = [];
  for (const id of dependency.sourceIds) {
    const resolved = resolve(index, id, projectId);
    if (resolved === undefined) {
      return false;
    }
    matched.push(resolved);
  }
  return fingerprintOf(matched) === dependency.evidenceFingerprint;
}

/**
 * Fingerprint the named sources in caller order from their entry ids, digests, omission state, and
 * text ranges.
 *
 * Each id is a registered reference or entry id, or a range reference whose entry is registered.
 *
 * @throws Error naming the first id that no entry of `sources` registers.
 */
export function sourceFingerprint(
  sources: readonly SourceEvidence[],
  ids: readonly string[],
): string {
  const index = indexSources(sources);
  return fingerprintOf(ids.map((id) => requireResolved(index, id)));
}

/**
 * Resolve registered source ids once for a proposal's references and evidence fingerprint.
 *
 * A bare entry id becomes its registered reference; a range reference keeps its range.
 *
 * @throws Error naming the first id that no entry of `sources` registers.
 */
export function sourceReferences(
  sources: readonly SourceEvidence[],
  ids: readonly string[],
): { references: string[]; evidenceFingerprint: string } {
  const index = indexSources(sources);
  const selected = ids.map((id) => requireResolved(index, id));
  return {
    references: selected.map(({ source, range }) => {
      const decoded = decodeSpanReference(source.reference);
      return decoded === undefined || range === undefined
        ? source.reference
        : encodeSpanReference(decoded.location, range);
    }),
    evidenceFingerprint: fingerprintOf(selected),
  };
}

/**
 * Report whether a dependency's sources still produce its captured fingerprint.
 *
 * A range reference resolves to its entry's record. A `tm1:` reference absent from `sources`
 * matches by entry id when it belongs to `projectId`, which admits references rebound from a fork
 * ancestor. An id that still matches no source yields `false`.
 */
export function evidenceMatches(
  sources: readonly SourceEvidence[],
  dependency: NoteDependency,
  projectId: string,
): boolean {
  return matches(indexSources(sources), dependency, projectId);
}

/**
 * Index `sources` once and return a check that reports what `evidenceMatches` reports for each
 * dependency.
 */
export function evidenceMatcher(
  sources: readonly SourceEvidence[],
  projectId: string,
): (dependency: NoteDependency) => boolean {
  const index = indexSources(sources);
  return (dependency) => matches(index, dependency, projectId);
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

function consumedSpan(consumed: ProcessedCoverage, reference: string): boolean {
  const decoded = decodeSpanReference(reference);
  if (decoded === undefined) {
    return false;
  }
  const entry = encodeReference(decoded.location);
  if (consumed.entries.has(entry)) {
    return true;
  }
  const { range } = decoded;
  return (
    range !== undefined &&
    (consumed.ranges.get(entry) ?? []).some(
      (merged) => merged.start <= range.start && range.end <= merged.end,
    )
  );
}

/**
 * Report whether content generated from `sourceIds` may replace or recreate a curated note.
 *
 * An edited note is never replaced. A deleted note may be recreated only when at least one of
 * `sourceIds` is new evidence, compared by entry and range:
 *
 * - A consumed span `0` consumes every span of its entry.
 * - A proposed range is consumed when the merged consumed ranges of its entry contain it.
 * - A proposed span `0` is consumed only by a consumed span `0`: the entry's length is not known
 *   here, so consumed ranges never prove that they cover the whole entry.
 *
 * Bare entry ids resolve in `scope.sessionId`; full references retain their encoded session
 * identity.
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
  const consumed = coverageOf(record.consumedSourceIds.map((id) => sourceIdentity(id, scope)));
  return sourceIds.some((id) => !consumedSpan(consumed, sourceIdentity(id, scope)));
}
