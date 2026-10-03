import { isDeepStrictEqual } from "node:util";

import { buildSessionProjection, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, MessageRenderer, SessionEntry } from "@earendil-works/pi-coding-agent";
import type * as Effect from "effect/Effect";

import { presentationMessageType, readPresentationEntry } from "../presentation/entries.ts";
import type {
  DamagedPresentation,
  PresentationEntry,
  PresentationLineage,
} from "../presentation/entries.ts";
import { renderPresentation, summarizePresentation } from "../presentation/render.ts";
import { confirmedInSessionFile } from "./session-file.ts";
import { projectEntriesOf } from "./storage-binding.ts";

/** Describe one presentation message on a branch: its session entry id and validated record. */
export interface BranchPresentation {
  entryId: string;
  entry: PresentationEntry;
}

/**
 * Return the presentation messages of the branch's effective projection in branch order, validated
 * through `readPresentationEntry`, with the damaged and edited ones listed separately.
 *
 * Reads `custom_message` entries whose `customType` is `presentationMessageType` through Pi's
 * `buildSessionProjection`, so the result matches what acting context contains: an entry that a
 * context edit omitted or replaced is listed in `edited` and never counts as presented, and an
 * entry that compaction summarized away is absent. Damaged and edited entries stay in the session
 * file unchanged.
 */
export function presentationsIn(branch: readonly SessionEntry[]): {
  records: BranchPresentation[];
  damaged: DamagedPresentation[];
  edited: string[];
} {
  const records: BranchPresentation[] = [];
  const damaged: DamagedPresentation[] = [];
  const edited: string[] = [];
  for (const { sourceEntry, messages } of buildSessionProjection([...branch]).entries) {
    if (
      sourceEntry.type !== "custom_message" ||
      sourceEntry.customType !== presentationMessageType
    ) {
      continue;
    }
    const [message] = messages;
    if (
      messages.length !== 1 ||
      message?.role !== "custom" ||
      !isDeepStrictEqual(message.content, sourceEntry.content)
    ) {
      edited.push(sourceEntry.id);
      continue;
    }
    const read = readPresentationEntry(sourceEntry.details);
    if (read.kind === "valid") {
      records.push({ entryId: sourceEntry.id, entry: read.entry });
    } else {
      damaged.push({ entryId: sourceEntry.id, path: read.path });
    }
  }
  return { records, damaged, edited };
}

/**
 * Return the validated presentation record of a message or session entry whose `customType` is
 * `presentationMessageType`, or `undefined` for anything else and for damaged details.
 */
export function presentationEntryOf(message: object): PresentationEntry | undefined {
  if (
    !("customType" in message) ||
    message.customType !== presentationMessageType ||
    !("details" in message)
  ) {
    return undefined;
  }
  const read = readPresentationEntry(message.details);
  return read.kind === "valid" ? read.entry : undefined;
}

/**
 * Return the entry ids of the branch's valid presentation messages in branch order, read from the
 * raw branch rather than its projection, so records that compaction summarized away or a context
 * edit replaced are included.
 */
export function rawPresentationIds(branch: readonly SessionEntry[]): string[] {
  return branch.flatMap((entry) => (presentationEntryOf(entry) === undefined ? [] : [entry.id]));
}

/**
 * Return the project of the branch's newest `orbis-tiered-memory-project` entry, which names the
 * project whose presentation records the branch carries, or `undefined` without one.
 */
export function branchProject(branch: readonly SessionEntry[]): string | undefined {
  return projectEntriesOf(branch).at(-1)?.projectId;
}

/**
 * Return the presentation lineage of session `sessionId` that the branch alone establishes while
 * memory storage is not open: its project from `branchProject`, when the raw branch has a valid
 * presentation record of that project; otherwise `undefined`.
 */
export function unopenedLineage(
  branch: readonly SessionEntry[],
  sessionId: string,
): PresentationLineage | undefined {
  const projectId = branchProject(branch);
  const presented = branch.some(
    (entry) => presentationEntryOf(entry)?.lineage.projectId === projectId,
  );
  return projectId !== undefined && presented ? { projectId, sessionId } : undefined;
}

/**
 * Return the presentation identities of the valid presentation records on the raw branch, including
 * records that compaction summarized away or a context edit omitted or replaced.
 */
export function rawRecordIds(branch: readonly SessionEntry[]): Set<string> {
  return new Set(branch.flatMap((entry) => presentationEntryOf(entry)?.id ?? []));
}

/**
 * Return the presentation entry ids among `entryIds` that the session file contains, fsyncing the
 * file before returning a nonempty set; a failed fsync confirms nothing.
 *
 * Uses the read-and-fsync confirmation of `tryConfirmReference`. Returns an empty set while Pi has
 * not created the session file.
 *
 * @throws The original read error other than `ENOENT`.
 */
export function confirmPresentations(
  sessionFile: string | undefined,
  entryIds: readonly string[],
): Effect.Effect<ReadonlySet<string>, unknown> {
  const wanted = new Set(entryIds);
  return confirmedInSessionFile(
    sessionFile,
    (entries) =>
      entries.flatMap((entry) =>
        entry.type === "custom_message" &&
        entry.customType === presentationMessageType &&
        wanted.has(entry.id)
          ? [entry.id]
          : [],
      ),
    "unconfirmed",
  );
}

/**
 * Validate an outgoing record and send it, rendered by `renderPresentation`, as a presentation
 * custom message.
 *
 * Sends with `display: true`, so `presentationMessageRenderer` shows it, `triggerTurn: false`, and
 * no `deliverAs`, so Pi appends it at the branch tail while idle or after the current turn's
 * messages while streaming. A send is not an append: the record counts as presented only after
 * `confirmPresentations` finds it on the selected branch. Never called from
 * `session_before_compact`.
 *
 * @throws Error naming the failing path when the record fails `readPresentationEntry`; nothing is
 *   sent.
 */
export function sendPresentation(
  pi: Pick<ExtensionAPI, "sendMessage">,
  entry: PresentationEntry,
): void {
  const read = readPresentationEntry(entry);
  if (read.kind === "damaged") {
    throw new Error(`Invalid presentation record at ${read.path}; nothing was sent.`);
  }
  pi.sendMessage(
    {
      customType: presentationMessageType,
      content: renderPresentation(read.entry),
      display: true,
      details: read.entry,
    },
    { triggerTurn: false },
  );
}

function visualLines(text: string, width: number): string[] {
  return truncateToVisualLines(text, Number.MAX_SAFE_INTEGER, Math.max(width, 1)).visualLines;
}

/**
 * Render a presentation message in the transcript: one collapsed line naming the record kind,
 * component, revision, and source boundary, which expands to the model-visible text.
 *
 * A message whose details fail validation renders one line saying so. Rendering reads only the
 * message and makes no model call.
 */
export const presentationMessageRenderer: MessageRenderer = (message, options, theme) => {
  const read = readPresentationEntry(message.details);
  const summary =
    read.kind === "valid"
      ? summarizePresentation(read.entry)
      : `Tiered memory: damaged presentation record at ${read.path}`;
  const body = typeof message.content === "string" ? message.content : "";
  return {
    render(width) {
      const [first = ""] = visualLines(summary, width);
      const head = theme.fg("customMessageLabel", first);
      if (!options.expanded || body === "") {
        return [head];
      }
      return [head, ...visualLines(body, width).map((line) => theme.fg("customMessageText", line))];
    },
    invalidate() {
      return undefined;
    },
  };
};
