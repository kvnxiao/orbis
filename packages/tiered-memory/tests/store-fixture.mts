import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

import { digest } from "../src/domain/canonical.ts";
import type { CommitResult, MemoryProposal } from "../src/domain/proposal.ts";
import { encodeReference } from "../src/domain/references.ts";
import type { ProposalContent } from "../src/pi/lineage.ts";
import { MemoryRuntime } from "../src/pi/runtime.ts";
import type { StorageSnapshot } from "../src/pi/runtime.ts";
import { writeDurable } from "../src/storage/files.ts";
import type { DurableWriter } from "../src/storage/files.ts";
import { canonicalProjectRoot, MemoryStore } from "../src/storage/store.ts";
import { test as piTest } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";

export const test = piTest.extend("makeRoot", ({ onTestFinished }) => {
  const roots: string[] = [];
  onTestFinished(async () => {
    await Promise.all(
      roots.map(async (root) => {
        await rm(root, { recursive: true, force: true });
      }),
    );
  });
  return async (prefix = "orbis-tiered-memory-store-"): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  };
});

export const zeroUsage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const evidenceFingerprint = "e".repeat(64);
export const configurationFingerprint = "c".repeat(64);

export function baseProposal(
  store: Pick<MemoryStore, "sessionId" | "projectId">,
  overrides: Partial<MemoryProposal> = {},
): MemoryProposal {
  return {
    sessionId: store.sessionId,
    projectId: store.projectId,
    anchorId: "source-1",
    sourceIds: ["source-1"],
    evidenceFingerprint,
    dependencyFingerprint: configurationFingerprint,
    configurationRevision: 1,
    expectedRevision: null,
    baseRevision: null,
    notes: { "current-work.md": "generated\n" },
    noteDependencies: {},
    consumedObservationIds: [],
    learnings: {},
    expectedLearnings: {},
    excludedInheritedNotes: [],
    ...overrides,
  };
}

export async function openStore(
  root: string,
  options: { sessionId?: string; write?: DurableWriter; signal?: AbortSignal } = {},
): Promise<MemoryStore> {
  return await MemoryStore.open(
    await canonicalProjectRoot(root),
    options.sessionId ?? "session-1",
    {
      signal: options.signal ?? new AbortController().signal,
      ...(options.write === undefined ? {} : { write: options.write }),
    },
  );
}

export function interruptingWriter(interruptAt: (path: string, contents: string) => boolean): {
  write: DurableWriter;
  writes: string[];
} {
  const writes: string[] = [];
  return {
    writes,
    async write(path, contents) {
      if (interruptAt(path, contents)) {
        throw new Error(`Injected interruption before writing ${path}.`);
      }
      writes.push(path);
      await writeDurable(path, contents);
    },
  };
}

export function rejectionPaths(schema: TSchema, value: unknown): string[] {
  return Value.Errors(schema, value).flatMap((error) => {
    const path = error.instancePath.length === 0 ? "/" : error.instancePath;
    return error.keyword === "required"
      ? error.params.requiredProperties.map((property) => `${path === "/" ? "" : path}/${property}`)
      : [path];
  });
}

export function runtimeFor(f: Fixture): MemoryRuntime {
  const manager = f.session.sessionManager;
  return new MemoryRuntime({
    appendEntry(type, data) {
      manager.appendCustomEntry(type, data);
    },
  });
}

export function sourceEntry(f: Fixture, text: string): SessionEntry {
  const entry = f.session.sessionManager
    .getBranch()
    .find(
      (item) =>
        item.type === "message" &&
        item.message.role === "user" &&
        (item.message.content === text ||
          (Array.isArray(item.message.content) &&
            item.message.content.some((block) => block.type === "text" && block.text === text))),
    );
  if (entry === undefined) {
    throw new Error(`Missing user source: ${text}`);
  }
  return entry;
}

export async function sourceReference(f: Fixture, text: string): Promise<string> {
  return encodeReference({
    projectId: digest(await canonicalProjectRoot(f.cwd)),
    sessionId: f.session.sessionManager.getSessionId(),
    entryId: sourceEntry(f, text).id,
    span: 0,
  });
}

export async function forkOnDisk(
  parent: Fixture,
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
): Promise<Fixture> {
  const parentFile = parent.session.sessionManager.getSessionFile();
  if (parentFile === undefined) {
    throw new Error("Missing parent session file.");
  }
  const fork = SessionManager.forkFrom(parentFile, parent.cwd, join(parent.cwd, "sessions"));
  const sessionFile = fork.getSessionFile();
  if (sessionFile === undefined) {
    throw new Error("Missing fork session file.");
  }
  return await createFixture({ cwd: parent.cwd, sessionFile });
}

export async function findSessionFileEntry<T extends TSchema>(
  sessionFile: string,
  customType: string,
  schema: T,
): Promise<{ id: string; data: Static<T> } | undefined> {
  const entries = parseSessionEntries(await readFile(sessionFile, "utf8"));
  const entry = entries.findLast(
    (candidate) => candidate.type === "custom" && candidate.customType === customType,
  );
  if (entry?.type !== "custom" || !Value.Check(schema, entry.data)) {
    return undefined;
  }
  return { id: entry.id, data: entry.data };
}

export function committedId(result: CommitResult): string {
  if (result.kind !== "committed") {
    throw new Error(`Expected a committed revision, received ${result.kind}.`);
  }
  return result.revisionId;
}

export function noteContent(notes: Record<string, string>): ProposalContent {
  return { notes, consumedObservationIds: [], learnings: {}, expectedLearnings: {} };
}

export function storageOf(runtime: MemoryRuntime): Extract<StorageSnapshot, { state: "open" }> {
  const storage = runtime.snapshot.storage;
  if (storage.state !== "open") {
    throw new Error(
      `Expected open storage, received ${storage.state}${storage.state === "failed" ? `: ${storage.error}` : ""}.`,
    );
  }
  return storage;
}

export async function storeFor(f: Fixture): Promise<MemoryStore> {
  return await openStore(f.cwd, { sessionId: f.session.sessionManager.getSessionId() });
}
