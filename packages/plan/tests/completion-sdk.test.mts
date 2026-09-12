import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CreateAgentSessionRuntimeFactory,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test, vi } from "vitest";

import extension from "../src/index.ts";
import * as terminal from "../src/pi/terminal.ts";

const model = {
  id: "completion",
  name: "Completion fixture",
  provider: "completion-fixture",
  api: "completion-fixture-api",
  baseUrl: "http://127.0.0.1",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
};
const unused = () => {
  throw new Error("Unexpected session operation");
};

interface Options {
  commandCollision?: boolean;
  selection?: string;
  queue?: "steer" | "followUp";
  sibling?: "terminate" | "continue";
  cancelReplacement?: boolean;
  rejectReplacement?: boolean;
  setup?: (pi: ExtensionAPI) => void;
  pauseContinuation?: boolean;
  implementArguments?: Record<string, unknown>;
}

async function fixture(options: Options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-completion-sdk-"));
  const agentDir = join(cwd, "agent");
  const contexts: { sessionId: string; context: Context }[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  const finished = Promise.withResolvers<undefined>();
  const sessions: AgentSession[] = [];
  const continued = Promise.withResolvers<undefined>();
  const handoffDone = Promise.withResolvers<undefined>();
  const approvals: unknown[] = [];
  let activeApi: ExtensionAPI | undefined;
  const factory: CreateAgentSessionRuntimeFactory = async (args) => {
    if (options.rejectReplacement === true && args.sessionStartEvent?.reason === "new") {
      throw new Error("Injected replacement creation failure");
    }
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          (pi) => {
            activeApi = pi;
            extension({
              ...pi,
              registerCommand(name, command) {
                pi.registerCommand(name, {
                  ...command,
                  async handler(commandArgs, ctx) {
                    try {
                      await command.handler(commandArgs, ctx);
                    } finally {
                      if (commandArgs.startsWith("__handoff ")) {
                        handoffDone.resolve(undefined);
                      }
                    }
                  },
                });
              },
            });
            options.setup?.(pi);
            pi.events.on("orbis:plan-approved", (approval) => {
              approvals.push(approval);
            });
            if (options.cancelReplacement === true) {
              pi.on("session_before_switch", () => ({ cancel: true }));
            }
            pi.registerTool({
              name: "sibling",
              label: "Sibling",
              description: "Return a scripted sibling result",
              parameters: Type.Object({}),
              executionMode: "sequential",
              async execute() {
                await Promise.resolve();
                return {
                  content: [{ type: "text", text: "Sibling result" }],
                  details: {},
                  ...(options.sibling === "terminate" ? { terminate: true } : {}),
                };
              },
            });
            pi.registerProvider(model.provider, {
              api: model.api,
              apiKey: "fixture",
              baseUrl: model.baseUrl,
              models: [model],
              streamSimple(_model, context, streamOptions) {
                expect(streamOptions?.signal?.aborted).not.toBe(true);
                contexts.push({
                  sessionId: args.sessionManager.getSessionId(),
                  context: {
                    messages: structuredClone(context.messages),
                    ...(context.systemPrompt === undefined
                      ? {}
                      : { systemPrompt: context.systemPrompt }),
                  },
                });
                if (contexts.length > 8) {
                  throw new Error("Unexpected model continuation");
                }
                const users = context.messages.filter((message) => message.role === "user");
                const lastUser = users.at(-1);
                const userText =
                  typeof lastUser?.content === "string"
                    ? lastUser.content
                    : (lastUser?.content
                        .map((part) => (part.type === "text" ? part.text : ""))
                        .join("") ?? "");
                const start = context.messages.find(
                  (message) => message.role === "toolResult" && message.toolName === "plan_start",
                );
                const reviewed = context.messages.some(
                  (message) => message.role === "toolResult" && message.toolName === "plan_review",
                );
                let content: AssistantMessage["content"] = [
                  { type: "text", text: "Approval acknowledged. Finished." },
                ];
                if (
                  options.implementArguments !== undefined &&
                  !context.messages.some(
                    (message) =>
                      message.role === "toolResult" && message.toolName === "plan_implement",
                  )
                ) {
                  content = [
                    {
                      type: "toolCall",
                      id: "implement",
                      name: "plan_implement",
                      arguments: options.implementArguments,
                    },
                  ];
                } else if (options.implementArguments !== undefined) {
                  content = [{ type: "text", text: "Rejected request acknowledged." }];
                } else if (userText.startsWith("Implement the approved plan")) {
                  launches.push(args.sessionManager.getSessionId());
                  finished.resolve(undefined);
                } else if (start === undefined) {
                  content = [
                    {
                      type: "toolCall",
                      id: "start",
                      name: "plan_start",
                      arguments: { objective: "Completion fixture" },
                    },
                  ];
                } else if (!reviewed) {
                  const text =
                    start.role === "toolResult"
                      ? start.content
                          .map((part) => (part.type === "text" ? part.text : ""))
                          .join("")
                      : "";
                  const planId = /"planId":\s*"([^"]+)"/u.exec(text)?.[1];
                  content = [
                    {
                      type: "toolCall",
                      id: "review",
                      name: "plan_review",
                      arguments: {
                        planId,
                        expectedRevision: 0,
                        markdown: "# Approved\nImplementation awaits separate authorization.\n",
                      },
                    },
                  ];
                  if (options.sibling !== undefined) {
                    content.push({
                      type: "toolCall",
                      id: "sibling",
                      name: "sibling",
                      arguments: {},
                    });
                  }
                }
                const stopReason = content.some((part) => part.type === "toolCall")
                  ? "toolUse"
                  : "stop";
                const message: AssistantMessage = {
                  role: "assistant",
                  content,
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                  },
                  stopReason,
                  timestamp: Date.now(),
                };
                const stream = createAssistantMessageEventStream();
                if (
                  options.pauseContinuation === true &&
                  stopReason === "stop" &&
                  !userText.startsWith("Implement the approved plan")
                ) {
                  continued.resolve(undefined);
                  const abort = () => {
                    stream.push({
                      type: "error",
                      reason: "aborted",
                      error: {
                        ...message,
                        content: [],
                        stopReason: "aborted",
                        errorMessage: "Fixture interrupted",
                      },
                    });
                  };
                  streamOptions?.signal?.addEventListener("abort", abort, { once: true });
                  if (streamOptions?.signal?.aborted === true) {
                    abort();
                  }
                } else {
                  stream.push({ type: "done", reason: stopReason, message });
                }
                return stream;
              },
            });
          },
          ...(options.commandCollision === true
            ? [
                (pi: ExtensionAPI) => {
                  pi.registerCommand("plan", {
                    description: "Competing planning command",
                    handler: () => {
                      throw new Error("Wrong command dispatched");
                    },
                  });
                },
              ]
            : []),
        ],
      },
    });
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: args.sessionManager,
      model,
      noTools: "builtin",
      ...(args.sessionStartEvent === undefined
        ? {}
        : { sessionStartEvent: args.sessionStartEvent }),
    });
    sessions.push(created.session);
    return { ...created, services, diagnostics: [] };
  };
  const runtime = await createAgentSessionRuntime(factory, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd, join(cwd, "sessions")),
  });
  const bind = async (session: AgentSession) => {
    const base = session.extensionRunner.createContext();
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        ...base.ui,
        notify() {
          return undefined;
        },
        setStatus() {
          return undefined;
        },
        async select(title) {
          expect(title).toBe("Implement approved plan?");
          expect(session.isIdle).toBe(false);
          if (options.queue !== undefined) {
            await session.prompt("Queued user input", { streamingBehavior: options.queue });
          }
          return options.selection;
        },
      },
      onError(error) {
        errors.push(error.error);
        finished.resolve(undefined);
      },
      commandContextActions: {
        waitForIdle: async () => {
          await session.waitForIdle();
        },
        newSession: async (args) => await runtime.newSession(args),
        fork: unused,
        switchSession: unused,
        navigateTree: unused,
        reload: unused,
      },
    });
  };
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  return {
    runtime,
    contexts,
    errors,
    launches,
    approvals,
    finished: finished.promise,
    continued: continued.promise,
    handoffDone: handoffDone.promise,
    api() {
      if (activeApi === undefined) {
        throw new Error("Missing API");
      }
      return activeApi;
    },
    dispose: async () => {
      await runtime.session.abort();
      await runtime.dispose();
      await rm(cwd, { recursive: true, force: true });
    },
    async idle() {
      await Promise.all(
        sessions.map(async (session) => {
          await session.waitForIdle();
        }),
      );
    },
  };
}

