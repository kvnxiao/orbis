import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

import { digest } from "../src/domain/canonical.ts";
import type {
  CommitResult,
  ConflictReason,
  MemoryProposal,
  RevisionPointer,
} from "../src/domain/proposal.ts";
import { encodeReference } from "../src/domain/references.ts";
import type { ProposalContent } from "../src/pi/lineage.ts";
import { MemoryRuntime } from "../src/pi/runtime.ts";
import type { StorageSnapshot } from "../src/pi/runtime.ts";
import type { CurationState } from "../src/storage/curation.ts";
import { fromPromise, writeDurable } from "../src/storage/files.ts";
import type { Revision } from "../src/storage/revisions.ts";
import type { StorageServices } from "../src/storage/services.ts";
import { SourceRegistry } from "../src/storage/sources.ts";
import type { SourceRecord, SourceSessionManager, SourceTime } from "../src/storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../src/storage/store.ts";
import type { StoreCommitResult } from "../src/storage/store.ts";
import { test as piTest } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import { disposeStorageRuntimes, storageRuntime, testServices } from "./storage-harness.mts";
import type { TestServices, TestWrite } from "./storage-harness.mts";

export const test = piTest.extend("makeRoot", ({ onTestFinished }) => {
  const roots: string[] = [];
  onTestFinished(async () => {
    await disposeStorageRuntimes();
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

/** Expose a store's Effect operations as Promises run in the store's own storage runtime. */
export class TestStore {
  readonly store: MemoryStore;
  private readonly runtime: ManagedRuntime.ManagedRuntime<StorageServices, never>;

  constructor(store: MemoryStore, runtime: ManagedRuntime.ManagedRuntime<StorageServices, never>) {
    this.store = store;
    this.runtime = runtime;
  }

  get projectRoot(): string {
    return this.store.projectRoot;
  }

  get projectId(): string {
    return this.store.projectId;
  }

  get sessionId(): string {
    return this.store.sessionId;
  }

  get baseDir(): string {
    return this.store.baseDir;
  }

  get sessionDir(): string {
    return this.store.sessionDir;
  }

  async run<A>(effect: Effect.Effect<A, unknown, StorageServices>): Promise<A> {
    return await this.runtime.runPromise(effect);
  }

  fork<A>(effect: Effect.Effect<A, unknown, StorageServices>): Fiber.Fiber<A, unknown> {
    return this.runtime.runFork(effect);
  }

  async commit(
    proposal: MemoryProposal,
    options: {
      validate?: () => Promise<ConflictReason | undefined> | ConflictReason | undefined;
      onHeadDurable?: (revisionId: string) => void;
    } = {},
  ): Promise<StoreCommitResult> {
    return await this.run(this.commitEffect(proposal, options));
  }

  commitEffect(
    proposal: MemoryProposal,
    options: {
      validate?: () => Promise<ConflictReason | undefined> | ConflictReason | undefined;
      onHeadDurable?: (revisionId: string) => void;
    } = {},
  ): Effect.Effect<StoreCommitResult, unknown, StorageServices> {
    const validate = options.validate ?? (() => undefined);
    return this.store.commit(proposal, {
      validate: fromPromise(async () => await validate()),
      onHeadDurable: options.onHeadDurable ?? (() => undefined),
    });
  }

  async readRevision(revisionId: string): Promise<Revision | undefined> {
    return await this.run(this.store.readRevision(revisionId));
  }

  async currentHead(): Promise<string | null> {
    return await this.run(this.store.currentHead());
  }

  async inheritRevision(pointer: RevisionPointer): Promise<Revision | undefined> {
    return await this.run(this.store.inheritRevision(pointer));
  }

  async inspectCuration(base: RevisionPointer | null): Promise<CurationState> {
    return await this.run(this.store.inspectCuration(base));
  }

  async lock<A>(run: () => Promise<A>): Promise<A> {
    return await this.run(this.store.locked(fromPromise(run)));
  }
}

/** Expose a source registry's Effect operations as Promises run in its store's runtime. */
export class TestRegistry {
  readonly registry: SourceRegistry;
  private readonly store: TestStore;

  constructor(registry: SourceRegistry, store: TestStore) {
    this.registry = registry;
    this.store = store;
  }

  get sources(): readonly SourceRecord[] {
    return this.registry.sources;
  }

  async register(
    manager: SourceSessionManager,
    times?: Readonly<Record<string, SourceTime>>,
  ): Promise<readonly SourceRecord[]> {
    return await this.store.run(this.registry.register(manager, times));
  }

  async current(manager: SourceSessionManager): Promise<readonly SourceRecord[]> {
    return await this.store.run(this.registry.current(manager));
  }
}

export async function openStore(
  root: string,
  options: { sessionId?: string } & TestServices = {},
): Promise<TestStore> {
  const { sessionId = "session-1", ...services } = options;
  const runtime = storageRuntime(services);
  const canonical = await runtime.runPromise(canonicalProjectRoot(root));
  return new TestStore(await runtime.runPromise(MemoryStore.open(canonical, sessionId)), runtime);
}

export async function openRegistry(store: TestStore): Promise<TestRegistry> {
  return new TestRegistry(await store.run(SourceRegistry.open(store.store)), store);
}

export function interruptingWriter(interruptAt: (path: string, contents: string) => boolean): {
  write: TestWrite;
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

/**
 * Create a runtime over `services` that the fixture shuts down before removing its files.
 *
 * `host` receives the runtime's entry appends; by default they go to the fixture's session.
 */
export function runtimeFor(
  f: Fixture,
  services: TestServices = {},
  host: Pick<ExtensionAPI, "appendEntry"> = {
    appendEntry(type, data) {
      f.session.sessionManager.appendCustomEntry(type, data);
    },
  },
): MemoryRuntime {
  const runtime = new MemoryRuntime(host, testServices(services));
  f.onDispose(async () => {
    await runtime.shutdown();
  });
  return runtime;
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
    projectId: digest(await Effect.runPromise(canonicalProjectRoot(f.cwd))),
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

export async function storeFor(f: Fixture): Promise<TestStore> {
  return await openStore(f.cwd, { sessionId: f.session.sessionManager.getSessionId() });
}
