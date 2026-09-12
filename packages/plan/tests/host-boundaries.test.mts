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
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { expect, test, vi } from "vitest";

import { approvalSchema } from "../src/domain/state.ts";
import type { PlanApproval } from "../src/domain/state.ts";
import extension from "../src/index.ts";
import * as terminal from "../src/pi/terminal.ts";
import { saveRecord } from "../src/storage/persistence.ts";
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
  let cleanup = async () => {
    await rm(cwd, { recursive: true, force: true });
  };
  try {
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
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        session.dispose();
        await rm(cwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

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

test("registered planning tools persist acceptance and emit once after the successful agent settles", async ({
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

test("closing plan review warns without an error response or model continuation", async ({
  onTestFinished,
}) => {
  const notify = vi.fn<ExtensionUIContext["notify"]>();
  const approvals = vi.fn<(payload: unknown) => void>();
  const f = await fixture(true, (pi, cwd) => {
    vi.stubEnv("PI_CODING_AGENT_DIR", join(cwd, "agent"));
    extension({
      ...pi,
      registerTool(tool) {
        pi.registerTool({
          ...tool,
          async execute(id, params, signal, update, ctx) {
            return await tool.execute(id, params, signal, update, {
              ...ctx,
              mode: "tui",
              ui: { ...ctx.ui, notify },
            });
          },
        });
      },
    });
    pi.events.on("orbis:plan-approved", approvals);
  });
  onTestFinished(async () => {
    await f.dispose();
    vi.unstubAllEnvs();
  });
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Keep this draft" });
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
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
      throw new Error("Closing review must stop model continuation");
    }
    const entry = context.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "plan_start",
    );
    const startText =
      entry?.role === "toolResult"
        ? (entry.content.find((content) => content.type === "text")?.text ?? "")
        : "";
    const planId = /"planId":\s*"([^"]+)"/u.exec(startText)?.[1];
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
                  ? { objective: "Closure fixture" }
                  : { planId, expectedRevision: 0, markdown: "# Pending plan\n" },
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
      stopReason: aborted ? "error" : "toolUse",
      timestamp: Date.now(),
      ...(aborted ? { errorMessage: "This operation was aborted" } : {}),
    };
    const stream = createAssistantMessageEventStream();
    if (aborted) {
      stream.push({ type: "error", reason: "error", error: message });
    } else {
      stream.push({ type: "done", reason: "toolUse", message });
    }
    return stream;
  };
  await f.session.prompt("Start planning and present the plan for review.");
  expect(calls).toBe(2);
  expect(f.session.isIdle).toBe(true);
  expect(approvals).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(
    "Plan review closed without approval. Use /plan to resume.",
    "warning",
  );
  const last = f.manager
    .getBranch()
    .findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  expect(last).toMatchObject({ message: { stopReason: "stop", content: [] } });
  if (last?.type !== "message" || last.message.role !== "assistant") {
    throw new Error("Missing finalized assistant message");
  }
  expect(last.message.errorMessage).toBeUndefined();
  expect(
    f.manager
      .getBranch()
      .findLast((entry) => entry.type === "custom" && entry.customType === "orbis-plan"),
  ).toMatchObject({
    data: {
      mode: "default",
      active: {
        phase: "cancelled",
        reviews: [{ feedbackDraft: "Keep this draft", status: "pending" }],
      },
    },
  });
});

test.for([false, true])(
  "Pi records rejected planning input once (malformed=%s)",
  async (malformed, { onTestFinished }) => {
    const execute = vi.fn<() => void>();
    const f = await fixture(true, (pi) => {
      extension({
        ...pi,
        registerTool(tool) {
          pi.registerTool({
            ...tool,
            async execute(id, params, signal, update, ctx) {
              execute();
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
                  name: malformed ? "plan_start" : "plan_round",
                  arguments: malformed
                    ? { objective: {} }
                    : {
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
    expect(execute).toHaveBeenCalledTimes(malformed ? 0 : 1);
    expect(
      f.manager
        .getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.message),
    ).toContainEqual(
      expect.objectContaining({
        role: "toolResult",
        toolName: malformed ? "plan_start" : "plan_round",
        isError: true,
      }),
    );
  },
);

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
