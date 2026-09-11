import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test } from "vitest";

import extension from "../src/index.ts";
import { saveRecord } from "../src/persistence.ts";
import { appendAssistantFixture } from "./runtime-fixture.mts";

const fixtureModel = {
  id: "fixture",
  name: "Fixture",
  api: "openai-responses",
  provider: "fixture",
  baseUrl: "http://127.0.0.1",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
};

async function fixture(persist = true, setup?: (pi: ExtensionAPI) => void) {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-host-"));
  const manager = persist
    ? SessionManager.create(cwd, join(cwd, "sessions"))
    : SessionManager.inMemory(cwd);
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
        setup?.(pi);
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: join(cwd, "agent"),
    sessionManager: manager,
    resourceLoader: loader,
    settingsManager: SettingsManager.inMemory(),
  });
  await session.bindExtensions({});
  if (api === undefined) {
    throw new Error("Probe extension was not loaded");
  }
  return {
    cwd,
    manager,
    api,
    session,
    ctx: session.extensionRunner.createContext(),
    async dispose() {
      await session.abort();
      session.dispose();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

test("appendEntry defers disk creation until an assistant message", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.api.appendEntry("probe", { revision: 1 });
  expect(f.manager.getBranch().some((entry) => entry.type === "custom")).toBe(true);
  const path = f.manager.getSessionFile();
  if (path === undefined) {
    throw new Error("Missing session path");
  }
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  appendAssistantFixture(f.manager);
  f.api.appendEntry("probe", { revision: 2 });
  expect(SessionManager.open(path).getBranch()).toEqual(f.manager.getBranch());
});

test("abort inside a tool prevents continuation and deferred notification observes idle", async ({
  onTestFinished,
}) => {
  const order: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const f = await fixture(true, (pi) => {
    pi.registerTool({
      name: "finish_probe",
      label: "Finish probe",
      description: "Probe idle ordering",
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _update, ctx) {
        order.push(`tool:${String(ctx.isIdle())}`);
        ctx.abort();
        timer = setInterval(() => {
          if (ctx.isIdle()) {
            clearInterval(timer);
            order.push("notification:true");
          }
        }, 5);
        return await Promise.resolve({
          content: [{ type: "text", text: "Approved probe" }],
          details: {},
        });
      },
    });
    pi.on("agent_end", (_event, ctx) => {
      order.push(`agent_end:${String(ctx.isIdle())}`);
    });
  });
  onTestFinished(async () => {
    clearInterval(timer);
    await f.dispose();
  });
  let calls = 0;
  f.api.registerProvider("fixture", {
    api: "openai-responses",
    baseUrl: "http://127.0.0.1",
    apiKey: "fixture",
    models: [fixtureModel],
  });
  await f.session.setModel(fixtureModel, { persist: false });
  f.session.agent.streamFunction = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "probe-call", name: "finish_probe", arguments: {} }],
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
      stopReason: "toolUse",
      timestamp: Date.now(),
    };
    if (options?.signal?.aborted === true) {
      stream.push({
        type: "error",
        reason: "aborted",
        error: { ...message, content: [], stopReason: "aborted" },
      });
      return stream;
    }
    calls += 1;
    if (calls > 1) {
      throw new Error("Unexpected implementation continuation");
    }
    stream.push({ type: "done", reason: "toolUse", message });
    return stream;
  };
  await f.session.prompt("Run finish_probe");
  await expect.poll(() => order.includes("notification:true")).toBe(true);
  expect(order).toEqual(["tool:false", "agent_end:false", "notification:true"]);
  expect(calls).toBe(1);
  expect(f.session.isIdle).toBe(true);
});

test("disabled persistence returns normally and retains only memory", async ({
  onTestFinished,
}) => {
  const f = await fixture(false);
  onTestFinished(async () => {
    await f.dispose();
  });
  appendAssistantFixture(f.manager);
  expect(() => {
    f.api.appendEntry("probe", { revision: 1 });
  }).not.toThrow();
  expect(f.manager.isPersisted()).toBe(false);
  expect(f.manager.getSessionFile()).toBeUndefined();
});

test("Pi records rejected planning execution as an error tool result", async ({
  onTestFinished,
}) => {
  const f = await fixture(true, (pi) => {
    extension({
      ...pi,
      registerTool(tool) {
        pi.registerTool({
          ...tool,
          async execute(id, params, signal, update, ctx) {
            return await tool.execute(id, params, signal, update, { ...ctx, mode: "tui" });
          },
        });
      },
    });
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  f.api.registerProvider("fixture", {
    api: fixtureModel.api,
    baseUrl: fixtureModel.baseUrl,
    apiKey: "fixture",
    models: [fixtureModel],
  });
  await f.session.setModel(fixtureModel, { persist: false });
  let calls = 0;
  f.session.agent.streamFunction = () => {
    calls += 1;
    if (calls > 2) {
      throw new Error("Unexpected fixture continuation");
    }
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant",
      content:
        calls === 1
          ? [
              {
                type: "toolCall",
                id: "invalid-plan",
                name: "plan_round",
                arguments: {
                  planId: "missing",
                  roundId: "round",
                  expectedRevision: 0,
                  questions: [
                    {
                      id: "scope",
                      prerequisites: [],
                      context: "Known context",
                      prompt: "Scope?",
                      options: [],
                    },
                  ],
                },
              },
            ]
          : [{ type: "text", text: "Observed the planning failure." }],
      api: fixtureModel.api,
      provider: fixtureModel.provider,
      model: fixtureModel.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: calls === 1 ? "toolUse" : "stop",
      timestamp: Date.now(),
    };
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    return stream;
  };
  await f.session.prompt("Present the round for the missing plan.");
  expect(
    f.manager
      .getBranch()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message),
  ).toContainEqual(
    expect.objectContaining({ role: "toolResult", toolName: "plan_round", isError: true }),
  );
});

test("failed writes advance memory and retry creates a missing-parent branch on disk", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  appendAssistantFixture(f.manager);
  const path = f.manager.getSessionFile();
  if (path === undefined) {
    throw new Error("Missing session path");
  }
  await rename(path, `${path}.backup`);
  await mkdir(path);
  expect(() => {
    f.api.appendEntry("probe", { revision: 1 });
  }).toThrow(/EISDIR|EPERM|EACCES/);
  const failed = f.manager.getLeafId();
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  f.api.appendEntry("probe", { revision: 1 });
  const reopened = SessionManager.open(path);
  expect(reopened.getEntry(failed ?? "missing")).toBeUndefined();
  expect(reopened.getBranch()).not.toEqual(f.manager.getBranch());
  expect(f.manager.getBranch().filter((entry) => entry.type === "custom")).toHaveLength(2);
});

test("disk confirmation distinguishes deferred, saved, and divergent branch records", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  expect(saveRecord(f.api, f.ctx, { revision: 1 }).saved).toBe(false);
  appendAssistantFixture(f.manager);
  expect(saveRecord(f.api, f.ctx, { revision: 2 }).saved).toBe(true);
  const path = f.manager.getSessionFile();
  if (path === undefined) {
    throw new Error("Missing session path");
  }
  await rename(path, `${path}.backup`);
  await mkdir(path);
  expect(() => {
    f.api.appendEntry("probe", {});
  }).toThrow(/EISDIR|EPERM|EACCES/);
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  const before = await readFile(path, "utf8");
  const result = saveRecord(f.api, f.ctx, { revision: 3 });
  expect(result.saved).toBe(false);
  expect(result.message).toContain("Reload");
  expect(await readFile(path, "utf8")).toBe(before);
});
