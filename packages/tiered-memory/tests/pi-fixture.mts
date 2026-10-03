import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEventStream, Message } from "@earendil-works/pi-ai";
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

import { observerRequest } from "../src/domain/observer.ts";
import { reportEntrySchema } from "../src/domain/settings.ts";
import { registerTieredMemory } from "../src/pi/extension.ts";
import type { TieredMemory } from "../src/pi/extension.ts";
import { disposeStorageRuntimes, testServices } from "./storage-harness.mts";
import type { TestServices } from "./storage-harness.mts";

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

/** Describe one observer completion request that reached the scripted provider. */
export interface ObserverCall {
  model: string;
  systemPrompt: string;
  prompt: string;
  options: { maxTokens?: number; maxRetries?: number; timeoutMs?: number; signal?: AbortSignal };
}

/** Answer an observer completion; a rejection becomes a provider error response. */
export type ObserverScript = (call: ObserverCall) => AssistantMessage | Promise<AssistantMessage>;

const observerSystemPrompt = observerRequest({
  interval: { spans: [], tokens: 0 },
  previousNote: undefined,
  checkpoint: undefined,
}).systemPrompt;

/** Build a scripted assistant message from the fixture model. */
export function fixtureMessage(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: fixtureModel.api,
    provider: fixtureModel.provider,
    model: fixtureModel.id,
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
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
}

function textOf(message: Message | undefined): string {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

const unscriptedObserver: ObserverScript = () =>
  fixtureMessage("", "error", "No scripted observer response.");

function observerStream(script: ObserverScript, call: ObserverCall): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void Promise.resolve()
    .then(async () => await script(call))
    .then(
      (message) => {
        const reason = message.stopReason;
        if (reason === "error" || reason === "aborted") {
          stream.push({ type: "error", reason, error: message });
        } else {
          stream.push({ type: "done", reason: reason === "pending" ? "stop" : reason, message });
        }
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        stream.push({ type: "error", reason: "error", error: fixtureMessage("", "error", text) });
      },
    );
  return stream;
}

/**
 * Describe one acting or native-summarizer request that reached the scripted provider; `summary`
 * marks Pi's compaction summarizer, which always receives "Fixture response".
 */
export interface ActingRequest {
  model: string;
  messages: Message[];
  tools: string[];
  summary: boolean;
}

/**
 * Script one acting response: text, tool calls, provider-reported usage, or a provider error, after
 * `wait` resolves when it is given.
 */
export interface ActingStep {
  text?: string;
  toolCalls?: {
    name: string;
    arguments: Extract<AssistantMessage["content"][number], { type: "toolCall" }>["arguments"];
  }[];
  usage?: Partial<AssistantMessage["usage"]>;
  errorMessage?: string;
  wait?: Promise<void>;
}

function actingStream(
  active: { api: string; provider: string; id: string },
  step: ActingStep,
  callId: string,
  signal: AbortSignal | undefined,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const calls = step.toolCalls ?? [];
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...step.usage,
  };
  const header = {
    role: "assistant" as const,
    api: active.api,
    provider: active.provider,
    model: active.id,
    timestamp: Date.now(),
    usage,
  };
  const finish = (): void => {
    if (step.errorMessage !== undefined) {
      const error: AssistantMessage = {
        ...header,
        content: step.text === undefined ? [] : [{ type: "text", text: step.text }],
        stopReason: "error",
        errorMessage: step.errorMessage,
      };
      stream.push({ type: "error", reason: "error", error });
      return;
    }
    const content: AssistantMessage["content"] =
      calls.length === 0
        ? [{ type: "text", text: step.text ?? "Fixture response" }]
        : calls.map((call, index) => ({
            type: "toolCall" as const,
            id: calls.length === 1 ? callId : `${callId}-${String(index)}`,
            name: call.name,
            arguments: call.arguments,
          }));
    const reason = calls.length === 0 ? "stop" : "toolUse";
    stream.push({ type: "done", reason, message: { ...header, content, stopReason: reason } });
  };
  if (step.wait === undefined) {
    finish();
    return stream;
  }
  let settled = false;
  const abort = (): void => {
    if (!settled) {
      settled = true;
      const error: AssistantMessage = {
        ...header,
        content: [],
        stopReason: "aborted",
        errorMessage: "Request was aborted",
      };
      stream.push({ type: "error", reason: "aborted", error });
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  void step.wait.then(
    () => {
      signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        finish();
      }
    },
    () => undefined,
  );
  return stream;
}

