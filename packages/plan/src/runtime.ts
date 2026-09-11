import { randomUUID } from "node:crypto";

import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { saveApproval } from "./approval.ts";
import { prepareReviewArtifact } from "./artifacts.ts";
import { defaultShortcut, readSettings } from "./config.ts";
import type { PlanSettings } from "./config.ts";
import { fencedObjective } from "./objective.ts";
import { readSavedRecord, saveRecord } from "./persistence.ts";
import type { SaveResult } from "./persistence.ts";
import type { PlanInteractionIdentity } from "./presentation.ts";
import {
  availablePresenters,
  presentationAction,
  presentationSnapshot,
  presentersChanged,
} from "./presenters.ts";
import {
  approvalSchema,
  presentReview,
  presentRound,
  roundStateSchema,
  transitionInteraction,
} from "./state.ts";
import type {
  PlanApproval,
  PlanningSession,
  ReviewInput,
  RoundInput,
  RuntimeResult,
} from "./state.ts";
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
  mode: Type.Union([Type.Literal("plan"), Type.Literal("default")]),
  active: Type.Optional(sessionSchema),
  unfinished: Type.Array(sessionSchema),
});

const unsupportedMode = (): RuntimeResult => ({
  outcome: "unsupported-mode",
  message: "Planning requires interactive Pi in TUI mode.",
});

export class PlanRuntime {
  private selectedMode: "plan" | "default" = "default";
  private configuredShortcut: PlanSettings["shortcut"] = defaultShortcut;
  private shortcutLabel: string | undefined = "Shift+Tab";
  get shortcut(): PlanSettings["shortcut"] {
    return this.configuredShortcut;
  }

