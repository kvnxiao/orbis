import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, vi } from "vitest";

import { SourceRegistry } from "../src/storage/sources.ts";
import type { Fixture } from "./pi-fixture.mts";
import {
  committedId,
  noteContent,
  runtimeFor,
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

test("start twice without stop leaves one open storage session", async ({ createFixture }) => {
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

test("stop aborts an in-flight storage open and its late result does not reach the replacement", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const original = SourceRegistry.open.bind(SourceRegistry);
  const open = vi.spyOn(SourceRegistry, "open").mockImplementationOnce(async (store) => {
    entered.resolve(undefined);
    await gate.promise;
    return await original(store);
  });
  onTestFinished(() => {
    open.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  runtime.stop();
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
  const open = vi.spyOn(SourceRegistry, "open").mockImplementationOnce(async () => {
    entered.resolve(undefined);
    return await gate.promise;
  });
  onTestFinished(() => {
    open.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  runtime.stop();
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
  const register = vi
    .spyOn(SourceRegistry.prototype, "register")
    .mockImplementationOnce(async () => {
      entered.resolve(undefined);
      return await gate.promise;
    });
  onTestFinished(() => {
    register.mockRestore();
  });
  const late = runtime.start(ctx);
  await entered.promise;
  runtime.stop();
  await runtime.start(ctx);
  const replacement = runtime.snapshot;
  gate.resolve([]);
  await late;
  expect(runtime.snapshot).toEqual(replacement);
  expect(storageOf(runtime).registration?.sources).toBeGreaterThan(0);
});

test("a delayed proposal from a stopped job is cancelled after its storage session is replaced", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Replace this session before committing.");
  const runtime = runtimeFor(f);
  const ctx = contextOf(f);
  await runtime.start(ctx);
  const job = new AbortController();
  runtime.ownJob(job);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Too late\n" }), [
    await sourceReference(f, "Replace this session before committing."),
  ]);
  runtime.stop();
  expect(() => runtime.captureProposal(ctx, noteContent({}), [])).toThrow("unavailable");
  await runtime.start(ctx);
  const result = await runtime.commitProposal({ ...ctx, signal: job.signal }, proposal);
  expect(result.kind === "cancelled" ? result.reason : result).toBeInstanceOf(Error);
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
