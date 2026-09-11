import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

export interface SaveResult {
  saved: boolean;
  deferred?: true;
  message: string;
}

export type SavedRecord =
  | { status: "none" }
  | { status: "record"; entry: SessionEntry }
  | { status: "unreadable"; message: string };

export function readSavedRecord(ctx: ExtensionContext): SavedRecord {
  const path = ctx.sessionManager.getSessionFile();
  if (path === undefined) {
    return { status: "none" };
  }
  let disk: ReturnType<typeof parseSessionEntries>;
  try {
    disk = parseSessionEntries(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { status: "none" };
    }
    return {
      status: "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const entries = new Map(
    disk.filter((entry) => entry.type !== "session").map((entry) => [entry.id, entry]),
  );
  const branch = ctx.sessionManager.getBranch();
  const mismatch = branch.findIndex(
    (entry) => JSON.stringify(entries.get(entry.id)) !== JSON.stringify(entry),
  );
  const prefix = branch.slice(0, mismatch === -1 ? branch.length : mismatch);
  const entry = prefix.findLast(
    (item) => item.type === "custom" && item.customType === "orbis-plan",
  );
  return entry === undefined ? { status: "none" } : { status: "record", entry };
}

export function saveRecord(pi: ExtensionAPI, ctx: ExtensionContext, data: unknown): SaveResult {
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
    persisted = parseSessionEntries(readFileSync(path, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      !branch.some((entry) => entry.type === "message" && entry.message.role === "assistant")
    ) {
      pi.appendEntry("orbis-plan", data);
      return {
        saved: false,
        deferred: true,
        message:
          "Pi has not written its first assistant message. Drafts remain unsaved until that write.",
      };
    }
    return {
      saved: false,
      message: `Cannot read the Pi session file. Correct the storage error and reload Pi before retrying: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const ids = new Set(
    persisted.filter((entry) => entry.type !== "session").map((entry) => entry.id),
  );
  if (branch.some((entry) => !ids.has(entry.id))) {
    return {
      saved: false,
      message:
        "Pi memory differs from its session file. Reload the saved session before retrying; current unsaved changes remain in memory until reload.",
    };
  }
  try {
    pi.appendEntry("orbis-plan", data);
    const leaf = ctx.sessionManager.getLeafId();
    const disk = parseSessionEntries(readFileSync(path, "utf8"));
    const entry = disk.find((item) => item.type !== "session" && item.id === leaf);
    if (
      entry?.type !== "custom" ||
      entry.customType !== "orbis-plan" ||
      JSON.stringify(entry.data) !== JSON.stringify(data)
    ) {
      throw new Error("Appended planning record was not found on disk");
    }
    return { saved: true, message: "Planning state saved." };
  } catch (error) {
    return {
      saved: false,
      message: `Planning state is unsaved. Correct the storage error and reload Pi before retrying: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
