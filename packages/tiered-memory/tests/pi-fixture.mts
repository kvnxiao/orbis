import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CreateAgentSessionFromServicesOptions,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { test as base } from "vitest";

import { reportEntrySchema } from "../src/domain/settings.ts";

export const fixtureModel = {
  id: "fixture",
  name: "Fixture",
  provider: "tiered-fixture",
  api: "tiered-fixture-api",
  baseUrl: "http://127.0.0.1",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16000,
  maxTokens: 4000,
};

export interface Fixture {
  cwd: string;
  agentDir: string;
  session: AgentSession;
  settings: SettingsManager;
  notifications: { message: string; type: "info" | "warning" | "error" | undefined }[];
  report: () => string;
  command: (args: string) => Promise<void>;
  reload: () => Promise<void>;
  dispose: () => Promise<void>;
}

type FixtureModel = NonNullable<CreateAgentSessionFromServicesOptions["model"]>;

export interface FixtureOptions {
  trusted?: boolean;
  personal?: unknown;
  project?: unknown;
  model?: FixtureModel;
  models?: FixtureModel[];
  noAuthModel?: FixtureModel;
  credentialCommand?: string;
  cwd?: string;
  sessionFile?: string;
  inMemory?: boolean;
  builtinTools?: boolean;
  toolCalls?: {
    name: "write" | "edit";
    arguments: Extract<AssistantMessage["content"][number], { type: "toolCall" }>["arguments"];
  }[];
}

export function findEntry<T extends TSchema>(
  session: AgentSession,
  customType: string,
  schema: T,
): { id: string; data: Static<T> } {
  const entry = session.sessionManager
    .getBranch()
    .findLast((candidate) => candidate.type === "custom" && candidate.customType === customType);
  if (entry?.type !== "custom") {
    throw new Error(`Missing ${customType} entry on the active branch.`);
  }
  if (!Value.Check(schema, entry.data)) {
    throw new Error(`Invalid ${customType} entry on the active branch.`);
  }
  return { id: entry.id, data: entry.data };
}

export async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const cwd = options.cwd ?? (await mkdtemp(join(tmpdir(), "orbis-tiered-memory-pi-")));
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (agentDir === undefined) {
    throw new Error("Missing isolated agent directory.");
  }
  await mkdir(join(cwd, ".pi", "tiered-memory"), { recursive: true });
  if (options.personal !== undefined) {
    await writeFile(
      join(agentDir, "tiered-memory.json"),
      typeof options.personal === "string" ? options.personal : JSON.stringify(options.personal),
    );
  }
  if (options.project !== undefined) {
    await writeFile(
      join(cwd, ".pi", "tiered-memory", "settings.json"),
      typeof options.project === "string" ? options.project : JSON.stringify(options.project),
    );
  }
  const settings = SettingsManager.inMemory(
    { compaction: { enabled: false } },
    { projectTrusted: options.trusted ?? true },
  );
  const model = options.model ?? fixtureModel;
  const notifications: Fixture["notifications"] = [];
  let nextToolCall = 0;
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager: settings,
    resourceLoaderOptions: {
      noExtensions: true,
      additionalExtensionPaths: [resolve(import.meta.dirname, "../src/index.ts")],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi: ExtensionAPI) => {
          pi.registerProvider(fixtureModel.provider, {
            api: fixtureModel.api,
            apiKey: "fixture",
            baseUrl: fixtureModel.baseUrl,
            models: [fixtureModel, ...(options.models ?? [])],
            streamSimple(active, _context) {
              const requested = options.toolCalls?.[nextToolCall];
              if (requested !== undefined) {
                nextToolCall++;
              }
              const message: AssistantMessage = {
                role: "assistant",
                content:
                  requested === undefined
                    ? [{ type: "text", text: "Fixture response" }]
                    : [
                        {
                          type: "toolCall",
                          id: `fixture-${String(nextToolCall)}`,
                          name: requested.name,
                          arguments: requested.arguments,
                        },
                      ],
                api: active.api,
                provider: active.provider,
                model: active.id,
                stopReason: requested === undefined ? "stop" : "toolUse",
                timestamp: Date.now(),
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              };
              const stream = createAssistantMessageEventStream();
              stream.push({
                type: "done",
                reason: requested === undefined ? "stop" : "toolUse",
                message,
              });
              return stream;
            },
          });
          if (options.noAuthModel !== undefined) {
            pi.registerProvider(options.noAuthModel.provider, {
              api: fixtureModel.api,
              apiKey: options.credentialCommand ?? "$ORBIS_TIERED_MEMORY_TEST_MISSING_KEY",
              authHeader: true,
              baseUrl: options.noAuthModel.baseUrl,
              models: [options.noAuthModel],
            });
          }
        },
      ],
    },
  });
  let manager: SessionManager;
  if (options.inMemory === true) {
    manager = SessionManager.inMemory(cwd);
  } else if (options.sessionFile === undefined) {
    manager = SessionManager.create(cwd, join(cwd, "sessions"));
  } else {
    manager = SessionManager.open(options.sessionFile, join(cwd, "sessions"), cwd);
  }
  const created = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    model,
    ...(options.builtinTools === true ? {} : { noTools: "builtin" as const }),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  const session = created.session;
  await session.bindExtensions({
    mode: "rpc",
    uiContext: {
      ...session.extensionRunner.createContext().ui,
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  });
  return {
    cwd,
    agentDir,
    session,
    settings,
    notifications,
    report() {
      return findEntry(session, "orbis-tiered-memory-report", reportEntrySchema).data.text;
    },
    async command(args) {
      await session.prompt(`/tiered-memory${args === "" ? "" : ` ${args}`}`);
    },
    async reload() {
      await session.reload();
    },
    async dispose() {
      await session.abort();
      session.dispose();
      if (options.cwd === undefined) {
        await rm(cwd, { recursive: true, force: true });
      }
      await rm(join(agentDir, "tiered-memory.json"), { force: true });
    },
  };
}

export const test = base.extend("createFixture", ({ onTestFinished }) => {
  const created: Fixture[] = [];
  onTestFinished(async () => {
    for (const opened of created.toReversed()) {
      // oxlint-disable-next-line no-await-in-loop -- A later fixture can share an earlier fixture's cwd, which the earlier fixture removes on dispose.
      await opened.dispose();
    }
  });
  return async (options?: FixtureOptions): Promise<Fixture> => {
    const opened = await fixture(options);
    created.push(opened);
    return opened;
  };
});