function approve() {
  return vi.spyOn(terminal, "terminalReview").mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "edit-feedback", text: "Supplementary SDK notes" });
    dispatch({ type: "approve-with-notes" });
    await Promise.resolve();
  });
}

test("host interruption after approval cancels handoff during mixed-batch continuation", async ({
  onTestFinished,
}) => {
  const view = approve();
  onTestFinished(() => {
    view.mockRestore();
  });
  const f = await fixture({
    selection: "Implement in a new session",
    sibling: "continue",
    pauseContinuation: true,
  });
  onTestFinished(f.dispose);
  const origin = f.runtime.session.sessionId;
  const planning = f.runtime.session.prompt("Plan the change");
  await f.continued;
  await f.runtime.session.abort();
  await planning;
  await f.handoffDone;
  expect(f.launches).toEqual([]);
  expect(f.runtime.session.sessionId).toBe(origin);
  expect(f.approvals).toHaveLength(1);
  expect(f.runtime.session.messages.at(-1)).toMatchObject({
    role: "assistant",
    stopReason: "aborted",
    errorMessage: "Fixture interrupted",
  });
});

test.for([
  { action: "invalid" },
  { action: "here", planId: "" },
  { action: "here", extra: true },
  { action: "new", planId: "unapproved" },
])(
  "plan_implement rejects $action arguments through Pi's failed-tool boundary",
  async (implementArguments, { onTestFinished }) => {
    const f = await fixture({ implementArguments });
    onTestFinished(f.dispose);
    await f.runtime.session.prompt("Exercise rejected implementation input");
    const result = f.runtime.session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "plan_implement",
    );
    expect(result).toMatchObject({ role: "toolResult", isError: true });
    expect(f.launches).toEqual([]);
    expect(f.approvals).toEqual([]);
  },
);

