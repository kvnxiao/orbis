import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import type { StorageServices } from "../storage/services.ts";
import { SourceRegistry } from "../storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../storage/store.ts";
import type { StorageScope } from "./execution.ts";
import type { LineageState, Registration } from "./lineage.ts";

/** Carry the store and source registry that one storage scope opened. */
export interface StorageSession {
  readonly store: MemoryStore;
  readonly sources: SourceRegistry;
}

/**
 * Expose the storage state that status reads.
 *
 * `stopped` holds before the first start and after shutdown; `opening` lasts from start until the
 * store and source registry are open; `failed` keeps the error that stopped opening; `open` carries
 * the canonical project root, the lineage state, the head seen by the latest refresh, the counts of
 * the latest registration, and the error of the latest failed refresh.
 */
export type StorageSnapshot =
  | { state: "stopped" }
  | { state: "opening" }
  | { state: "failed"; error: string }
  | {
      state: "open";
      projectRoot: string;
      lineage: LineageState;
      latestRevision: string | null;
      registration: Registration | undefined;
      error: string | undefined;
    };

/** Carry open storage with the scope that owns it and the session it opened. */
export type OpenStorage = Omit<Extract<StorageSnapshot, { state: "open" }>, "projectRoot"> & {
  scope: StorageScope;
  session: StorageSession;
};

/** Carry the runtime's storage state; open storage keeps its scope and session. */
export type StorageState =
  | Extract<StorageSnapshot, { state: "stopped" | "opening" | "failed" }>
  | OpenStorage;

/**
 * Return a copy of `storage` that names the canonical project root instead of the scope and
 * session.
 */
export function storageSnapshot(storage: StorageState): StorageSnapshot {
  if (storage.state !== "open") {
    return structuredClone(storage);
  }
  const { scope: _scope, session, ...state } = storage;
  return structuredClone({ ...state, projectRoot: session.store.projectRoot });
}

/**
 * Open the store and source registry for the context's session under its canonical project root.
 *
 * @throws Error before anything is written when Pi keeps the session in memory without a session
 *   file.
 * @throws The failures of `canonicalProjectRoot`, `MemoryStore.open`, and `SourceRegistry.open`.
 */
export const openStorageSession = Effect.fnUntraced(function* (
  ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
): Effect.fn.Return<StorageSession, unknown, StorageServices> {
  if (ctx.sessionManager.getSessionFile() === undefined) {
    return yield* Effect.fail(
      new Error(
        "Pi keeps this session in memory; tiered memory storage needs a persisted session.",
      ),
    );
  }
  const root = yield* canonicalProjectRoot(ctx.cwd);
  const store = yield* MemoryStore.open(root, ctx.sessionManager.getSessionId());
  const sources = yield* SourceRegistry.open(store);
  return { store, sources };
});
