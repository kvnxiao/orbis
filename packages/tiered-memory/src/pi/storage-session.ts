import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { SourceRegistry } from "../storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../storage/store.ts";

/**
 * Own the storage handles and cancellation of one runtime start.
 *
 * The store and source registry observe `signal`. `stop` aborts it; the runtime then drops the
 * session, so late results cannot reach a replacement.
 */
export class StorageSession {
  readonly store: MemoryStore;
  readonly sources: SourceRegistry;
  private readonly controller: AbortController;

  private constructor(controller: AbortController, store: MemoryStore, sources: SourceRegistry) {
    this.controller = controller;
    this.store = store;
    this.sources = sources;
  }

  /**
   * Open the store and source registry for the context's session under its canonical project root.
   *
   * `controller` is created for this start and owned by the session from then on; aborting it
   * cancels the open.
   *
   * @throws Error before anything is written when Pi keeps the session in memory without a session
   *   file; Error from `canonicalProjectRoot`, `MemoryStore.open`, or `SourceRegistry.open`;
   *   `controller.signal.reason` when it aborts.
   */
  static async open(
    ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
    controller: AbortController,
  ): Promise<StorageSession> {
    const signal = controller.signal;
    signal.throwIfAborted();
    if (ctx.sessionManager.getSessionFile() === undefined) {
      throw new Error(
        "Pi keeps this session in memory; tiered memory storage needs a persisted session.",
      );
    }
    const root = await canonicalProjectRoot(ctx.cwd);
    signal.throwIfAborted();
    const store = await MemoryStore.open(root, ctx.sessionManager.getSessionId(), { signal });
    const sources = await SourceRegistry.open(store);
    return new StorageSession(controller, store, sources);
  }

  /** Return the abort signal every storage operation of this session observes. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Abort this session's storage work; repeated calls keep the first reason. */
  stop(reason: unknown): void {
    this.controller.abort(reason);
  }
}
