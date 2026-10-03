import type { SessionBeforeCompactEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

import type { PresentationEntry } from "../presentation/entries.ts";
import { presentationEntryOf } from "./presentation-log.ts";

/**
 * Report which corrections could cover the presented current-work note in a prepared compaction.
 *
 * - `none`: the prepared input carries no presented note record of `projectId`.
 * - `uncorrected`: no current-work note correction follows the newest such record on the branch.
 * - `outside`: corrections follow it, but none is in the prepared input or the retained tail.
 * - `candidates`: the entry ids of corrections that follow it and are in the prepared input or the
 *   retained tail; one of them covers the note once it is confirmed in the session file.
 */
export type NoteCoverage =
  | { kind: "none" }
  | { kind: "uncorrected" }
  | { kind: "outside" }
  | { kind: "candidates"; entryIds: readonly string[] };

function carriesNote(entry: PresentationEntry): boolean {
  if (entry.kind === "reset") {
    return entry.components.some((component) => component.component === "work-note");
  }
  return entry.kind !== "correction" && entry.component === "work-note";
}

function noteCorrection(entry: SessionEntry, projectId: string): boolean {
  const record = entry.type === "custom_message" ? presentationEntryOf(entry) : undefined;
  return (
    record?.kind === "correction" &&
    record.component === "work-note" &&
    record.lineage.projectId === projectId
  );
}

/**
 * Find the corrections that could cover the presented current-work note records in a prepared
 * compaction, reading `event.preparation` and `event.branchEntries` without changing them.
 *
 * A correction covers every earlier note record, so only corrections after the newest note record
 * of `projectId` in `messagesToSummarize` or `turnPrefixMessages` count, and only those in that
 * prepared input or in the retained tail from `firstKeptEntryId` on.
 */
export function noteCoverage(
  event: Pick<SessionBeforeCompactEvent, "preparation" | "branchEntries">,
  projectId: string,
): NoteCoverage {
  const { preparation, branchEntries: branch } = event;
  const prepared = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const preparedIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const message of prepared) {
    const record = presentationEntryOf(message);
    if (record?.lineage.projectId === projectId) {
      preparedIds.add(record.id);
      if (carriesNote(record)) {
        noteIds.add(record.id);
      }
    }
  }
  const newest = branch.findLastIndex(
    (entry) => entry.type === "custom_message" && noteIds.has(presentationEntryOf(entry)?.id ?? ""),
  );
  if (newest === -1) {
    return { kind: "none" };
  }
  const firstKept = branch.findIndex((entry) => entry.id === preparation.firstKeptEntryId);
  const corrections = branch
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index > newest && noteCorrection(entry, projectId));
  if (corrections.length === 0) {
    return { kind: "uncorrected" };
  }
  const entryIds = corrections.flatMap(({ entry, index }) => {
    const id = entry.type === "custom_message" ? presentationEntryOf(entry)?.id : undefined;
    const inInput = id !== undefined && preparedIds.has(id);
    const retained = firstKept !== -1 && index >= firstKept;
    return inInput || retained ? [entry.id] : [];
  });
  return entryIds.length === 0 ? { kind: "outside" } : { kind: "candidates", entryIds };
}
