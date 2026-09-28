import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";

import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { fixtureModel, test } from "./pi-fixture.mts";
import type { Fixture } from "./pi-fixture.mts";
import { runtimeFor, sourceEntry, storageOf } from "./store-fixture.mts";

function recordingRuntime(f: Fixture): { runtime: MemoryRuntime; entries: string[] } {
  const entries: string[] = [];
  const runtime = runtimeFor(
    f,
    {},
    {
      appendEntry(type) {
        entries.push(type);
      },
    },
  );
  return { runtime, entries };
}

function contextWithModel(
  f: Fixture,
  model: { current: ExtensionContext["model"] },
): ExtensionContext {
  const ctx = { ...f.session.extensionRunner.createContext() };
  Object.defineProperty(ctx, "model", { get: () => model.current });
  return ctx;
}

const configurationEntry = "orbis-tiered-memory-configuration";

test("Pi can repeatedly replace the extension lifecycle without duplicate commands", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const reloadAndInspect = async () => {
    await f.reload();
    await f.command("status");
    expect(f.report()).toContain("Tiered memory: enabled (default)");
    expect(
      f.session.extensionRunner
        .getRegisteredCommands()
        .filter((command) => command.invocationName === "tiered-memory"),
    ).toHaveLength(1);
  };
  await reloadAndInspect();
  await reloadAndInspect();
  await reloadAndInspect();
});

test("late credential resolution after disable does not restore resolved roles", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const gate = Promise.withResolvers<{ ok: true; apiKey: string }>();
  const lookup = vi
    .spyOn(ctx.modelRegistry, "getApiKeyAndHeaders")
    .mockImplementation(async () => await gate.promise);
  onTestFinished(() => {
    lookup.mockRestore();
  });
  const pending = runtime.refreshRoles(ctx);
  runtime.disable();
  gate.resolve({ ok: true, apiKey: "fixture" });
  await pending;
  expect(runtime.snapshot.roles).toBeUndefined();
});

test("late credential resolution after model change cannot replace current roles", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime(f);
  const original = f.session.extensionRunner.createContext();
  await runtime.start(original);
  const gate = Promise.withResolvers<{ ok: true; apiKey: string }>();
  const lookup = vi
    .spyOn(original.modelRegistry, "getApiKeyAndHeaders")
    .mockImplementation(async (model) =>
      model.id === "fixture" ? await gate.promise : { ok: true, apiKey: "fixture" },
    );
  onTestFinished(() => {
    lookup.mockRestore();
  });
  const stale = runtime.refreshRoles(original);
  const current = { ...original, model: { ...fixtureModel, id: "new-session-model" } };
  await runtime.refreshRoles(current);
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/new-session-model",
  });
  gate.resolve({ ok: true, apiKey: "fixture" });
  await stale;
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/new-session-model",
  });
});

test("late credential resolution after tree selection cannot replace the destination's roles", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime(f);
  const original = f.session.extensionRunner.createContext();
  await runtime.start(original);
  const gate = Promise.withResolvers<{ ok: true; apiKey: string }>();
  const lookup = vi
    .spyOn(original.modelRegistry, "getApiKeyAndHeaders")
    .mockImplementation(async (model) =>
      model.id === "fixture" ? await gate.promise : { ok: true, apiKey: "fixture" },
    );
  onTestFinished(() => {
    lookup.mockRestore();
  });
  const stale = runtime.refreshRoles(original);
  const destination = { ...original, model: { ...fixtureModel, id: "destination-model" } };
  await runtime.selectBranch(destination);
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/destination-model",
  });
  gate.resolve({ ok: true, apiKey: "fixture" });
  await stale;
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/destination-model",
  });
});

test("configuration revision is unchanged by disable and by a model select that resolves the same roles", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const revision = runtime.snapshot.configurationRevision;
  runtime.disable();
  expect(runtime.snapshot.configurationRevision).toBe(revision);
  await runtime.enable(ctx);
  expect(runtime.snapshot.configurationRevision).toBe(revision);
  await runtime.refreshRoles(ctx);
  expect(runtime.snapshot.configurationRevision).toBe(revision);
  await runtime.refreshRoles({ ...ctx, model: { ...fixtureModel, id: "changed-session-model" } });
  expect(runtime.snapshot.configurationRevision).toBe(revision + 1);
});

test("two concurrent starts write exactly one configuration entry and resolve roles once", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const { runtime, entries } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  const lookup = vi.spyOn(ctx.modelRegistry, "getApiKeyAndHeaders");
  onTestFinished(() => {
    lookup.mockRestore();
  });
  await Promise.all([runtime.start(ctx), runtime.start(ctx)]);
  expect(entries).toEqual([configurationEntry]);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/fixture",
  });
});

test("a project-root failure records the error instead of rejecting start or branch selection", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, entries } = recordingRuntime(f);
  const ctx = { ...f.session.extensionRunner.createContext(), cwd: join(f.cwd, "invalid\0root") };
  await runtime.start(ctx);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.error).toContain("null bytes");
  await runtime.selectBranch(ctx);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.error).toContain("null bytes");
  expect(entries).toEqual([]);
});

test("a disable during the first settings load keeps the loaded configuration and /tiered-memory on then enables memory", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, entries } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  const starting = runtime.start(ctx);
  runtime.disable();
  await starting;
  expect(runtime.snapshot.configuration).toBeDefined();
  expect(runtime.enabled).toBe(false);
  expect(entries).toContain(configurationEntry);
  await runtime.enable(ctx);
  expect(runtime.enabled).toBe(true);
  expect(runtime.snapshot.roles?.observer).toMatchObject({ state: "ready" });
});

