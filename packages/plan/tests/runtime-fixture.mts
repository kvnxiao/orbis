import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { saveRecord } from "../src/persistence.ts";
import type { SaveResult } from "../src/persistence.ts";
import { PlanRuntime } from "../src/runtime.ts";
import type { PlanningSession } from "../src/state.ts";

interface RuntimeFixture {
  runtime: PlanRuntime;
  ctx: ExtensionContext;
  manager: SessionManager;
  api: ExtensionAPI;
  persist: (plan: PlanningSession) => SaveResult;
  dispose: () => Promise<void>;
}
export async function runtimeFixture(): Promise<RuntimeFixture> {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-runtime-"));
  const manager = SessionManager.create(cwd, join(cwd, "sessions"));
  let runtime: PlanRuntime | undefined;
  let api: ExtensionAPI | undefined;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        api = pi;
        runtime = new PlanRuntime(pi, join(cwd, "agent"));
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: join(cwd, "agent"),
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory(),
  });
  await session.bindExtensions({});
  if (runtime === undefined || api === undefined) {
    throw new Error("Fixture did not initialize planning runtime");
  }
  const planning = runtime;
  const extensionApi = api;
  const base = session.extensionRunner.createContext();
  const ctx: ExtensionContext = {
    ...base,
    mode: "tui",
    ui: {
      ...base.ui,
      notify() {
        return undefined;
      },
      setStatus() {
        return undefined;
      },
    },
  };
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Fixture response" }],
    api: "openai-responses",
    provider: "openai",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  return {
    runtime: planning,
    ctx,
    manager,
    api,
    persist(plan) {
      return saveRecord(extensionApi, ctx, { version: 1, active: plan, unfinished: [] });
    },
    async dispose(): Promise<void> {
      await session.abort();
      planning.close(ctx);
      session.dispose();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
