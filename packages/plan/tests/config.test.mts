import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "vitest";

import { readSettings, readSettingsFile, writeSettings } from "../src/config.ts";

test("settings inherit defaults and trust gates project overrides", async ({ onTestFinished }) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-config-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const agent = join(cwd, "agent");
  expect(await readSettings(agent, cwd, false)).toEqual({
    interface: "terminal",
    planDirectory: resolve(cwd, ".pi/plans"),
  });
  await writeSettings(join(agent, "orbis-plan.json"), {
    interface: "browser",
    planDirectory: "personal-plans",
  });
  await writeSettings(join(cwd, ".pi/plan.json"), { planDirectory: "project-plans" });
  expect(await readSettings(agent, cwd, true)).toEqual({
    interface: "browser",
    planDirectory: resolve(cwd, "project-plans"),
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
  expect((await readSettings(agent, other, false)).interface).toBe("browser");
});

test("malformed settings identify the file and preserve its bytes", async ({ onTestFinished }) => {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-config-"));
  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  await Promise.all(
    [
      "{",
      '{"interface":"auto"}',
      '{"planDirectory":" "}',
      '{"planDirectory":12}',
      '{"extra":true}',
    ].map(async (content, index) => {
      const path = join(cwd, `invalid-${String(index)}.json`);
      await writeFile(path, content);
      await expect(readSettingsFile(path)).rejects.toThrow(path);
      await expect(writeSettings(path, { interface: "terminal" })).rejects.toThrow(
        "Correct this file",
      );
      expect(await readFile(path, "utf8")).toBe(content);
    }),
  );
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi/plan.json"), "invalid");
  await expect(readSettings(join(cwd, "absent"), cwd, false)).resolves.toMatchObject({
    interface: "terminal",
  });
});
