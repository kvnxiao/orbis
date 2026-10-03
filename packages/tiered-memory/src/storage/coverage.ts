import * as Effect from "effect/Effect";

import { evidenceMatcher } from "../domain/evidence.ts";
import type { SourceEvidence } from "../domain/evidence.ts";
import { coverageOf } from "../domain/intervals.ts";
import type { ProcessedCoverage } from "../domain/intervals.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import { rebindReference } from "../domain/references.ts";
import type { Revision } from "./revisions.ts";
import type { MemoryStore } from "./store.ts";

/**
 * Describe what the revisions on a selected lineage committed: processed coverage of the revisions
 * whose evidence still matches, and the span references of those whose evidence changed.
 *
 * Revision files and the supplied sources are the only authority; nothing here is written, cached
 * on disk, or inferred from presentation records.
 */
export interface LineageRecords {
  coverage: ProcessedCoverage;
  changed: ReadonlySet<string>;
}

/**
 * Read the selected revision and its base chain, through fork ancestors, and collect their
 * processed `sourceIds`.
 *
 * References from an ancestor session are rebound to `store`'s session as fork curation rebinds
 * them, so an inherited span stays covered in the child. A revision whose `sourceIds` no longer
 * produce its `evidenceFingerprint` against `sources`, the active branch's current evidence, covers
 * nothing: a context edit keeps an entry's id but replaces the text its spans and ranges named, so
 * its references move to `changed` and the text is planned again. `selected` `null` yields empty
 * records. Reads without the project lock: revisions are immutable once a head names them.
 *
 * @throws Error naming the revision when one on the chain is unavailable or the chain revisits it.
 * @throws The failures of `MemoryStore.inheritRevision`, including a damaged revision.
 */
export const readLineageRecords = Effect.fnUntraced(function* (
  store: MemoryStore,
  selected: RevisionPointer | null,
  sources: readonly SourceEvidence[],
): Effect.fn.Return<LineageRecords, unknown> {
  const chain: Revision[] = [];
  const visited = new Set<string>();
  let pointer = selected;
  while (pointer !== null) {
    const key = `${pointer.sessionId}/${pointer.revisionId}`;
    if (visited.has(key)) {
      return yield* Effect.fail(
        new Error(`Memory revision lineage revisits revision ${pointer.revisionId}.`),
      );
    }
    visited.add(key);
    const revision = yield* store.inheritRevision(pointer);
    if (revision === undefined) {
      return yield* Effect.fail(
        new Error(`Memory revision ${pointer.revisionId} on the selected lineage is unavailable.`),
      );
    }
    chain.unshift(revision);
    pointer = revision.baseRevision;
  }
  const fork = {
    projectId: store.projectId,
    lineage: new Set(chain.map((revision) => revision.sessionId)),
    childSessionId: store.sessionId,
  };
  const current = evidenceMatcher(sources, store.projectId);
  const processed: string[] = [];
  const changed = new Set<string>();
  for (const revision of chain) {
    const references = revision.sourceIds.map((reference) => rebindReference(reference, fork));
    if (current(revision)) {
      processed.push(...references);
    } else {
      for (const reference of references) {
        changed.add(reference);
      }
    }
  }
  return { coverage: coverageOf(processed), changed };
});
