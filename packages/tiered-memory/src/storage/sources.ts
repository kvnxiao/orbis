import { join } from "node:path";

import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import { sourceEvidenceSchema } from "../domain/evidence.ts";
import { digestSchema, encodeReference, safeIdSchema } from "../domain/references.ts";
import { readText } from "./files.ts";
import { parseRecord } from "./records.ts";
import { writeRecord } from "./services.ts";
import type { DurableWrites, StorageServices } from "./services.ts";
import { canonicalProjectRoot } from "./store.ts";
import type { MemoryStore } from "./store.ts";

/** Validate supplied or recorded source time; an absent member means unknown and is never invented. */
export const sourceTimeSchema = Type.Object(
  {
    recordedAt: Type.Optional(Type.String()),
    eventTime: Type.Optional(Type.String({ maxLength: 256 })),
    timezone: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);

/**
 * Validate a registered original source: one whole Pi message entry with its raw and effective
 * digests.
 *
 * The registry reader also checks that `reference` encodes this record's own location, that
 * `effectiveDigest` is `null` exactly when `omitted` is true, and that `time.recordedAt` parses as
 * a date.
 */
export const sourceRecordSchema = Type.Object(
  {
    ...sourceEvidenceSchema.properties,
    projectId: digestSchema,
    sessionId: safeIdSchema,
    span: Type.Literal(0),
    order: Type.Integer({ minimum: 0 }),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("toolResult")]),
    time: sourceTimeSchema,
  },
  { additionalProperties: false },
);

/** Validate a session's source registry. */
export const registrySchema = Type.Object(
  {
    version: Type.Literal(1),
    projectId: digestSchema,
    sessionId: safeIdSchema,
    sources: Type.Array(sourceRecordSchema),
  },
  { additionalProperties: false },
);

/** Define the `time` member of one `sources` record in `sessions/<session-id>/sources.json`. */
export type SourceTime = Static<typeof sourceTimeSchema>;
/** Define one `sources` record of `sessions/<session-id>/sources.json`. */
export type SourceRecord = Static<typeof sourceRecordSchema>;
/** Define the `sessions/<session-id>/sources.json` payload. */
export type Registry = Static<typeof registrySchema>;

/** Supply the session-manager members that registration reads. */
export type SourceSessionManager = Pick<
  SessionManager,
  "getSessionId" | "getSessionFile" | "getHeader" | "getBranch"
>;

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

const textBlockSchema = Type.Object({ type: Type.Literal("text"), text: Type.String() });
const toolCallMarkerSchema = Type.Object({ type: Type.Literal("toolCall") });
const toolCallBlockSchema = Type.Object({
  type: Type.Literal("toolCall"),
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});
const toolResultSchema = Type.Object({
  toolCallId: Type.String(),
  toolName: Type.String(),
  isError: Type.Boolean(),
});
const blocksSchema = Type.Array(Type.Unknown());

function textOf(message: MessageEntry["message"]): string {
  const parts: string[] = [];
  if (message.role === "toolResult") {
    if (!Value.Check(toolResultSchema, message)) {
      throw new Error("Invalid tool result source metadata.");
    }
    const { toolCallId, toolName, isError } = message;
    parts.push(`Tool result: ${JSON.stringify({ toolCallId, toolName, isError })}`);
  }
  const content: unknown = "content" in message ? message.content : undefined;
  if (typeof content === "string") {
    parts.push(content);
  } else if (Value.Check(blocksSchema, content)) {
    for (const block of content) {
      if (Value.Check(textBlockSchema, block)) {
        parts.push(block.text);
      } else if (Value.Check(toolCallMarkerSchema, block)) {
        if (!Value.Check(toolCallBlockSchema, block)) {
          throw new Error("Invalid tool call source metadata.");
        }
        const { id, name, arguments: input } = block;
        parts.push(`Tool call: ${JSON.stringify({ id, name, arguments: input })}`);
      }
    }
  }
  return parts.join("\n");
}

function sourceTimestamp(entry: MessageEntry): string | undefined {
  const timestamp: unknown = "timestamp" in entry.message ? entry.message.timestamp : undefined;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  return /^\d{4}-\d\d-\d\dT/u.test(entry.timestamp) ? entry.timestamp : undefined;
}

