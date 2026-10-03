import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import { curationEventSchema } from "../domain/evidence.ts";
import { sourceBoundarySchema } from "../domain/intervals.ts";
import { revisionPointerSchema } from "../domain/proposal.ts";
import { digestSchema, safeIdSchema } from "../domain/references.ts";

/** Name the Pi custom message type of every presentation record. */
export const presentationMessageType = "orbis-tiered-memory-presentation";

/** Name a presented memory component: the current-work note or the bounded index. */
export const memoryComponentSchema = Type.Union([Type.Literal("work-note"), Type.Literal("index")]);

/**
 * Identify the lineage a record was written for: the project and the memory session, which is the
 * Pi session that appended it.
 */
export const presentationLineageSchema = Type.Object(
  { projectId: digestSchema, sessionId: safeIdSchema },
  { additionalProperties: false },
);

const recordFields = {
  version: Type.Literal(1),
  id: safeIdSchema,
  lineage: presentationLineageSchema,
  anchorId: safeIdSchema,
};

const componentFields = {
  component: memoryComponentSchema,
  revision: revisionPointerSchema,
  sourceBoundary: sourceBoundarySchema,
  body: Type.String(),
  bodyDigest: digestSchema,
};

/**
 * Validate a complete changed component; one confirmed Pi custom-message append is its unit.
 *
 * `id` is the presentation identity, distinct from the canonical `revision`. `anchorId` is the
 * branch leaf when the record was planned; a record is current only on a branch that contains its
 * anchor. `supersedes` names the previous presentation of the same component, absent for the first.
 * An empty work-note `body` is an explicitly empty working state.
 */
export const presentationComponentSchema = Type.Object(
  {
    ...recordFields,
    kind: Type.Literal("component"),
    ...componentFields,
    supersedes: Type.Optional(safeIdSchema),
  },
  { additionalProperties: false },
);

/**
 * Validate a coverage update for an unchanged body; `componentId` and `bodyDigest` name the
 * presented body it extends to `revision` and `sourceBoundary` without copying it, and
 * `bodyRevision` is the revision label the model saw with that body.
 */
export const presentationBoundarySchema = Type.Object(
  {
    ...recordFields,
    kind: Type.Literal("boundary"),
    component: memoryComponentSchema,
    componentId: safeIdSchema,
    bodyRevision: revisionPointerSchema,
    bodyDigest: digestSchema,
    revision: revisionPointerSchema,
    sourceBoundary: sourceBoundarySchema,
  },
  { additionalProperties: false },
);

/**
 * Validate a presentation reset: one complete baseline append of every eligible current component.
 *
 * Each baseline component has its own presentation `id` for later supersession. `superseded` lists
 * the package-owned presentation identities that acting context suppresses from this record on.
 * `tokensBefore` estimates accumulated presentation plus the records that triggered the reset;
 * `tokensAfter` estimates the baseline.
 */
export const presentationResetSchema = Type.Object(
  {
    ...recordFields,
    kind: Type.Literal("reset"),
    components: Type.Array(
      Type.Object({ id: safeIdSchema, ...componentFields }, { additionalProperties: false }),
      { maxItems: 2 },
    ),
    superseded: Type.Array(safeIdSchema),
    reason: Type.Literal("budget"),
    tokensBefore: Type.Integer({ minimum: 0 }),
    tokensAfter: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/**
 * Name why a presented component is no longer current: its note file was edited or deleted outside
 * the extension, with the observed `event` that persisted curation also records; the evidence it
 * relied on changed in effective context; native fallback replaced it with a native checkpoint at
 * `compactionEntryId`; or its freshness could not be verified.
 */
export const correctionCauseSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("curation"), event: curationEventSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("evidence") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("fallback"), compactionEntryId: safeIdSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("unverified") }, { additionalProperties: false }),
]);

/**
 * Validate a correction that keeps an invalid revision from regaining current authority, visible to
 * native compaction even while new injection is disabled.
 *
 * `affectedRevision` is the canonical revision that lost validity. `presented`, when that revision
 * is presented, names the record that carries its body and the revision label the model saw with
 * that body, which differs from `affectedRevision` after a boundary update. Queued delivery is not
 * a durable correction until confirmed.
 */
export const presentationCorrectionSchema = Type.Object(
  {
    ...recordFields,
    kind: Type.Literal("correction"),
    component: memoryComponentSchema,
    affectedRevision: revisionPointerSchema,
    presented: Type.Optional(
      Type.Object(
        { id: safeIdSchema, bodyRevision: revisionPointerSchema },
        { additionalProperties: false },
      ),
    ),
    cause: correctionCauseSchema,
  },
  { additionalProperties: false },
);