test.for([
  { label: "single terminating result", options: {}, calls: 2 },
  {
    label: "all sequential results terminate",
    options: { sibling: "terminate" as const },
    calls: 2,
  },
  {
    label: "mixed sequential batch continues",
    options: { sibling: "continue" as const },
    calls: 3,
  },
  { label: "queued steering continues", options: { queue: "steer" as const }, calls: 3 },
  { label: "queued follow-up continues", options: { queue: "followUp" as const }, calls: 3 },
])("SDK $label preserves graceful completion", async ({ options, calls }, { onTestFinished }) => {
  const view = approve();
  onTestFinished(() => {
    view.mockRestore();
  });
  const f = await fixture(options);
  onTestFinished(f.dispose);
  await f.runtime.session.prompt("Plan the change");
  expect(
    f.runtime.session.messages.filter(
      (message) => message.role === "assistant" && message.stopReason === "error",
    ),
  ).toEqual([]);
  expect(f.contexts).toHaveLength(calls);
  expect(f.errors).toEqual([]);
  expect(f.launches).toEqual([]);
  expect(f.approvals).toHaveLength(1);
  expect(
    f.runtime.session.messages
      .filter((message) => message.role === "assistant")
      .every((message) => message.stopReason !== "aborted" && message.stopReason !== "error"),
  ).toBe(true);
  expect(JSON.stringify(f.contexts.at(-1)?.context.messages).includes("Queued user input")).toBe(
    options.queue !== undefined,
  );
});

