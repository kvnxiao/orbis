import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { PlanApproval } from "../domain/state.ts";

const choices = ["Implement in this session", "Implement in a new session", "Decide later"];

interface Launch {
  token: string;
  sessionId: string;
  generation: number;
  approval: PlanApproval;
  destination: "here" | "new";
  claimed: boolean;
  signal?: AbortSignal;
}

/** Own ephemeral implementation selection and single-use command dispatch. */
export class PlanHandoff {
  private generation = 0;
  private controller: AbortController | undefined;
  private pending: Launch | undefined;
  private readonly dispatched = new Set<string>();

  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  invalidate(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.pending = undefined;
  }

  async request(
    ctx: ExtensionContext,
    approval: PlanApproval,
    action: "here" | "new" | "options",
    signal?: AbortSignal,
    beforeDispatch?: () => void,
  ): Promise<string> {
    if (this.controller !== undefined || this.pending !== undefined) {
      throw new Error("An implementation selection or launch is already pending.");
    }
    const key = `${approval.planId}:${String(approval.revision)}`;
    if (this.dispatched.has(key)) {
      throw new Error(
        "Implementation was already dispatched for this approval. Inspect the session before requesting further work.",
      );
    }
    const generation = this.generation;
    const sessionId = ctx.sessionManager.getSessionId();
    const controller = new AbortController();
    this.controller = controller;
    const combined =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    const current = () =>
      !combined.aborted &&
      generation === this.generation &&
      sessionId === ctx.sessionManager.getSessionId();
    try {
      let destination = action;
      if (destination === "options") {
        const selected = await ctx.ui.select("Implement approved plan?", choices, {
          signal: combined,
        });
        if (!current() || selected === undefined || selected === "Decide later") {
          return "Approval preserved. No implementation requested.";
        }
        if (selected === "Implement in this session") {
          destination = "here";
        } else if (selected === "Implement in a new session") {
          destination = "new";
        } else {
          throw new Error("Unknown implementation destination.");
        }
      }
      if (!current()) {
        return "Approval preserved. The implementation action expired.";
      }
      beforeDispatch?.();
      const token = randomUUID();
      this.pending = {
        token,
        sessionId,
        generation,
        approval: structuredClone(approval),
        destination,
        claimed: false,
        ...(signal === undefined ? {} : { signal }),
      };
      // Command dispatch precedes queueing; its idle wait must not be awaited by this tool.
      this.pi.sendUserMessage(`/plan __handoff ${token}`, { expandPromptTemplates: true });
      return "Implementation authorized and scheduled after planning completes. Acknowledge approval and finish this planning turn.";
    } catch (error) {
      if (generation === this.generation) {
        this.pending = undefined;
      }
      throw error;
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
      controller.abort();
    }
  }

  async dispatch(token: string, ctx: ExtensionCommandContext): Promise<void> {
    const launch = this.pending;
    if (launch === undefined || launch.token !== token || launch.claimed) {
      throw new Error("The implementation action is unavailable or already consumed.");
    }
    launch.claimed = true;
    const current = () =>
      this.pending === launch &&
      launch.signal?.aborted !== true &&
      launch.generation === this.generation &&
      launch.sessionId === ctx.sessionManager.getSessionId();
    try {
      if (!current()) {
        return;
      }
      await ctx.waitForIdle();
      if (!current()) {
        return;
      }
      const approval = launch.approval;
      if (
        readFileSync(approval.planPath, "utf8") !== approval.planContent ||
        (approval.notesPath !== undefined &&
          readFileSync(approval.notesPath, "utf8") !== approval.notesContent)
      ) {
        throw new Error(
          "Approved artifacts changed. Restore the reviewed bytes before requesting implementation.",
        );
      }
      const prompt = `Implement the approved plan at this absolute Markdown path: ${JSON.stringify(approval.planPath)}.\n\nThe user selected implementation and authorizes execution now, even if the saved plan says implementation awaits separate authorization. Follow the approved plan and the repository instructions. Start implementation without asking for the same authorization again.${approval.notesContent === undefined ? "" : `\n\nSupplementary approved notes (${JSON.stringify(approval.notesPath)}):\n${approval.notesContent}`}`;
      const key = `${approval.planId}:${String(approval.revision)}`;
      this.dispatched.add(key);
      if (launch.destination === "here") {
        this.pi.sendUserMessage(prompt, { deliverAs: "followUp", expandPromptTemplates: false });
        return;
      }
      const origin = launch.sessionId;
      const submission = { started: false };
      const result = await ctx.newSession({
        async withSession(fresh) {
          if (submission.started || fresh.sessionManager.getSessionId() === origin) {
            throw new Error("Replacement did not provide an unused fresh session context.");
          }
          submission.started = true;
          await fresh.sendUserMessage(prompt, { expandPromptTemplates: false });
        },
      });
      if (result.cancelled) {
        this.dispatched.delete(key);
        throw new Error(
          "Session replacement was cancelled. Approval is preserved; request implementation again when ready.",
        );
      }
      if (!submission.started) {
        throw new Error(
          "Session replacement completed without submitting implementation. Inspect the session before retrying.",
        );
      }
    } catch (error) {
      throw new Error(
        `Implementation handoff failed; approval is preserved. No automatic retry was made. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      if (this.pending === launch) {
        this.pending = undefined;
      }
    }
  }
}
