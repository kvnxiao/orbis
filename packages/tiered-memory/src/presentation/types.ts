import type { SourceBoundary } from "../domain/intervals.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import type {
  CorrectionCause,
  DamagedPresentation,
  MemoryComponent,
  PresentationEntry,
  PresentationLineage,
} from "./entries.ts";

/**
 * Supply one valid canonical component a request may present; `body` is the complete committed note
 * or bounded index text.
 */
export interface ComponentState {
  component: MemoryComponent;
  revision: RevisionPointer;
  sourceBoundary: SourceBoundary;
  body: string;
  bodyDigest: string;
}

/**
 * Supply the canonical memory one request snapshot presents.
 *
 * An absent component has no valid current revision. `invalidated` lists components whose
 * previously current revision lost validity and still needs a durable correction. `anchorId` is the
 * branch leaf at the snapshot.
 */
export interface PresentationView {
  lineage: PresentationLineage;
  anchorId: string;
  components: Partial<Record<MemoryComponent, ComponentState>>;
  invalidated: readonly {
    component: MemoryComponent;
    revision: RevisionPointer;
    cause: CorrectionCause;
  }[];
}

/**
 * Describe one presentation record on the selected branch or awaiting its append.
 *
 * `entryId` is the Pi session entry, `undefined` while Pi still queues the message. `confirmed`
 * holds once the record is on the selected branch and its entry is in the session file after
 * fsync.
 */
export interface PresentedRecord {
  entry: PresentationEntry;
  entryId: string | undefined;
  confirmed: boolean;
  tokens: number;
}

/**
 * Describe the presented body of one component: the record identity that carries its body, the
 * revision label shown with that body (`bodyRevision`), and the revision and source boundary that
 * record, or a later boundary record, presents.
 */
export interface PresentedComponent {
  id: string;
  component: MemoryComponent;
  bodyDigest: string;
  bodyRevision: RevisionPointer;
  revision: RevisionPointer;
  sourceBoundary: SourceBoundary;
}

/**
 * Describe a presented correction of one component's revision; `position` is its index in
 * `PresentationLog.records`, and every component and boundary record of that component before it is
 * no longer current.
 */
export interface PresentedCorrection {
  component: MemoryComponent;
  revision: RevisionPointer;
  position: number;
}

/**
 * Describe presentation reconstructed from the effective projection of the selected branch, plus
 * records awaiting their append.
 *
 * - `records` lists the accepted records: valid, unedited, of the scope's project and session
 *   lineage, and anchored on the branch.
 * - `current` names each component's presented body, including a pending one; a correction of that
 *   component, or a reset without the component, removes it.
 * - `suppressed` lists identities that any reset in `records` superseded, pending or confirmed, so a
 *   pending reset is not planned twice.
 * - `accumulatedTokens` counts every record whose identity is not suppressed.
 */
export interface PresentationLog {
  records: readonly PresentedRecord[];
  current: Partial<Record<MemoryComponent, PresentedComponent>>;
  corrections: readonly PresentedCorrection[];
  suppressed: ReadonlySet<string>;
  accumulatedTokens: number;
  damaged: readonly DamagedPresentation[];
}

/**
 * Report what a request must present.
 *
 * - `current`: confirmed and pending records already represent the view.
 * - `append`: send these records, in order: corrections, then changed components and boundary
 *   updates.
 * - `reset`: send `corrections`, then one complete baseline that supersedes them and every earlier
 *   unsuppressed record.
 * - `over-budget`: the complete baseline exceeds the presentation budget after the index yields; the
 *   caller applies the capacity stop and sends nothing.
 */
export type PresentationPlan =
  | { kind: "current" }
  | { kind: "append"; records: readonly PresentationEntry[] }
  | {
      kind: "reset";
      corrections: readonly PresentationEntry[];
      record: Extract<PresentationEntry, { kind: "reset" }>;
    }
  | { kind: "over-budget"; requiredTokens: number; budgetTokens: number };
