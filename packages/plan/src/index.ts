import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { readSettings, writeSettings } from "./config.ts";
import { planningInstructions } from "./instructions.ts";
import { PlanRuntime } from "./runtime.ts";
import { reviewSchema, roundSchema } from "./state.ts";

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
    description: "Switch the current planning interaction between terminal and browser",
    async handler(args, ctx) {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Planning requires interactive Pi in TUI mode.", "error");
        return;
      }
      const selected =
        args === "terminal" || args === "browser"
          ? args
          : await ctx.ui.select("Planning interface", ["terminal", "browser"]);
      if (selected !== "terminal" && selected !== "browser") {
        return;
      }
      try {
        await runtime.chooseInterface(ctx, selected);
        ctx.ui.notify(`Planning interface: ${selected}. Use /plan to reopen saved input.`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
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
        const field = await ctx.ui.select(`Edit ${path}`, ["interface", "planDirectory"]);
        if (field === "interface") {
          const value = await ctx.ui.select("Preferred interface", ["terminal", "browser"]);
          if (value === "terminal" || value === "browser") {
            await writeSettings(path, { interface: value });
          }
        } else if (field === "planDirectory") {
          const value = await ctx.ui.input("Approved-plan directory", settings.planDirectory);
          if (value !== undefined) {
            await writeSettings(path, { planDirectory: value });
          }
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
        ctx.ui.notify(entry.message ?? "Planning entry failed.", "error");
        return;
      }
      const resumed = runtime.resumeCurrent(ctx);
      if (entry.outcome === "started") {
        pi.sendUserMessage(
          `Develop a collaborative plan for ${args.trim().length === 0 ? "the objective in this conversation" : args.trim()}. Planning identity: ${runtime.active?.planId ?? ""}. Research before presenting a plan_round.`,
        );
      }
      const active = runtime.active;
      if (
        active !== undefined &&
        ((resumed && active.phase === "research") ||
          (active.phase === "clarification" && ctx.isIdle()))
      ) {
        pi.sendUserMessage(
          `Resume collaborative planning for ${active.objective}. Plan identity: ${active.planId}. ${active.phase === "clarification" ? `Answer the unresolved clarification in this conversation before reopening the round. These drafts remain unsubmitted: ${JSON.stringify(active.round)}` : "Continue research and compute the next answerable frontier."}`,
        );
      }
      if (
        ctx.mode === "tui" &&
        active !== undefined &&
        (active.phase === "round" || active.phase === "review")
      ) {
        active.phase = active.reviews?.at(-1)?.status === "pending" ? "review" : "round";
        const result = await runtime.interact(ctx, ctx.signal);
        if (
          result.outcome === "answers" ||
          result.outcome === "clarification" ||
          result.outcome === "feedback"
        ) {
          pi.sendMessage(
            { customType: "orbis-plan-input", content: JSON.stringify(result), display: true },
            { triggerTurn: true },
          );
        }
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
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "plan_start",
    label: "Start planning",
    description:
      "Start collaborative planning when the user requests a plan. Repeated entry preserves active work. Replacement requires user confirmation.",
    parameters: startSchema,
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) {
      if (!Value.Check(startSchema, params)) {
        return {
          content: [{ type: "text", text: "Invalid planning entry input." }],
          details: { outcome: "error" },
        };
      }
      if (_signal?.aborted === true) {
        return {
          content: [{ type: "text", text: "Planning entry cancelled." }],
          details: { outcome: "cancelled" },
        };
      }
      let replace = false;
      if (ctx.mode === "tui" && params.replace === true && runtime.active !== undefined) {
        replace = await ctx.ui.confirm(
          "Start another plan?",
          "Keep the current unfinished plan and start a new objective?",
        );
        if (!replace) {
          return {
            content: [{ type: "text", text: "Replacement cancelled; current plan preserved." }],
            details: { outcome: "cancelled" },
          };
        }
      }
      const result = {
        ...runtime.start(ctx, params.objective?.trim() ?? "", replace),
        instructions: planningInstructions,
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
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
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
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