test.for(["Implement in this session", "Implement in a new session"])(
  "SDK %s sends one authorized prompt to the intended session",
  async (selection, { onTestFinished }) => {
    const view = approve();
    onTestFinished(() => {
      view.mockRestore();
    });
    const f = await fixture({ selection, queue: "followUp" });
    onTestFinished(f.dispose);
    const origin = f.runtime.session.sessionId;
    await f.runtime.session.prompt("Original planning context");
    await f.finished;
    await f.idle();
    expect(f.errors).toEqual([]);
    expect(f.launches).toHaveLength(1);
    const launch = f.contexts.at(-1);
    const prompt = JSON.stringify(launch?.context.messages);
    expect(prompt).toContain("authorizes execution now");
    expect(prompt).toContain("Supplementary SDK notes");
    const fresh = selection === "Implement in a new session";
    expect(launch?.sessionId === origin).toBe(!fresh);
    expect(prompt.includes("Original planning context")).toBe(!fresh);
    expect(
      f.contexts.some(
        (entry) =>
          entry.sessionId === origin &&
          JSON.stringify(entry.context.messages).includes("Queued user input"),
      ),
    ).toBe(true);
    expect(f.approvals).toHaveLength(1);
    const approval = f.approvals[0];
    if (
      typeof approval !== "object" ||
      approval === null ||
      !("planPath" in approval) ||
      typeof approval.planPath !== "string"
    ) {
      throw new Error("Missing approval");
    }
    expect(await readFile(approval.planPath, "utf8")).toContain(
      "Implementation awaits separate authorization",
    );
  },
);

test.for(["cancel", "failure"] as const)(
  "SDK replacement %s preserves approval and reports the error",
  async (failure, { onTestFinished }) => {
    const view = approve();
    onTestFinished(() => {
      view.mockRestore();
    });
    const f = await fixture({
      selection: "Implement in a new session",
      cancelReplacement: failure === "cancel",
      rejectReplacement: failure === "failure",
    });
    onTestFinished(f.dispose);
    const origin = f.runtime.session.sessionId;
    await f.runtime.session.prompt("Plan the change");
    await f.finished;
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toContain("approval is preserved");
    expect(f.launches).toEqual([]);
    expect(f.approvals).toHaveLength(1);
    expect(f.runtime.session.sessionId).toBe(origin);
  },
);

test.for([false, true])(
  "SDK command expansion %s controls dispatch before follow-up queueing",
  async (expand, { onTestFinished }) => {
    const commandStarted = vi.fn<(idle: boolean) => void>();
    const commandFinished = vi.fn<() => void>();
    const f = await fixture({
      setup(pi) {
        pi.registerCommand("routing-probe", {
          description: "Probe command routing",
          async handler(_args, ctx: ExtensionCommandContext) {
            commandStarted(ctx.isIdle());
            await ctx.waitForIdle();
            commandFinished();
          },
        });
      },
    });
    onTestFinished(f.dispose);
    const view = vi
      .spyOn(terminal, "terminalReview")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        f.api().sendUserMessage("/routing-probe", {
          expandPromptTemplates: expand,
          deliverAs: "followUp",
        });
        await Promise.resolve();
        expect(commandStarted.mock.calls).toEqual(expand ? [[false]] : []);
        expect(commandFinished).not.toHaveBeenCalled();
        dispatch({ type: "approve" });
      });
    onTestFinished(() => {
      view.mockRestore();
    });
    await f.runtime.session.prompt("Plan the change");
    await f.idle();
    expect(commandStarted).toHaveBeenCalledTimes(expand ? 1 : 0);
    expect(commandFinished).toHaveBeenCalledTimes(expand ? 1 : 0);
    expect(JSON.stringify(f.runtime.session.messages).includes("/routing-probe")).toBe(!expand);
    expect(f.errors).toEqual([]);
  },
);

test("implementation handoff resolves Pi command collision suffixes", async ({
  onTestFinished,
}) => {
  const view = approve();
  onTestFinished(() => {
    view.mockRestore();
  });
  const f = await fixture({ selection: "Implement in this session", commandCollision: true });
  onTestFinished(f.dispose);
  expect(
    f.runtime.session.extensionRunner
      .getRegisteredCommands()
      .map((command) => command.invocationName),
  ).toContain("plan:1");
  await f.runtime.session.prompt("Original planning context");
  await f.finished;
  await f.idle();
  expect(f.errors).toEqual([]);
  expect(f.launches).toHaveLength(1);
});