export interface Fixture {
  cwd: string;
  /** Acting requests the scripted provider received, oldest first; observer requests excluded. */
  requests: ActingRequest[];
  agentDir: string;
  session: AgentSession;
  settings: SettingsManager;
  /** The extension's owners when it loaded with injected `services`; reload replaces them. */
  memory: () => TieredMemory;
  notifications: { message: string; type: "info" | "warning" | "error" | undefined }[];
  report: () => string;
  command: (args: string) => Promise<void>;
  reload: () => Promise<void>;
  onDispose: (teardown: () => Promise<void>) => void;
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
  /** Load the extension through `registerTieredMemory` over these test capabilities. */
  services?: TestServices;
  /** Answer observer completions; unscripted requests receive a provider error response. */
  observer?: ObserverScript;
  /** Script acting responses; `undefined` falls back to `toolCalls` or "Fixture response". */
  acting?: (request: ActingRequest) => ActingStep | undefined;
  /** Load these extension factories after the extension, for example to register models. */
  extensions?: ((pi: ExtensionAPI) => void)[];
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
  const teardowns: (() => Promise<void>)[] = [];
  let nextToolCall = 0;
  const requests: ActingRequest[] = [];
  let memory: TieredMemory | undefined;
  const services = options.services;
  const extensionPath = resolve(import.meta.dirname, "../src/index.ts");
  const sessionServices = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager: settings,
    resourceLoaderOptions: {
      noExtensions: true,
      additionalExtensionPaths: services === undefined ? [extensionPath] : [],
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
            streamSimple(active, context, streamOptions) {
              const [system, first] = context.messages;
              if (system?.role === "system" && textOf(system) === observerSystemPrompt) {
                return observerStream(options.observer ?? unscriptedObserver, {
                  model: `${active.provider}/${active.id}`,
                  systemPrompt: observerSystemPrompt,
                  prompt: textOf(first),
                  options: {
                    ...(streamOptions?.maxTokens === undefined
                      ? {}
                      : { maxTokens: streamOptions.maxTokens }),
                    ...(streamOptions?.maxRetries === undefined
                      ? {}
                      : { maxRetries: streamOptions.maxRetries }),
                    ...(streamOptions?.timeoutMs === undefined
                      ? {}
                      : { timeoutMs: streamOptions.timeoutMs }),
                    ...(streamOptions?.signal === undefined
                      ? {}
                      : { signal: streamOptions.signal }),
                  },
                });
              }
              const request: ActingRequest = {
                model: `${active.provider}/${active.id}`,
                messages: [...context.messages],
                tools: getCurrentTools(context.messages).map((tool) => tool.name),
                summary: getCurrentSystemPrompt(context.messages).includes(
                  "summarization assistant",
                ),
              };
              requests.push(request);
              const scripted = request.summary ? undefined : options.acting?.(request);
              if (scripted !== undefined) {
                return actingStream(
                  active,
                  scripted,
                  `call-${String(requests.length)}`,
                  streamOptions?.signal,
                );
              }
              const requested = request.summary ? undefined : options.toolCalls?.[nextToolCall];
              if (requested !== undefined) {
                nextToolCall++;
              }
              const step = requested === undefined ? {} : { toolCalls: [requested] };
              return actingStream(
                active,
                step,
                `fixture-${String(nextToolCall)}`,
                streamOptions?.signal,
              );
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
        ...(services === undefined
          ? []
          : [
              (pi: ExtensionAPI) => {
                memory = registerTieredMemory(pi, testServices(services));
              },
            ]),
        ...(options.extensions ?? []),
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
    services: sessionServices,
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
    requests,
    agentDir,
    session,
    settings,
    memory() {
      if (memory === undefined) {
        throw new Error("The extension loaded without injected services.");
      }
      return memory;
    },
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
    onDispose(teardown) {
      teardowns.push(teardown);
    },
    async dispose() {
      for (const teardown of teardowns.toReversed()) {
        // oxlint-disable-next-line no-await-in-loop -- Later teardowns can depend on earlier ones.
        await teardown();
      }
      await session.abort();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      await disposeStorageRuntimes();
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
