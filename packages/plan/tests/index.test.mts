import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import extension from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

const unused = () => {
  throw new Error("Unexpected session operation");
};

test.for([
  { objective: "Design a task tracker.", block: "```\nDesign a task tracker.\n```" },
  {
    objective: "Keep this example:\n```text\nhello\n```",
    block: "````\nKeep this example:\n```text\nhello\n```\n````",
  },
])(
  "planning entry fences the objective: $objective",
  async ({ objective, block }, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    const send = vi.spyOn(f.api, "sendUserMessage").mockImplementation(() => undefined);
    onTestFinished(() => {
      send.mockRestore();
    });
    extension(f.api);
    const command = f.resources.getExtensions().extensions[0]?.commands.get("plan");
    if (command === undefined) {
      throw new Error("Missing plan command");
    }
    await command.handler(objective, {
      ...f.ctx,
      getSystemPromptOptions: unused,
      waitForIdle: unused,
      newSession: unused,
      fork: unused,
      navigateTree: unused,
      switchSession: unused,
      reload: unused,
    });
    f.runtime.restore(f.ctx);
    expect(send).toHaveBeenCalledWith(
      `Develop a collaborative plan for:\n${block}\n\nPlanning identity: ${f.runtime.active?.planId ?? ""}. Research before presenting a plan_round.`,
    );
  },
);

test("loads the TypeScript source and registers the package command", async ({
  onTestFinished,
}) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-extension-"));
  onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
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
  expect(typeof loaded.extensions[0]?.commands.get("plan")?.handler).toBe("function");
  expect(loaded.extensions[0]?.tools.has("plan_start")).toBe(true);
  expect([...(loaded.extensions[0]?.commands.keys() ?? [])].toSorted()).toEqual([
    "plan",
    "plan-settings",
  ]);
  const { session } = await createAgentSession({
    cwd: fixture,
    agentDir: join(fixture, "agent"),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(fixture),
    settingsManager: SettingsManager.inMemory(),
  });
  onTestFinished(() => {
    session.dispose();
  });
  await session.bindExtensions({});
  expect(session.systemPrompt).toContain(
    "call plan_start with replace: false before claiming saved work is unavailable",
  );
  expect(session.systemPrompt).toContain("Do not resume for unrelated messages");
  expect(session.systemPrompt).not.toContain("Planning is active");
});