function projectAllSources(branch: SessionEntry[]): ReturnType<typeof buildSessionProjection> {
  return buildSessionProjection(
    branch.map((entry) =>
      entry.type === "compaction"
        ? {
            type: "custom",
            id: entry.id,
            parentId: entry.parentId,
            timestamp: entry.timestamp,
            customType: "orbis-tiered-memory-projection",
            data: null,
          }
        : entry,
    ),
  );
}

function registryProblem(registry: Registry, store: MemoryStore): string | undefined {
  if (registry.projectId !== store.projectId || registry.sessionId !== store.sessionId) {
    return "/projectId: names another project or session";
  }
  for (const [index, source] of registry.sources.entries()) {
    const location = { projectId: source.projectId, sessionId: source.sessionId };
    if (
      location.projectId !== registry.projectId ||
      location.sessionId !== registry.sessionId ||
      source.reference !== encodeReference({ ...location, entryId: source.entryId, span: 0 })
    ) {
      return `/sources/${String(index)}/reference: does not encode its own location`;
    }
    if (source.omitted !== (source.effectiveDigest === null)) {
      return `/sources/${String(index)}/omitted: disagrees with effectiveDigest`;
    }
    if (source.time.recordedAt !== undefined && Number.isNaN(Date.parse(source.time.recordedAt))) {
      return `/sources/${String(index)}/time/recordedAt: is not a date`;
    }
  }
  return undefined;
}

const readRegistry = Effect.fnUntraced(function* (
  store: MemoryStore,
): Effect.fn.Return<Registry, unknown> {
  const path = join(store.sessionDir, "sources.json");
  const text = yield* readText(path);
  if (text === undefined) {
    return { version: 1, projectId: store.projectId, sessionId: store.sessionId, sources: [] };
  }
  const registry = parseRecord(registrySchema, text, path);
  const problem = registryProblem(registry, store);
  if (problem !== undefined) {
    return yield* Effect.fail(new Error(`Invalid record at ${path}: ${problem}`));
  }
  return registry;
});

/**
 * Own a session's source registry and its in-memory cache.
 *
 * Registration merges under the project lock from a fresh read of `sources.json`; `current`
 * projects the manager's active branch from the cache without writing. The cache changes only after
 * a registration's write succeeds.
 */
export class SourceRegistry {
  private readonly store: MemoryStore;
  private registry: Registry;

  private constructor(store: MemoryStore, registry: Registry) {
    this.store = store;
    this.registry = registry;
  }

  /**
   * Load the registry of the store's session, or start an empty one when none exists.
   *
   * @throws Error naming the path when `sources.json` is not JSON, fails `registrySchema`, names
   *   another project or session, or has a record that fails its cross-field checks; its bytes are
   *   preserved.
   * @throws The original read error other than `ENOENT`.
   */
  static open(store: MemoryStore): Effect.Effect<SourceRegistry, unknown> {
    return readRegistry(store).pipe(Effect.map((registry) => new SourceRegistry(store, registry)));
  }

  /** Return a copy of every registered source, including sources no longer on the active branch. */
  get sources(): readonly SourceRecord[] {
    return structuredClone(this.registry.sources);
  }

  /**
   * Project the active branch's current effective sources without changing the registry.
   *
   * @throws Error when `manager` belongs to another session or project root, or when tool-call or
   *   tool-result metadata is malformed.
   */
  current(manager: SourceSessionManager): Effect.Effect<readonly SourceRecord[], unknown> {
    return this.assertManager(manager).pipe(
      Effect.map(() => this.recordsFor(this.registry, manager.getBranch(), {})),
    );
  }