test("a model change during the first settings load resolves roles for the new model once the load applies", async ({
  createFixture,
}) => {
  const second = { ...fixtureModel, id: "second-model", name: "Second" };
  const f = await createFixture({ models: [second] });
  const { runtime } = recordingRuntime(f);
  const model: { current: ExtensionContext["model"] } = { current: fixtureModel };
  const ctx = contextWithModel(f, model);
  const starting = runtime.start(ctx);
  model.current = second;
  const selected = runtime.refreshRoles(ctx);
  await Promise.all([starting, selected]);
  expect(runtime.snapshot.configuration).toBeDefined();
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/second-model",
  });
});

test("a model change during a restart with a current configuration applies the new load and the new model's roles", async ({
  createFixture,
}) => {
  const second = { ...fixtureModel, id: "second-model", name: "Second" };
  const f = await createFixture({ models: [second] });
  const { runtime, entries } = recordingRuntime(f);
  const model: { current: ExtensionContext["model"] } = { current: fixtureModel };
  const ctx = contextWithModel(f, model);
  await runtime.start(ctx);
  const restarting = runtime.start(ctx);
  model.current = second;
  const selected = runtime.refreshRoles(ctx);
  await Promise.all([restarting, selected]);
  expect(entries.filter((type) => type === configurationEntry)).toHaveLength(2);
  expect(runtime.snapshot.configuration).toBeDefined();
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/second-model",
  });
});

test("a role check during branch selection does not skip the mismatch clear", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const untrusted = { ...ctx, isProjectTrusted: () => false };
  const selecting = runtime.selectBranch(untrusted);
  const checking = runtime.refreshRoles(ctx);
  await Promise.all([selecting, checking]);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.error).toBe("Settings need a reload for this project or trust state.");
});

test("tree navigation before the first load completes applies the loaded configuration and appends its entry only on the destination branch", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("First turn.");
  await f.session.prompt("Second turn.");
  const manager = f.session.sessionManager;
  const origin = manager.getLeafId() ?? undefined;
  const existing = new Set(manager.getEntries().map((entry) => entry.id));
  const runtime = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  const starting = runtime.start(ctx);
  manager.branch(sourceEntry(f, "First turn.").id);
  const navigating = runtime.selectBranch(ctx);
  await Promise.all([starting, navigating]);
  expect(runtime.snapshot.configuration).toBeDefined();
  expect(runtime.snapshot.error).toBeUndefined();
  const appended = manager
    .getEntries()
    .filter(
      (entry) =>
        !existing.has(entry.id) &&
        entry.type === "custom" &&
        entry.customType === configurationEntry,
    )
    .map((entry) => entry.id);
  expect(appended).toHaveLength(1);
  const onBranch = (ids: readonly { id: string }[]) =>
    ids.some((entry) => entry.id === appended[0]);
  expect(onBranch(manager.getBranch())).toBe(true);
  expect(onBranch(manager.getBranch(origin))).toBe(false);
});

test("a failed settings load falls back to the latest matching snapshot on the branch and still opens storage", async ({
  createFixture,
}) => {
  const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
  const first = runtimeFor(f);
  const ctx = f.session.extensionRunner.createContext();
  await first.start(ctx);
  const loaded = first.snapshot.configuration;
  await writeFile(join(f.cwd, ".pi", "tiered-memory", "settings.json"), "{not json");
  const second = runtimeFor(f);
  await second.start(ctx);
  expect(second.snapshot.configuration).toEqual(loaded);
  expect(second.snapshot.error).toContain("Invalid JSON");
  expect(storageOf(second).registration).toMatchObject({ event: "session_start" });
});

test("a project-root failure leaves configuration unavailable and still runs storage startup", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const ctx = { ...f.session.extensionRunner.createContext(), cwd: join(f.cwd, "invalid\0root") };
  await runtime.start(ctx);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.storage).toMatchObject({ state: "failed" });
});

test("a load replaced by a later start never becomes current", async ({ createFixture }) => {
  const f = await createFixture({ project: { limits: { queuedJobs: 3 } } });
  const { runtime, entries } = recordingRuntime(f);
  const ctx = f.session.extensionRunner.createContext();
  const first = runtime.start(ctx);
  const second = runtime.start({ ...ctx, isProjectTrusted: () => false });
  await Promise.all([first, second]);
  expect(entries.filter((type) => type === configurationEntry)).toHaveLength(1);
  expect(runtime.snapshot.configuration?.settings.limits.queuedJobs).toBe(8);
  expect(runtime.snapshot.configuration?.projectTrusted).toBe(false);
});

test("a failing role check still opens storage before start rejects", async ({ createFixture }) => {
  const f = await createFixture();
  const runtime = runtimeFor(f);
  const failure = new Error("The session model is unreadable.");
  const ctx = { ...f.session.extensionRunner.createContext() };
  Object.defineProperty(ctx, "model", {
    get: () => {
      throw failure;
    },
  });
  await expect(runtime.start(ctx)).rejects.toBe(failure);
  expect(runtime.snapshot.configuration).toBeDefined();
  expect(storageOf(runtime).registration).toMatchObject({ event: "session_start" });
});
