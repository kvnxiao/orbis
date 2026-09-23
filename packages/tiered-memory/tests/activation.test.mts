import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { configurationEntrySchema } from "../src/domain/settings.ts";
import { findEntry, test } from "./pi-fixture.mts";

test("Pi loads defaults, routes commands without a model call, and keeps native settings", async ({
  createFixture,
}) => {
  const f = await createFixture();
  expect(
    f.session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName),
  ).toContain("tiered-memory");
  await f.command("");
  expect(f.notifications.at(-1)).toMatchObject({ type: "info", message: f.report() });
  expect(f.report()).toContain("Tiered memory: enabled (default)");
  expect(f.report()).toContain("limits.queuedJobs: 8 (default)");
  await f.command("off");
  expect(f.report()).toContain("Tiered memory: disabled (session override)");
  await f.command("on");
  expect(f.report()).toContain("Tiered memory: enabled (session override)");
  expect(f.settings.getCompactionSettings().enabled).toBe(false);
  expect(f.session.messages).toEqual([]);
  const before = f.report();
  const entries = f.session.sessionManager.getEntries().length;
  await f.command("nonsense");
  expect(f.report()).toBe(before);
  expect(f.notifications.at(-1)).toEqual({
    message: "Usage: /tiered-memory [on|off|status]",
    type: "warning",
  });
  expect(f.session.sessionManager.getEntries()).toHaveLength(entries);
  expect(f.session.messages).toEqual([]);
});

test("Pi applies personal and trusted project fields without writing settings", async ({
  createFixture,
}) => {
  const personal = { enabled: false, limits: { queuedJobs: 3 } };
  const project = { enabled: true, limits: { workerInputTokens: 5000 } };
  const f = await createFixture({ personal, project });
  await f.command("status");
  expect(f.report()).toContain("Tiered memory: enabled (project)");
  expect(f.report()).toContain("limits.queuedJobs: 3 (personal)");
  expect(f.report()).toContain("limits.workerInputTokens: 5000 (project)");
  await f.command("off");
  expect(JSON.parse(await readFile(join(f.agentDir, "tiered-memory.json"), "utf8"))).toEqual(
    personal,
  );
  expect(
    JSON.parse(await readFile(join(f.cwd, ".pi", "tiered-memory", "settings.json"), "utf8")),
  ).toEqual(project);
});

test("Pi ignores project overrides without host trust and retains valid settings after invalid reload", async ({
  createFixture,
}) => {
  const f = await createFixture({
    trusted: false,
    personal: { limits: { queuedJobs: 4 } },
    project: { enabled: false, limits: { queuedJobs: 1 } },
  });
  await f.command("status");
  expect(f.report()).toContain("Tiered memory: enabled (default)");
  expect(f.report()).toContain("limits.queuedJobs: 4 (personal)");
  expect(f.report()).toContain("ignored: project is untrusted");
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{bad");
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain(
    `Configuration error: Invalid JSON at ${join(f.agentDir, "tiered-memory.json")}.`,
  );
  expect(f.report()).toContain("limits.queuedJobs: 4 (personal)");
});

test("Pi suspends automatic work without a valid configuration", async ({ createFixture }) => {
  const f = await createFixture({ personal: "{" });
  await f.command("status");
  expect(f.report()).toContain("Tiered memory: disabled (configuration unavailable)");
  expect(f.report()).toContain("Automatic work: suspended; native Pi remains available.");
});

test("Pi restores an activation override on resume and resets it in an unrelated session", async ({
  createFixture,
}) => {
  const original = await createFixture();
  await original.command("off");
  await original.session.prompt("Record the session");
  const sessionFile = original.session.sessionManager.getSessionFile();
  if (sessionFile === undefined) {
    throw new Error("Missing persisted Pi session.");
  }
  const resumed = await createFixture({ cwd: original.cwd, sessionFile });
  await resumed.command("status");
  expect(resumed.report()).toContain("Tiered memory: disabled (session override)");
  const unrelated = await createFixture({ cwd: original.cwd });
  await unrelated.command("status");
  expect(unrelated.report()).toContain("Tiered memory: enabled (default)");
});

test("Pi tree navigation selects activation from the active branch", async ({ createFixture }) => {
  const f = await createFixture();
  const initial = findEntry(
    f.session,
    "orbis-tiered-memory-configuration",
    configurationEntrySchema,
  );
  await f.command("off");
  expect(f.report()).toContain("disabled (session override)");
  const result = await f.session.navigateTree(initial.id, { summarize: false });
  expect(result.cancelled).toBe(false);
  await f.command("status");
  expect(f.report()).toContain("enabled (default)");
});

test("Pi tree navigation keeps loaded settings until reload", async ({ createFixture }) => {
  const f = await createFixture({ personal: { limits: { queuedJobs: 3 } } });
  const initial = findEntry(
    f.session,
    "orbis-tiered-memory-configuration",
    configurationEntrySchema,
  );
  await f.command("off");
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({ limits: { queuedJobs: 6 } }),
  );
  await f.session.navigateTree(initial.id, { summarize: false });
  await f.command("status");
  expect(f.report()).toContain("limits.queuedJobs: 3 (personal)");
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("limits.queuedJobs: 6 (personal)");
});

