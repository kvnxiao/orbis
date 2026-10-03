import type { SourceBoundary, SourceRole } from "../domain/intervals.ts";
import type { RevisionPointer } from "../domain/proposal.ts";
import { estimateTextTokens } from "../domain/tokens.ts";
import type { CorrectionCause, MemoryComponent, PresentationEntry } from "./entries.ts";

const componentTitles = {
  "work-note": "current-work note",
  index: "memory index",
} satisfies Record<MemoryComponent, string>;

const componentNouns = {
  "work-note": "note",
  index: "index",
} satisfies Record<MemoryComponent, string>;

const boundaryRoles = {
  user: "user message",
  assistant: "assistant message",
  toolResult: "tool result",
  bashExecution: "user shell command",
} satisfies Record<SourceRole, string>;

function pointerText(revision: RevisionPointer): string {
  return `revision ${revision.revisionId} of session ${revision.sessionId}`;
}

function readableBoundary(boundary: SourceBoundary): string {
  const recorded =
    boundary.recordedAt === undefined ? "at an unknown time" : `at ${boundary.recordedAt}`;
  return `the ${boundaryRoles[boundary.role]} recorded ${recorded}`;
}

function boundaryText(boundary: SourceBoundary): string {
  return `${readableBoundary(boundary)} (reference ${boundary.reference})`;
}

function precedenceText(component: MemoryComponent): string {
  return `Newer user instructions retained in the conversation take precedence over this ${componentNouns[component]}.`;
}

function componentBlock(component: {
  component: MemoryComponent;
  revision: RevisionPointer;
  sourceBoundary: SourceBoundary;
  body: string;
}): string {
  const title = componentTitles[component.component];
  const body =
    component.body === "" && component.component === "work-note"
      ? "No active work is identified."
      : component.body;
  return [
    `[Tiered memory: ${title}, ${pointerText(component.revision)}]`,
    `Source boundary: this ${componentNouns[component.component]} covers the conversation through ${boundaryText(component.sourceBoundary)}.`,
    `${precedenceText(component.component)} It supersedes every earlier ${title} representation.`,
    "",
    body,
  ].join("\n");
}

/** Render why a correction's component is no longer current, as a clause after "because". */
export function correctionCauseText(cause: CorrectionCause): string {
  if (cause.kind === "curation") {
    return cause.event.kind === "edited"
      ? "its file was edited outside tiered memory"
      : "its file was deleted outside tiered memory";
  }
  if (cause.kind === "fallback") {
    return `native compaction entry ${cause.compactionEntryId} replaced it`;
  }
  return cause.kind === "evidence"
    ? "the evidence it relied on changed"
    : "its freshness could not be verified";
}

/**
 * Render the model-visible text of a presentation record.
 *
 * A component states its component and revision, its source boundary as the role and recorded time
 * of the last source it accounts for with the exact source reference, that newer retained user
 * instructions take precedence, and that it supersedes earlier representations of that component. A
 * reset renders every baseline component the same way. A boundary names the revision label shown
 * with the unchanged body, the newer revision, and its source boundary in the same readable form. A
 * correction names the revision label of the presented body, when one was presented, and the
 * affected revision, states that it and every earlier representation of its component are no longer
 * current, and names the cause. Token estimates are not rendered.
 */
export function renderPresentation(entry: PresentationEntry): string {
  if (entry.kind === "component") {
    return componentBlock(entry);
  }
  if (entry.kind === "boundary") {
    const title = componentTitles[entry.component];
    return `[Tiered memory: ${title} update] The ${title} shown for ${pointerText(entry.bodyRevision)} is unchanged and is current at ${pointerText(entry.revision)}. It now covers the conversation through ${boundaryText(entry.sourceBoundary)}. ${precedenceText(entry.component)}`;
  }
  if (entry.kind === "reset") {
    return [
      "[Tiered memory: presentation reset] Every earlier tiered-memory presentation message is superseded; the current state follows.",
      ...entry.components.map((component) => componentBlock(component)),
    ].join("\n\n");
  }
  const title = componentTitles[entry.component];
  const shown =
    entry.presented === undefined
      ? `The ${title} at ${pointerText(entry.affectedRevision)}`
      : `The ${title} shown for ${pointerText(entry.presented.bodyRevision)}, every update extending it to ${pointerText(entry.affectedRevision)},`;
  return `[Tiered memory: correction] ${shown} and every earlier ${title} representation are no longer current because ${correctionCauseText(entry.cause)}. Do not rely on them as current state.`;
}

/** Estimate the tokens of a record's rendered text with `estimateTextTokens`. */
export function estimatePresentationTokens(entry: PresentationEntry): number {
  return estimateTextTokens(renderPresentation(entry));
}

/**
 * Summarize a presentation record in one line for the collapsed transcript view: the record kind,
 * component, revision, and readable source boundary; the reset's components, the note's readable
 * boundary, and token estimates; or the correction's affected revision and cause.
 */
export function summarizePresentation(entry: PresentationEntry): string {
  if (entry.kind === "reset") {
    const names = entry.components.map((component) => componentTitles[component.component]);
    const kept = names.length === 0 ? "no components" : names.join(" and ");
    const note = entry.components.find((component) => component.component === "work-note");
    const through = note === undefined ? "" : `, through ${readableBoundary(note.sourceBoundary)}`;
    return `Tiered memory reset: ${kept}${through}; estimated ${String(entry.tokensBefore)} to ${String(entry.tokensAfter)} tokens`;
  }
  const title = componentTitles[entry.component];
  if (entry.kind === "correction") {
    return `Tiered memory correction: ${title} at ${pointerText(entry.affectedRevision)} is no longer current because ${correctionCauseText(entry.cause)}`;
  }
  const label = entry.kind === "component" ? title : `${title} update`;
  return `Tiered memory ${label}: ${pointerText(entry.revision)}, through ${readableBoundary(entry.sourceBoundary)}`;
}
