import { link, mkdir, open as openFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect, vi } from "vitest";

import type { CommitResult, MemoryProposal } from "../src/domain/proposal.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { fromPromise, writeDurable } from "../src/storage/files.ts";
import { LockFilesystem, ProcessLiveness } from "../src/storage/services.ts";
import { SourceRegistry } from "../src/storage/sources.ts";
import type { Fixture } from "./pi-fixture.mts";
import { afterWrite } from "./storage-harness.mts";
import type { TestServices, TestWrite } from "./storage-harness.mts";
import {
  committedId,
  noteContent,
  openRegistry,
  openStore,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  test,
} from "./store-fixture.mts";

function contextOf(f: Fixture) {
  return f.session.extensionRunner.createContext();
}

test("a committed revision survives disk resume and ordinary appended turns", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Remember the blue setting.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Blue\n" }), [
    await sourceReference(f, "Remember the blue setting."),
  ]);
  await f.session.prompt("A later turn leaves that setting unchanged.");
  const committed = committedId(await runtime.commitProposal(ctx, proposal));
  expect(storageOf(runtime).lineage.selected).toMatchObject({ revisionId: committed });
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain(`Selected memory revision: ${committed}`);
});

test("an in-memory session reports why storage is unavailable and writes no storage records", async ({
  createFixture,
}) => {
  const f = await createFixture({ inMemory: true });
  await f.session.prompt("An in-memory turn.");
  await f.command("status");
  expect(f.report()).toContain("Memory storage: unavailable");
  expect(f.report()).toContain(
    "Storage error: Pi keeps this session in memory; tiered memory storage needs a persisted session.",
  );
  await expect(readdir(join(f.cwd, ".pi", "tiered-memory", "sessions"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("a project-root failure during tree navigation leaves storage failed with its reason", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = { ...contextOf(f), cwd: join(f.cwd, "invalid\0root") };
  await runtime.selectBranch(ctx);
  const storage = runtime.snapshot.storage;
  expect(storage).toMatchObject({ state: "failed" });
  expect(storage.state === "failed" ? storage.error : "").toContain("null bytes");
});

test("a disable while start loads settings still opens storage", async ({ createFixture }) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const starting = runtime.start(contextOf(f));
  runtime.disable();
  await starting;
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_start" });
});

test("a failed confirmation after commit keeps the reference appended for the refresh to confirm", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Confirmed after a failed read.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Confirmed after a failed read."),
  ]);
  const sessionFile = vi.spyOn(ctx.sessionManager, "getSessionFile").mockReturnValueOnce(f.cwd);
  onTestFinished(() => {
    sessionFile.mockRestore();
  });
  const committed = committedId(await runtime.commitProposal(ctx, proposal));
  expect(sessionFile).toHaveBeenCalled();
  expect(storageOf(runtime).lineage).toMatchObject({
    selected: { state: "selected", revisionId: committed, invalidNotes: [] },
    pending: { state: "none" },
  });
});

test("two concurrent starts leave one open storage session and one project entry", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await Promise.all([runtime.start(ctx), runtime.start(ctx)]);
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_start" });
  expect(
    f.session.sessionManager
      .getEntries()
      .filter(
        (entry) => entry.type === "custom" && entry.customType === "orbis-tiered-memory-project",
      ),
  ).toHaveLength(1);
});

test("a replacement during storage open closes the old scope first and the old result does not reach the replacement", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const original = SourceRegistry.open.bind(SourceRegistry);
  const open = vi.spyOn(SourceRegistry, "open").mockImplementationOnce((store) =>
    fromPromise(async () => {
      entered.resolve(undefined);
      await gate.promise;
    }).pipe(Effect.andThen(original(store))),
  );
  onTestFinished(() => {
    open.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  await runtime.start(ctx);
  const replacement = runtime.snapshot;
  gate.resolve(undefined);
  await late;
  expect(runtime.snapshot).toEqual(replacement);
  expect(replacement.storage.state).toBe("open");
});

test("a late storage startup failure cannot clear replacement storage", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<SourceRegistry>();
  const open = vi.spyOn(SourceRegistry, "open").mockImplementationOnce(() =>
    fromPromise(async () => {
      entered.resolve(undefined);
      return await gate.promise;
    }),
  );
  onTestFinished(() => {
    open.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  await runtime.start(ctx);
  const replacement = runtime.snapshot;
  gate.reject(new Error("Old startup failed."));
  await late;
  expect(runtime.snapshot).toEqual(replacement);
});

test("a late source registration cannot change a replacement runtime", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Initial source.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<readonly []>();
  const register = vi.spyOn(SourceRegistry.prototype, "register").mockImplementationOnce(() =>
    fromPromise(async () => {
      entered.resolve(undefined);
      return await gate.promise;
    }),
  );
  onTestFinished(() => {
    register.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  await runtime.start(ctx);
  const replacement = runtime.snapshot;
  gate.resolve([]);
  await late;
  expect(runtime.snapshot).toEqual(replacement);
  expect(storageOf(runtime).registration?.sources).toBeGreaterThan(0);
});

test("a proposal whose host signal aborted before a replacement's commit returns cancelled with that reason and writes no head", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Replace this session before committing.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Too late\n" }), [
    await sourceReference(f, "Replace this session before committing."),
  ]);
  const controller = new AbortController();
  const reason = new Error("tool call cancelled before the replacement");
  controller.abort(reason);
  await runtime.start(ctx);
  expect(await runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal)).toEqual({
    kind: "cancelled",
    reason,
  });
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});