test.for([
  { label: "work note exceeds output", limits: { workNoteTokens: 3000 } },
  {
    label: "work note exceeds checkpoint",
    limits: { workNoteTokens: 5000, workerOutputTokens: 6000 },
  },
  { label: "threshold exceeds active pool", limits: { consolidationThresholdTokens: 9000 } },
  { label: "note and index exceed input", limits: { workerInputTokens: 1200 } },
])("Pi rejects $label budget configuration", async ({ limits }, { createFixture }) => {
  const f = await createFixture({ personal: { limits } });
  await f.command("status");
  expect(f.report()).toContain("disabled (configuration unavailable)");
  expect(f.report()).toContain("Tiered-memory limits conflict");
});

test("Pi retains the last valid configuration when a reload introduces conflicting budgets", async ({
  createFixture,
}) => {
  const f = await createFixture({ personal: { limits: { queuedJobs: 3 } } });
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({ limits: { queuedJobs: 4, workerInputTokens: 1200 } }),
  );
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("Tiered-memory limits conflict");
  expect(f.report()).toContain("limits.queuedJobs: 3 (personal)");
});

test("Pi applies a temporary host trust decision on reload", async ({ createFixture }) => {
  const f = await createFixture({
    trusted: false,
    project: { enabled: false, limits: { queuedJobs: 2 } },
  });
  await f.command("status");
  expect(f.report()).toContain("enabled (default)");
  f.settings.setProjectTrusted(true);
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("disabled (project)");
  expect(f.report()).toContain("limits.queuedJobs: 2 (project)");
});

test("Pi does not restore trusted project values after trust is revoked and replacement settings are invalid", async ({
  createFixture,
}) => {
  const f = await createFixture({ trusted: true, project: { enabled: false } });
  await f.command("status");
  expect(f.report()).toContain("disabled (project)");
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{");
  f.settings.setProjectTrusted(false);
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("disabled (configuration unavailable)");
});

test("Pi forked session restores the selected branch activation", async ({ createFixture }) => {
  const original = await createFixture();
  await original.command("off");
  await original.session.prompt("Persist the selected branch");
  const leaf = original.session.sessionManager.getLeafId();
  if (leaf === null) {
    throw new Error("Missing Pi session leaf.");
  }
  const forkFile = original.session.sessionManager.createBranchedSession(leaf);
  if (forkFile === undefined) {
    throw new Error("Missing Pi fork file.");
  }
  const forked = await createFixture({ cwd: original.cwd, sessionFile: forkFile });
  await forked.command("status");
  expect(forked.report()).toContain("disabled (session override)");
});

test("untrusted unreadable project path does not invalidate updated personal settings", async ({
  createFixture,
}) => {
  const f = await createFixture({ trusted: false, personal: { limits: { queuedJobs: 3 } } });
  await rm(join(f.cwd, ".pi"), { recursive: true });
  await writeFile(join(f.cwd, ".pi"), "blocked project path");
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({ limits: { queuedJobs: 4 } }),
  );
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("limits.queuedJobs: 4 (personal)");
  expect(f.report()).not.toContain("Configuration error:");
});

test("tree navigation keeps current valid settings for a later invalid reload", async ({
  createFixture,
}) => {
  const f = await createFixture({ personal: { limits: { queuedJobs: 3 } } });
  const first = findEntry(f.session, "orbis-tiered-memory-configuration", configurationEntrySchema);
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({ limits: { queuedJobs: 6 } }),
  );
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("limits.queuedJobs: 6 (personal)");
  await f.session.navigateTree(first.id, { summarize: false });
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{");
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("limits.queuedJobs: 6 (personal)");
});
