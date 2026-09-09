import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { approvalSchema, saveApproval } from "./approval.ts";
import type { PlanApproval } from "./approval.ts";
import { PlanBrowser } from "./browser.ts";
import { readSettings, readSettingsFile, writeSettings } from "./config.ts";
import { readSavedRecord, saveRecord } from "./persistence.ts";
import { presentReview, presentRound, roundStateSchema, transitionInteraction } from "./state.ts";
import type { ReviewInput, RoundInput, RoundState } from "./state.ts";
import { terminalReview, terminalRound } from "./terminal.ts";

const sessionSchema = Type.Object({
  ...roundStateSchema.properties,
  planId: Type.String(),
  sessionId: Type.String(),
  branchId: Type.Union([Type.String(), Type.Null()]),
  cwd: Type.String(),
  objective: Type.String(),
  accepted: Type.Optional(approvalSchema),
  pendingApproval: Type.Optional(approvalSchema),
});
const snapshotSchema = Type.Object({
  version: Type.Literal(1),
  active: Type.Optional(sessionSchema),
  unfinished: Type.Array(sessionSchema),
});

export interface PlanningSession extends RoundState {
  planId: string;
  sessionId: string;
  branchId: string | null;
  cwd: string;
  objective: string;
  accepted?: PlanApproval;
  pendingApproval?: PlanApproval;
}

export interface RuntimeResult {
  outcome: string;
  message?: string;
  plan?: PlanningSession | undefined;
  planId?: string;
  approval?: PlanApproval | undefined;
  revision?: number | undefined;
  feedback?: string | undefined;
  roundId?: string | undefined;
  decisions?: RoundState["decisions"];
  round?: RoundState["round"];
  draftsSubmitted?: boolean;
}

export class PlanRuntime {
  active: PlanningSession | undefined;
  readonly unfinished: PlanningSession[] = [];
  private waiting = false;
  private readonly pi: ExtensionAPI;
  private readonly agentDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private viewVersion = 0;
  private browser: PlanBrowser | undefined;
  private viewController: AbortController | undefined;
  private finishView: (() => void) | undefined;
  private selectedInterface: "terminal" | "browser" | undefined;
  private completionTimer: ReturnType<typeof setInterval> | undefined;
  private readonly emitted = new Set<string>();
  saveStatus = { saved: false, message: "Planning state is unsaved." };

  constructor(pi: ExtensionAPI, agentDir = getAgentDir()) {
    this.pi = pi;
    this.agentDir = agentDir;
  }

  resumeCurrent(ctx: ExtensionContext): boolean {
    const active = this.active;
    if (active?.phase !== "cancelled") {
      return false;
    }
    const round = active.round;
    const phase =
      active.reviews?.at(-1)?.status === "pending"
        ? "review"
        : round !== undefined && !round.submitted
          ? round.clarifications.some((request) => request.response === undefined)
            ? "clarification"
            : "round"
          : "research";
    this.active = { ...active, phase };
    this.viewVersion += 1;
    this.save(ctx);
    return true;
  }

  cancel(ctx: ExtensionContext): RuntimeResult {
    if (
      this.active === undefined ||
      this.active.phase === "accepted" ||
      this.active.phase === "saving"
    ) {
      return { outcome: "error", message: "No cancellable planning interaction is active." };
    }
    this.active = { ...this.active, phase: "cancelled" };
    this.viewVersion += 1;
    this.controller?.abort();
    this.viewController?.abort();
    this.browser?.close();
    this.browser = undefined;
    this.save(ctx);
    ctx.abort();
    return { outcome: "cancelled", planId: this.active.planId };
  }

  resume(ctx: ExtensionContext, planId: string): void {
    if (this.waiting) {
      throw new Error("Cancel the current interaction before resuming another plan.");
    }
    const index = this.unfinished.findIndex(
      (plan) => plan.planId === planId && plan.phase !== "accepted",
    );
    const selected = this.unfinished[index];
    if (selected === undefined) {
      throw new Error("The selected unfinished plan is unavailable on this branch.");
    }
    this.unfinished.splice(index, 1);
    if (this.active !== undefined) {
      this.unfinished.push(this.active);
    }
    this.active = selected;
    this.viewVersion += 1;
    this.save(ctx);
    this.present(ctx);
  }

  switchInterface(interfaceName: "terminal" | "browser"): void {
    if (interfaceName === "terminal") {
      this.browser?.close();
      this.browser = undefined;
    }
    this.selectedInterface = interfaceName;
    this.viewController?.abort();
  }

