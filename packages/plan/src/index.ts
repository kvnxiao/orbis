import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { readSettings, writeSettings } from "./config.ts";
import { planningInstructions } from "./instructions.ts";
import { PlanRuntime } from "./runtime.ts";
import { reviewSchema, roundSchema } from "./state.ts";
import { toolResult } from "./tool-result.ts";

const startSchema = Type.Object(
  { objective: Type.Optional(Type.String()), replace: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export default function extension(pi: ExtensionAPI): void {
  const runtime = new PlanRuntime(pi);
  pi.registerCommand("plan-cancel", {
    description: "Cancel planning and keep its saved unfinished work",
    async handler(_args, ctx) {
      ctx.ui.notify(JSON.stringify(runtime.cancel(ctx)), "info");
      await Promise.resolve();
    },
  });
  pi.registerCommand("plan-resume", {
    description: "Select an archived unfinished plan from this conversation branch",
    async handler(_args, ctx) {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Planning requires interactive Pi in TUI mode.", "error");
        return;
      }
      const plans = runtime.unfinished.filter((plan) => plan.phase !== "accepted");
      const selected = await ctx.ui.select(
        "Resume unfinished planning",
        plans.map((plan) => `${plan.objective} [${plan.planId}]`),
      );
      const plan = plans.find((item) => selected === `${item.objective} [${item.planId}]`);
      if (plan !== undefined) {
        runtime.resume(ctx, plan.planId);
        ctx.ui.notify(
          "Unfinished plan restored. Use /plan to reopen input or continue research.",
          "info",
        );
      }
    },
  });
  pi.registerCommand("plan-ui", {
    description: "Select a registered presenter for the pending planning interaction",
    async handler(args, ctx) {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Planning requires interactive Pi in TUI mode.", "error");
        return;
      }
      try {
        if (args.trim().length === 0) {
          ctx.ui.notify(
            "Use Ctrl+P in planning input, or /plan-ui terminal|presenter-id. Registered: " +
              runtime.presenters.map((item) => item.id).join(", "),
            "info",
          );
        } else {
          runtime.chooseInterface(args.trim());
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
      await Promise.resolve();
    },
  });
  pi.registerCommand("plan-settings", {
    description:
      "Inspect planning settings or edit personal defaults and trusted project overrides",
    async handler(_args, ctx) {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Planning settings require interactive Pi in TUI mode.", "error");
        return;
      }
      try {
        const settings = await readSettings(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
        ctx.ui.notify(JSON.stringify(settings), "info");
        const scope = await ctx.ui.select("Edit planning settings", [
          "Personal defaults",
          ...(ctx.isProjectTrusted() ? ["Project overrides"] : []),
        ]);
        if (scope === undefined) {
          return;
        }
        const path =
          scope === "Project overrides"
            ? join(ctx.cwd, ".pi", "plan.json")
            : join(getAgentDir(), "orbis-plan.json");
        const value = await ctx.ui.input("Approved-plan directory", settings.planDirectory);
        if (value !== undefined) {
          await writeSettings(path, { planDirectory: value });
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
  pi.registerCommand("plan", {
    description: "Start or inspect collaborative planning; optionally supply an objective",
    handler: async (args, ctx) => {
      const entry = runtime.start(ctx, args.trim());
      if (entry.outcome === "unsupported-mode" || entry.outcome === "error") {
        ctx.ui.notify(entry.message, "error");
        return;
      }
      const resumed = runtime.resumeCurrent(ctx);
      if (entry.outcome === "started") {
        pi.sendUserMessage(
          `Develop a collaborative plan for ${args.trim().length === 0 ? "the objective in this conversation" : args.trim()}. Planning identity: ${runtime.active?.planId ?? ""}. Research before presenting a plan_round.`,
        );
      }
      const active = runtime.active;
      if (active?.phase === "clarification" && ctx.isIdle()) {
        await runtime.resumeClarification(ctx.signal);
      }
      if (active !== undefined && resumed && active.phase === "research") {
        pi.sendUserMessage(
          `Resume collaborative planning for ${active.objective}. Plan identity: ${active.planId}. Continue research and compute the next answerable frontier.`,
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
      "Start collaborative planning when the user requests a plan. Repeated entry preserves active work. Replacement requires user confirmation.",
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
      "Present the researched, answerable frontier. Use stable identities and expectedRevision=0 for a new round. Reuse the round identity and returned revision for clarification updates. Drafts remain unsubmitted until explicit whole-round submission.",
    parameters: roundSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = await runtime.round(ctx, params, signal);
      return await toolResult(result);
    },
  });
  pi.on("before_agent_start", (event) => {
    if (
      runtime.active !== undefined &&
      runtime.active.phase !== "accepted" &&
      runtime.active.phase !== "cancelled"
    ) {
      return { systemPrompt: `${event.systemPrompt}\n\n${planningInstructions}` };
    }
    return undefined;
  });
  pi.on("session_shutdown", (_event, ctx) => {
    runtime.close(ctx);
  });
  pi.on("session_start", (event, ctx) => {
    runtime.restore(ctx, event.reason === "fork");
  });
  pi.on("session_tree", (_event, ctx) => {
    runtime.restore(ctx, true);
  });
}
