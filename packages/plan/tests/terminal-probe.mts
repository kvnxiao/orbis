import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { PlanRuntime } from "../src/runtime.ts";

const log = (value: unknown) => {
  appendFileSync(join(getAgentDir(), "plan-probe.jsonl"), `${JSON.stringify(value)}\n`);
};

export default function probe(pi: ExtensionAPI): void {
  const runtime = new PlanRuntime(pi);
  let timer: ReturnType<typeof setInterval> | undefined;
  pi.registerCommand("probe-ui", {
    description: "Switch the probe interface",
    async handler(args) {
      if (args === "terminal" || args === "browser") {
        runtime.switchInterface(args);
      }
      await Promise.resolve();
    },
  });
  pi.registerCommand("probe-review", {
    description: "Review and save a deterministic Markdown plan",
    async handler(_args, ctx) {
      runtime.start(ctx, "Review probe");
      const plan = runtime.active;
      if (plan === undefined) {
        throw new Error("Missing probe plan");
      }
      const result = await runtime.review(ctx, {
        planId: plan.planId,
        expectedRevision: plan.reviews?.at(-1)?.revision ?? 0,
        markdown:
          "# Review probe\n\n## Objective\nVerify terminal review.\n\n## Decisions\nUse explicit approval.\n\n## Approach\nSave the exact reviewed Markdown.\n\n## Verification\nInspect the file and approval event.\n\n## Limitations\nThis is a scripted fixture.\n",
      });
      log({ event: "review-result", result });
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });
  pi.events.on("orbis:plan-approved", (payload) => {
    log({ event: "approval-event", payload });
  });
  pi.registerCommand("probe-round", {
    description: "Exercise planning terminal input without a model",
    async handler(_args, ctx) {
      runtime.start(ctx, "Terminal probe");
      const plan = runtime.active;
      if (plan === undefined) {
        throw new Error("Missing probe plan");
      }
      const result = await runtime.round(ctx, {
        planId: plan.planId,
        roundId: "probe",
        expectedRevision: plan.round?.revision ?? 0,
        questions: ["storage", "scope"].map((id) => ({
          id,
          prerequisites: [],
          prompt: `Choose ${id}`,
          context: "**Verified fixture:** local and remote alternatives.",
          options: [
            { id: "local", label: "Local", explanation: "Works offline." },
            { id: "remote", label: "Remote", explanation: "Shares access." },
          ],
          recommendation: { optionId: "local", reason: "The fixture requires offline access." },
        })),
      });
      log({ result, state: runtime.active });
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });
  pi.registerTool({
    name: "finish_probe",
    label: "Finish probe",
    description: "Verify approval idle ordering",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const approved = await ctx.ui.confirm(
        "Approve probe?",
        "Verify deferred notification after Pi becomes idle.",
      );
      log({ event: "approval", approved, idle: ctx.isIdle() });
      if (approved) {
        ctx.abort();
        timer = setInterval(() => {
          if (ctx.isIdle()) {
            clearInterval(timer);
            log({ event: "notification", idle: ctx.isIdle() });
            ctx.ui.notify("Probe notification: idle", "info");
          }
        }, 10);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ approved }) }],
        details: { approved },
      };
    },
  });
  pi.on("agent_end", (_event, ctx) => {
    log({ event: "agent_end", idle: ctx.isIdle() });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearInterval(timer);
    runtime.close(ctx);
  });
  pi.registerProvider("plan-probe", {
    api: "plan-probe-api",
    apiKey: "fixture",
    baseUrl: "http://127.0.0.1",
    models: [
      {
        id: "probe",
        name: "Planning probe",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 10000,
        maxTokens: 1000,
      },
    ],
    streamSimple(_model, _context, options) {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "toolCall", id: "probe", name: "finish_probe", arguments: {} }],
        api: "plan-probe-api",
        provider: "plan-probe",
        model: "probe",
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
      } else {
        log({ event: "provider" });
        stream.push({ type: "done", reason: "toolUse", message });
      }
      return stream;
    },
  });
}
