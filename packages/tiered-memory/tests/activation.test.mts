import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { resolveProjectSettingsPath } from "../src/settings.ts";
import { fixture } from "./pi-fixture.mts";

const git = promisify(execFile);

test("Pi loads defaults, routes commands without a model call, and keeps native settings", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
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
  onTestFinished,
}) => {
  const personal = { enabled: false, limits: { queuedJobs: 3 } };
  const project = { enabled: true, limits: { workerInputTokens: 5000 } };
  const f = await fixture({ personal, project });
  onTestFinished(async () => {
    await f.dispose();
  });
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
  onTestFinished,
}) => {
  const f = await fixture({
    trusted: false,
    personal: { limits: { queuedJobs: 4 } },
    project: { enabled: false, limits: { queuedJobs: 1 } },
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain("Tiered memory: enabled (default)");
  expect(f.report()).toContain("limits.queuedJobs: 4 (personal)");
  expect(f.report()).toContain("ignored: project is untrusted");
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{bad");
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("invalid JSON");
  expect(f.report()).toContain("limits.queuedJobs: 4 (personal)");
});

test("Pi suspends automatic work without a valid configuration", async ({ onTestFinished }) => {
  const f = await fixture({ personal: "{" });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain("Tiered memory: disabled (configuration unavailable)");
  expect(f.report()).toContain("Automatic work: suspended; native Pi remains available.");
});

test("Pi restores an activation override on resume and resets it in an unrelated session", async ({
  onTestFinished,
}) => {
  const original = await fixture();
  onTestFinished(async () => {
    await original.dispose();
  });
  await original.command("off");
  await original.session.prompt("Record the session");
  const sessionFile = original.session.sessionManager.getSessionFile();
  if (sessionFile === undefined) {
    throw new Error("Missing persisted Pi session.");
  }
  const resumed = await fixture({ cwd: original.cwd, sessionFile });
  onTestFinished(async () => {
    await resumed.dispose();
  });
  await resumed.command("status");
  expect(resumed.report()).toContain("Tiered memory: disabled (session override)");
  const unrelated = await fixture({ cwd: original.cwd });
  onTestFinished(async () => {
    await unrelated.dispose();
  });
  await unrelated.command("status");
  expect(unrelated.report()).toContain("Tiered memory: enabled (default)");
});

test("Pi tree navigation selects activation from the active branch", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const initial = f.session.sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "custom" && entry.customType === "orbis-tiered-memory-configuration",
    );
  if (initial === undefined) {
    throw new Error("Missing initial configuration entry.");
  }
  await f.command("off");
  expect(f.report()).toContain("disabled (session override)");
  const result = await f.session.navigateTree(initial.id, { summarize: false });
  expect(result.cancelled).toBe(false);
  await f.command("status");
  expect(f.report()).toContain("enabled (default)");
});

test("Pi tree navigation keeps loaded settings until reload", async ({ onTestFinished }) => {
  const f = await fixture({ personal: { limits: { queuedJobs: 3 } } });
  onTestFinished(async () => {
    await f.dispose();
  });
  const initial = f.session.sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "custom" && entry.customType === "orbis-tiered-memory-configuration",
    );
  if (initial === undefined) {
    throw new Error("Missing initial configuration entry.");
  }
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
])("Pi rejects $label budget configuration", async ({ limits }, { onTestFinished }) => {
  const f = await fixture({ personal: { limits } });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain("disabled (configuration unavailable)");
  expect(f.report()).toContain("Tiered-memory limits conflict");
});

test("Git non-repository detection uses a fixed diagnostic locale", async ({ onTestFinished }) => {
  const workspace = await mkdtemp(join(tmpdir(), "orbis-tiered-locale-"));
  onTestFinished(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const bin = join(workspace, "bin");
  const cwd = join(workspace, "project");
  await mkdir(bin);
  await mkdir(cwd);
  const wrapper = join(bin, "git");
  await writeFile(
    wrapper,
    '#!/bin/sh\nif [ "$LC_ALL" = C ]; then echo "fatal: not a git repository" >&2; else echo "fatal: ceci n est pas un depot Git" >&2; fi\nexit 128\n',
  );
  await chmod(wrapper, 0o755);
  const previousPath = process.env.PATH;
  const previousLocale = process.env.LC_ALL;
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  process.env.LC_ALL = "fr_FR.UTF-8";
  try {
    expect(await resolveProjectSettingsPath(cwd)).toBe(
      join(cwd, ".pi", "tiered-memory", "settings.json"),
    );
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousLocale === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = previousLocale;
    }
  }
});

