import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { digestSchema, safeIdSchema } from "../domain/references.ts";
import type { StorageServices } from "../storage/services.ts";
import { SourceRegistry } from "../storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../storage/store.ts";

const projectEntryType = "orbis-tiered-memory-project";

/**
 * Validate the project entry that binds a Pi session to a canonical project root and memory
 * session.
 */
export const projectEntrySchema = Type.Object(
  {
    version: Type.Literal(1),
    root: Type.String({ minLength: 1 }),
    projectId: digestSchema,
    sessionId: safeIdSchema,
  },
  { additionalProperties: false },
);

/** Carry the `orbis-tiered-memory-project` custom entry. */
export type ProjectEntry = Static<typeof projectEntrySchema>;

/** Return the valid project entries on `branch`, in branch order. */
export function projectEntriesOf(branch: readonly SessionEntry[]): ProjectEntry[] {
  return branch.flatMap((entry) =>
    entry.type === "custom" &&
    entry.customType === projectEntryType &&
    Value.Check(projectEntrySchema, entry.data)
      ? [entry.data]
      : [],
  );
}

/**
 * Bind the session's branch to its project, appending a project entry when the branch has none for
 * this root and session.
 *
 * @throws Error when the branch carries a project entry for another root or project, whose memory
 *   must not attach to this session.
 */
export function attachProject(
  pi: Pick<ExtensionAPI, "appendEntry">,
  branch: readonly SessionEntry[],
  store: MemoryStore,
): void {
  const entries = projectEntriesOf(branch);
  if (
    entries.some((entry) => entry.root !== store.projectRoot || entry.projectId !== store.projectId)
  ) {
    throw new Error("Session memory belongs to a different project root.");
  }
  if (!entries.some((entry) => entry.sessionId === store.sessionId)) {
    const entry: ProjectEntry = {
      version: 1,
      root: store.projectRoot,
      projectId: store.projectId,
      sessionId: store.sessionId,
    };
    pi.appendEntry(projectEntryType, entry);
  }
}

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