test("session_start and session_tree register sources and label the cached counts with their event", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("A registered source.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  expect(storageOf(runtime).registration).toEqual({
    sources: 2,
    curatedNotes: 0,
    event: "session_start",
  });
  await runtime.selectBranch(ctx);
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_tree" });
});

test("commit registration labels the cached counts with commit", async ({ createFixture }) => {
  const f = await createFixture();
  await f.session.prompt("Committed source.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Note\n" }), [
        await sourceReference(f, "Committed source."),
      ]),
    ),
  );
  expect(storageOf(runtime).registration).toMatchObject({ event: "commit" });
});

async function rivalRuntimes(
  f: Fixture,
  text: string,
  services: TestServices = {},
): Promise<{
  first: MemoryRuntime;
  second: MemoryRuntime;
  ctx: ExtensionContext;
  stale: MemoryProposal;
  winner: string;
}> {
  await f.session.prompt(text);
  const sessionFile = f.session.sessionManager.getSessionFile();
  if (sessionFile === undefined) {
    throw new Error("Missing session file.");
  }
  const manager = SessionManager.open(sessionFile, dirname(sessionFile), f.cwd);
  const first = runtimeFor(f);
  const second = runtimeFor(f, services, {
    appendEntry(type, data) {
      manager.appendCustomEntry(type, data);
    },
  });
  const firstCtx = contextOf(f);
  const ctx = { ...firstCtx, sessionManager: manager };
  await first.start(firstCtx);
  await second.start(ctx);
  const stale = second.captureProposal(ctx, noteContent({ "current-work.md": "Second\n" }), [
    await sourceReference(f, text),
  ]);
  const winner = committedId(
    await first.commitProposal(
      firstCtx,
      first.captureProposal(firstCtx, noteContent({ "current-work.md": "First\n" }), [
        await sourceReference(f, text),
      ]),
    ),
  );
  return { first, second, ctx, stale, winner };
}

function headConflict(winner: string): CommitResult {
  return { kind: "conflict", expectedRevision: null, actualRevision: winner, reason: "head" };
}

test("a head conflict refreshes the losing runtime's head and registration so its next proposal commits", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { second, ctx, stale, winner } = await rivalRuntimes(f, "Rival sessions.");
  expect(await second.commitProposal(ctx, stale)).toEqual(headConflict(winner));
  expect(storageOf(second)).toMatchObject({
    latestRevision: winner,
    registration: { event: "commit" },
    error: undefined,
  });
  const fresh = second.captureProposal(ctx, noteContent({ "current-work.md": "Second\n" }), [
    await sourceReference(f, "Rival sessions."),
  ]);
  expect(fresh.expectedRevision).toBe(winner);
  expect((await second.commitProposal(ctx, fresh)).kind).toBe("committed");
});

test("a failed refresh after a head conflict records the storage error and still returns the conflict", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const armed = { value: false };
  const { second, ctx, stale, winner } = await rivalRuntimes(f, "Rival refresh failure.", {
    write: async (path, contents) => {
      if (armed.value && path.endsWith("curation.json")) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      await writeDurable(path, contents);
    },
  });
  await writeFile(join((await storeFor(f)).sessionDir, "current", "current-work.md"), "Edited\n");
  armed.value = true;
  expect(await second.commitProposal(ctx, stale)).toEqual(headConflict(winner));
  expect(storageOf(second)).toMatchObject({
    latestRevision: null,
    registration: { event: "session_start" },
    error: "EACCES: permission denied",
  });
});

async function gatedConflictRefresh(
  f: Fixture,
  text: string,
): Promise<{
  second: MemoryRuntime;
  ctx: ExtensionContext;
  winner: string;
  pending: Promise<CommitResult>;
  release: () => void;
}> {
  const armed = { value: false };
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const { second, ctx, stale, winner } = await rivalRuntimes(f, text, {
    write: async (path, contents) => {
      if (armed.value && path.endsWith("curation.json")) {
        armed.value = false;
        entered.resolve(undefined);
        await gate.promise;
      }
      await writeDurable(path, contents);
    },
  });
  await writeFile(join((await storeFor(f)).sessionDir, "current", "current-work.md"), "Edited\n");
  armed.value = true;
  const pending = second.commitProposal(ctx, stale);
  await entered.promise;
  return {
    second,
    ctx,
    winner,
    pending,
    release: () => {
      gate.resolve(undefined);
    },
  };
}

