import { digest } from "../domain/canonical.ts";
import type { SourceBoundary } from "../domain/intervals.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import type { PresentationLineage } from "../presentation/entries.ts";
import type { PresentationView } from "../presentation/types.ts";
import type { CanonicalMemory } from "./canonical-memory.ts";
import { correctionCauseOf, storageClosed } from "./note-validity.ts";
import type { NoteValidity } from "./note-validity.ts";

/**
 * Supply the bounded index component a request may present: the revision and source boundary it
 * presents and its complete text.
 */
export interface IndexComponent {
  revision: RevisionPointer;
  sourceBoundary: SourceBoundary;
  body: string;
}

/**
 * Identify the canonical state a request snapshot reads: the presentation lineage of open storage
 * and the branch leaf.
 */
export interface RequestSelection {
  lineage: PresentationLineage;
  anchorId: string | undefined;
}

/**
 * Capture what one acting request presents at its snapshot point; `view` is `undefined` while the
 * branch has no leaf. `validity` is the selected note's validity at the snapshot; while it is
 * `invalid` or `unknown`, acting context omits every representation of the note.
 */
export interface RequestSnapshot {
  view: PresentationView | undefined;
  validity: NoteValidity;
}

/**
 * Take one acting request's snapshot synchronously from cached canonical memory and the note's
 * validity.
 *
 * Each request reflects canonical state committed before its `context` hook: the hook reads the
 * selection and the storage session's cached canonical memory without awaiting anything, so a
 * commit that lands between `context` and dispatch appears in the next request, and bookkeeping
 * never counts it as presented in the earlier request. The work note is presented only while it is
 * valid and has a known source boundary. A note that is `invalid` or `unknown` is listed for
 * correction with its cause, `unverified` for unknown freshness; it stays stored, and the native
 * checkpoint and retained conversation carry continuation until a valid note is presented.
 */
export function takeRequestSnapshot(
  selection: RequestSelection,
  canonical: CanonicalMemory | undefined,
  index: IndexComponent | undefined,
  validity: NoteValidity,
): RequestSnapshot {
  const { lineage, anchorId } = selection;
  if (anchorId === undefined) {
    return { view: undefined, validity };
  }
  const view: PresentationView = { lineage, anchorId, components: {}, invalidated: [] };
  const revision = canonical?.revision;
  const note = canonical?.workNote;
  const boundary = canonical?.sourceBoundary;
  if (
    revision !== undefined &&
    note !== undefined &&
    boundary !== undefined &&
    validity.state === "valid"
  ) {
    const { body, bodyDigest } = note;
    view.components["work-note"] = {
      component: "work-note",
      revision,
      sourceBoundary: boundary,
      body,
      bodyDigest,
    };
  }
  if (index !== undefined) {
    view.components.index = { component: "index", ...index, bodyDigest: digest(index.body) };
  }
  if (revision !== undefined && (validity.state === "invalid" || validity.state === "unknown")) {
    view.invalidated = [{ component: "work-note", revision, cause: correctionCauseOf(validity) }];
  }
  return { view, validity };
}

/**
 * Take the snapshot of a request while memory storage is not open: nothing is presented, and the
 * work note that `presented` names, the current note of the branch's presentation log, is listed
 * for an `unverified` correction.
 */
export function unopenedSnapshot(
  lineage: PresentationLineage,
  anchorId: string,
  presented: RevisionPointer | undefined,
): RequestSnapshot & { view: PresentationView } {
  const view: PresentationView = { lineage, anchorId, components: {}, invalidated: [] };
  if (presented !== undefined) {
    view.invalidated = [
      { component: "work-note", revision: presented, cause: { kind: "unverified" } },
    ];
  }
  return { view, validity: storageClosed };
}
