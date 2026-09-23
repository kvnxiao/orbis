import { join } from "node:path";

import { expect, vi } from "vitest";

import { MemoryRuntime } from "../src/pi/runtime.ts";
import { fixtureModel, test } from "./pi-fixture.mts";

function recordingRuntime(): { runtime: MemoryRuntime; entries: string[] } {
  const entries: string[] = [];
  const runtime = new MemoryRuntime({
    appendEntry(type) {
      entries.push(type);
    },
  });
  return { runtime, entries };
}

test("runtime cancels owned work on disable and shutdown", () => {
  const { runtime, entries } = recordingRuntime();
  const pending = new AbortController();
  runtime.ownJob(pending);
  runtime.disable();
  expect(entries).toEqual(["orbis-tiered-memory-activation"]);
  expect(pending.signal.aborted).toBe(true);
  const shutdown = new AbortController();
  runtime.ownJob(shutdown);
  runtime.stop();
  expect(shutdown.signal.aborted).toBe(true);
  const completed = new AbortController();
  const release = runtime.ownJob(completed);
  release();
  runtime.stop();
  expect(completed.signal.aborted).toBe(false);
});

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
  const { runtime } = recordingRuntime();
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
  const { runtime } = recordingRuntime();
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

test("configuration revision is unchanged by disable and by a model select that resolves the same roles", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime } = recordingRuntime();
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

test("start called twice without stop leaves one live generation", async ({ createFixture }) => {
  const f = await createFixture();
  const { runtime, entries } = recordingRuntime();
  const ctx = f.session.extensionRunner.createContext();
  await Promise.all([runtime.start(ctx), runtime.start(ctx)]);
  expect(entries).toEqual(["orbis-tiered-memory-configuration"]);
  expect(runtime.snapshot.roles?.observer).toMatchObject({
    state: "ready",
    id: "tiered-fixture/fixture",
  });
});

test("a project-root failure records the error instead of rejecting start or branch selection", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, entries } = recordingRuntime();
  const ctx = { ...f.session.extensionRunner.createContext(), cwd: join(f.cwd, "invalid\0root") };
  await runtime.start(ctx);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.error).toContain("null bytes");
  await runtime.selectBranch(ctx);
  expect(runtime.snapshot.configuration).toBeUndefined();
  expect(runtime.snapshot.error).toContain("null bytes");
  expect(entries).toEqual([]);
});
