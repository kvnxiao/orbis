import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { CurationEvent } from "../domain/evidence.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import type { PresentationLineage } from "../presentation/entries.ts";
import type { NoteInspection } from "./note-inspection.ts";
import { presentationEntryOf } from "./presentation-log.ts";

/**
 * Describe the latest completed inspection of the managed current-work note file: `verified` when
 * it established that nothing outside the extension changed the file, or `unknown` with the reason
 * it could not; `at` is the Effect clock time it completed.
 */
export type FreshnessObservation =
  | { state: "verified"; at: number }
  | { state: "unknown"; reason: string; at: number };

/**
 * Describe an external edit or deletion that an inspection detected in `sessionDir`, with the
 * revision selected when it was detected, until persisted curation that a later reconciliation read
 * records it.
 *
 * `persistence` is `pending` before recording starts and after a failed recording, `recording`
 * while storage-session work records it, and `recorded` once `curation.json` holds it; `error` is
 * the latest failed recording's message.
 */
export interface DetectedCuration {
  sessionDir: string;
  event: CurationEvent;
  revision: RevisionPointer | null;
  persistence: "pending" | "recording" | "recorded";
  error: string | undefined;
}

/** Carry a copy of the freshness state that validity and status read. */
export interface FreshnessView {
  observation: FreshnessObservation | undefined;
  detection: DetectedCuration | undefined;
}

/**
 * Own the managed note file's freshness observations and the detected curation of one runtime.
 *
 * Invariants:
 *
 * - An inspection applies only when the generation it started under is still current. Opening a
 *   storage session, a transition, a durable head this process wrote, and a canonical-memory
 *   publication advance the generation, so a result read across any of them is discarded, except
 *   that a detected edit or deletion of the latest head's note still records its detection.
 * - A detection is sticky: later inspections, including one that finds the file restored, never clear
 *   it. Only a reconciliation that started after the detection was recorded clears it, since that
 *   reconciliation read the recorded curation.
 * - A reconciliation records a verified observation only when no inspection result applied after it
 *   started, so a newer result is never overwritten by an older reading.
 * - Opening another session's storage drops the observation and a detection of the other session.
 */
export class NoteFreshness {
  private observation: FreshnessObservation | undefined;
  private detection: DetectedCuration | undefined;
  private generation = 0;
  private recordings = 0;
  private observations = 0;

  /** Return a copy of the observation and detection. */
  get view(): FreshnessView {
    return structuredClone({ observation: this.observation, detection: this.detection });
  }

  /** Return the generation an inspection starting now records. */
  get current(): number {
    return this.generation;
  }

  /** Return the recording count a reconciliation starting now records. */
  get recorded(): number {
    return this.recordings;
  }

  /** Return the count of applied observations a reconciliation starting now records. */
  get observed(): number {
    return this.observations;
  }

  /** Report whether the detection still awaits a recording that is not already running. */
  get awaitsRecording(): boolean {
    return this.detection?.persistence === "pending";
  }

  /** Report whether a detection is not yet recorded, which refuses new memory proposals. */
  get blocksProposals(): boolean {
    return this.detection !== undefined && this.detection.persistence !== "recorded";
  }

  /** Discard every inspection in flight. */
  advance(): void {
    this.generation++;
  }

  /**
   * Start a storage session in `sessionDir`, keeping only a detection of that session; a recording
   * that the previous storage session interrupted waits again.
   */
  open(sessionDir: string): void {
    this.advance();
    this.observation = undefined;
    if (this.detection?.sessionDir !== sessionDir) {
      this.detection = undefined;
    } else if (this.detection.persistence === "recording") {
      this.detection = { ...this.detection, persistence: "pending" };
    }
  }

  /**
   * Apply an inspection that started at generation `started` and completed at `at`, and report
   * whether it applied.
   *
   * `unknown` records an unknown observation; `verified`, `recurated`, and `curated` record a
   * verified one, and `curated` also records a detection with `revision` when none exists and
   * canonical memory still holds the selected note as current (`current`); a note that canonical
   * memory already excludes leaves the change to reconciliation. `pending` changes nothing. After
   * the generation moved, only a `curated` result whose head is still `latest` applies, and it
   * records only the detection.
   */
  apply(
    started: number,
    inspection: NoteInspection,
    context: {
      sessionDir: string;
      revision: RevisionPointer | null;
      current: boolean;
      latest: string | null;
      at: number;
    },
  ): boolean {
    if (started !== this.generation) {
      if (inspection.kind !== "curated" || inspection.headRevisionId !== context.latest) {
        return false;
      }
      this.detect(inspection.event, context);
      return true;
    }
    const { at } = context;
    if (inspection.kind === "pending") {
      return true;
    }
    this.observations++;
    if (inspection.kind === "unknown") {
      this.observation = { state: "unknown", reason: inspection.reason, at };
      return true;
    }
    this.observation = { state: "verified", at };
    if (inspection.kind === "curated") {
      this.detect(inspection.event, context);
    }
    return true;
  }

  /** Mark a pending detection `recording` and return a copy of it, or `undefined` when none waits. */
  startRecording(): DetectedCuration | undefined {
    if (this.detection?.persistence !== "pending") {
      return undefined;
    }
    this.detection = { ...this.detection, persistence: "recording" };
    return structuredClone(this.detection);
  }

  /** Mark the detection recorded in `curation.json`. */
  finishRecording(): void {
    if (this.detection !== undefined) {
      this.recordings++;
      this.detection = { ...this.detection, persistence: "recorded", error: undefined };
    }
  }

  /** Return the detection to `pending` with the failed recording's message. */
  failRecording(error: string): void {
    if (this.detection !== undefined) {
      this.detection = { ...this.detection, persistence: "pending", error };
    }
  }

  /**
   * Record the inspection a reconciliation completed at `at`, which started at recording count
   * `started.recorded` and observation count `started.observed`: the observation becomes verified
   * unless an inspection result applied since, and a detection recorded before it started clears.
   */
  reconciled(started: { recorded: number; observed: number }, at: number): void {
    this.advance();
    if (this.observations === started.observed) {
      this.observation = { state: "verified", at };
    }
    if (this.detection?.persistence === "recorded" && this.recordings <= started.recorded) {
      this.detection = undefined;
    }
  }

  private detect(
    event: CurationEvent,
    context: { sessionDir: string; revision: RevisionPointer | null; current: boolean },
  ): void {
    if (context.current && this.detection === undefined) {
      const { sessionDir, revision } = context;
      this.detection = { sessionDir, event, revision, persistence: "pending", error: undefined };
    }
  }
}

/**
 * Return the external change and affected revision of the newest current-work note correction on
 * the raw `branch` whose cause is curation and whose record `lineage` wrote, or `undefined` without
 * one. A fork ancestor's corrections are excluded: fork inheritance already carries the curation
 * the ancestor recorded.
 */
export function curationCorrectedOn(
  branch: readonly SessionEntry[],
  lineage: PresentationLineage,
): { event: CurationEvent; revision: RevisionPointer } | undefined {
  for (const entry of branch.toReversed()) {
    const record = entry.type === "custom_message" ? presentationEntryOf(entry) : undefined;
    if (
      record?.kind === "correction" &&
      record.component === "work-note" &&
      record.lineage.projectId === lineage.projectId &&
      record.lineage.sessionId === lineage.sessionId &&
      record.cause.kind === "curation"
    ) {
      return { event: record.cause.event, revision: record.affectedRevision };
    }
  }
  return undefined;
}