test("a disable during the refresh after a head conflict lets the refresh apply", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { second, winner, pending, release } = await gatedConflictRefresh(f, "Disable refresh.");
  second.disable();
  release();
  expect(await pending).toEqual(headConflict(winner));
  expect(second.enabled).toBe(false);
  expect(storageOf(second)).toMatchObject({
    latestRevision: winner,
    registration: { event: "commit" },
    error: undefined,
  });
});

test("a replacement during the refresh after a head conflict discards the refresh and keeps the replacement's registration", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { second, ctx, winner, pending, release } = await gatedConflictRefresh(
    f,
    "Replace refresh.",
  );
  const replacing = second.selectBranch(ctx);
  release();
  expect(await pending).toEqual(headConflict(winner));
  await replacing;
  expect(storageOf(second)).toMatchObject({
    latestRevision: winner,
    registration: { event: "session_tree" },
    error: undefined,
  });
});

test("a shutdown during the refresh after a head conflict discards the refresh and returns the conflict", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { second, winner, pending, release } = await gatedConflictRefresh(f, "Shutdown refresh.");
  const stopping = second.shutdown();
  release();
  expect(await pending).toEqual(headConflict(winner));
  await stopping;
  expect(second.snapshot.storage).toEqual({ state: "stopped" });
});

test("a curation conflict refresh reports the curated note of the selected revision as invalid", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Curated after commit.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const source = await sourceReference(f, "Curated after commit.");
  const selected = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "One\n" }), [source]),
    ),
  );
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Two\n" }), [
    source,
  ]);
  await writeFile(join((await storeFor(f)).sessionDir, "current", "current-work.md"), "Edited\n");
  expect(storageOf(runtime).lineage.selected).toMatchObject({ invalidNotes: [] });
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({
    kind: "conflict",
    reason: "curation",
  });
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    state: "selected",
    revisionId: selected,
    invalidNotes: ["current-work.md"],
  });
});

interface LockWait {
  runtime: MemoryRuntime;
  before: ReturnType<typeof storageOf>;
  result: CommitResult;
}

async function cancelInLockWait(
  f: Fixture,
  text: string,
  after: "start" | "registration",
  cancel: (runtime: MemoryRuntime, controller: AbortController) => void,
): Promise<LockWait> {
  await f.session.prompt(text);
  const holder = { published: false, armed: false, waiting: false };
  const published = Promise.withResolvers<undefined>();
  const waiting = Promise.withResolvers<undefined>();
  const held = Promise.withResolvers<undefined>();
  const store = await openStore(f.cwd, {
    sessionId: f.session.sessionManager.getSessionId(),
    lock: {
      publish: async (source, ticket) => {
        await link(source, ticket);
        if (holder.armed) {
          published.resolve(undefined);
        }
      },
    },
  });
  let holding: Promise<void> | undefined;
  const hold = async (): Promise<void> => {
    holder.armed = true;
    holding = store.lock(async () => {
      await held.promise;
    });
    await published.promise;
    holder.waiting = true;
  };
  const stage = { registering: false };
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      await writeDurable(path, contents);
      if (stage.registering && path.endsWith("sources.json")) {
        stage.registering = false;
        await hold();
      }
    },
    lock: {
      readTicket: async (path) => {
        const ticket = await Effect.runPromise(LockFilesystem.live.readTicket(path));
        if (holder.waiting) {
          waiting.resolve(undefined);
        }
        return ticket;
      },
    },
  });
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, text),
  ]);
  const before = storageOf(runtime);
  if (after === "start") {
    await hold();
  } else {
    stage.registering = true;
  }
  const controller = new AbortController();
  const pending = runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal);
  await waiting.promise;
  cancel(runtime, controller);
  held.resolve(undefined);
  const result = await pending;
  await holding;
  return { runtime, before, result };
}

test("a host abort while the commit waits for the lock after registration returns cancelled and refreshes the registration counts", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const reason = new Error("tool call cancelled during the lock wait");
  const { runtime, before, result } = await cancelInLockWait(
    f,
    "Abort in lock wait.",
    "registration",
    (_runtime, controller) => {
      controller.abort(reason);
    },
  );
  expect(result).toEqual({ kind: "cancelled", reason });
  expect(before.registration).toMatchObject({ event: "session_start" });
  expect(storageOf(runtime)).toMatchObject({
    latestRevision: null,
    registration: { sources: 2, curatedNotes: 0, event: "commit" },
    error: undefined,
  });
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});

test("a disable while the commit waits for the lock after registration returns cancelled and refreshes the registration counts", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, result } = await cancelInLockWait(
    f,
    "Disable in lock wait.",
    "registration",
    (current) => {
      current.disable();
    },
  );
  expect(result).toMatchObject({
    kind: "cancelled",
    reason: { message: "Tiered memory is disabled." },
  });
  expect(storageOf(runtime).registration).toMatchObject({ event: "commit" });
});

