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

import type { PlanningSession } from "../src/domain/state.ts";
import { planCommandDescription } from "../src/pi/instructions.ts";
import { PlanRuntime } from "../src/pi/runtime.ts";
import { saveRecord } from "../src/storage/persistence.ts";
import type { SaveResult } from "../src/storage/persistence.ts";

/** Establish Pi’s initial persistence boundary without a model request. */
export function appendAssistantFixture(manager: SessionManager): void {
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
}

/** Describe a disposable planning runtime and its cleanup. */
export interface RuntimeFixture {
  runtime: PlanRuntime;
  ctx: ExtensionContext;
  manager: SessionManager;
  api: ExtensionAPI;
  resources: DefaultResourceLoader;
  persist: (plan: PlanningSession) => SaveResult;
  shutdown: () => Promise<void>;
  startup: () => Promise<void>;
  dispose: () => Promise<void>;
}
/** Create an isolated disk-backed planning runtime without model turns. */
export async function runtimeFixture(): Promise<RuntimeFixture> {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-runtime-"));
  let cleanup = async () => {
    await rm(cwd, { recursive: true, force: true });
  };
  try {
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
          pi.registerCommand("plan", {
            description: planCommandDescription,
            handler: async () => {
              await Promise.resolve();
            },
          });
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
    cleanup = async () => {
      try {
        await session.abort();
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        session.dispose();
        await rm(cwd, { recursive: true, force: true });
      }
    };
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
        async select(title, _options, options) {
          if (title === "Implement approved plan?") {
            return undefined;
          }
          await new Promise<undefined>((resolve) => {
            const finish = () => {
              resolve(undefined);
            };
            options?.signal?.addEventListener("abort", finish, { once: true });
            if (options?.signal?.aborted === true) {
              finish();
            }
          });
          return undefined;
        },
        setStatus() {
          return undefined;
        },
      },
    };
    appendAssistantFixture(manager);
    return {
      runtime: planning,
      ctx,
      manager,
      api,
      resources: loader,
      persist(plan) {
        return saveRecord(extensionApi, ctx, {
          version: 1,
          mode: "plan",
          active: plan,
          unfinished: [],
        });
      },
      async shutdown() {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
      },
      async startup() {
        await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
      },
      async dispose(): Promise<void> {
        await session.abort();
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        planning.close(ctx);
        session.dispose();
        await rm(cwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
