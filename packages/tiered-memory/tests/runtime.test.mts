import { expect, test, vi } from "vitest";

import { MemoryRuntime } from "../src/runtime.ts";
import { fixture, fixtureModel } from "./pi-fixture.mts";

test("runtime cancels owned work on disable and shutdown", async () => {
  const entries: string[] = [];
  const runtime = new MemoryRuntime({
    appendEntry(type) {
      entries.push(type);
    },
  });
  const pending = new AbortController();
  runtime.ownJob(pending);
  await runtime.setEnabled(false);
  expect(entries).toContain("orbis-tiered-memory-activation");
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
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
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
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const entries: string[] = [];
  const runtime = new MemoryRuntime({
    appendEntry(type) {
      entries.push(type);
    },
  });
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
  await runtime.setEnabled(false);
  gate.resolve({ ok: true, apiKey: "fixture" });
  await pending;
  expect(runtime.snapshot.roles).toBeUndefined();
});

test("late credential resolution after model change cannot replace current roles", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const entries: string[] = [];
  const runtime = new MemoryRuntime({
    appendEntry(type) {
      entries.push(type);
    },
  });
  const original = f.session.extensionRunner.createContext();
  await runtime.start(original);
  const gate = Promise.withResolvers<{ ok: true; apiKey: string }>();
  let calls = 0;
  const lookup = vi
    .spyOn(original.modelRegistry, "getApiKeyAndHeaders")
    .mockImplementation(async () => {
      calls++;
      return calls <= 2 ? await gate.promise : { ok: true, apiKey: "fixture" };
    });
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