test("a refresh that adopts a concurrent commit's head leaves that commit one reference entry", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Adopted head.");
  const phase = { value: "idle" };
  const cancelledPublish = {
    entered: Promise.withResolvers<undefined>(),
    gate: Promise.withResolvers<undefined>(),
  };
  const revisionWrite = {
    entered: Promise.withResolvers<undefined>(),
    gate: Promise.withResolvers<undefined>(),
  };
  const commitWaiting = Promise.withResolvers<undefined>();
  const refreshWaiting = Promise.withResolvers<undefined>();
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (phase.value === "committing" && path.includes(`${sep}revisions${sep}`)) {
        phase.value = "revision held";
        revisionWrite.entered.resolve(undefined);
        await revisionWrite.gate.promise;
      }
      await writeDurable(path, contents);
      if (phase.value === "registering" && path.endsWith("sources.json")) {
        phase.value = "registered";
      }
    },
    lock: {
      publish: async (source, ticket) => {
        if (phase.value === "registered") {
          phase.value = "publish held";
          cancelledPublish.entered.resolve(undefined);
          await cancelledPublish.gate.promise;
        }
        await link(source, ticket);
      },
      readTicket: async (path) => {
        const ticket = await Effect.runPromise(LockFilesystem.live.readTicket(path));
        if (phase.value === "publish released") {
          phase.value = "commit waiting";
          commitWaiting.resolve(undefined);
        } else if (phase.value === "aborted") {
          phase.value = "refresh waiting";
          refreshWaiting.resolve(undefined);
        }
        return ticket;
      },
    },
  });
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const source = await sourceReference(f, "Adopted head.");
  const cancelling = runtime.captureProposal(ctx, noteContent({ "journey.md": "Zero\n" }), [
    source,
  ]);
  const winning = runtime.captureProposal(ctx, noteContent({ "current-work.md": "One\n" }), [
    source,
  ]);
  const controller = new AbortController();
  phase.value = "registering";
  const cancelled = runtime.commitProposal({ ...ctx, signal: controller.signal }, cancelling);
  await cancelledPublish.entered.promise;
  phase.value = "committing";
  const committed = runtime.commitProposal(ctx, winning);
  await revisionWrite.entered.promise;
  phase.value = "publish released";
  cancelledPublish.gate.resolve(undefined);
  await commitWaiting.promise;
  phase.value = "aborted";
  controller.abort(new Error("cancelled behind the winning commit"));
  await refreshWaiting.promise;
  phase.value = "done";
  revisionWrite.gate.resolve(undefined);
  const winner = committedId(await committed);
  expect(await cancelled).toMatchObject({ kind: "cancelled" });
  expect(
    f.session.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === "custom" && entry.customType === "orbis-tiered-memory-revision"
          ? [entry.data]
          : [],
      ),
  ).toEqual([expect.objectContaining({ revisionId: winner })]);
  expect(storageOf(runtime).lineage).toMatchObject({
    selected: { state: "selected", revisionId: winner },
    pending: { state: "none" },
  });
});

test("a host abort while registration waits for the lock returns cancelled and leaves the registration counts", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const reason = new Error("tool call cancelled before registration");
  const { runtime, before, result } = await cancelInLockWait(
    f,
    "Abort before registration.",
    "start",
    (_runtime, controller) => {
      controller.abort(reason);
    },
  );
  expect(result).toEqual({ kind: "cancelled", reason });
  expect(storageOf(runtime).registration).toEqual(before.registration);
});

test("context and agent_end events do not register sources", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const register = vi.spyOn(SourceRegistry.prototype, "register");
  onTestFinished(() => {
    register.mockRestore();
  });
  await f.session.prompt("A turn with context and agent_end events.");
  expect(register).not.toHaveBeenCalled();
});

test("status writes no storage files and reports the cached counts", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Status source.");
  await f.reload();
  const store = await storeFor(f);
  const sources = join(store.sessionDir, "sources.json");
  const before = await readFile(sources, "utf8");
  const register = vi.spyOn(SourceRegistry.prototype, "register");
  onTestFinished(() => {
    register.mockRestore();
  });
  await f.command("status");
  await f.command("status");
  expect(register).not.toHaveBeenCalled();
  expect(await readFile(sources, "utf8")).toBe(before);
  expect(f.report()).toContain("Registered original sources: 2 (session_start)");
  expect(f.report()).toContain("Curated session notes: 0 (session_start)");
});

test("a storage failure leaves configuration and model status available", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const sessionDir = join(
    f.cwd,
    ".pi",
    "tiered-memory",
    "sessions",
    f.session.sessionManager.getSessionId(),
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "identity.json"), "damaged identity");
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("Memory storage: unavailable");
  expect(f.report()).toContain(
    `Storage error: Invalid JSON at ${join(sessionDir, "identity.json")}.`,
  );
  expect(f.report()).toContain("limits.queuedJobs: 8 (default)");
});

