import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DefaultResourceLoader,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { assert, expect, test, vi } from "vitest";

test("loads the package and requests shutdown through /exit", async ({ onTestFinished }) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-extension-"));
  onTestFinished(() => rm(fixture, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: fixture,
    agentDir: join(fixture, "agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [resolve(import.meta.dirname, "..")],
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
  const extension = loaded.extensions[0];
  assert.isDefined(extension);
  expect([...extension.commands.keys()]).toEqual(["exit"]);
  const command = extension.commands.get("exit");
  assert.isDefined(command);
  const modelRuntime = await ModelRuntime.create({
    authPath: join(fixture, "auth.json"),
    modelsPath: join(fixture, "models.json"),
    modelsStorePath: join(fixture, "models-cache"),
    refreshOnCreate: false,
  });
  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    fixture,
    SessionManager.inMemory(fixture),
    new ModelRegistry(modelRuntime),
  );
  const context = runner.createCommandContext();
  const shutdown = vi.spyOn(context, "shutdown");
  await command.handler("", context);
  expect(shutdown).toHaveBeenCalledExactlyOnceWith();
});
