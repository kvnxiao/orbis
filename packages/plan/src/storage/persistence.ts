import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

import { describe, isPlanningError, PlanningError } from "../domain/errors.ts";
import { sameRecord } from "../domain/record-equality.ts";
import type { SessionFile } from "./session-file.ts";

/** Distinguish durable writes from unsaved and deferred first-assistant snapshots. */
export interface SaveResult {
  saved: boolean;
  deferred?: true;
  message: string;
  cause?: unknown;
}

/** Report the last branch-compatible planning entry without modifying the session. */
export type SavedRecord =
  | { status: "none" }
  | { status: "record"; entry: SessionEntry; records: SessionEntry[] }
  | { status: "unreadable"; message: string; cause?: unknown };

/** Recognize operating-system failures without classifying invalid API arguments as storage errors. */
export function isFileError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^E[A-Z]+$/u.test(error.code)
  );
}

/** Preserve save status and its cause when persistence prevents an operation. */
export function saveFailure(result: SaveResult): PlanningError<"persistence"> {
  return new PlanningError("persistence", result.message, {
    cause: result,
    ...(result.deferred === true ? { data: { deferred: true } } : {}),
  });
}

/** Read the last planning record in the matching disk and memory branch prefix. */
export function readSavedRecord(
  ctx: ExtensionContext,
  file?: SessionFile,
  customType = "orbis-plan",
  includeMessages = false,
): SavedRecord {
  const path = ctx.sessionManager.getSessionFile();
  if (path === undefined) {
    return { status: "none" };
  }
  let disk: ReturnType<typeof parseSessionEntries>;
  try {
    disk = file?.read(path) ?? parseSessionEntries(readFileSync(path, "utf8"));
  } catch (error) {
    if (!isFileError(error)) {
      throw error;
    }
    if (error.code === "ENOENT") {
      return { status: "none" };
    }
    return {
      status: "unreadable",
      message: describe(error),
      cause: error,
    };
  }
  const entries = new Map(
    disk.filter((entry) => entry.type !== "session").map((entry) => [entry.id, entry]),
  );
  const branch = ctx.sessionManager.getBranch();
  const mismatch = branch.findIndex((entry) => !sameRecord(entries.get(entry.id), entry));
  const prefix = branch.slice(0, mismatch === -1 ? branch.length : mismatch);
  const records = prefix.filter(
    (item) =>
      (item.type === "custom" || (includeMessages && item.type === "custom_message")) &&
      item.customType === customType,
  );
  const entry = records.at(-1);
  return entry === undefined ? { status: "none" } : { status: "record", entry, records };
}

/** Compare branch records before append and confirm the appended record on disk. */
export function saveRecord(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: unknown,
  file?: SessionFile,
  customType = "orbis-plan",
): SaveResult {
  const path = ctx.sessionManager.getSessionFile();
  if (path === undefined) {
    return {
      saved: false,
      message: "Pi session persistence is disabled. Drafts remain in memory.",
    };
  }
  const branch = ctx.sessionManager.getBranch();
  let persisted;
  try {
    persisted = file?.read(path) ?? parseSessionEntries(readFileSync(path, "utf8"));
  } catch (error) {
    if (!isFileError(error)) {
      throw error;
    }
    if (
      error.code === "ENOENT" &&
      !branch.some((entry) => entry.type === "message" && entry.message.role === "assistant")
    ) {
      pi.appendEntry(customType, data);
      return {
        saved: false,
        deferred: true,
        message:
          "Pi has not written its first assistant message. Drafts remain unsaved until that write.",
      };
    }
    return {
      saved: false,
      message: `Cannot read the Pi session file: ${describe(error)}`,
      cause: error,
    };
  }
  const entries = new Map(
    persisted.filter((entry) => entry.type !== "session").map((entry) => [entry.id, entry]),
  );
  if (branch.some((entry) => !sameRecord(entries.get(entry.id), entry))) {
    return {
      saved: false,
      message: "Pi memory differs from its session file. Current unsaved changes remain in memory.",
    };
  }
  try {
    pi.appendEntry(customType, data);
    const leaf = ctx.sessionManager.getLeafId();
    const disk = file?.read(path) ?? parseSessionEntries(readFileSync(path, "utf8"));
    const confirmed = new Map(
      disk.filter((item) => item.type !== "session").map((item) => [item.id, item]),
    );
    if (ctx.sessionManager.getBranch().some((item) => !sameRecord(confirmed.get(item.id), item))) {
      throw new PlanningError(
        "persistence",
        "Pi memory differs from its session file after append.",
      );
    }
    const entry = leaf === null ? undefined : confirmed.get(leaf);
    if (
      entry?.type !== "custom" ||
      entry.customType !== customType ||
      !sameRecord(entry.data, data)
    ) {
      throw new PlanningError("persistence", "Appended planning record was not found on disk.");
    }
    return { saved: true, message: "Planning state saved." };
  } catch (error) {
    if (!isFileError(error) && !isPlanningError(error)) {
      throw error;
    }
    return {
      saved: false,
      message: `Planning state is unsaved: ${describe(error)}`,
      cause: error,
    };
  }
}