function revisionReferences(f: Fixture): number {
  return f.session.sessionManager
    .getEntries()
    .filter(
      (entry) => entry.type === "custom" && entry.customType === "orbis-tiered-memory-revision",
    ).length;
}

async function committing(
  f: Fixture,
  text: string,
  hook: (runtime: () => MemoryRuntime) => TestWrite,
): Promise<{
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  proposal: MemoryProposal;
}> {
  await f.session.prompt(text);
  const runtime: MemoryRuntime = runtimeFor(f, { write: hook(() => runtime) });
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, text),
  ]);
  return { runtime, ctx, proposal };
}

const headWrite = (path: string): boolean => path.endsWith("head.json");
const revisionWrite = (path: string): boolean => path.includes(`${sep}revisions${sep}`);

test("a host abort after the head write reports committed, finishes the views, and applies lineage while storage stays current", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const controller = new AbortController();
  const armed = { value: false };
  const { runtime, ctx, proposal } = await committing(f, "Abort after head.", () =>
    afterWrite(
      (path) => armed.value && headWrite(path),
      () => {
        controller.abort(new Error("tool call cancelled after the head"));
      },
    ),
  );
  armed.value = true;
  const revisionId = committedId(
    await runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal),
  );
  const store = await storeFor(f);
  expect(await store.currentHead()).toBe(revisionId);
  expect(await readFile(join(store.sessionDir, "current", "current-work.md"), "utf8")).toBe(
    "Kept\n",
  );
  expect(storageOf(runtime).lineage.selected).toMatchObject({ state: "selected", revisionId });
  expect(revisionReferences(f)).toBe(1);
});

test("a disable after the head write reports committed and still applies lineage", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const armed = { value: false };
  const { runtime, ctx, proposal } = await committing(f, "Disable after head.", (current) =>
    afterWrite(
      (path) => armed.value && headWrite(path),
      () => {
        current().disable();
      },
    ),
  );
  armed.value = true;
  const revisionId = committedId(await runtime.commitProposal(ctx, proposal));
  expect(runtime.enabled).toBe(false);
  expect(storageOf(runtime).lineage.selected).toMatchObject({ state: "selected", revisionId });
  expect(revisionReferences(f)).toBe(1);
});

test("an interruption plus a failing sibling view write rejects with the original error after every started write settles and before the lock releases", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Failing sibling.");
  const controller = new AbortController();
  const failure = new Error("note write failed");
  const armed = { value: false };
  const started = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const order: string[] = [];
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (armed.value && path.endsWith("journey.md")) {
        started.resolve(undefined);
        await gate.promise;
        order.push("journey settled");
      }
      if (armed.value && path.endsWith("current-work.md")) {
        await started.promise;
        throw failure;
      }
      await writeDurable(path, contents);
      if (armed.value && path.endsWith("head.json")) {
        controller.abort(new Error("tool call cancelled after the head"));
      }
    },
  });
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Work\n", "journey.md": "Journey\n" }),
    [await sourceReference(f, "Failing sibling.")],
  );
  const store = await storeFor(f);
  armed.value = true;
  const pending = runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal);
  await started.promise;
  const contender = store.lock(async () => {
    order.push("contender entered");
    await Promise.resolve();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  gate.resolve(undefined);
  await expect(pending).rejects.toBe(failure);
  await contender;
  expect(order).toEqual(["journey settled", "contender entered"]);
});

test("a replacement after the head discards the old lineage application, keeps the commit, and the replacement reconciles its reference once", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const armed = { value: false };
  let replacement: Promise<void> | undefined;
  const { runtime, ctx, proposal } = await committing(f, "Replace after head.", (current) =>
    afterWrite(
      (path) => armed.value && headWrite(path),
      () => {
        replacement = current().start(contextOf(f));
      },
    ),
  );
  armed.value = true;
  const revisionId = committedId(await runtime.commitProposal(ctx, proposal));
  await replacement;
  expect(await (await storeFor(f)).currentHead()).toBe(revisionId);
  expect(revisionReferences(f)).toBe(1);
  expect(storageOf(runtime).lineage.selected).toMatchObject({ state: "selected", revisionId });
});

test("a host abort after the revision write and before the head returns cancelled with that reason and leaves the head unchanged", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const controller = new AbortController();
  const reason = new Error("tool call cancelled before the head");
  const armed = { value: false };
  const { runtime, ctx, proposal } = await committing(f, "Abort before head.", () =>
    afterWrite(
      (path) => armed.value && revisionWrite(path),
      () => {
        controller.abort(reason);
      },
    ),
  );
  armed.value = true;
  expect(await runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal)).toEqual({
    kind: "cancelled",
    reason,
  });
  expect(await (await storeFor(f)).currentHead()).toBeNull();
  expect(revisionReferences(f)).toBe(0);
});

