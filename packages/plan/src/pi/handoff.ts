import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Marked } from "@earendil-works/pi-tui";
import type { Tokens } from "@earendil-works/pi-tui";

import { approvalKey } from "../domain/state.ts";
import type { PlanApproval, RuntimeResult } from "../domain/state.ts";
import { launchEntryType, readLaunches, saveLaunch } from "../storage/launches.ts";
import type { LaunchRecord } from "../storage/launches.ts";
import { planCommandDescription } from "./instructions.ts";

const choices = ["Implement in this session", "Implement in a new session", "Decide later"];

interface Launch {
  token: string;
  sessionId: string;
  generation: number;
  approval: PlanApproval;
  destination: "here" | "new";
  claimed: boolean;
  record: LaunchRecord;
  signal?: AbortSignal;
}

/** Own ephemeral implementation selection and single-use command dispatch. */
export class PlanHandoff {
  private generation = 0;
  private controller: AbortController | undefined;
  private pending: Launch | undefined;

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
    restart = false,
  ): Promise<string | LaunchRecord> {
    const previous = readLaunches(ctx).findLast(
      (record) => approvalKey(record.approval) === approvalKey(approval),
    );
    if (!restart && action !== "options" && previous !== undefined) {
      if (
        previous.status === "received" &&
        previous.sessionId === ctx.sessionManager.getSessionId()
      ) {
        beforeDispatch?.();
      }
      return previous;
    }
    if (this.controller !== undefined || this.pending !== undefined) {
      throw new Error("An implementation selection or launch is already pending.");
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
      if (!restart && previous !== undefined) {
        if (
          previous.status === "received" &&
          previous.sessionId === ctx.sessionManager.getSessionId()
        ) {
          beforeDispatch?.();
        }
        return previous;
      }
      const commands = this.pi
        .getCommands()
        .filter(
          (command) =>
            command.source === "extension" &&
            /^plan(?::[0-9]+)?$/u.test(command.name) &&
            command.description === planCommandDescription,
        );
      const command = commands[0];
      if (commands.length !== 1 || command === undefined) {
        throw new Error(
          "The planning command is missing or ambiguous. Resolve extension command registration before requesting implementation.",
        );
      }
      beforeDispatch?.();
      const token = randomUUID();
      const record: LaunchRecord = {
        version: 1,
        id: token,
        approval: structuredClone(approval),
        destination,
        originSessionId: sessionId,
        sessionId,
        status: "requested",
      };
      saveLaunch(this.pi, ctx, record);
      this.pending = {
        token,
        sessionId,
        generation,
        approval: structuredClone(approval),
        destination,
        claimed: false,
        record,
        ...(signal === undefined ? {} : { signal }),
      };
      // Command dispatch precedes queueing; its idle wait must not be awaited by this tool.
      this.pi.sendUserMessage(`/${command.name} __handoff ${token}`, {
        expandPromptTemplates: true,
      });
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

  /** Return execution instructions only to the recorded receiving session. */
  result(ctx: ExtensionContext, record: LaunchRecord): RuntimeResult {
    if (record.status === "failed") {
      return {
        outcome: "error",
        message: `Implementation launch ${record.id} failed: ${record.failure ?? "unknown failure"}. Explicitly request a restart for another attempt.`,
      };
    }
    const received =
      record.status === "received" && record.sessionId === ctx.sessionManager.getSessionId();
    if (!received) {
      return {
        outcome: "implementation",
        launchId: record.id,
        status: "requested",
        approval: record.approval,
        message: `Implementation launch ${record.id} was requested for destination ${record.destination}. Delivery is not confirmed by this session. No additional prompt or session was created. Explicitly request a restart for another launch.`,
      };
    }
    const approval = record.approval;
    if (
      approval.cwd !== ctx.cwd ||
      readFileSync(approval.planPath, "utf8") !== approval.planContent ||
      (approval.notesPath !== undefined &&
        readFileSync(approval.notesPath, "utf8") !== approval.notesContent)
    ) {
      return {
        outcome: "error",
        message:
          "Approved artifacts or working directory changed. Preserve the recorded approval and resolve the conflict before implementation.",
      };
    }
    const heading = new Marked()
      .lexer(approval.planContent)
      .filter((token): token is Tokens.Heading => token.type === "heading")
      .find((token) => token.text.trim() !== "");
    const introduction =
      heading === undefined
        ? `Implement the approved plan at this absolute Markdown path: ${JSON.stringify(approval.planPath)}.`
        : `Implement the approved plan: ${heading.text.trim()}\n\nApproved Markdown path: ${JSON.stringify(approval.planPath)}.`;
    const message = `${introduction}\n\nImplementation launch ${record.id} is already in this session. The user selected implementation and authorizes execution now, even if the saved plan says implementation awaits separate authorization. Read the Markdown file at the path above and implement the plan with ordinary tools. Continue this launch without calling the launcher again or requesting the same authorization.${approval.notesContent === undefined ? "" : `\n\nSupplementary approved notes (${JSON.stringify(approval.notesPath)}):\n${approval.notesContent}`}`;
    return {
      outcome: "implementation",
      launchId: record.id,
      status: "received",
      approval,
      message,
    };
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
      const bootstrap = `Continue authorized implementation launch ${launch.record.id}. Call plan_implement with action "here" and planId ${JSON.stringify(approval.planId)} to obtain its execution instructions. This is the receiving session for an existing launch; do not request a restart or create another session.`;
      const message = {
        customType: "orbis-plan-implementation",
        content: bootstrap,
        display: false,
      };
      if (launch.destination === "here") {
        saveLaunch(this.pi, ctx, { ...launch.record, status: "received" });
        this.pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
        return;
      }
      const origin = launch.sessionId;
      const submission = { started: false };
      const result = await ctx.newSession({
        async setup(manager) {
          await Promise.resolve(
            manager.appendCustomEntry(launchEntryType, {
              ...launch.record,
              sessionId: manager.getSessionId(),
              status: "received",
            }),
          );
        },
        async withSession(fresh) {
          if (submission.started || fresh.sessionManager.getSessionId() === origin) {
            throw new Error("Replacement did not provide an unused fresh session context.");
          }
          submission.started = true;
          try {
            await fresh.sendMessage(message, { triggerTurn: true });
          } catch (error) {
            const failure = error instanceof Error ? error.message : String(error);
            try {
              const failed: LaunchRecord = {
                ...launch.record,
                sessionId: fresh.sessionManager.getSessionId(),
                status: "failed",
                failure,
              };
              await fresh.sendMessage(
                {
                  customType: launchEntryType,
                  content: `Implementation startup failed: ${failure}`,
                  details: failed,
                  display: false,
                },
                { triggerTurn: false },
              );
            } catch (recordError) {
              throw new AggregateError(
                [error, recordError],
                `Implementation startup failed: ${failure}. Failure recording also failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
                { cause: recordError },
              );
            }
            throw error;
          }
        },
      });
      if (result.cancelled) {
        throw new Error(
          "Session replacement was cancelled. Approval is preserved; explicitly request a restart for another attempt.",
        );
      }
      if (!submission.started) {
        throw new Error(
          "Session replacement completed without submitting implementation. Inspect the session before retrying.",
        );
      }
    } catch (error) {
      if (current()) {
        const failure = error instanceof Error ? error.message : String(error);
        try {
          saveLaunch(this.pi, ctx, { ...launch.record, status: "failed", failure });
        } catch (recordError) {
          throw new AggregateError(
            [error, recordError],
            `Implementation handoff failed: ${failure}. Failure recording also failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
            { cause: recordError },
          );
        }
      }
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
