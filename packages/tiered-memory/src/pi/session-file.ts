import { open } from "node:fs/promises";

import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import { fromPromise, readText } from "../storage/files.ts";

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Return the identifiers `select` picks from the session file's entries, fsyncing the file before
 * returning a nonempty set.
 *
 * Returns an empty set while the session has no file; Pi defers a new session's first write until
 * an assistant message exists. With `syncFailure` `unconfirmed`, a failed fsync confirms nothing;
 * that recovery runs inside the fsync's uninterruptible region, where a pending interruption cannot
 * skip it.
 *
 * @throws The original read error other than `ENOENT`, and with `syncFailure` `fail`, the original
 *   fsync error.
 */
export const confirmedInSessionFile = Effect.fnUntraced(function* (
  sessionFile: string | undefined,
  select: (entries: readonly FileEntry[]) => readonly string[],
  syncFailure: "fail" | "unconfirmed",
): Effect.fn.Return<Set<string>, unknown> {
  const text = sessionFile === undefined ? undefined : yield* readText(sessionFile);
  if (sessionFile === undefined || text === undefined) {
    return new Set();
  }
  const ids = new Set(select(parseSessionEntries(text)));
  if (ids.size === 0) {
    return ids;
  }
  const sync = fromPromise(async () => {
    await syncFile(sessionFile);
  }).pipe(Effect.as(true));
  const synced = yield* Effect.uninterruptible(
    syncFailure === "fail" ? sync : sync.pipe(Effect.catch(() => Effect.succeed(false))),
  );
  return synced ? ids : new Set<string>();
});