test("Git worktree root keeps trailing spaces", async ({ onTestFinished }) => {
  const workspace = await mkdtemp(join(tmpdir(), "orbis-tiered-space-"));
  onTestFinished(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const root = join(workspace, "worktree ");
  const cwd = join(root, "src");
  await mkdir(cwd, { recursive: true });
  await git("git", ["init", "-q", root]);
  expect(await resolveProjectSettingsPath(cwd)).toBe(
    join(root, ".pi", "tiered-memory", "settings.json"),
  );
});

test("Pi retains the last valid configuration when a reload introduces conflicting budgets", async ({
  onTestFinished,
}) => {
  const f = await fixture({ personal: { limits: { queuedJobs: 3 } } });
  onTestFinished(async () => {
    await f.dispose();
  });
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({ limits: { queuedJobs: 4, workerInputTokens: 1200 } }),
  );
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("Tiered-memory limits conflict");
  expect(f.report()).toContain("limits.queuedJobs: 3 (personal)");
});

test("Pi applies a temporary host trust decision on reload", async ({ onTestFinished }) => {
  const f = await fixture({
    trusted: false,
    project: { enabled: false, limits: { queuedJobs: 2 } },
  });
  onTestFinished(async () => {
    await f.dispose();
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
  onTestFinished,
}) => {
  const f = await fixture({ trusted: true, project: { enabled: false } });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain("disabled (project)");
  await writeFile(join(f.agentDir, "tiered-memory.json"), "{");
  f.settings.setProjectTrusted(false);
  await f.reload();
  await f.command("status");
  expect(f.report()).toContain("disabled (configuration unavailable)");
});

test("Pi forked session restores the selected branch activation", async ({ onTestFinished }) => {
  const original = await fixture();
  onTestFinished(async () => {
    await original.dispose();
  });
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
  const forked = await fixture({ cwd: original.cwd, sessionFile: forkFile });
  onTestFinished(async () => {
    await forked.dispose();
  });
  await forked.command("status");
  expect(forked.report()).toContain("disabled (session override)");
});

test("untrusted unreadable project path does not invalidate updated personal settings", async ({
  onTestFinished,
}) => {
  const f = await fixture({ trusted: false, personal: { limits: { queuedJobs: 3 } } });
  onTestFinished(async () => {
    await f.dispose();
  });
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
  onTestFinished,
}) => {
  const f = await fixture({ personal: { limits: { queuedJobs: 3 } } });
  onTestFinished(async () => {
    await f.dispose();
  });
  const first = f.session.sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "custom" && entry.customType === "orbis-tiered-memory-configuration",
    );
  if (first === undefined) {
    throw new Error("Missing initial configuration entry.");
  }
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

test.for([
  { label: "Git subdirectory", kind: "subdirectory" as const },
  { label: "linked worktree", kind: "linked" as const },
  { label: "nested repository", kind: "nested" as const },
  { label: "outside Git", kind: "non-git" as const },
])("project settings use the $label root", async ({ kind }, { onTestFinished }) => {
  const workspace = await mkdtemp(join(tmpdir(), "orbis-tiered-root-"));
  onTestFinished(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  let root = workspace;
  if (kind === "subdirectory" || kind === "nested") {
    await git("git", ["init", "-q", workspace]);
  }
  if (kind === "nested") {
    root = join(workspace, "nested");
    await mkdir(root);
    await git("git", ["init", "-q", root]);
  }
  if (kind === "linked") {
    const main = join(workspace, "main");
    await mkdir(main);
    await git("git", ["init", "-q", main]);
    await git("git", [
      "-C",
      main,
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=Fixture",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    root = join(workspace, "linked");
    await git("git", ["-C", main, "worktree", "add", "-q", "--detach", root, "HEAD"]);
  }
  const cwd = join(root, "src");
  await mkdir(cwd);
  const settingsRoot = kind === "non-git" ? cwd : root;
  await mkdir(join(settingsRoot, ".pi", "tiered-memory"), { recursive: true });
  await writeFile(
    join(settingsRoot, ".pi", "tiered-memory", "settings.json"),
    JSON.stringify({ limits: { queuedJobs: 2 } }),
  );
  const f = await fixture({ cwd });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    `Project settings: ${join(settingsRoot, ".pi", "tiered-memory", "settings.json")}`,
  );
  expect(f.report()).toContain("limits.queuedJobs: 2 (project)");
});
