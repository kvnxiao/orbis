import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { installPlanComposer } from "./composer.ts";
import { planningInstructions } from "./instructions.ts";
import { fencedObjective } from "./objective.ts";
import { PlanRuntime } from "./runtime.ts";
import { showPlanSettings } from "./settings-menu.ts";
import { reviewSchema, roundSchema } from "./state.ts";
import { toolResult } from "./tool-result.ts";

const startSchema = Type.Object(
  { objective: Type.Optional(Type.String()), replace: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export default function extension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const runtime = new PlanRuntime(pi, agentDir);
  let removeComposer: (() => void) | undefined;
  let interrupted = false;
  let sessionGeneration = 0;
  pi.registerCommand("plan-settings", {
    description: "Configure Plan appearance, shortcut, and saved-plan directory",
    async handler(_args, ctx) {
      try {
        await showPlanSettings(ctx, agentDir, async () => {
          await runtime.reloadSettings(ctx);
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
  pi.registerCommand("plan", {
    description: "Start or inspect collaborative planning; optionally supply an objective",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Stop the current turn before entering planning.", "info");
        return;
      }
      if (ctx.mode === "tui" && !(await runtime.selectUnfinished(ctx, ctx.signal))) {
        return;
      }
      const entry = runtime.start(ctx, args.trim());
      if (entry.outcome === "unsupported-mode" || entry.outcome === "error") {
        ctx.ui.notify(entry.message, "error");
        return;
      }
      const resumed = runtime.resumeCurrent(ctx);
      const active = runtime.active;
      const objective = active?.objective ?? "";
      const objectiveText =
        objective.length === 0
          ? " the objective in this conversation."
          : `:\n${fencedObjective(objective)}`;
      if (entry.outcome === "started") {
        pi.sendUserMessage(
          `Develop a collaborative plan for${objectiveText}\n\nPlanning identity: ${active?.planId ?? ""}. Research before presenting a plan_round.`,
        );
      }
      if (active?.phase === "clarification" && ctx.isIdle()) {
        await runtime.resumeClarification(ctx.signal);
      }
      if (active !== undefined && resumed && active.phase === "research") {
        pi.sendUserMessage(
          `Resume collaborative planning for${objectiveText}\n\nPlan identity: ${active.planId}. Continue research and compute the next answerable frontier.`,
        );
      }
      if (
        ctx.mode === "tui" &&
        active !== undefined &&
        (active.phase === "round" || active.phase === "review")
      ) {
        await runtime.reopen(ctx, ctx.signal);
      }
    },
  });
  pi.registerTool({
    name: "plan_review",
    label: "Review plan",
    description:
      "Present complete Markdown for explicit user review. Include objective, constraints, decisions, implementation approach, verification and unresolved assumptions. Only the user can approve this exact revision. Return feedback to revise the plan; approval does not authorize implementation.",
    parameters: reviewSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = await runtime.review(ctx, params, signal);
      return await toolResult(result);
    },
  });
  pi.registerTool({
    name: "plan_start",
    label: "Start planning",
    description:
      "Start or resume collaborative planning on explicit user intent: enter plan mode, help me plan, resume the plan, or continue planning. These are examples, not exact phrases. Do not activate for quoted examples, questions about this feature, or unrelated conversation. Reopen pending input through this tool; preserve existing drafts. Ambiguous saved plans require user selection. Replacement requires confirmation.",
    parameters: startSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      if (!Value.Check(startSchema, params)) {
        throw new Error("Invalid planning entry input.");
      }
      const result = await runtime.requestStart(
        ctx,
        params.objective?.trim() ?? "",
        params.replace === true,
        signal,
      );
      return await toolResult(result, planningInstructions);
    },
  });
  pi.registerTool({
    name: "plan_round",
    label: "Planning questions",
    description:
      "Present the researched, answerable frontier. Before calling, check every question: use 2–4 distinct options with recommendation: { optionId, reason }, where optionId matches one of this question's option IDs and reason is nonblank; or use options: [] and omit recommendation for free text. Exactly one option is invalid. Every question with options requires the recommendation field; naming a preferred option in context or explanation does not replace it. Each option needs id, label, and explanation. Prerequisites must reference previously submitted decision IDs; defer dependent questions until those decisions are submitted. Questions in the same round and draft answers do not satisfy prerequisites. Use stable identities and expectedRevision=0 for a new round. Reuse the round identity and returned revision for clarification updates, include clarification: { id, response } for the pending request, and send the complete active questions. Clarification can steer options, recommendations, and membership. Preserve the question ID for the same decision; use a new ID for a different decision. Explicitly retire omitted active questions with retire: [{ id, status: 'withdrawn' | 'deferred', reason }]. To retire every active question, send questions: [] with retire entries. Deferred questions keep their IDs when they return. The UI adds Other and Ask for clarification; do not duplicate them in generated options. Drafts remain unsubmitted until explicit whole-round submission.",
    parameters: roundSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = await runtime.round(ctx, params, signal);
      return await toolResult(result);
    },
  });
  pi.on("before_agent_start", (event) => {
    if (
      runtime.mode === "plan" &&
      runtime.active !== undefined &&
      runtime.active.phase !== "accepted" &&
      runtime.active.phase !== "cancelled"
    ) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${planningInstructions}
Current plan identity: ${runtime.active.planId}. Current phase: ${runtime.active.phase}. When a question round or review is pending, call plan_start to reopen it before replacing its content.`,
      };
    }
    return undefined;
  });
  pi.on("input", (event, ctx) => {
    if (
      ctx.mode === "tui" &&
      event.source === "interactive" &&
      ctx.isIdle() &&
      runtime.mode === "plan" &&
      event.text.trim().length > 0 &&
      !/^[!/]/u.test(event.text.trimStart())
    ) {
      runtime.start(ctx, event.text);
      runtime.resumeCurrent(ctx);
    }
    return { action: "continue" };
  });
  pi.on("agent_start", () => {
    interrupted = false;
  });
  pi.on("message_end", (event, ctx) => {
    const message = runtime.replaceReviewAbort(event.message, ctx);
    return message === undefined ? undefined : { message };
  });
  pi.on("agent_end", (event, ctx) => {
    const last = event.messages.findLast((message) => message.role === "assistant");
    interrupted =
      ctx.signal?.aborted === true ||
      (last?.role === "assistant" &&
        (last.stopReason === "aborted" || last.stopReason === "error"));
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (interrupted && runtime.mode === "plan") {
      runtime.pause(ctx);
    }
    interrupted = false;
    runtime.settled(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration++;
    interrupted = false;
    removeComposer?.();
    removeComposer = undefined;
    runtime.close(ctx);
  });
  pi.on("session_start", async (_event, ctx) => {
    const generation = ++sessionGeneration;
    removeComposer?.();
    removeComposer = undefined;
    interrupted = false;
    runtime.restore(ctx);
    try {
      await runtime.reloadSettings(ctx);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    if (generation === sessionGeneration) {
      removeComposer = installPlanComposer(ctx, runtime);
    }
  });
  pi.on("session_tree", (_event, ctx) => {
    interrupted = false;
    runtime.restore(ctx);
  });
}
