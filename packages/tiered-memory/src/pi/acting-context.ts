import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { suppressedInActingContext } from "../presentation/append-snapshots.ts";
import {
  presentationMessageType,
  readPresentationEntry,
  resetWithOnly,
} from "../presentation/entries.ts";
import type { PresentationEntry } from "../presentation/entries.ts";
import { renderPresentation } from "../presentation/render.ts";
import type { PresentationLog, PresentationView } from "../presentation/types.ts";

/** Name one message of an acting request's transcript. */
export type AgentMessage = ContextEvent["messages"][number];

/**
 * Describe the package-owned presentation one acting request carries, for its capacity check.
 *
 * `mandatory` and `optional` name presentation identities by role; `noteOnly` maps a reset that
 * carries the current note beside the index to its note-only rendering, whose tokens are mandatory
 * while the rest of the reset is optional. `anchorId` is the branch leaf at the snapshot.
 */
export interface RequestState {
  mandatory: Set<string>;
  optional: Set<string>;
  noteOnly: Map<string, PresentationEntry>;
  anchorId: string;
}

function carriesBody(entry: PresentationEntry, bodyId: string): boolean {
  if (entry.kind === "reset") {
    return entry.components.some((component) => component.id === bodyId);
  }
  if (entry.kind === "boundary") {
    return entry.componentId === bodyId;
  }
  return entry.kind === "component" && entry.id === bodyId;
}

function messageOf(entry: PresentationEntry): AgentMessage {
  return {
    role: "custom",
    customType: presentationMessageType,
    content: renderPresentation(entry),
    display: true,
    details: entry,
    timestamp: Date.now(),
  };
}

/**
 * Return a new message that renders `entry` in place of a presentation message, keeping its other
 * fields; any other message is returned unchanged.
 */
export function renderedAs(message: AgentMessage, entry: PresentationEntry): AgentMessage {
  return message.role === "custom"
    ? { ...message, content: renderPresentation(entry), details: entry }
    : message;
}

// Returns the form acting context shows of an accepted, unsuppressed record: without any note
// portion while the note is hidden, a reset without the note portion that a later work-note
// correction invalidated, or `undefined` when nothing remains.
function actingForm(
  entry: PresentationEntry,
  log: PresentationLog,
  hideNote: boolean,
): PresentationEntry | undefined {
  if (entry.kind === "correction") {
    return entry;
  }
  if (entry.kind !== "reset") {
    return hideNote && entry.component === "work-note" ? undefined : entry;
  }
  const position = log.records.findIndex((record) => record.entry.id === entry.id);
  const corrected = log.corrections.some(
    (correction) => correction.component === "work-note" && correction.position > position,
  );
  if (!hideNote && !corrected) {
    return entry;
  }
  const reduced = resetWithOnly(entry, new Set(["index"]));
  if (reduced.components.length === entry.components.length) {
    return entry;
  }
  return reduced.components.length === 0 ? undefined : reduced;
}

/**
 * Build one acting request's transcript from the incoming `messages` and the reconstructed `log`.
 *
 * Drops presentation messages that `suppressedInActingContext` names and every representation of
 * the current-work note while `hideNote` holds, renders a reset without its note portion as a new
 * message when the note is hidden or a later work-note correction invalidated that portion, and
 * appends records still awaiting their append at the tail. User, assistant, and tool messages keep
 * their order and identity, and incoming messages are never mutated.
 *
 * Returns the request's presentation state for its capacity check when `view` presents memory and
 * any presented record remains. Only the record that carries the view's current note body and the
 * newest boundary record for that body are mandatory, and of a reset that also carries the index
 * only its note portion; earlier boundary records for the body are optional.
 */
export function actingContext(
  messages: readonly AgentMessage[],
  log: PresentationLog,
  view: PresentationView,
  hideNote: boolean,
): { messages: AgentMessage[]; request: RequestState | undefined } {
  const visible = messages.flatMap((message) => {
    if (message.role !== "custom" || message.customType !== presentationMessageType) {
      return [message];
    }
    const read = readPresentationEntry(message.details);
    if (read.kind === "damaged" || suppressedInActingContext(read.entry, log)) {
      return [];
    }
    const entry = actingForm(read.entry, log, hideNote);
    if (entry === undefined) {
      return [];
    }
    return [entry === read.entry ? message : renderedAs(message, entry)];
  });
  const tail = log.records.flatMap(({ entry, entryId }) => {
    const pending = entryId === undefined && !suppressedInActingContext(entry, log);
    const rendered = pending ? actingForm(entry, log, hideNote) : undefined;
    return rendered === undefined ? [] : [messageOf(rendered)];
  });
  const note = view.components["work-note"] === undefined ? undefined : log.current["work-note"];
  const newestBoundary = log.records.findLast(
    ({ entry }) =>
      entry.kind === "boundary" &&
      entry.componentId === note?.id &&
      !suppressedInActingContext(entry, log),
  )?.entry.id;
  const request: RequestState = {
    mandatory: new Set(),
    optional: new Set(),
    noteOnly: new Map(),
    anchorId: view.anchorId,
  };
  for (const { entry } of log.records) {
    const shown = suppressedInActingContext(entry, log)
      ? undefined
      : actingForm(entry, log, hideNote);
    if (shown === undefined || shown.kind === "correction") {
      continue;
    }
    if (
      note === undefined ||
      !carriesBody(shown, note.id) ||
      (shown.kind === "boundary" && shown.id !== newestBoundary)
    ) {
      request.optional.add(entry.id);
    } else if (shown.kind === "reset" && shown.components.length > 1) {
      request.noteOnly.set(entry.id, resetWithOnly(shown, new Set(["work-note"])));
    } else {
      request.mandatory.add(entry.id);
    }
  }
  const presented = request.mandatory.size + request.optional.size + request.noteOnly.size;
  return { messages: [...visible, ...tail], request: presented === 0 ? undefined : request };
}
