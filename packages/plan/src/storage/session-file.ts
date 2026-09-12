import { readFileSync } from "node:fs";

import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

/** Reuse parsed prefixes only after rereading and comparing their exact bytes. */
export class SessionFile {
  private path: string | undefined;
  private bytes: Buffer | undefined;
  private entries: ReturnType<typeof parseSessionEntries> = [];

  /** Discard the session-owned cache on branch replacement or shutdown. */
  clear(): void {
    this.path = undefined;
    this.bytes = undefined;
    this.entries = [];
  }

  /** Borrow parsed entries until the next read; callers must not mutate them. */
  read(path: string): ReturnType<typeof parseSessionEntries> {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      this.clear();
      throw error;
    }
    const previous = this.bytes;
    const unchanged =
      this.path === path &&
      previous?.at(-1) === 10 &&
      bytes.length >= previous.length &&
      bytes.subarray(0, previous.length).equals(previous);
    if (unchanged && bytes.length === previous.length) {
      return this.entries;
    }
    const entries = unchanged
      ? [...this.entries, ...parseSessionEntries(bytes.subarray(previous.length).toString("utf8"))]
      : parseSessionEntries(bytes.toString("utf8"));
    const maximumBytes = 2 * 1024 * 1024;
    const maximumEntries = 4096;
    if (bytes.length <= maximumBytes && entries.length <= maximumEntries) {
      this.path = path;
      this.bytes = bytes;
      this.entries = entries;
    } else {
      this.clear();
    }
    return entries;
  }
}