/**
 * Validate the `details` of a presentation custom message; `kind` discriminates the variants and
 * readers reject every `version` other than 1.
 */
export const presentationEntrySchema = Type.Union([
  presentationComponentSchema,
  presentationBoundarySchema,
  presentationResetSchema,
  presentationCorrectionSchema,
]);

/** Name a presented memory component. */
export type MemoryComponent = Static<typeof memoryComponentSchema>;
/** Define a presentation record's lineage identity. */
export type PresentationLineage = Static<typeof presentationLineageSchema>;
/** Define the cause of a presentation correction. */
export type CorrectionCause = Static<typeof correctionCauseSchema>;
/** Define the `details` of an `orbis-tiered-memory-presentation` custom message. */
export type PresentationEntry = Static<typeof presentationEntrySchema>;

/**
 * Return a copy of a reset record whose baseline keeps only the components in `keep`, in their
 * order, for rendering one request without the others; the persisted record is unchanged.
 */
export function resetWithOnly(
  entry: Extract<PresentationEntry, { kind: "reset" }>,
  keep: ReadonlySet<MemoryComponent>,
): Extract<PresentationEntry, { kind: "reset" }> {
  return {
    ...entry,
    components: entry.components.filter((component) => keep.has(component.component)),
  };
}

/**
 * Identify a presentation message whose `details` fail validation; `path` is the first failing
 * instance path. A damaged record is preserved, excluded from reconstruction, and reported.
 */
export interface DamagedPresentation {
  entryId: string;
  path: string;
}

const variantsByKind = new Map<string, TSchema>(
  presentationEntrySchema.anyOf.map((variant) => [variant.properties.kind.const, variant]),
);

function firstErrorPath(schema: TSchema, value: unknown): string {
  const [error] = Value.Errors(schema, value);
  if (error === undefined) {
    return "/";
  }
  const path = error.instancePath.length === 0 ? "/" : error.instancePath;
  const missing = error.keyword === "required" ? error.params.requiredProperties[0] : undefined;
  return missing === undefined ? path : `${path === "/" ? "" : path}/${missing}`;
}

function variantOf(details: unknown): TSchema | undefined {
  if (typeof details !== "object" || details === null || !("kind" in details)) {
    return undefined;
  }
  const kind = details.kind;
  return typeof kind === "string" ? variantsByKind.get(kind) : undefined;
}

function resetProblem(entry: Extract<PresentationEntry, { kind: "reset" }>): string | undefined {
  const ids = new Set([entry.id]);
  const components = new Set<string>();
  for (const [index, component] of entry.components.entries()) {
    if (digest(component.body) !== component.bodyDigest) {
      return `/components/${String(index)}/bodyDigest`;
    }
    if (ids.has(component.id)) {
      return `/components/${String(index)}/id`;
    }
    if (components.has(component.component)) {
      return `/components/${String(index)}/component`;
    }
    ids.add(component.id);
    components.add(component.component);
  }
  const own = entry.superseded.findIndex((id) => ids.has(id));
  return own === -1 ? undefined : `/superseded/${String(own)}`;
}

function relationProblem(entry: PresentationEntry): string | undefined {
  if (entry.kind === "component") {
    if (digest(entry.body) !== entry.bodyDigest) {
      return "/bodyDigest";
    }
    return entry.supersedes === entry.id ? "/supersedes" : undefined;
  }
  if (entry.kind === "boundary") {
    return entry.componentId === entry.id ? "/componentId" : undefined;
  }
  if (entry.kind === "reset") {
    return resetProblem(entry);
  }
  return entry.presented?.id === entry.id ? "/presented/id" : undefined;
}

/**
 * Validate presentation `details` read from a session entry or built for an append.
 *
 * Checks the schema of the variant `kind` names, so a failure reports the variant's first failing
 * path, or `/kind` for a missing or unknown kind. Then checks that each `bodyDigest` is the digest
 * of its `body`, that reset component identities and components are unique and not superseded by
 * their own reset, and that no record supersedes, extends, or corrects itself.
 */
export function readPresentationEntry(
  details: unknown,
): { kind: "valid"; entry: PresentationEntry } | { kind: "damaged"; path: string } {
  const variant = variantOf(details);
  if (variant === undefined) {
    const path = typeof details === "object" && details !== null ? "/kind" : "/";
    return { kind: "damaged", path };
  }
  if (!Value.Check(variant, details) || !Value.Check(presentationEntrySchema, details)) {
    return { kind: "damaged", path: firstErrorPath(variant, details) };
  }
  const problem = relationProblem(details);
  return problem === undefined
    ? { kind: "valid", entry: details }
    : { kind: "damaged", path: problem };
}
