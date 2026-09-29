import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import type { StorageServices } from "../storage/services.ts";
import { SourceRegistry } from "../storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../storage/store.ts";
import type { StorageScope } from "./execution.ts";
import type { LineageState, Registration, RegistrationUpdate } from "./lineage.ts";

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
 * the canonical project root, the project ID, the lineage state, the head seen by the latest
 * refresh, the source count and event of the registration that refresh used, the curated-note count
 * of the curation it inspected, and the error of the latest failed refresh.
 */
export type StorageSnapshot =
  | { state: "stopped" }
  | { state: "opening" }
  | { state: "failed"; error: string }
  | {
      state: "open";
      projectRoot: string;
      projectId: string;
      lineage: LineageState;
      latestRevision: string | null;
      registration: Registration | undefined;
      error: string | undefined;
    };

/**
 * Carry open storage with the scope that owns it, the session it opened, and the newest completed
 * source registration of that session, which the next refresh uses.
 */
export type OpenStorage = Omit<
  Extract<StorageSnapshot, { state: "open" }>,
  "projectRoot" | "projectId"
> & {
  scope: StorageScope;
  session: StorageSession;
  newestRegistration: RegistrationUpdate;
};

/** Carry the runtime's storage state; open storage keeps its scope and session. */
export type StorageState =
  | Extract<StorageSnapshot, { state: "stopped" | "opening" | "failed" }>
  | OpenStorage;

/**
 * Return a copy of `storage` that names the canonical project root and project ID instead of the
 * scope, session, and newest registration.
 */
export function storageSnapshot(storage: StorageState): StorageSnapshot {
  if (storage.state !== "open") {
    return structuredClone(storage);
  }
  const { scope: _scope, session, newestRegistration: _newest, ...state } = storage;
  const { projectRoot, projectId } = session.store;
  return structuredClone({ ...state, projectRoot, projectId });
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
