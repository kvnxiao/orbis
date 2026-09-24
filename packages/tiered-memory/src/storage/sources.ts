import { join } from "node:path";

import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { digest } from "../domain/canonical.ts";
import { sourceEvidenceSchema } from "../domain/evidence.ts";
import { digestSchema, encodeReference, safeIdSchema } from "../domain/references.ts";
import { readText } from "./files.ts";
import { parseRecord } from "./records.ts";
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

/**
 * Own a session's source registry.
 *
 * Registration writes `sources.json`; every other member only reads the in-memory copy. Every read
 * and write observes the store's signal.
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
   *   another project or session, or holds a record that fails its cross-field checks; its bytes
   *   are preserved.
   */
  static async open(store: MemoryStore): Promise<SourceRegistry> {
    const path = join(store.sessionDir, "sources.json");
    const text = await readText(path, store.access.signal);
    if (text === undefined) {
      return new SourceRegistry(store, {
        version: 1,
        projectId: store.projectId,
        sessionId: store.sessionId,
        sources: [],
      });
    }
    const registry = parseRecord(registrySchema, text, path);
    const problem = registryProblem(registry, store);
    if (problem !== undefined) {
      throw new Error(`Invalid record at ${path}: ${problem}`);
    }
    return new SourceRegistry(store, registry);
  }

  /** Return a copy of every registered source, including sources no longer on the active branch. */
  get sources(): readonly SourceRecord[] {
    return structuredClone(this.registry.sources);
  }

  /**
   * Register the active branch's message entries and write the registry once.
   *
   * Records one source for each user, assistant, or tool-result message with text, keyed by
   * reference, and keeps earlier records of entries off the branch. `times` supplies event times by
   * entry id; recording time comes only from the entry itself.
   *
   * @throws Error when `manager` belongs to another session or project root, or when tool-call or
   *   tool-result metadata is malformed, before anything is written; the store's `signal.reason`
   *   when it aborts.
   */
  async register(
    manager: SourceSessionManager,
    times: Readonly<Record<string, SourceTime>> = {},
  ): Promise<readonly SourceRecord[]> {
    const store = this.store;
    const signal = store.access.signal;
    signal.throwIfAborted();
    if (manager.getSessionId() !== store.sessionId) {
      throw new Error("Source session identity differs from storage identity.");
    }
    const header = manager.getHeader();
    if (
      header !== null &&
      (header.id !== store.sessionId ||
        (header.cwd !== "" && (await canonicalProjectRoot(header.cwd)) !== store.projectRoot))
    ) {
      throw new Error("Source session belongs to a different project root.");
    }
    signal.throwIfAborted();
    const records = this.recordsFor(manager.getBranch(), times);
    const merged = new Map(this.registry.sources.map((source) => [source.reference, source]));
    for (const record of records) {
      merged.set(record.reference, record);
    }
    const next: Registry = { ...this.registry, sources: [...merged.values()] };
    await store.access.write(join(store.sessionDir, "sources.json"), `${JSON.stringify(next)}\n`);
    signal.throwIfAborted();
    this.registry = next;
    return structuredClone(records);
  }

  private recordsFor(
    branch: SessionEntry[],
    times: Readonly<Record<string, SourceTime>>,
  ): SourceRecord[] {
    const { projectId, sessionId } = this.store;
    const effective = new Map(
      projectAllSources(branch).entries.map((entry) => [entry.sourceEntry.id, entry.messages]),
    );
    const recordedTimes = new Map(
      this.registry.sources.map((source) => [source.entryId, source.time]),
    );
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
      const supplied = times[entry.id] ?? recordedTimes.get(entry.id);
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
          ...(supplied?.eventTime === undefined ? {} : { eventTime: supplied.eventTime }),
          ...(supplied?.timezone === undefined ? {} : { timezone: supplied.timezone }),
        },
      });
    }
    return records;
  }
}
