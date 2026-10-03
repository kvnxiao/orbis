import { Type } from "typebox";
import type { Static } from "typebox";

import { digest, stableStringify } from "./canonical.ts";
import { sourceTimeSchema } from "./evidence.ts";
import { safeIdSchema, spanReferenceSchema } from "./references.ts";

/**
 * List the observation kinds the observer distinguishes; `attempt` is an action whose outcome is
 * separate, and `completion-claim` is a claim of completion, not a confirmed result.
 */
export const observationKindSchema = Type.Union([
  Type.Literal("request"),
  Type.Literal("question"),
  Type.Literal("proposal"),
  Type.Literal("decision"),
  Type.Literal("constraint"),
  Type.Literal("attempt"),
  Type.Literal("outcome"),
  Type.Literal("correction"),
  Type.Literal("completion-claim"),
]);

/**
 * Validate one citation of an accepted observation.
 *
 * `source` cites an assigned span and copies the span's branch order and time context at
 * acceptance, so later consolidation reads the same available context after delay or retry.
 * `checkpoint` cites a native compaction entry whose claims were carried without processing their
 * original spans.
 */
export const observationCitationSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("source"),
      reference: spanReferenceSchema,
      order: Type.Integer({ minimum: 0 }),
      time: sourceTimeSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("checkpoint"), entryId: safeIdSchema },
    { additionalProperties: false },
  ),
]);

/**
 * Validate an accepted observation as its revision records it.
 *
 * `id` is derived from the assigned interval and `ordinal`, the observation's position in the
 * observer response, so a retried interval yields the same identities. Supersession ordering comes
 * from the citations' `order` and `time` and the revision's sequence; processing time never orders
 * observations.
 */
export const observationRecordSchema = Type.Object(
  {
    id: safeIdSchema,
    kind: observationKindSchema,
    text: Type.String({ minLength: 1 }),
    ordinal: Type.Integer({ minimum: 0 }),
    citations: Type.Array(observationCitationSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

/** Name an observation kind. */
export type ObservationKind = Static<typeof observationKindSchema>;
/** Define one citation of an accepted observation. */
export type ObservationCitation = Static<typeof observationCitationSchema>;
/** Define one `observations` entry of a proposal and of its revision file. */
export type ObservationRecord = Static<typeof observationRecordSchema>;

/**
 * Derive an observation identity from its assigned interval's span references, the evidence
 * fingerprint of that interval, and its ordinal.
 *
 * The result satisfies `safeIdSchema`; equal intervals, fingerprints, and ordinals give equal
 * identities, so a retry of unchanged evidence repeats them while re-observing edited text under
 * the same references yields new ones.
 */
export function observationId(
  intervalReferences: readonly string[],
  evidenceFingerprint: string,
  ordinal: number,
): string {
  return digest(stableStringify({ interval: intervalReferences, evidenceFingerprint, ordinal }));
}
