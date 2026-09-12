import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

import { readSettings, readSettingsFile, writeSettings } from "../src/storage/config.ts";

test("concurrent settings updates preserve both fields", async ({ onTestFinished }) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-config-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const path = join(cwd, "settings.json");
  await Promise.all([
    writeSettings(path, { border: "double" }),
    writeSettings(path, { planDirectory: "approved-plans" }),
  ]);
  expect(await readSettingsFile(path)).toEqual({
    border: "double",
    planDirectory: "approved-plans",
  });
});

test("hints defaults persist and only trusted project settings override them", async ({
  onTestFinished,
}) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-hints-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const agent = join(cwd, "agent");
  expect((await readSettings(agent, cwd, false)).showHints).toBe(true);
  await writeSettings(join(agent, "orbis-plan.json"), { showHints: false });
  expect((await readSettings(agent, cwd, false)).showHints).toBe(false);
  await writeSettings(join(cwd, ".pi/plan.json"), { showHints: true });
  expect((await readSettings(agent, cwd, true)).showHints).toBe(true);
  expect((await readSettings(agent, cwd, false)).showHints).toBe(false);
});

test("settings inherit defaults and trust gates project overrides", async ({ onTestFinished }) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-config-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const agent = join(cwd, "agent");
  expect(await readSettings(agent, cwd, false)).toEqual({
    planDirectory: resolve(cwd, ".pi/plans"),
    symbols: "unicode",
    border: "rounded",
    showHints: true,
    shortcut: "shift+tab",
  });
  await writeSettings(join(agent, "orbis-plan.json"), {
    border: "double",
    planDirectory: "personal-plans",
  });
  await writeSettings(join(cwd, ".pi/plan.json"), { planDirectory: "project-plans" });
  expect(await readSettings(agent, cwd, true)).toEqual({
    planDirectory: resolve(cwd, "project-plans"),
    symbols: "unicode",
    border: "double",
    showHints: true,
    shortcut: "shift+tab",
  });
  expect((await readSettings(agent, cwd, false)).planDirectory).toBe(
    resolve(cwd, "personal-plans"),
  );
  const other = join(cwd, "other");
  expect((await readSettings(agent, other, true)).planDirectory).toBe(
    resolve(other, "personal-plans"),
  );
  await writeSettings(join(agent, "orbis-plan.json"), { planDirectory: cwd });
  expect((await readSettings(agent, other, false)).planDirectory).toBe(cwd);
});

test("malformed settings identify the file and preserve its bytes", async ({ onTestFinished }) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-config-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  await Promise.all(
    [
      "{",
      '{"interface":"browser"}',
      '{"planDirectory":" "}',
      '{"planDirectory":12}',
      '{"extra":true}',
      '{"symbols":"ascii"}',
      '{"border":"thick"}',
      '{"showHints":"off"}',
      '{"showHints":0}',
      '{"shortcut":"ctrl+ctrl+p"}',
      '{"shortcut":"a"}',
      '{"shortcut":"shift+a"}',
      '{"shortcut":"ctrl+notakey"}',
      '{"shortcut":"ctrl+escape"}',
      '{"shortcut":"alt+esc"}',
      '{"shortcut":"ctrl++"}',
      '{"shortcut":false}',
    ].map(async (content, index) => {
      const path = join(cwd, `invalid-${String(index)}.json`);
      await writeFile(path, content);
      await expect(readSettingsFile(path)).rejects.toThrow(path);
      await expect(writeSettings(path, { showHints: true })).rejects.toThrow("Correct this file");
      expect(await readFile(path, "utf8")).toBe(content);
    }),
  );
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi/plan.json"), "invalid");
  await expect(readSettings(join(cwd, "absent"), cwd, false)).resolves.toEqual({
    planDirectory: resolve(cwd, ".pi/plans"),
    symbols: "unicode",
    border: "rounded",
    showHints: true,
    shortcut: "shift+tab",
  });
});

test("planning shortcut defaults, disabling and trusted overrides persist", async ({
  onTestFinished,
}) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-shortcut-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const agent = join(cwd, "agent");
  expect((await readSettings(agent, cwd, false)).shortcut).toBe("shift+tab");
  await writeSettings(join(agent, "orbis-plan.json"), { shortcut: null });
  expect((await readSettings(agent, cwd, false)).shortcut).toBeNull();
  await writeSettings(join(cwd, ".pi/plan.json"), { shortcut: "ctrl+alt+p" });
  expect((await readSettings(agent, cwd, true)).shortcut).toBe("ctrl+alt+p");
  expect((await readSettings(agent, cwd, false)).shortcut).toBeNull();
});

test("appearance settings merge only trusted project fields and preserve the directory", async ({
  onTestFinished,
}) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-appearance-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const agent = join(cwd, "agent");
  await writeSettings(join(agent, "orbis-plan.json"), {
    symbols: "emoji",
    border: "double",
    planDirectory: "plans",
  });
  await writeSettings(join(cwd, ".pi/plan.json"), { border: "ascii" });
  expect(await readSettings(agent, cwd, false)).toEqual({
    symbols: "emoji",
    border: "double",
    planDirectory: resolve(cwd, "plans"),
    showHints: true,
    shortcut: "shift+tab",
  });
  expect(await readSettings(agent, cwd, true)).toEqual({
    symbols: "emoji",
    border: "ascii",
    planDirectory: resolve(cwd, "plans"),
    showHints: true,
    shortcut: "shift+tab",
  });
});