  async reloadSettings(ctx: ExtensionContext): Promise<void> {
    const generation = this.generation;
    const settings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted());
    if (generation === this.generation) {
      this.configuredShortcut = settings.shortcut;
      this.setShortcutStatus(ctx, settings.shortcut ?? undefined);
    }
  }

  setShortcutStatus(ctx: ExtensionContext, label: string | undefined): void {
    if (this.shortcutLabel !== label) {
      this.shortcutLabel = label;
      ctx.ui.setStatus("orbis-plan", this.statusLine());
    }
  }
  get mode(): "plan" | "default" {
    return this.selectedMode;
  }
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
  private viewController: AbortController | undefined;
  private selectedInterface = "terminal";
  private pendingCompletion: PlanApproval | undefined;
  private dismissedReviewSignal: AbortSignal | undefined;
  private readonly emitted = new Set<string>();
  private saveStatus: SaveResult = { saved: false, message: "Planning state is unsaved." };

  constructor(pi: ExtensionAPI, agentDir = getAgentDir()) {
    this.pi = pi;
    this.agentDir = agentDir;
  }

  toggleMode(ctx: ExtensionContext): void {
    if (!ctx.isIdle() || this.controller !== undefined) {
      ctx.ui.notify("Stop the current turn to switch modes.", "info");
      return;
    }
    if (this.selectedMode === "plan") {
      this.pause(ctx);
    } else {
      this.selectedMode = "plan";
      this.save(ctx);
    }
  }

  pause(ctx: ExtensionContext): void {
    if (this.current?.phase === "saving") {
      return;
    }
    if (this.current !== undefined && this.current.phase !== "accepted") {
      this.current = { ...this.current, phase: "cancelled" };
    }
    this.selectedMode = "default";
    this.disposeOperations();
    this.save(ctx);
  }

  async selectUnfinished(ctx: ExtensionContext, signal?: AbortSignal): Promise<boolean> {
    const plans = [this.current, ...this.archived].filter(
      (plan): plan is PlanningSession => plan !== undefined && plan.phase !== "accepted",
    );
    if (plans.length < 2) {
      const plan = plans[0];
      if (plan !== undefined && plan !== this.current) {
        this.resume(ctx, plan.planId);
      }
      return true;
    }
    const generation = this.generation;
    const labels = plans.map((plan) => `${plan.objective} [${plan.planId}]`);
    const selected = await ctx.ui.select(
      "Continue a saved plan",
      labels,
      signal === undefined ? undefined : { signal },
    );
    if (selected === undefined || signal?.aborted === true || generation !== this.generation) {
      return false;
    }
    const plan = plans[labels.indexOf(selected)];
    if (plan === undefined) {
      return false;
    }
    if (plan !== this.current) {
      this.resume(ctx, plan.planId);
    }
    return true;
  }

  resumeCurrent(ctx: ExtensionContext): boolean {
    const active = this.current;
    if (active?.phase !== "cancelled") {
      return false;
    }
    const round = active.round;
    let phase: PlanningSession["phase"] = "research";
    if (active.reviews?.at(-1)?.status === "pending") {
      phase = "review";
    } else if (round !== undefined && !round.submitted) {
      phase = round.clarifications.some((request) => request.response === undefined)
        ? "clarification"
        : "round";
    }
    this.current = { ...active, phase };
    this.selectedMode = "plan";

    this.save(ctx);
    return true;
  }

  private resume(ctx: ExtensionContext, planId: string): void {
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

    this.save(ctx);
    this.present(ctx);
  }

  private get presenters(): readonly { id: string; label: string }[] {
    return availablePresenters(this.pi.events).map(({ id, label }) => ({ id, label }));
  }

  private statusLine(): string {
    const mode = `${this.selectedMode === "plan" ? "Plan" : "Default"} mode${this.shortcutLabel === undefined ? "" : ` · ${this.shortcutLabel}`}`;
    return this.current === undefined
      ? mode
      : `${mode} · ${this.current.phase} (${this.saveStatus.saved ? "saved" : "unsaved"})`;
  }

  save(ctx: ExtensionContext): SaveResult {
    clearTimeout(this.saveTimer);
    this.saveStatus = saveRecord(
      this.pi,
      ctx,
      structuredClone({
        version: 1,
        mode: this.selectedMode,
        ...(this.current === undefined ? {} : { active: this.current }),
        unfinished: this.archived,
      }),
    );
    ctx.ui.setStatus("orbis-plan", this.statusLine());
    if (!this.saveStatus.saved && this.saveStatus.deferred !== true) {
      ctx.ui.notify(this.saveStatus.message, "warning");
    }
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
    this.selectedMode = "default";
    this.archived.length = 0;
    ctx.ui.setStatus("orbis-plan", undefined);
  }

  restore(ctx: ExtensionContext): void {
    this.disposeOperations();

    this.selectedInterface = "terminal";
    clearTimeout(this.saveTimer);
    this.current = undefined;
    this.selectedMode = "default";
    ctx.ui.setStatus("orbis-plan", this.statusLine());
    this.archived.length = 0;
    const saved = readSavedRecord(ctx);
    if (saved.status === "unreadable") {
      ctx.ui.notify(
        `Cannot read the Pi session file, so planning state was not restored: ${saved.message}. Correct the storage error and reload Pi.`,
        "error",
      );
      return;
    }
    if (saved.status === "none" || saved.entry.type !== "custom") {
      return;
    }
    const record = saved.entry;
    if (
      !Value.Check(snapshotSchema, record.data) ||
      [record.data.active, ...record.data.unfinished].some((plan) => {
        if (plan === undefined) {
          return false;
        }
        const round = plan.round;
        const review = plan.reviews?.at(-1);
        switch (plan.phase) {
          case "round":
          case "clarification":
            if (round === undefined || round.submitted) {
              return true;
            }
            break;
          case "review":
          case "saving":
            if (review?.status !== "pending") {
              return true;
            }
            break;
          case "accepted":
            if (plan.accepted === undefined || review?.status !== "approved") {
              return true;
            }
            break;
          case "research":
          case "cancelled":
            break;
        }
        return (
          round?.questions.some((question) => {
            const draft = round.drafts[question.id];
            const answer = draft?.answer;
            return (
              draft === undefined ||
              (draft.revision === question.revision &&
                answer !== undefined &&
                "optionId" in answer &&
                !question.options.some((option) => option.id === answer.optionId))
            );
          }) ?? false
        );
      })
    ) {
      ctx.ui.notify(
        "Cannot restore malformed planning state. The saved record remains unchanged.",
        "error",
      );
      return;
    }
    this.current = structuredClone(record.data.active);
    this.archived.push(...structuredClone(record.data.unfinished));
    if (this.current?.phase === "accepted") {
      this.selectedMode = "default";
    } else {
      this.selectedMode = record.data.mode;
    }
    ctx.ui.setStatus("orbis-plan", this.statusLine());
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
    this.pendingCompletion = undefined;
    this.dismissedReviewSignal = undefined;
    this.controller?.abort();
    this.entryController?.abort();
    this.viewController?.abort();
    this.controller = undefined;
    this.viewController = undefined;
  }

  async requestStart(
    ctx: ExtensionContext,
    objective: string,
    replace: boolean,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui") {
      return unsupportedMode();
    }
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
      if (replace && plan !== undefined) {
        const confirmed = await ctx.ui.confirm(
          "Start another plan?",
          "Keep the current unfinished plan and start a new objective?",
          { signal: combined },
        );
        if (!confirmed || !current() || this.current !== plan) {
          return { outcome: "cancelled" };
        }
      }
      if (!replace) {
        if (!(await this.selectUnfinished(ctx, combined)) || !current()) {
          return { outcome: "cancelled" };
        }
      }
      const entry = this.start(ctx, objective, replace);
      this.resumeCurrent(ctx);
      if (this.current?.phase === "round" || this.current?.phase === "review") {
        return await this.interact(ctx, combined);
      }
      if (this.current?.phase === "clarification" && this.current.round !== undefined) {
        return { outcome: "clarification", round: this.current.round, draftsSubmitted: false };
      }
      return entry.outcome === "active" && this.current !== undefined
        ? { outcome: "active", plan: this.current }
        : entry;
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
      return unsupportedMode();
    }
    if (this.current !== undefined && this.current.phase !== "accepted" && !replace) {
      this.selectedMode = "plan";
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
      roundNumber: 0,
      questionNumbers: {},
      decisions: {},
    };
    this.selectedMode = "plan";

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
      await this.deliverInput(result, signal);
    }
  }

  async resumeClarification(signal?: AbortSignal): Promise<void> {
    const active = this.current;
    if (active?.phase === "clarification" && active.round !== undefined) {
      await this.deliverInput(
        { outcome: "clarification", round: active.round, draftsSubmitted: false },
        signal,
      );
    }
  }

  private async deliverInput(result: RuntimeResult, signal?: AbortSignal): Promise<void> {
    const plan = this.current;
    const generation = this.generation;
    const current = () =>
      plan !== undefined &&
      this.current === plan &&
      generation === this.generation &&
      signal?.aborted !== true;
    if (!current()) {
      return;
    }
    try {
      const prepared = await toolResult(result);
      if (current()) {
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

  private ownReview(ctx: ExtensionContext): void {
    const active = this.current;
    if (active?.phase !== "review") {
      return;
    }
    const branch = new Set(ctx.sessionManager.getBranch().map((entry) => entry.id));
    const divergent =
      active.pendingApproval === undefined &&
      (active.sessionId !== ctx.sessionManager.getSessionId() ||
        ctx.sessionManager.getEntries().some((entry) => {
          if (
            branch.has(entry.id) ||
            entry.type !== "custom" ||
            entry.customType !== "orbis-plan" ||
            !Value.Check(snapshotSchema, entry.data)
          ) {
            return false;
          }
          return [entry.data.active, ...entry.data.unfinished].some(
            (plan) => plan?.planId === active.planId,
          );
        }));
    const owned = divergent
      ? {
          ...active,
          planId: randomUUID(),
          sessionId: ctx.sessionManager.getSessionId(),
          branchId: ctx.sessionManager.getLeafId(),
          cwd: ctx.cwd,
        }
      : active;
    if (owned !== active) {
      const reviews = structuredClone(owned.reviews ?? []);
      const latest = reviews.at(-1);
      if (latest !== undefined) {
        delete latest.path;
      }
      this.current = { ...owned, reviews };
    }
  }

  async interact(ctx: ExtensionContext, signal?: AbortSignal): Promise<RuntimeResult> {
    const read = () => this.current;
    if (this.controller !== undefined) {
      return { outcome: "error", message: "A planning interaction is already waiting." };
    }
    this.ownReview(ctx);
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
    const reviewClosure = { requested: false };
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
      if (reviewing && this.current !== undefined) {
        this.current = prepareReviewArtifact(this.current, settings.planDirectory, (state) => {
          this.current = state;
          return this.save(ctx);
        });
      }
      this.selectedInterface = "terminal";
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

        this.scheduleSave(ctx);
      };
      const dispatch = (action: Parameters<typeof transitionInteraction>[3]) => {
        if (generation !== this.generation) {
          throw new Error("Planning session changed; reopen the active interaction.");
        }
        apply(roundId, revision, action);
        if (reviewing && action.type === "cancel") {
          reviewClosure.requested = true;
        }
      };
      const runView = async (): Promise<boolean> => {
        const view = this.selectedInterface;
        const viewController = new AbortController();
        this.viewController = viewController;
        const valid = () =>
          this.controller === controller &&
          !controller.signal.aborted &&
          !viewController.signal.aborted &&
          this.viewController === viewController &&
          generation === this.generation &&
          this.current?.planId === current?.planId;
        if (!valid()) {
          return false;
        }
        const chooser = { requested: false };
        let fallback = false;
        const guardedDispatch = (action: Parameters<typeof transitionInteraction>[3]) => {
          if (!valid()) {
            throw new Error("Planning presenter is no longer active.");
          }
          dispatch(action);
        };
        const remove = this.pi.events.on(presentersChanged, () => {
          if (view !== "terminal" && !this.presenters.some((item) => item.id === view)) {
            fallback = true;
            viewController.abort();
          }
        });
        try {
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
              guardedDispatch,
              viewController.signal,
              this.presenters.length === 0
                ? undefined
                : () => {
                    chooser.requested = true;
                    viewController.abort();
                  },
              settings,
            );
          } else {
            const presenter = availablePresenters(this.pi.events).find((item) => item.id === view);
            if (presenter === undefined) {
              fallback = true;
            } else {
              const identity: PlanInteractionIdentity = {
                version: 1,
                sessionId: ctx.sessionManager.getSessionId(),
                planId: current?.planId ?? "",
                interactionId: randomUUID(),
                revision,
              };
              const stop = Symbol("interrupted");
              const interrupted = Promise.withResolvers<typeof stop>();
              const onAbort = () => {
                interrupted.resolve(stop);
              };
              viewController.signal.addEventListener("abort", onAbort, { once: true });
              try {
                const pending = Promise.resolve().then(async () => {
                  if (!valid()) {
                    return undefined;
                  }
                  const active = this.current;
                  if (active === undefined) {
                    return undefined;
                  }
                  return await presenter.present({
                    identity: { ...identity },
                    snapshot: presentationSnapshot(active),
                    signal: viewController.signal,
                    updateDraft: (update) => {
                      guardedDispatch(presentationAction(update, identity, true));
                      if (this.current === undefined) {
                        throw new Error("Planning session ended.");
                      }
                      return presentationSnapshot(this.current);
                    },
                  });
                });
                const control = ctx.ui
                  .select(
                    "Planning presenter: " + presenter.label,
                    ["Use terminal (Recommended)", "Cancel planning"],
                    { signal: viewController.signal },
                  )
                  .then((selection) => {
                    if (valid()) {
                      if (selection === "Cancel planning") {
                        guardedDispatch({ type: "cancel" });
                      } else {
                        this.selectedInterface = "terminal";
                      }
                      viewController.abort();
                    }
                    return stop;
                  });
                const result = await Promise.race([pending, interrupted.promise, control]);
                if (result !== stop && valid()) {
                  if (result === undefined) {
                    fallback = true;
                  } else {
                    guardedDispatch(presentationAction(result, identity, false));
                  }
                }
              } catch (error) {
                if (valid()) {
                  ctx.ui.notify(
                    "Presenter failed: " +
                      (error instanceof Error ? error.message : String(error)) +
                      ". Returning to terminal input.",
                    "error",
                  );
                  fallback = true;
                }
              } finally {
                viewController.signal.removeEventListener("abort", onAbort);
              }
            }
          }
        } finally {
          remove();
          viewController.abort();
          if (this.viewController === viewController) {
            this.viewController = undefined;
          }
        }
        const active =
          !controller.signal.aborted &&
          generation === this.generation &&
          (this.current?.phase === "round" || this.current?.phase === "review");
        if (!active) {
          return false;
        }
        if (chooser.requested) {
          const choices = ["terminal", ...this.presenters.map((item) => item.id)];
          const selected = await ctx.ui.select("Planning presenter", choices, {
            signal: controller.signal,
          });
          if (
            signal?.aborted === true ||
            this.controller !== controller ||
            generation !== this.generation
          ) {
            return false;
          }
          this.selectedInterface =
            selected !== undefined && choices.includes(selected) ? selected : "terminal";
          return true;
        }
        if (fallback) {
          this.selectedInterface = "terminal";
        }
        return fallback || view !== this.selectedInterface;
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

        ctx.ui.setStatus("orbis-plan", this.statusLine());
        ctx.ui.notify(approval.message, approval.outcome === "approval" ? "info" : "error");
        if (approval.outcome === "approval" && approval.state.accepted !== undefined) {
          this.selectedMode = "default";
          this.save(ctx);
          this.pendingCompletion = approval.state.accepted;
          ctx.abort();
          this.settled(ctx);
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
          clarifications: structuredClone(active.round.clarifications),
        };
      }
      if (active.phase === "clarification") {
        if (active.round === undefined) {
          throw new Error("Clarification ended without its round.");
        }
        return { outcome: "clarification", round: active.round, draftsSubmitted: false };
      }
      this.pause(ctx);
      if (reviewClosure.requested) {
        this.dismissedReviewSignal = ctx.signal;
        ctx.ui.notify("Plan review closed without approval. Use /plan to resume.", "warning");
      }
      ctx.abort();
      return { outcome: "cancelled", planId: active.planId };
    } catch (error) {
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      if (this.current?.phase === "saving") {
        this.current = { ...this.current, phase: "review" };

        this.save(ctx);
      }
      const message = `${error instanceof Error ? error.message : String(error)} Use /plan to retry the current interaction, or Escape to pause planning.`;
      ctx.ui.notify(message, "error");
      return { outcome: "error", message };
    } finally {
      if (this.controller === controller) {
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
      return unsupportedMode();
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
      return unsupportedMode();
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

      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  present(ctx: ExtensionContext): void {
    if (this.current !== undefined) {
      ctx.ui.setStatus("orbis-plan", this.statusLine());
      ctx.ui.notify(
        `Planning:\n${fencedObjective(this.current.objective.length === 0 ? "objective not supplied" : this.current.objective)}\n\n${this.saveStatus.message}`,
        "info",
      );
    }
  }

  replaceReviewAbort(
    message: MessageEndEvent["message"],
    ctx: ExtensionContext,
  ): MessageEndEvent["message"] | undefined {
    if (message.role !== "assistant") {
      return undefined;
    }
    const signal = this.dismissedReviewSignal;
    this.dismissedReviewSignal = undefined;
    if (
      signal === undefined ||
      signal !== ctx.signal ||
      !signal.aborted ||
      message.content.length > 0 ||
      (message.diagnostics?.length ?? 0) > 0 ||
      !(
        message.stopReason === "aborted" ||
        (message.stopReason === "error" &&
          (message.errorMessage === "This operation was aborted" ||
            message.errorMessage === "Request was aborted"))
      )
    ) {
      return undefined;
    }
    const replacement = { ...message, stopReason: "stop" as const };
    delete replacement.errorMessage;
    return replacement;
  }

  settled(ctx: ExtensionContext): void {
    this.dismissedReviewSignal = undefined;
    const payload = this.pendingCompletion;
    if (payload === undefined || !ctx.isIdle()) {
      return;
    }
    this.pendingCompletion = undefined;
    const key = `${payload.planId}:${String(payload.revision)}`;
    if (!this.emitted.has(key)) {
      this.emitted.add(key);
      this.pi.events.emit("orbis:plan-approved", payload);
    }
  }
}