test("shutdown after the head write reports committed and performs no append", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const armed = { value: false };
  let shutdown: Promise<void> | undefined;
  const { runtime, ctx, proposal } = await committing(f, "Shutdown after head.", (current) =>
    afterWrite(
      (path) => armed.value && headWrite(path),
      () => {
        shutdown = current().shutdown();
      },
    ),
  );
  armed.value = true;
  const revisionId = committedId(await runtime.commitProposal(ctx, proposal));
  await shutdown;
  expect(await (await storeFor(f)).currentHead()).toBe(revisionId);
  expect(revisionReferences(f)).toBe(0);
  expect(runtime.snapshot.storage).toEqual({ state: "stopped" });
});

test("shutdown waits for an in-flight registration write before it resolves", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Registered during shutdown.");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let written = false;
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (path.endsWith("sources.json")) {
        entered.resolve(undefined);
        await gate.promise;
      }
      await writeDurable(path, contents);
      if (path.endsWith("sources.json")) {
        written = true;
      }
    },
  });
  const starting = runtime.start(contextOf(f));
  await entered.promise;
  let stopped = false;
  const shutdown = runtime.shutdown().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(stopped).toBe(false);
  gate.resolve(undefined);
  await Promise.all([shutdown, starting]);
  expect(written).toBe(true);
  expect(runtime.snapshot.storage).toEqual({ state: "stopped" });
});

test("a durable head whose lineage application fails still reports committed and records the failure", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Application failure.");
  const manager = f.session.sessionManager;
  let armed = false;
  const runtime = runtimeFor(
    f,
    {},
    {
      appendEntry(type, data) {
        if (armed && type === "orbis-tiered-memory-revision") {
          throw new Error("The session refused the reference entry.");
        }
        manager.appendCustomEntry(type, data);
      },
    },
  );
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Application failure."),
  ]);
  armed = true;
  const revisionId = committedId(await runtime.commitProposal(ctx, proposal));
  expect(await (await storeFor(f)).currentHead()).toBe(revisionId);
  expect(revisionReferences(f)).toBe(0);
  expect(storageOf(runtime).error).toBe("The session refused the reference entry.");
});

test("a durable head whose lineage application fails during a scope close still reports committed", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Application failure during replacement.");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let stage: "idle" | "committing" | "armed" | "gated" = "idle";
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (stage === "armed" && path.includes(`${sep}private${sep}`)) {
        stage = "gated";
        entered.resolve(undefined);
        await gate.promise;
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      }
      await writeDurable(path, contents);
      if (
        stage === "committing" &&
        path.endsWith("head.json") &&
        contents.includes('"materialized":true')
      ) {
        stage = "armed";
      }
    },
  });
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Application failure during replacement."),
  ]);
  stage = "committing";
  const pending = runtime.commitProposal(ctx, proposal);
  await entered.promise;
  const replacement = runtime.start(ctx);
  gate.resolve(undefined);
  const revisionId = committedId(await pending);
  await replacement;
  expect(await (await storeFor(f)).currentHead()).toBe(revisionId);
  expect(storageOf(runtime).lineage.selected).toMatchObject({ state: "selected", revisionId });
});

test("captureProposal and commitProposal refuse after shutdown and while a replacement opens storage", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Refused evidence.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const content = noteContent({ "current-work.md": "Refused\n" });
  const source = await sourceReference(f, "Refused evidence.");
  const proposal = runtime.captureProposal(ctx, content, [source]);
  const replacing = runtime.start(ctx);
  expect(runtime.snapshot.storage).toEqual({ state: "opening" });
  expect(() => runtime.captureProposal(ctx, content, [source])).toThrow("unavailable");
  await expect(runtime.commitProposal(ctx, proposal)).rejects.toThrow("unavailable");
  await replacing;
  await runtime.shutdown();
  expect(() => runtime.captureProposal(ctx, content, [source])).toThrow("unavailable");
  await expect(runtime.commitProposal(ctx, proposal)).rejects.toThrow("unavailable");
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});

test("a Pi reload awaits the old instance's in-flight storage write before the replacement instance opens storage", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("First turn.");
  await f.session.prompt("Second turn.");
  const probe = await openFile(join(f.cwd, "handle-probe"), "w");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Every FileHandle, including those of the Pi-loaded module copy, shares this prototype.
  const handlePrototype = Reflect.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  // oxlint-disable-next-line typescript/unbound-method -- The spy calls the original with its FileHandle receiver.
  const original = handlePrototype.sync;
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const writes: string[] = [];
  let armed = false;
  let gated = false;
  const sync = vi.spyOn(handlePrototype, "sync").mockImplementation(async function (this: unknown) {
    if (armed && !gated) {
      gated = true;
      entered.resolve(undefined);
      await gate.promise;
      writes.push("old write settled");
    } else if (gated) {
      writes.push("later write");
    }
    await original.call(this);
  });
  onTestFinished(() => {
    sync.mockRestore();
  });
  armed = true;
  const navigating = f.session.navigateTree(sourceEntry(f, "First turn.").id);
  await entered.promise;
  const reloading = f.reload();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(writes).toEqual([]);
  gate.resolve(undefined);
  await Promise.all([navigating, reloading]);
  expect(writes[0]).toBe("old write settled");
  expect(writes.length).toBeGreaterThan(1);
  await f.command("status");
  expect(f.report()).toContain("Memory project root:");
  expect(f.report()).toMatch(/Registered original sources: \d+ \(session_start\)/);
});

