import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { saveApproval } from "./approval.ts";
import { PlanBrowser } from "./browser.ts";
import { readSettings, readSettingsFile, writeSettings } from "./config.ts";
import { readSavedRecord, saveRecord } from "./persistence.ts";
import {
  approvalSchema,
  presentReview,
  presentRound,
  roundStateSchema,
  transitionInteraction,
} from "./state.ts";
import type { PlanningSession, ReviewInput, RoundInput, RuntimeResult } from "./state.ts";
import { terminalReview, terminalRound } from "./terminal.ts";
import { toolResult } from "./tool-result.ts";

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

export type { PlanningSession } from "./state.ts";

export type { RuntimeResult } from "./state.ts";

export class PlanRuntime {
  private current: PlanningSession | undefined;
  private readonly archived: PlanningSession[] = [];

  get active(): Readonly<PlanningSession> | undefined {
    return this.current;
  }

  get unfinished(): readonly Readonly<PlanningSession>[] {
    return this.archived;
  }
  private readonly pi: ExtensionAPI;
  private readonly agentDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private entryController: AbortController | undefined;
  private generation = 0;
  private viewVersion = 0;
  private browser: PlanBrowser | undefined;
  private viewController: AbortController | undefined;
  private finishView: (() => void) | undefined;
  private selectedInterface: "terminal" | "browser" | undefined;
  private interfaceRequest = 0;
  private completionTimer: ReturnType<typeof setInterval> | undefined;
  private readonly emitted = new Set<string>();
  saveStatus = { saved: false, message: "Planning state is unsaved." };

  constructor(pi: ExtensionAPI, agentDir = getAgentDir()) {
    this.pi = pi;
    this.agentDir = agentDir;
  }

  resumeCurrent(ctx: ExtensionContext): boolean {
    const active = this.current;
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
    this.current = { ...active, phase };
    this.viewVersion += 1;
    this.save(ctx);
    return true;
  }

  cancel(ctx: ExtensionContext): RuntimeResult {
    if (
      this.current === undefined ||
      this.current.phase === "accepted" ||
      this.current.phase === "saving"
    ) {
      return { outcome: "error", message: "No cancellable planning interaction is active." };
    }
    this.current = { ...this.current, phase: "cancelled" };
    this.viewVersion += 1;
    this.disposeOperations();
    this.save(ctx);
    ctx.abort();
    return { outcome: "cancelled", planId: this.current.planId };
  }

  resume(ctx: ExtensionContext, planId: string): void {
    if (this.controller !== undefined) {
      throw new Error("Cancel the current interaction before resuming another plan.");
    }
    const index = this.archived.findIndex(
      (plan) => plan.planId === planId && plan.phase !== "accepted",
    );
    const selected = this.archived[index];
    if (selected === undefined) {
      throw new Error("The selected unfinished plan is unavailable on this branch.");
    }
    this.archived.splice(index, 1);
    if (this.current !== undefined) {
      this.archived.push(this.current);
    }
    this.current = selected;
    this.viewVersion += 1;
    this.save(ctx);
    this.present(ctx);
  }

  switchInterface(interfaceName: "terminal" | "browser"): void {
    this.interfaceRequest += 1;
    if (interfaceName === "terminal") {
      this.browser?.close();
      this.browser = undefined;
    }
    this.selectedInterface = interfaceName;
    this.viewController?.abort();
  }

  async chooseInterface(
    ctx: ExtensionContext,
    selected: "terminal" | "browser",
    signal?: AbortSignal,
  ): Promise<boolean> {
    const generation = this.generation;
    const request = ++this.interfaceRequest;
    const current = () =>
      generation === this.generation &&
      request === this.interfaceRequest &&
      signal?.aborted !== true;
    if (!current()) {
      return false;
    }
    try {
      const projectPath = join(ctx.cwd, ".pi", "plan.json");
      const project = ctx.isProjectTrusted() ? await readSettingsFile(projectPath) : {};
      if (!current()) {
        return false;
      }
      await writeSettings(
        project.interface === undefined ? join(this.agentDir, "orbis-plan.json") : projectPath,
        { interface: selected },
        current,
      );
      if (!current()) {
        return false;
      }
      this.switchInterface(selected);
      return true;
    } catch (error) {
      if (!current()) {
        return false;
      }
      throw error;
    }
  }

