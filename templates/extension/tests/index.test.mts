import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

test("loads the TypeScript source and registers the package command", async ({
  onTestFinished,
}) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-extension-"));
  onTestFinished(() => rm(fixture, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: fixture,
    agentDir: join(fixture, "agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [resolve(import.meta.dirname, "../src/index.ts")],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions).toHaveLength(1);
  expect(typeof loaded.extensions[0]?.commands.get("orbis-example")?.handler).toBe("function");
});
