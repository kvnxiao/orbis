import { StringEnum } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { describe, superseded } from "./domain/errors.ts";
import { fencedObjective } from "./domain/objective.ts";
import { questionGuidance, reviewSchema, roundSchema } from "./domain/state.ts";
import { installPlanComposer } from "./pi/composer.ts";
import { planningInstructions, planCommandDescription } from "./pi/instructions.ts";
import { PlanRuntime } from "./pi/runtime.ts";
import { showPlanSettings } from "./pi/settings-menu.ts";
import { toolResult } from "./pi/tool-result.ts";

const openSchema = Type.Object(
  {
    objective: Type.Optional(Type.String()),
    replace: Type.Optional(Type.Boolean()),
    requestId: Type.Optional(Type.String({ minLength: 1, pattern: "\\S" })),
  },
  { additionalProperties: false },
);

/** Register planning tools, commands, presenter lifecycle, and session-owned cleanup. */
export default function extension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const runtime = new PlanRuntime(pi, agentDir);
  let removeComposer: (() => void) | undefined;
  let interrupted = false;
  let sessionGeneration = 0;
  let settingsController: AbortController | undefined;
  let commandController: AbortController | undefined;
  let shortcutInitialized = false;
  pi.registerCommand("plan-settings", {
    description: "Configure Plan appearance, shortcut, and saved-plan directory",
    async handler(_args, ctx) {
      settingsController?.abort(superseded);
      const controller = new AbortController();
      settingsController = controller;
      const signal =
        ctx.signal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, ctx.signal]);
      try {
        await showPlanSettings(ctx, agentDir, signal);
      } catch (error) {
        if (!signal.aborted) {
          ctx.ui.notify(describe(error), "error");
        }
      } finally {
        if (settingsController === controller) {
          settingsController = undefined;
        }
      }
    },
  });
  pi.registerCommand("plan", {
    description: planCommandDescription,
    handler: async (args, ctx) => {
      if (args.startsWith("__handoff ")) {
        await runtime.dispatchImplementation(args.slice("__handoff ".length), ctx);
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Stop the current turn before entering planning.", "info");
        return;
      }
      commandController?.abort(superseded);
      const controller = new AbortController();
      commandController = controller;
      const signal =
        ctx.signal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, ctx.signal]);
      try {
        if (ctx.mode === "tui" && !(await runtime.selectUnfinished(ctx, signal))) {
          return;
        }
        if (signal.aborted) {
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
          await runtime.resumeClarification(signal);
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
          await runtime.reopen(ctx, signal);
        }
      } catch (error) {
        if (!signal.aborted) {
          ctx.ui.notify(describe(error), "error");
        }
      } finally {
        if (commandController === controller) {
          commandController = undefined;
        }
      }
    },
  });
  pi.registerTool({
    name: "plan_implement",
    label: "Implement approved plan",
    description:
      "On explicit user intent, implement an approved plan here, implement it in a fresh session, or show the implementation options again. Use action here, new, or options respectively. These are intent examples, not exact phrases. Do not invoke for quoted examples or feature questions. When the reference is unambiguous, supply planId; otherwise omit it for explicit saved-plan selection. The implementation action authorizes execution without another confirmation. A new launch with action new replaces the Pi session. Ordinary repeats reuse the recorded launch, including requests for another destination. Only an explicit user restart request permits restart: true. Approval alone does not authorize execution.",
    promptGuidelines: [
      "When the user asks to implement a saved approved plan or reopen implementation options, use plan_implement. For a fresh-session request, use action new; do not simulate an empty context. Resolve ambiguous plan references explicitly.",
      "When a hidden startup instruction identifies an existing implementation launch, call plan_implement with action here to receive its approved plan and execution instructions. Ordinary repeats reuse that launch. Set restart: true only when the user explicitly requests another launch; a changed destination alone is not a restart. After receiving execution instructions, implement the plan with ordinary tools.",
    ],
    parameters: Type.Object(
      {
        action: StringEnum(["here", "new", "options"] as const),
        planId: Type.Optional(Type.String({ minLength: 1 })),
        restart: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      return await toolResult(
        runtime.implement(ctx, params.action, params.planId, signal, params.restart === true),
      );
    },
  });
  pi.registerTool({
    name: "plan_review",
    label: "Review plan",
    description:
      "Present complete Markdown for explicit user review. Retry with the original expectedRevision and exact arguments to retrieve a completed result; use plan_open to explicitly reopen review. Include objective, constraints, decisions, implementation approach, verification and unresolved assumptions. Only the user can approve this exact revision. Return feedback to revise the plan; approval does not authorize implementation.",
    parameters: reviewSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = runtime.review(ctx, params, signal);
      return await toolResult(result);
    },
  });
  pi.registerTool({
    name: "plan_open",
    label: "Open planning",
    promptGuidelines: [
      "When the user explicitly asks to resume planning or plan review, call plan_open with replace: false before claiming saved work is unavailable. A previous cancelled result ends that interaction and preserves saved unfinished work. Do not resume for unrelated messages or replace modal approval with chat approval.",
    ],
    description:
      "Create or reopen collaborative planning, questions, or review without starting implementation. Invoke on explicit user intent, such as enter plan mode, help me plan, resume the plan, or continue planning. These are examples, not exact phrases. Do not activate for quoted examples, questions about this feature, or unrelated conversation. Reopen pending input through this tool; preserve existing drafts. Ambiguous saved plans require user selection. Replacement requires confirmation and a stable requestId. Reuse the requestId and original arguments for retries; use a new requestId for a new replacement request.",
    parameters: openSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = runtime.requestOpen(
        ctx,
        params.objective?.trim() ?? "",
        params.replace === true,
        signal,
        params.requestId,
      );
      return await toolResult(result, planningInstructions);
    },
  });
  pi.registerTool({
    name: "plan_round",
    label: "Planning questions",
    description: `Present the researched, answerable frontier. Retry with the original expectedRevision and exact arguments to retrieve a completed result; use plan_open to explicitly reopen pending input. ${questionGuidance} Each option needs id, label, and explanation. Prerequisites must reference previously submitted decision IDs; defer dependent questions until those decisions are submitted. Questions in the same round and draft answers do not satisfy prerequisites. Use stable identities and expectedRevision=0 for a new round. Reuse the round identity and returned revision for clarification updates, include clarification: { id, response } for the pending request, and send the complete active questions. Clarification can steer options, recommendations, and membership. Preserve the question ID for the same decision; use a new ID for a different decision. Explicitly retire omitted active questions with retire: [{ id, status: 'withdrawn' | 'deferred', reason }]. To retire every active question, send questions: [] with retire entries. Deferred questions keep their IDs when they return. Drafts remain unsubmitted until explicit whole-round submission.`,
    parameters: roundSchema,
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const result = runtime.round(ctx, params, signal);
      return await toolResult(result);
    },
  });
  pi.on("context", (event) => {
    const active = runtime.active;
    if (
      runtime.mode === "plan" &&
      active !== undefined &&
      active.phase !== "accepted" &&
      active.phase !== "cancelled"
    ) {
      return {
        messages: [
          ...event.messages,
          {
            role: "custom" as const,
            customType: "orbis-plan-mode",
            content: `${planningInstructions}\nCurrent plan identity: ${active.planId}. Current phase: ${active.phase}. When a question round or review is pending, call plan_open to reopen it before replacing its content.`,
            display: false,
            timestamp: Date.now(),
          },
        ],
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
    settingsController?.abort(superseded);
    commandController?.abort(superseded);
    interrupted = false;
    removeComposer?.();
    removeComposer = undefined;
    runtime.close(ctx);
  });
  pi.on("session_start", async (event, ctx) => {
    const generation = ++sessionGeneration;
    settingsController?.abort(superseded);
    commandController?.abort(superseded);
    removeComposer?.();
    removeComposer = undefined;
    interrupted = false;
    runtime.restore(ctx);
    try {
      if (!shortcutInitialized) {
        await runtime.reloadSettings(ctx);
        shortcutInitialized = true;
      }
    } catch (error) {
      if (generation === sessionGeneration) {
        ctx.ui.notify(describe(error), "error");
      }
    }
    if (generation === sessionGeneration) {
      removeComposer = installPlanComposer(pi, ctx, runtime, event.reason === "reload");
    }
  });
  pi.on("session_tree", (_event, ctx) => {
    sessionGeneration++;
    settingsController?.abort(superseded);
    commandController?.abort(superseded);
    interrupted = false;
    runtime.restore(ctx);
  });
}
