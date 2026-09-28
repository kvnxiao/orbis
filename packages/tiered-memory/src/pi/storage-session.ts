import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import type { StorageServices } from "../storage/services.ts";
import { SourceRegistry } from "../storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../storage/store.ts";

/** Carry the store and source registry that one storage scope opened. */
export interface StorageSession {
  readonly store: MemoryStore;
  readonly sources: SourceRegistry;
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