function failingAt(
  armed: { value: boolean },
  matches: (path: string) => boolean,
  failure: Error,
): { write: TestWrite; entered: Promise<undefined>; release: () => void } {
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let fired = false;
  return {
    write: async (path, contents) => {
      if (armed.value && !fired && matches(path)) {
        fired = true;
        entered.resolve(undefined);
        await gate.promise;
        throw failure;
      }
      await writeDurable(path, contents);
    },
    entered: entered.promise,
    release: () => {
      gate.resolve(undefined);
    },
  };
}

const genuineStages = [
  { stage: "a pre-head revision write", matches: revisionWrite, curated: false },
  {
    stage: "a registration write",
    matches: (path: string) => path.endsWith("sources.json"),
    curated: false,
  },
  {
    stage: "a curation save",
    matches: (path: string) => path.endsWith("curation.json"),
    curated: true,
  },
];

test.for(genuineStages)(
  "a genuine failure of $stage that races a disable rejects the commit with the original error",
  async ({ matches, curated }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Genuine failure evidence.");
    const armed = { value: false };
    const failure = Object.assign(new Error("ENOSPC: no space left on device, write"), {
      code: "ENOSPC",
    });
    const failing = failingAt(armed, matches, failure);
    const runtime = runtimeFor(f, { write: failing.write });
    const ctx = contextOf(f);
    await runtime.start(ctx);
    const source = await sourceReference(f, "Genuine failure evidence.");
    if (curated) {
      committedId(
        await runtime.commitProposal(
          ctx,
          runtime.captureProposal(ctx, noteContent({ "current-work.md": "First\n" }), [source]),
        ),
      );
      const store = await storeFor(f);
      await writeFile(join(store.sessionDir, "current", "current-work.md"), "User edit\n");
    }
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Next\n" }), [
      source,
    ]);
    armed.value = true;
    const pending = runtime.commitProposal(ctx, proposal);
    await failing.entered;
    runtime.disable();
    failing.release();
    await expect(pending).rejects.toBe(failure);
  },
);

test.for([
  {
    name: "an Error",
    make: () => Object.assign(new Error("aborted write"), { name: "AbortError" }),
  },
  { name: "a DOMException", make: () => new DOMException("aborted write", "AbortError") },
])(
  "a write that rejects with $name named AbortError while nothing is cancelled rejects the commit with that error",
  async ({ make }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("AbortError evidence.");
    const armed = { value: false };
    const failure = make();
    const failing = failingAt(armed, revisionWrite, failure);
    const runtime = runtimeFor(f, { write: failing.write });
    const ctx = contextOf(f);
    await runtime.start(ctx);
    const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "No\n" }), [
      await sourceReference(f, "AbortError evidence."),
    ]);
    armed.value = true;
    const pending = runtime.commitProposal(ctx, proposal);
    await failing.entered;
    failing.release();
    await expect(pending).rejects.toBe(failure);
    expect(await (await storeFor(f)).currentHead()).toBeNull();
  },
);

test.for([
  { kind: "no reason", make: () => undefined },
  { kind: "a DOMException", make: () => new DOMException("The host timed out.", "TimeoutError") },
  { kind: "a custom Error", make: () => new Error("tool call cancelled") },
  { kind: "a string", make: () => "tool call cancelled" },
  { kind: "a plain object", make: () => ({ kind: "host-cancel" }) },
])(
  "a host abort with $kind during the commit's registration write returns cancelled with that exact reason and refreshes from that registration",
  async ({ make }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Reason evidence.");
    const armed = { value: false };
    const controller = new AbortController();
    const runtime = runtimeFor(f, {
      write: afterWrite(
        (path) => armed.value && path.endsWith("sources.json"),
        () => {
          const reason = make();
          if (reason === undefined) {
            controller.abort();
          } else {
            controller.abort(reason);
          }
        },
      ),
    });
    const ctx = contextOf(f);
    await runtime.start(ctx);
    const source = await sourceReference(f, "Reason evidence.");
    const selected = committedId(
      await runtime.commitProposal(
        ctx,
        runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [source]),
      ),
    );
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "No\n" }), [source]);
    f.session.sessionManager.appendContextEdit(sourceEntry(f, "Reason evidence.").id, {
      content: "Edited reason evidence.",
    });
    await f.session.prompt("A turn before the cancelled commit.");
    expect(storageOf(runtime).registration).toMatchObject({ sources: 2, event: "commit" });
    armed.value = true;
    const result = await runtime.commitProposal({ ...ctx, signal: controller.signal }, proposal);
    expect(result.kind).toBe("cancelled");
    expect(result.kind === "cancelled" ? result.reason : undefined).toBe(controller.signal.reason);
    expect(await (await storeFor(f)).currentHead()).toBe(selected);
    expect(storageOf(runtime).lineage.selected).toMatchObject({
      revisionId: selected,
      invalidNotes: ["current-work.md"],
      invalidReason: "note-evidence",
    });
    expect(storageOf(runtime).registration).toMatchObject({ sources: 4, event: "commit" });
  },
);