  save(ctx: ExtensionContext): { saved: boolean; message: string } {
    clearTimeout(this.saveTimer);
    this.saveStatus = saveRecord(
      this.pi,
      ctx,
      structuredClone({
        version: 1,
        ...(this.current === undefined ? {} : { active: this.current }),
        unfinished: this.archived,
      }),
    );
    ctx.ui.setStatus(
      "orbis-plan",
      `Plan: ${this.current?.phase ?? "inactive"} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
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
    if (this.current !== undefined) {
      this.save(ctx);
    }
    this.disposeOperations();
    clearTimeout(this.saveTimer);
    this.current = undefined;
    this.archived.length = 0;
    ctx.ui.setStatus("orbis-plan", undefined);
  }

  restore(ctx: ExtensionContext, fork = false): void {
    this.disposeOperations();
    this.viewVersion += 1;
    this.selectedInterface = undefined;
    clearTimeout(this.saveTimer);
    this.current = undefined;
    this.archived.length = 0;
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
    this.current = structuredClone(record.data.active);
    this.archived.push(...structuredClone(record.data.unfinished));
    if (
      this.current !== undefined &&
      this.current.phase !== "accepted" &&
      (fork || this.current.sessionId !== ctx.sessionManager.getSessionId())
    ) {
      this.current.planId = randomUUID();
      this.current.sessionId = ctx.sessionManager.getSessionId();
      this.current.branchId = ctx.sessionManager.getLeafId();
      this.current.cwd = ctx.cwd;
      delete this.current.pendingApproval;
    }
    if (fork) {
      for (const plan of this.archived) {
        if (plan.phase !== "accepted") {
          plan.planId = randomUUID();
          plan.sessionId = ctx.sessionManager.getSessionId();
          plan.branchId = ctx.sessionManager.getLeafId();
          plan.cwd = ctx.cwd;
          delete plan.pendingApproval;
        }
      }
    }
    if (this.current?.phase === "saving") {
      this.current.phase = "review";
    }
    if (this.current?.pendingApproval !== undefined) {
      ctx.ui.notify(
        `An approval may have saved ${this.current.pendingApproval.planPath}. Review the exact revision and explicitly retry approval to reconcile it, or cancel.`,
        "warning",
      );
    }
    this.saveStatus = {
      saved: false,
      message: "Restored from the active branch; new changes require disk confirmation.",
    };
    this.present(ctx);
  }

  private disposeOperations() {
    this.generation += 1;
    clearInterval(this.completionTimer);
    this.controller?.abort();
    this.entryController?.abort();
    this.viewController?.abort();
    this.browser?.close();
    this.browser = undefined;
    this.controller = undefined;
    this.viewController = undefined;
    this.finishView = undefined;
  }

  async requestStart(
    ctx: ExtensionContext,
    objective: string,
    replace: boolean,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    const generation = this.generation;
    const plan = this.current;
    const controller = new AbortController();
    this.entryController?.abort();
    this.entryController = controller;
    const combined =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    const current = () => generation === this.generation && !combined.aborted;
    try {
      if (!current()) {
        return { outcome: "cancelled" };
      }
      if (ctx.mode === "tui" && replace && plan !== undefined) {
        const confirmed = await ctx.ui.confirm(
          "Start another plan?",
          "Keep the current unfinished plan and start a new objective?",
          { signal: combined },
        );
        if (!confirmed || !current() || this.current !== plan) {
          return { outcome: "cancelled" };
        }
      }
      return this.start(ctx, objective, replace);
    } catch (error) {
      if (!current()) {
        return { outcome: "cancelled" };
      }
      throw error;
    } finally {
      if (this.entryController === controller) {
        this.entryController = undefined;
      }
    }
  }

  start(ctx: ExtensionContext, objective: string, replace = false): RuntimeResult {
    if (ctx.mode !== "tui") {
      return {
        outcome: "unsupported-mode",
        message: "Planning requires interactive Pi in TUI mode.",
      };
    }
    if (this.current !== undefined && !replace) {
      this.present(ctx);
      return { outcome: "active", plan: this.current };
    }
    if (this.controller !== undefined) {
      return {
        outcome: "error",
        message: "Cancel the current interaction before starting another plan.",
      };
    }
    if (this.current !== undefined) {
      this.archived.push(this.current);
    }
    this.current = {
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
    return { outcome: "started", plan: this.current };
  }

  async reopen(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    const generation = this.generation;
    const planId = this.current?.planId;
    const current = () =>
      generation === this.generation && this.current?.planId === planId && signal?.aborted !== true;
    const result = await this.interact(ctx, signal);
    if (!current()) {
      return;
    }
    if (
      result.outcome === "answers" ||
      result.outcome === "clarification" ||
      result.outcome === "feedback"
    ) {
      const plan = this.current;
      if (plan === undefined) {
        return;
      }
      try {
        const prepared = await toolResult(result);
        const updated = this.current;
        if (
          current() &&
          updated !== undefined &&
          updated.phase === plan.phase &&
          updated.round?.id === plan.round?.id &&
          updated.round?.revision === plan.round?.revision &&
          updated.reviews?.at(-1)?.revision === plan.reviews?.at(-1)?.revision
        ) {
          this.pi.sendMessage(
            { customType: "orbis-plan-input", content: prepared.content, display: true },
            { triggerTurn: true },
          );
        }
      } catch (error) {
        if (current()) {
          throw error;
        }
      }
    }
  }

  async interact(ctx: ExtensionContext, signal?: AbortSignal): Promise<RuntimeResult> {
    const read = () => this.current;
    if (this.controller !== undefined) {
      return { outcome: "error", message: "A planning interaction is already waiting." };
    }
    const current = this.current;
    const reviewing = current?.phase === "review";
    const record = reviewing ? current.reviews?.at(-1) : current?.round;
    if (record === undefined) {
      return { outcome: "error", message: "Start a round or review before requesting input." };
    }
    const roundId = reviewing ? "review" : (current?.round?.id ?? "");
    const revision = record.revision;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => {
      controller.abort();
      if (this.controller === controller) {
        this.viewController?.abort();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) {
      controller.abort();
    }
    try {
      const settings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted());
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      this.selectedInterface ??= settings.interface;
      const apply = (
        id: string,
        expectedRevision: number,
        action: Parameters<typeof transitionInteraction>[3],
      ) => {
        const active = this.current;
        if (active === undefined) {
          throw new Error("Planning session ended.");
        }
        this.current = {
          ...active,
          ...transitionInteraction(active, id, expectedRevision, action),
        };
        this.viewVersion += 1;
        this.scheduleSave(ctx);
        if (this.current.phase !== "round" && this.current.phase !== "review") {
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
        const obsolete = () => controller.signal.aborted || generation !== this.generation;
        const view = this.selectedInterface;
        const viewController = new AbortController();
        const interrupted = () => viewController.signal.aborted;
        this.viewController = viewController;
        if (obsolete()) {
          return false;
        }
        if (view === "terminal") {
          const show = reviewing ? terminalReview : terminalRound;
          await show(
            ctx,
            () => {
              if (this.current === undefined) {
                throw new Error("Planning session ended.");
              }
              return this.current;
            },
            dispatch,
            viewController.signal,
            () => {
              this.chooseInterface(ctx, "browser", controller.signal).catch((error: unknown) => {
                if (generation === this.generation && !controller.signal.aborted) {
                  ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
                }
              });
            },
          );
        } else {
          this.browser ??= new PlanBrowser(
            () => ({
              state: this.current,
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
                this.controller === undefined &&
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
          if (obsolete()) {
            return false;
          }
          ctx.ui.notify(
            `Planning browser: ${url}\nIf unreachable, select Use terminal below.`,
            "info",
          );
          this.finishView = () => {
            viewController.abort();
          };
          if (
            viewController.signal.aborted ||
            (this.current?.phase !== "round" && this.current?.phase !== "review")
          ) {
            return false;
          }
          const selection = await ctx.ui.select(
            `Browser planning: ${url}\nAnswer in the browser, or choose an action here.`,
            ["Use terminal (Recommended)", "Cancel planning"],
            { signal: viewController.signal },
          );
          if (selection === "Use terminal (Recommended)") {
            await this.chooseInterface(ctx, "terminal", controller.signal);
          } else if (!interrupted() && (read()?.phase === "round" || read()?.phase === "review")) {
            dispatch({ type: "cancel" });
          }
        }
        return (
          generation === this.generation &&
          view !== this.selectedInterface &&
          (this.current?.phase === "round" || this.current?.phase === "review")
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
          this.current = { ...active, phase: "review" };
          return { outcome: "cancelled" };
        }
        const approval = saveApproval(active, approvalSettings.planDirectory, (state) => {
          this.current = state;
          return this.save(ctx);
        });
        this.current = approval.state;
        this.viewVersion += 1;
        ctx.ui.setStatus(
          "orbis-plan",
          `Plan: ${this.current.phase} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
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
        if (approval.outcome === "error") {
          return { outcome: "error", message: approval.message };
        }
        if (approval.state.accepted === undefined) {
          throw new Error("Approval completed without its accepted record.");
        }
        return {
          outcome: "approval",
          message: approval.message,
          approval: approval.state.accepted,
        };
      }
      if (active.phase === "round" || active.phase === "review") {
        this.current = { ...active, phase: "cancelled" };
      }
      if (this.current?.phase === "cancelled") {
        this.browser?.close();
        this.browser = undefined;
      }
      this.present(ctx);
      this.save(ctx);
      if (active.phase === "research" && reviewing) {
        const feedback = active.reviews?.at(-1)?.feedback;
        if (feedback === undefined) {
          throw new Error("Plan review ended without feedback.");
        }
        return { outcome: "feedback", revision, feedback };
      }
      if (active.phase === "research") {
        if (active.round === undefined) {
          throw new Error("Question submission ended without its round.");
        }
        return {
          outcome: "answers",
          roundId: active.round.id,
          revision: active.round.revision,
          decisions: active.decisions,
        };
      }
      if (active.phase === "clarification") {
        if (active.round === undefined) {
          throw new Error("Clarification ended without its round.");
        }
        return { outcome: "clarification", round: active.round, draftsSubmitted: false };
      }
      return { outcome: "cancelled", planId: active.planId };
    } catch (error) {
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      if (this.current?.phase === "saving") {
        this.current = { ...this.current, phase: "review" };
        this.viewVersion += 1;
        this.save(ctx);
      }
      const message = `${error instanceof Error ? error.message : String(error)} Use /plan to retry the current interaction, /plan-ui to switch interfaces, or /plan-cancel to cancel.`;
      ctx.ui.notify(message, "error");
      return { outcome: "error", message };
    } finally {
      if (this.controller === controller) {
        this.finishView = undefined;
        this.controller = undefined;
      }
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
    if (this.controller !== undefined) {
      return {
        outcome: "error",
        message: "A planning interaction is already waiting; finish or cancel it first.",
      };
    }
    const active = this.current;
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
      this.current = { ...active, ...presentRound(active, input) };
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
    if (this.controller !== undefined) {
      return {
        outcome: "error",
        message: "Finish the current planning interaction before requesting review.",
      };
    }
    const active = this.current;
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
      this.current = { ...active, ...presentReview(active, input) };
      this.viewVersion += 1;
      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  present(ctx: ExtensionContext): void {
    if (this.current !== undefined) {
      ctx.ui.setStatus(
        "orbis-plan",
        `Plan: ${this.current.phase} (${this.saveStatus.saved ? "saved" : "unsaved"})`,
      );
      ctx.ui.notify(
        `Planning: ${this.current.objective.length === 0 ? "objective not supplied" : this.current.objective}. ${this.saveStatus.message}`,
        "info",
      );
    }
  }
}