  async chooseInterface(ctx: ExtensionContext, selected: "terminal" | "browser"): Promise<void> {
    const projectPath = join(ctx.cwd, ".pi", "plan.json");
    const project = ctx.isProjectTrusted() ? await readSettingsFile(projectPath) : {};
    await writeSettings(
      project.interface === undefined ? join(this.agentDir, "orbis-plan.json") : projectPath,
      { interface: selected },
    );
    this.switchInterface(selected);
  }

  save(ctx: ExtensionContext): { saved: boolean; message: string } {
    clearTimeout(this.saveTimer);
    this.saveStatus = saveRecord(
      this.pi,
      ctx,
      structuredClone({
        version: 1,
        ...(this.active === undefined ? {} : { active: this.active }),
        unfinished: this.unfinished,
      }),
    );
    ctx.ui.setStatus(
      "orbis-plan",
      `Plan: ${this.active?.phase ?? "inactive"} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
    );
    return this.saveStatus;
  }

  private scheduleSave(ctx: ExtensionContext) {
    clearTimeout(this.saveTimer);
    this.saveStatus = { saved: false, message: "Draft save pending (200 ms)." };
    const generation = this.generation;
    this.saveTimer = setTimeout(() => {
      if (this.generation === generation) {
        this.save(ctx);
      }
    }, 200);
  }

  close(ctx: ExtensionContext): void {
    if (this.active !== undefined) {
      this.save(ctx);
    }
    this.generation += 1;
    clearInterval(this.completionTimer);
    this.controller?.abort();
    this.viewController?.abort();
    this.browser?.close();
    this.browser = undefined;
    clearTimeout(this.saveTimer);
    this.active = undefined;
    this.unfinished.length = 0;
    ctx.ui.setStatus("orbis-plan", undefined);
  }

  restore(ctx: ExtensionContext, fork = false): void {
    this.generation += 1;
    clearInterval(this.completionTimer);
    this.controller?.abort();
    this.viewController?.abort();
    this.browser?.close();
    this.browser = undefined;
    this.viewVersion += 1;
    this.selectedInterface = undefined;
    clearTimeout(this.saveTimer);
    this.active = undefined;
    this.unfinished.length = 0;
    const record = readSavedRecord(ctx);
    if (record?.type !== "custom") {
      return;
    }
    if (!Value.Check(snapshotSchema, record.data)) {
      ctx.ui.notify(
        "Cannot restore malformed planning state. The saved record remains unchanged.",
        "error",
      );
      return;
    }
    this.active = structuredClone(record.data.active);
    this.unfinished.push(...structuredClone(record.data.unfinished));
    if (
      this.active !== undefined &&
      this.active.phase !== "accepted" &&
      (fork || this.active.sessionId !== ctx.sessionManager.getSessionId())
    ) {
      this.active.planId = randomUUID();
      this.active.sessionId = ctx.sessionManager.getSessionId();
      this.active.branchId = ctx.sessionManager.getLeafId();
      this.active.cwd = ctx.cwd;
      delete this.active.pendingApproval;
    }
    if (fork) {
      for (const plan of this.unfinished) {
        if (plan.phase !== "accepted") {
          plan.planId = randomUUID();
          plan.sessionId = ctx.sessionManager.getSessionId();
          plan.branchId = ctx.sessionManager.getLeafId();
          plan.cwd = ctx.cwd;
          delete plan.pendingApproval;
        }
      }
    }
    if (this.active?.phase === "saving") {
      this.active.phase = "review";
    }
    if (this.active?.pendingApproval !== undefined) {
      ctx.ui.notify(
        `An approval may have saved ${this.active.pendingApproval.planPath}. Review the exact revision and explicitly retry approval to reconcile it, or cancel.`,
        "warning",
      );
    }
    this.saveStatus = {
      saved: false,
      message: "Restored from the active branch; new changes require disk confirmation.",
    };
    this.present(ctx);
  }

  start(ctx: ExtensionContext, objective: string, replace = false): RuntimeResult {
    if (ctx.mode !== "tui") {
      return {
        outcome: "unsupported-mode",
        message: "Planning requires interactive Pi in TUI mode.",
      };
    }
    if (this.active !== undefined && !replace) {
      this.present(ctx);
      return { outcome: "active", plan: this.active };
    }
    if (this.waiting) {
      return {
        outcome: "error",
        message: "Cancel the current interaction before starting another plan.",
      };
    }
    if (this.active !== undefined) {
      this.unfinished.push(this.active);
    }
    this.active = {
      planId: randomUUID(),
      sessionId: ctx.sessionManager.getSessionId(),
      branchId: ctx.sessionManager.getLeafId(),
      cwd: ctx.cwd,
      objective,
      phase: "research",
      decisions: {},
    };
    this.viewVersion += 1;
    this.present(ctx);
    this.save(ctx);
    return { outcome: "started", plan: this.active };
  }

  async interact(ctx: ExtensionContext, signal?: AbortSignal): Promise<RuntimeResult> {
    const read = () => this.active;
    if (this.waiting) {
      return { outcome: "active", plan: this.active };
    }
    const current = this.active;
    const reviewing = current?.phase === "review";
    const record = reviewing ? current.reviews?.at(-1) : current?.round;
    if (record === undefined) {
      return { outcome: "error", message: "Start a round or review before requesting input." };
    }
    const roundId = reviewing ? "review" : (current?.round?.id ?? "");
    const revision = record.revision;
    this.waiting = true;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => {
      controller.abort();
      this.viewController?.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) {
      controller.abort();
    }
    try {
      const settings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted());
      this.selectedInterface ??= settings.interface;
      const apply = (
        id: string,
        expectedRevision: number,
        action: Parameters<typeof transitionInteraction>[3],
      ) => {
        const active = this.active;
        if (active === undefined) {
          throw new Error("Planning session ended.");
        }
        this.active = { ...active, ...transitionInteraction(active, id, expectedRevision, action) };
        this.viewVersion += 1;
        this.scheduleSave(ctx);
        if (this.active.phase !== "round" && this.active.phase !== "review") {
          this.finishView?.();
        }
      };
      const dispatch = (action: Parameters<typeof transitionInteraction>[3]) => {
        if (generation !== this.generation) {
          throw new Error("Planning session changed; reopen the active interaction.");
        }
        apply(roundId, revision, action);
      };
      const runView = async (): Promise<boolean> => {
        const view = this.selectedInterface;
        const viewController = new AbortController();
        const interrupted = () => viewController.signal.aborted;
        this.viewController = viewController;
        if (controller.signal.aborted || generation !== this.generation) {
          return false;
        }
        if (view === "terminal") {
          const show = reviewing ? terminalReview : terminalRound;
          await show(
            ctx,
            () => {
              if (this.active === undefined) {
                throw new Error("Planning session ended.");
              }
              return this.active;
            },
            dispatch,
            viewController.signal,
            () => {
              this.chooseInterface(ctx, "browser").catch((error: unknown) => {
                ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
              });
            },
          );
        } else {
          this.browser ??= new PlanBrowser(
            () => ({
              state: this.active,
              version: this.viewVersion,
              saving: this.saveStatus.message,
            }),
            (version, id, expectedRevision, action) => {
              if (version !== this.viewVersion || generation !== this.generation) {
                throw new Error(
                  "Planning state changed. Reload the current revision before retrying.",
                );
              }
              if (
                !this.waiting &&
                !["focus", "edit", "answer", "edit-feedback"].includes(action.type)
              ) {
                throw new Error(
                  "This interaction is paused. Use /plan in Pi to reopen it before submitting.",
                );
              }
              apply(id, expectedRevision, action);
            },
          );
          const url = await this.browser.start();
          ctx.ui.notify(
            `Planning browser: ${url}\nIf unreachable, select Use terminal below.`,
            "info",
          );
          this.finishView = () => {
            viewController.abort();
          };
          if (
            viewController.signal.aborted ||
            (this.active?.phase !== "round" && this.active?.phase !== "review")
          ) {
            return false;
          }
          const selection = await ctx.ui.select(
            `Browser planning: ${url}\nAnswer in the browser, or choose an action here.`,
            ["Use terminal (Recommended)", "Cancel planning"],
            { signal: viewController.signal },
          );
          if (selection === "Use terminal (Recommended)") {
            await this.chooseInterface(ctx, "terminal");
          } else if (!interrupted() && (read()?.phase === "round" || read()?.phase === "review")) {
            dispatch({ type: "cancel" });
          }
        }
        return (
          generation === this.generation &&
          view !== this.selectedInterface &&
          (this.active?.phase === "round" || this.active?.phase === "review")
        );
      };
      let switching: boolean;
      do {
        // oxlint-disable-next-line no-await-in-loop -- The active view must close before its replacement opens.
        switching = await runView();
      } while (switching);
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      const active = read();
      if (active === undefined) {
        return { outcome: "cancelled" };
      }
      if (active.phase === "saving") {
        const approvalSettings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted());
        if (generation !== this.generation) {
          return { outcome: "cancelled" };
        }
        if (controller.signal.aborted) {
          this.active = { ...active, phase: "review" };
          return { outcome: "cancelled" };
        }
        const approval = saveApproval(active, approvalSettings.planDirectory, (state) => {
          this.active = state;
          return this.save(ctx);
        });
        this.active = approval.state;
        this.viewVersion += 1;
        ctx.ui.setStatus(
          "orbis-plan",
          `Plan: ${this.active.phase} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
        );
        ctx.ui.notify(approval.message, approval.outcome === "approval" ? "info" : "error");
        if (approval.outcome === "approval" && approval.state.accepted !== undefined) {
          const payload = approval.state.accepted;
          ctx.abort();
          this.completionTimer = setInterval(() => {
            if (generation !== this.generation) {
              clearInterval(this.completionTimer);
              return;
            }
            if (ctx.isIdle()) {
              clearInterval(this.completionTimer);
              const key = `${payload.planId}:${String(payload.revision)}`;
              if (!this.emitted.has(key)) {
                this.emitted.add(key);
                this.pi.events.emit("orbis:plan-approved", payload);
              }
            }
          }, 10);
        }
        return {
          outcome: approval.outcome,
          message: approval.message,
          approval: approval.state.accepted,
        };
      }
      if (active.phase === "round" || active.phase === "review") {
        this.active = { ...active, phase: "cancelled" };
      }
      if (this.active?.phase === "cancelled") {
        this.browser?.close();
        this.browser = undefined;
      }
      this.present(ctx);
      this.save(ctx);
      if (active.phase === "research" && reviewing) {
        return { outcome: "feedback", revision, feedback: active.reviews?.at(-1)?.feedback };
      }
      if (active.phase === "research") {
        return {
          outcome: "answers",
          roundId: active.round?.id,
          revision: active.round?.revision,
          decisions: active.decisions,
        };
      }
      if (active.phase === "clarification") {
        return { outcome: "clarification", round: active.round, draftsSubmitted: false };
      }
      return { outcome: "cancelled", planId: active.planId };
    } catch (error) {
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      if (this.active?.phase === "saving") {
        this.active = { ...this.active, phase: "review" };
        this.viewVersion += 1;
        this.save(ctx);
      }
      const message = `${error instanceof Error ? error.message : String(error)} Use /plan to retry the current interaction, /plan-ui to switch interfaces, or /plan-cancel to cancel.`;
      ctx.ui.notify(message, "error");
      return { outcome: "error", message };
    } finally {
      this.waiting = false;
      this.finishView = undefined;
      signal?.removeEventListener("abort", abort);
    }
  }

  async round(
    ctx: ExtensionContext,
    input: RoundInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui") {
      return {
        outcome: "unsupported-mode",
        message: "Planning requires interactive Pi in TUI mode.",
      };
    }
    if (this.waiting) {
      return {
        outcome: "error",
        message: "A planning interaction is already waiting; finish or cancel it first.",
      };
    }
    const active = this.active;
    if (active === undefined || active.planId !== input.planId) {
      return {
        outcome: "error",
        message: "Start or inspect the current plan before presenting a round.",
      };
    }
    if (active.phase === "cancelled" || active.pendingApproval !== undefined) {
      return {
        outcome: "error",
        message: "Use /plan to explicitly resume unfinished work before changing its questions.",
      };
    }
    try {
      this.active = { ...active, ...presentRound(active, input) };
      this.viewVersion += 1;
      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async review(
    ctx: ExtensionContext,
    input: ReviewInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui") {
      return {
        outcome: "unsupported-mode",
        message: "Planning requires interactive Pi in TUI mode.",
      };
    }
    if (this.waiting) {
      return {
        outcome: "error",
        message: "Finish the current planning interaction before requesting review.",
      };
    }
    const active = this.active;
    if (active === undefined || active.planId !== input.planId) {
      return {
        outcome: "error",
        message: "Inspect the current plan identity before requesting review.",
      };
    }
    if (active.phase === "cancelled") {
      return {
        outcome: "error",
        message: "Use /plan to explicitly resume cancelled planning before requesting review.",
      };
    }
    if (active.pendingApproval !== undefined) {
      const review = active.reviews?.at(-1);
      if (
        review?.revision === input.expectedRevision &&
        review.markdown === input.markdown &&
        active.phase === "review"
      ) {
        return await this.interact(ctx, signal);
      }
      return {
        outcome: "error",
        message:
          "An earlier approval needs explicit reconciliation through /plan before another revision.",
      };
    }
    try {
      this.active = { ...active, ...presentReview(active, input) };
      this.viewVersion += 1;
      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  present(ctx: ExtensionContext): void {
    if (this.active !== undefined) {
      ctx.ui.setStatus(
        "orbis-plan",
        `Plan: ${this.active.phase} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
      );
      ctx.ui.notify(
        `Planning: ${this.active.objective.length === 0 ? "objective not supplied" : this.active.objective}. ${this.saveStatus.message}`,
        "info",
      );
    }
  }
}