  /**
   * Register the active branch's message entries under the project lock and return their records.
   *
   * Checks `manager`, then under the lock reads and validates `sources.json` afresh, reads the
   * active branch, projects it with that fresh registry's metadata rather than the cache, writes
   * the merge, and replaces the cache. The merge keeps records of references absent from the
   * branch. For a reference on the branch:
   *
   * - The branch supplies the digests, role, order, and omission state.
   * - `recordedAt` comes only from the transcript entry.
   * - An entry in `times` that has `eventTime` or `timezone` supplies both together, either of which
   *   may be absent; otherwise the fresh registry's pair stays.
   *
   * The lock is not reentrant, so callers do not hold it.
   *
   * `onRegistered` receives a copy of the returned records synchronously in the uninterruptible
   * step that replaces the cache, under the lock, and must not throw:
   *
   * - It runs once per successful write, in write order.
   * - It still runs when an interruption follows the write.
   * - It does not run after a failed write.
   *
   * @throws Error when `manager` belongs to another session or project root, before locking.
   * @throws Error when tool-call or tool-result metadata is malformed, before anything is written.
   * @throws Error naming the path when the fresh `sources.json` is not JSON, fails
   *   `registrySchema`, or fails its cross-field checks; the file and the cache stay unchanged.
   * @throws The original write error, also when an interruption is pending; the cache stays
   *   unchanged. A write that succeeds replaces the cache even when an interruption follows it.
   * @throws The failures of `MemoryStore.locked`, including the busy error.
   */
  register(
    manager: SourceSessionManager,
    times: Readonly<Record<string, SourceTime>> = {},
    onRegistered?: (records: readonly SourceRecord[]) => void,
  ): Effect.Effect<readonly SourceRecord[], unknown, StorageServices> {
    return this.assertManager(manager).pipe(
      Effect.andThen(this.store.locked(this.mergeLocked(manager, times, onRegistered))),
    );
  }

  private readonly mergeLocked = Effect.fnUntraced(function* (
    this: SourceRegistry,
    manager: SourceSessionManager,
    times: Readonly<Record<string, SourceTime>>,
    onRegistered: ((records: readonly SourceRecord[]) => void) | undefined,
  ): Effect.fn.Return<readonly SourceRecord[], unknown, DurableWrites> {
    const fresh = yield* readRegistry(this.store);
    const records = this.recordsFor(fresh, manager.getBranch(), times);
    const merged = new Map(fresh.sources.map((source) => [source.reference, source]));
    for (const record of records) {
      merged.set(record.reference, record);
    }
    const next: Registry = { ...fresh, sources: [...merged.values()] };
    yield* Effect.uninterruptible(
      writeRecord(join(this.store.sessionDir, "sources.json"), next).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            this.registry = next;
            onRegistered?.(structuredClone(records));
          }),
        ),
      ),
    );
    return structuredClone(records);
  });

  private readonly assertManager = Effect.fnUntraced(function* (
    this: SourceRegistry,
    manager: SourceSessionManager,
  ): Effect.fn.Return<void, unknown> {
    const store = this.store;
    if (manager.getSessionId() !== store.sessionId) {
      yield* Effect.fail(new Error("Source session identity differs from storage identity."));
      return;
    }
    const header = manager.getHeader();
    if (
      header !== null &&
      (header.id !== store.sessionId ||
        (header.cwd !== "" && (yield* canonicalProjectRoot(header.cwd)) !== store.projectRoot))
    ) {
      yield* Effect.fail(new Error("Source session belongs to a different project root."));
    }
  });

  private recordsFor(
    registry: Registry,
    branch: SessionEntry[],
    times: Readonly<Record<string, SourceTime>>,
  ): SourceRecord[] {
    const { projectId, sessionId } = this.store;
    const effective = new Map(
      projectAllSources(branch).entries.map((entry) => [entry.sourceEntry.id, entry.messages]),
    );
    const recordedTimes = new Map(registry.sources.map((source) => [source.entryId, source.time]));
    const records: SourceRecord[] = [];
    for (const [order, entry] of branch.entries()) {
      if (entry.type !== "message") {
        continue;
      }
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant" && role !== "toolResult") {
        continue;
      }
      const rawText = textOf(entry.message);
      if (rawText === "") {
        continue;
      }
      const messages = effective.get(entry.id) ?? [];
      const effectiveText = messages
        .map((message) => textOf(message))
        .filter((text) => text !== "")
        .join("\n");
      const supplied = times[entry.id];
      const context =
        supplied?.eventTime !== undefined || supplied?.timezone !== undefined
          ? supplied
          : recordedTimes.get(entry.id);
      const recordedAt = sourceTimestamp(entry);
      records.push({
        reference: encodeReference({ projectId, sessionId, entryId: entry.id, span: 0 }),
        entryId: entry.id,
        rawDigest: digest(rawText),
        effectiveDigest: messages.length === 0 ? null : digest(effectiveText),
        omitted: messages.length === 0,
        projectId,
        sessionId,
        span: 0,
        order,
        role,
        time: {
          ...(recordedAt === undefined ? {} : { recordedAt }),
          ...(context?.eventTime === undefined ? {} : { eventTime: context.eventTime }),
          ...(context?.timezone === undefined ? {} : { timezone: context.timezone }),
        },
      });
    }
    return records;
  }
}