test("tree navigation during a pending start with a delayed registration write opens the replacement only after that write settles, and its registration survives", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Registered before navigation.");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let gated = false;
  const later: string[] = [];
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (!gated && path.endsWith("sources.json")) {
        gated = true;
        entered.resolve(undefined);
        await gate.promise;
      } else if (gated) {
        later.push(path);
      }
      await writeDurable(path, contents);
    },
  });
  const ctx = contextOf(f);
  const starting = runtime.start(ctx);
  await entered.promise;
  const navigating = runtime.selectBranch(ctx);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(later).toEqual([]);
  gate.resolve(undefined);
  await Promise.all([starting, navigating]);
  expect(later.some((path) => path.endsWith("sources.json"))).toBe(true);
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_tree", sources: 2 });
  const store = await storeFor(f);
  expect((await openRegistry(store)).sources).toHaveLength(2);
});

test("a busy lock during startup registration leaves storage failed with the busy error and sources.json unchanged", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Registered under a busy lock.");
  const sources = join((await storeFor(f)).sessionDir, "sources.json");
  const before = await readFile(sources, "utf8");
  const blocker = 2 ** 30;
  let publications = 0;
  let now = 0;
  const runtime = runtimeFor(f, {
    now: () => (now += 1000),
    isRunning: (pid) => pid === blocker || ProcessLiveness.live.isRunning(pid),
    lock: {
      publish: async (source, ticket) => {
        publications++;
        if (publications > 1) {
          await writeFile(ticket, JSON.stringify({ version: 1, pid: blocker, token: "other" }));
        }
        await link(source, ticket);
      },
    },
  });
  await runtime.start(contextOf(f));
  expect(publications).toBeGreaterThan(1);
  expect(runtime.snapshot.storage).toEqual({
    state: "failed",
    error: "Tiered memory project lock is busy. Retry after the other writer finishes.",
  });
  expect(await readFile(sources, "utf8")).toBe(before);
});

test("a replacement while MemoryStore.open holds the lock lets the old open finish its lock cleanup before the new session opens", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Opened during a replacement.");
  const store = await storeFor(f);
  await rm(join(store.sessionDir, "identity.json"));
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  let gated = false;
  const holders: number[] = [];
  const runtime = runtimeFor(f, {
    write: async (path, contents) => {
      if (!gated && path.endsWith("identity.json")) {
        gated = true;
        entered.resolve(undefined);
        await gate.promise;
      }
      await writeDurable(path, contents);
    },
    lock: {
      publish: async (source, ticket) => {
        holders.push((await readdir(dirname(source))).length);
        await link(source, ticket);
      },
    },
  });
  const ctx = contextOf(f);
  const starting = runtime.start(ctx);
  await entered.promise;
  const replacing = runtime.start(ctx);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(holders).toEqual([1]);
  gate.resolve(undefined);
  await Promise.all([starting, replacing]);
  expect(holders.length).toBeGreaterThan(1);
  expect(holders.every((count) => count === 1)).toBe(true);
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_start" });
  expect(await readdir(join(store.baseDir, "sessions", ".lock", "private"))).toEqual([]);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Opened during a replacement."),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
});

test("after shutdown, role checks, transitions, and commits start no work", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Shut down evidence.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "No\n" }), [
    await sourceReference(f, "Shut down evidence."),
  ]);
  await runtime.shutdown();
  const lookup = vi.spyOn(ctx.modelRegistry, "getApiKeyAndHeaders");
  onTestFinished(() => {
    lookup.mockRestore();
  });
  const entries = f.session.sessionManager.getEntries().length;
  await runtime.refreshRoles(ctx);
  await runtime.enable(ctx);
  await expect(runtime.start(ctx)).rejects.toThrow("shut down");
  await expect(runtime.selectBranch(ctx)).rejects.toThrow("shut down");
  await expect(runtime.commitProposal(ctx, proposal)).rejects.toThrow("unavailable");
  expect(lookup).not.toHaveBeenCalled();
  expect(f.session.sessionManager.getEntries().length).toBe(entries + 1);
  expect(runtime.snapshot.storage).toEqual({ state: "stopped" });
  expect(await (await storeFor(f)).currentHead()).toBeNull();
});
