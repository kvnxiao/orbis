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
import { Value } from "typebox/value";
import { expect, test, vi } from "vitest";

import extension from "../src/index.ts";
import { saveRecord } from "../src/persistence.ts";
import { approvalSchema } from "../src/state.ts";
import type { PlanApproval } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
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

async function fixture(persist = true, setup?: (pi: ExtensionAPI, cwd: string) => void) {
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
        setup?.(pi, cwd);
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

test("abort inside a tool prevents continuation and agent_settled observes idle", async ({
  onTestFinished,
}) => {
  const order: string[] = [];
  const f = await fixture(true, (pi) => {
    pi.registerTool({
      name: "finish_probe",
      label: "Finish probe",
      description: "Probe idle ordering",
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _update, ctx) {
        order.push(`tool:${String(ctx.isIdle())}`);
        ctx.abort();
        return await Promise.resolve({
          content: [{ type: "text", text: "Approved probe" }],
          details: {},
        });
      },
    });
    pi.on("agent_end", (_event, ctx) => {
      order.push(`agent_end:${String(ctx.isIdle())}`);
    });
    pi.on("agent_settled", (_event, ctx) => {
      order.push(`agent_settled:${String(ctx.isIdle())}`);
    });
  });
  onTestFinished(async () => {
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
  expect(order).toEqual(["tool:false", "agent_end:false", "agent_settled:true"]);
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
  expect(saveRecord(f.api, f.ctx, {})).toEqual({
    saved: false,
    message: "Pi session persistence is disabled. Drafts remain in memory.",
  });
});

test("registered planning tools persist acceptance and emit once after the aborted agent settles", async ({
  onTestFinished,
}) => {
  const notifications: PlanApproval[] = [];
  const order: string[] = [];
  const f = await fixture(true, (pi, cwd) => {
    vi.stubEnv("PI_CODING_AGENT_DIR", join(cwd, "agent"));
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
    pi.on("agent_end", () => {
      order.push("agent_end");
    });
    pi.on("agent_settled", (_event, ctx) => {
      order.push(`settled:${String(ctx.isIdle())}`);
    });
  });
  onTestFinished(async () => {
    await f.dispose();
    vi.unstubAllEnvs();
  });
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.api.events.on("orbis:plan-approved", (payload) => {
    if (!Value.Check(approvalSchema, payload)) {
      throw new Error("Invalid approval payload");
    }
    expect(f.session.isIdle).toBe(true);
    const saved = f.manager
      .getBranch()
      .findLast((entry) => entry.type === "custom" && entry.customType === "orbis-plan");
    expect(saved).toMatchObject({ data: { active: { phase: "accepted", accepted: payload } } });
    notifications.push(payload);
    order.push("approval");
  });
  f.api.registerProvider("fixture", {
    api: fixtureModel.api,
    baseUrl: fixtureModel.baseUrl,
    apiKey: "fixture",
    models: [fixtureModel],
  });
  await f.session.setModel(fixtureModel, { persist: false });
  let calls = 0;
  f.session.agent.streamFunction = (_model, context, options) => {
    const aborted = options?.signal?.aborted === true;
    if (!aborted) {
      calls++;
    }
    if (calls > 2) {
      throw new Error("Approval must not start implementation");
    }
    const entry = context.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "plan_start",
    );
    const text =
      entry?.role === "toolResult"
        ? (entry.content.find((content) => content.type === "text")?.text ?? "")
        : "";
    const planId = /"planId":\s*"([^"]+)"/u.exec(text)?.[1];
    if (!aborted && calls === 2 && planId === undefined) {
      throw new Error("Missing tool-returned planning identity");
    }
    const message: AssistantMessage = {
      role: "assistant",
      api: fixtureModel.api,
      provider: fixtureModel.provider,
      model: fixtureModel.id,
      content: aborted
        ? []
        : [
            {
              type: "toolCall",
              id: `call-${String(calls)}`,
              name: calls === 1 ? "plan_start" : "plan_review",
              arguments:
                calls === 1
                  ? { objective: "Scripted approval" }
                  : { planId, expectedRevision: 0, markdown: "# Exact approved plan\n" },
            },
          ],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: aborted ? "aborted" : "toolUse",
      timestamp: Date.now(),
    };
    const stream = createAssistantMessageEventStream();
    if (aborted) {
      stream.push({ type: "error", reason: "aborted", error: message });
    } else {
      stream.push({ type: "done", reason: "toolUse", message });
    }
    return stream;
  };
  await f.session.prompt("Start planning and present the reviewed plan.");
  expect(calls).toBe(2);
  expect(order).toEqual(["agent_end", "approval", "settled:true"]);
  expect(notifications).toHaveLength(1);
  const payload = notifications[0];
  if (payload === undefined) {
    throw new Error("Missing approval notification");
  }
  expect(await readFile(payload.planPath, "utf8")).toBe("# Exact approved plan\n");
  await f.session.extensionRunner.emit({ type: "agent_settled" });
  expect(notifications).toHaveLength(1);
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
