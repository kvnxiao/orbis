import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { DocumentAnalysis } from "../document/document-analysis.ts";
import { PlanningError, describe, errorResult, superseded } from "../domain/errors.ts";
import { fencedObjective } from "../domain/objective.ts";
import {
  recoverReview,
  reopenApproval,
  closeReview,
  approvalKey,
  presentReview,
  presentRound,
  validSnapshot,
  transitionInteraction,
} from "../domain/state.ts";
import type {
  PlanApproval,
  PlanningSnapshot,
  PlanningSession,
  ReviewInput,
  RoundInput,
  RuntimeResult,
} from "../domain/state.ts";
import type { PlanInteractionIdentity } from "../presentation.ts";
import { saveApproval } from "../storage/approval.ts";
import { prepareReviewArtifact } from "../storage/artifacts.ts";
import { defaultShortcut, readSettings } from "../storage/config.ts";
import type { PlanSettings } from "../storage/config.ts";
import { readLaunches } from "../storage/launches.ts";
import { runPlanningOperation } from "../storage/operations.ts";
import { saveFailure, readSavedRecord, saveRecord } from "../storage/persistence.ts";
import type { SaveResult } from "../storage/persistence.ts";
import { SessionFile } from "../storage/session-file.ts";
import { PlanHandoff } from "./handoff.ts";
import {
  availablePresenters,
  presentationAction,
  presentationSnapshot,
  presentersChanged,
} from "./presenters.ts";
import { terminalReview, terminalRound } from "./terminal.ts";
import { toolResult } from "./tool-result.ts";

function recoverPlanningCheckpoint(plan: PlanningSession): PlanningSession {
  const restored = reopenApproval(structuredClone(plan), true);
  const pending = restored.pendingApproval;
  if (
    pending !== undefined &&
    restored.approvals?.some((approval) => approvalKey(approval) === approvalKey(pending)) === true
  ) {
    delete restored.pendingApproval;
  }
  return {
    ...(restored.phase === "saving" ? recoverReview(restored) : restored),
    approvalRequired: true,
  };
}

const unsupportedMode = (): RuntimeResult => ({
  outcome: "unsupported-mode",
  message: "Planning requires interactive Pi in TUI mode.",
});

/** Own one planning session, its interactions, and durable branch snapshots. */
export class PlanRuntime {
  private readonly sessionFile = new SessionFile();
  private selectedMode: "plan" | "default" = "default";
  private configuredShortcut: PlanSettings["shortcut"] = defaultShortcut;
  private shortcutLabel: string | undefined;
  get shortcut(): PlanSettings["shortcut"] {
    return this.configuredShortcut;
  }

  async reloadSettings(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    const generation = this.generation;
    const settings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted(), signal);
    if (generation === this.generation && signal?.aborted !== true) {
      this.configuredShortcut = settings.shortcut;
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
  private recovery:
    | { entryId: string; checkpoint?: { id: string; data: PlanningSnapshot } }
    | undefined;
  private readonly archived: PlanningSession[] = [];

  get active(): Readonly<PlanningSession> | undefined {
    return structuredClone(this.current);
  }

  get unfinished(): readonly Readonly<PlanningSession>[] {
    return structuredClone(this.archived);
  }
  private readonly pi: ExtensionAPI;
  private readonly handoff: PlanHandoff;
  private readonly agentDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private entryController: AbortController | undefined;
  private generation = 0;
  private sessionGeneration = 0;
  private viewController: AbortController | undefined;
  private selectedInterface = "terminal";
  private pendingCompletion: PlanApproval | undefined;
  private dismissedReviewSignal: AbortSignal | undefined;
  private readonly emitted = new Set<string>();
  private saveStatus: SaveResult = { saved: false, message: "Planning state is unsaved." };

  constructor(pi: ExtensionAPI, agentDir = getAgentDir()) {
    this.pi = pi;
    this.handoff = new PlanHandoff(pi);
    this.agentDir = agentDir;
  }

  toggleMode(ctx: ExtensionContext): void {
    if (this.recovery !== undefined) {
      ctx.ui.notify("Use /plan to select recovery before changing planning mode.", "warning");
      return;
    }
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
      this.current = closeReview(this.current);
    }
    this.selectedMode = "default";
    this.disposeOperations();
    this.save(ctx);
  }

  async selectUnfinished(ctx: ExtensionContext, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.recoverCheckpoint(ctx, signal))) {
      return false;
    }
    const plans = [this.current, ...this.archived].filter(
      (plan): plan is PlanningSession => plan !== undefined,
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
      throw new PlanningError(
        "rejected",
        "Cancel the current interaction before resuming another plan.",
      );
    }
    const index = this.archived.findIndex((plan) => plan.planId === planId);
    const selected = this.archived[index];
    if (selected === undefined) {
      throw new PlanningError("rejected", "The selected saved plan is unavailable on this branch.");
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
    this.saveTimer = undefined;
    this.saveStatus = saveRecord(
      this.pi,
      ctx,
      structuredClone({
        version: 1,
        mode: this.selectedMode,
        ...(this.current === undefined ? {} : { active: this.current }),
        unfinished: this.archived,
      }),
      this.sessionFile,
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
    this.sessionGeneration++;
    if (this.current !== undefined) {
      this.save(ctx);
    }
    this.disposeOperations();
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.current = undefined;
    this.recovery = undefined;
    this.selectedMode = "default";
    this.archived.length = 0;
    ctx.ui.setStatus("orbis-plan", undefined);
  }

  restore(ctx: ExtensionContext): void {
    this.sessionGeneration++;
    this.disposeOperations();

    this.selectedInterface = "terminal";
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.current = undefined;
    this.recovery = undefined;
    this.selectedMode = "default";
    ctx.ui.setStatus("orbis-plan", this.statusLine());
    this.archived.length = 0;
    const saved = readSavedRecord(ctx, this.sessionFile);
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
    if (!validSnapshot(record.data)) {
      const checkpoint = saved.records.findLast(
        (entry) => entry.type === "custom" && validSnapshot(entry.data),
      );
      this.recovery = {
        entryId: record.id,
        ...(checkpoint?.type === "custom" && validSnapshot(checkpoint.data)
          ? { checkpoint: { id: checkpoint.id, data: structuredClone(checkpoint.data) } }
          : {}),
      };
      ctx.ui.notify(
        "Cannot restore malformed planning state. The saved record remains unchanged. Use /plan or plan_open to select recovery.",
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
      this.current = recoverReview(this.current);
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

  private async recoverCheckpoint(ctx: ExtensionContext, signal?: AbortSignal): Promise<boolean> {
    const recovery = this.recovery;
    if (recovery === undefined) {
      return true;
    }
    const checkpoint = recovery.checkpoint;
    if (checkpoint === undefined) {
      throw new PlanningError(
        "rejected",
        "No valid earlier planning checkpoint exists on this branch. Explicitly start replacement planning to preserve history and begin again.",
      );
    }
    const generation = this.generation;
    const label = `Recover ${checkpoint.id}: ${checkpoint.data.active?.objective ?? "saved planning"} (${checkpoint.data.active?.phase ?? "default"}); newer drafts may be missing`;
    const selected = await ctx.ui.select(
      "Recover planning",
      [label, "Decide later"],
      signal === undefined ? undefined : { signal },
    );
    if (
      selected !== label ||
      signal?.aborted === true ||
      generation !== this.generation ||
      this.recovery !== recovery
    ) {
      return false;
    }
    const saved = readSavedRecord(ctx, this.sessionFile);
    if (saved.status !== "record" || saved.entry.id !== recovery.entryId) {
      throw new PlanningError(
        "rejected",
        "Planning history changed. Reload before choosing recovery.",
      );
    }
    this.current =
      checkpoint.data.active === undefined
        ? undefined
        : recoverPlanningCheckpoint(checkpoint.data.active);
    this.archived.push(...checkpoint.data.unfinished.map(recoverPlanningCheckpoint));
    this.selectedMode = this.current === undefined ? checkpoint.data.mode : "plan";
    this.recovery = undefined;
    const result = this.save(ctx);
    if (!result.saved) {
      this.current = undefined;
      this.archived.length = 0;
      this.selectedMode = "default";
      this.recovery = recovery;
      throw saveFailure(result);
    }
    return true;
  }

  private disposeOperations() {
    this.handoff.invalidate();
    this.sessionFile.clear();
    this.generation += 1;
    this.pendingCompletion = undefined;
    this.dismissedReviewSignal = undefined;
    this.controller?.abort(superseded);
    this.entryController?.abort(superseded);
    this.viewController?.abort(superseded);
    this.controller = undefined;
    this.viewController = undefined;
  }

  async requestOpen(
    ctx: ExtensionContext,
    objective: string,
    replace: boolean,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<RuntimeResult> {
    if (!replace || ctx.mode !== "tui" || signal?.aborted === true) {
      return await this.open(ctx, objective, replace, signal);
    }
    if (requestId === undefined || requestId.trim() === "") {
      return {
        outcome: "error",
        message:
          "Replacement requires a stable requestId. Reuse it only when retrying this replacement.",
      };
    }
    const generation = this.sessionGeneration;
    return await runPlanningOperation(
      this.pi,
      ctx,
      JSON.stringify(["open", requestId]),
      { objective, replace },
      () => this.current,
      () => generation === this.sessionGeneration,
      async (begin) => await this.open(ctx, objective, replace, signal, begin),
    );
  }

  private async open(
    ctx: ExtensionContext,
    objective: string,
    replace: boolean,
    signal?: AbortSignal,
    begin?: () => void,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui") {
      return unsupportedMode();
    }
    const generation = this.generation;
    const plan = this.current;
    const controller = new AbortController();
    this.entryController?.abort(superseded);
    this.entryController = controller;
    const combined =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    const current = () => generation === this.generation && !combined.aborted;
    try {
      if (!current()) {
        return { outcome: "cancelled" };
      }
      begin?.();
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
        return {
          outcome: "clarification",
          round: structuredClone(this.current.round),
          draftsSubmitted: false,
        };
      }
      return entry.outcome === "active" && this.current !== undefined
        ? { outcome: "active", plan: structuredClone(this.current) }
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
    if (this.recovery !== undefined && !replace) {
      return {
        outcome: "error",
        message: "Use /plan or plan_open to select recovery before starting work.",
      };
    }
    if (replace) {
      this.recovery = undefined;
    }
    if (
      this.current !== undefined &&
      !replace &&
      (this.current.phase !== "accepted" ||
        objective.length === 0 ||
        objective === this.current.objective)
    ) {
      this.current = reopenApproval(this.current);
      this.selectedMode = "plan";
      this.present(ctx);
      return { outcome: "active", plan: structuredClone(this.current) };
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
    return { outcome: "started", plan: structuredClone(this.current) };
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
    if (result.outcome === "error" || result.outcome === "unsupported-mode") {
      ctx.ui.notify(result.message, "error");
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
            !validSnapshot(entry.data)
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
      delete this.current.approvals;
    }
  }

  async interact(ctx: ExtensionContext, signal?: AbortSignal): Promise<RuntimeResult> {
    if (signal?.aborted === true) {
      return { outcome: "cancelled" };
    }
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
    const combined =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    this.controller = controller;
    try {
      combined.throwIfAborted();
      const settings = await readSettings(this.agentDir, ctx.cwd, ctx.isProjectTrusted(), combined);
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      combined.throwIfAborted();
      if (reviewing && this.current !== undefined) {
        const review = this.current.reviews?.at(-1);
        const prior = [
          this.current.pendingApproval,
          ...(this.current.approvals ?? []).toReversed(),
        ].find(
          (approval) =>
            approval !== undefined &&
            approval.revision === review?.revision &&
            approval.planPath === review.path &&
            approval.planContent === review.markdown,
        );
        let damaged = false;
        if (review?.path !== undefined) {
          try {
            damaged =
              readFileSync(review.path, "utf8") !== review.markdown ||
              (prior?.notesPath !== undefined &&
                readFileSync(prior.notesPath, "utf8") !== prior.notesContent);
          } catch {
            damaged = true;
          }
        }
        if (damaged) {
          if (review === undefined) {
            throw new Error("Recorded review is missing.");
          }
          const confirmed = await ctx.ui.confirm(
            "Recover plan artifact",
            `Recreate the recorded content from ${review.path ?? "the saved revision"} at a new path? Existing files will be preserved and fresh approval is required.`,
            { signal: combined },
          );
          if (generation !== this.generation) {
            return { outcome: "cancelled" };
          }
          combined.throwIfAborted();
          if (!confirmed) {
            this.pause(ctx);
            return { outcome: "cancelled" };
          }
          this.current = {
            ...this.current,
            approvalRequired: true,
            reviews: [
              ...(this.current.reviews?.slice(0, -1) ?? []),
              {
                ...review,
                path: join(
                  settings.planDirectory,
                  `${this.current.planId}-${String(review.revision)}-recovered-${randomUUID()}.md`,
                ),
              },
            ],
          };
          delete this.current.pendingApproval;
        }
        this.current = prepareReviewArtifact(this.current, settings.planDirectory, (state) => {
          this.current = state;
          return this.save(ctx);
        });
      }
      this.selectedInterface = "terminal";
      const analysis =
        reviewing && "markdown" in record ? new DocumentAnalysis(record.markdown) : undefined;
      const apply = (
        id: string,
        expectedRevision: number,
        action: Parameters<typeof transitionInteraction>[3],
      ) => {
        const active = this.current;
        if (active === undefined) {
          throw new PlanningError("interaction-closed", "Planning session ended.");
        }
        this.current = {
          ...active,
          ...transitionInteraction(active, id, expectedRevision, action, analysis),
        };

        this.scheduleSave(ctx);
      };
      const dispatch = (action: Parameters<typeof transitionInteraction>[3]) => {
        if (generation !== this.generation) {
          throw new PlanningError("interaction-closed", "Planning session changed.");
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
        const viewSignal = AbortSignal.any([combined, viewController.signal]);
        const valid = () =>
          this.controller === controller &&
          !combined.aborted &&
          !viewSignal.aborted &&
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
            throw new PlanningError(
              "interaction-closed",
              "Planning presenter is no longer active.",
            );
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
                  throw new PlanningError("interaction-closed", "Planning session ended.");
                }
                return this.current;
              },
              guardedDispatch,
              viewSignal,
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
              viewSignal.addEventListener("abort", onAbort, { once: true });
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
                    signal: viewSignal,
                    updateDraft: (update) => {
                      if (!valid()) {
                        throw new PlanningError(
                          "interaction-closed",
                          "Planning presenter is no longer active.",
                        );
                      }
                      guardedDispatch(presentationAction(update, identity, true));
                      if (this.current === undefined) {
                        throw new PlanningError("interaction-closed", "Planning session ended.");
                      }
                      return presentationSnapshot(this.current);
                    },
                  });
                });
                const control = ctx.ui
                  .select(
                    "Planning presenter: " + presenter.label,
                    ["Use terminal (Recommended)", "Cancel planning"],
                    { signal: viewSignal },
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
                combined.throwIfAborted();
                if (valid()) {
                  ctx.ui.notify(
                    "Presenter failed: " + describe(error) + ". Returning to terminal input.",
                    "error",
                  );
                  fallback = true;
                }
              } finally {
                viewSignal.removeEventListener("abort", onAbort);
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
          !combined.aborted &&
          generation === this.generation &&
          (this.current?.phase === "round" || this.current?.phase === "review");
        if (!active) {
          return false;
        }
        if (chooser.requested) {
          const choices = ["terminal", ...this.presenters.map((item) => item.id)];
          const selected = await ctx.ui.select("Planning presenter", choices, {
            signal: combined,
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
        combined.throwIfAborted();
      } while (switching);
      if (generation !== this.generation) {
        return { outcome: "cancelled" };
      }
      const active = read();
      if (active === undefined) {
        return { outcome: "cancelled" };
      }
      if (active.phase === "saving") {
        const approvalSettings = await readSettings(
          this.agentDir,
          ctx.cwd,
          ctx.isProjectTrusted(),
          combined,
        );
        if (generation !== this.generation) {
          return { outcome: "cancelled" };
        }
        combined.throwIfAborted();
        const approval = saveApproval(active, approvalSettings.planDirectory, (state) => {
          this.current = state;
          return this.save(ctx);
        });
        this.current = approval.state;

        ctx.ui.setStatus("orbis-plan", this.statusLine());
        if (approval.outcome === "approval") {
          ctx.ui.notify(approval.message, "info");
        }
        if (approval.outcome === "approval" && approval.state.accepted !== undefined) {
          this.selectedMode = "default";
          this.save(ctx);
          const acceptedKey = approvalKey(approval.state.accepted);
          if (active.approvals?.some((item) => approvalKey(item) === acceptedKey) !== true) {
            this.pendingCompletion = approval.state.accepted;
          }
          this.settled(ctx);
          const selection = await this.handoff.request(
            ctx,
            approval.state.accepted,
            "options",
            combined,
          );
          if (typeof selection !== "string") {
            return this.handoff.result(ctx, selection);
          }
        }
        if (approval.outcome === "error") {
          return errorResult(approval.error ?? new PlanningError("rejected", approval.message));
        }
        if (approval.state.accepted === undefined) {
          throw new Error("Approval completed without its accepted record.");
        }
        return {
          outcome: "approval",
          message: approval.message,
          approval: structuredClone(approval.state.accepted),
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
          decisions: structuredClone(active.decisions),
          clarifications: structuredClone(active.round.clarifications),
        };
      }
      if (active.phase === "clarification") {
        if (active.round === undefined) {
          throw new Error("Clarification ended without its round.");
        }
        return {
          outcome: "clarification",
          round: structuredClone(active.round),
          draftsSubmitted: false,
        };
      }
      this.pause(ctx);
      if (reviewClosure.requested && this.current?.accepted !== undefined) {
        return {
          outcome: "approval",
          approval: structuredClone(this.current.accepted),
          message: "Review closed. Existing approval preserved.",
        };
      }
      if (reviewClosure.requested) {
        this.dismissedReviewSignal = ctx.signal;
        ctx.ui.notify("Plan review closed without approval. Use /plan to resume.", "warning");
      }
      ctx.abort();
      return { outcome: "cancelled", planId: active.planId };
    } catch (error) {
      if (generation !== this.generation || (combined.aborted && combined.reason === superseded)) {
        return { outcome: "cancelled" };
      }
      if (this.current?.phase === "saving") {
        this.current = recoverReview(this.current);

        this.save(ctx);
      }
      if (combined.aborted) {
        this.pause(ctx);
        return { outcome: "cancelled" };
      }
      return errorResult(error);
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  async round(
    ctx: ExtensionContext,
    input: RoundInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui" || signal?.aborted === true) {
      return await this.applyRound(ctx, input, signal);
    }
    const generation = this.sessionGeneration;
    return await runPlanningOperation(
      this.pi,
      ctx,
      JSON.stringify(["round", input.planId, input.roundId, input.expectedRevision]),
      input,
      () => this.current,
      () => generation === this.sessionGeneration,
      async (begin) => await this.applyRound(ctx, input, signal, begin),
    );
  }

  private async applyRound(
    ctx: ExtensionContext,
    input: RoundInput,
    signal?: AbortSignal,
    begin?: () => void,
  ): Promise<RuntimeResult> {
    const cancelled = () => signal?.aborted === true;
    if (cancelled()) {
      return { outcome: "cancelled" };
    }
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
      const next = { ...active, ...presentRound(active, input) };
      begin?.();
      this.current = next;

      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      if (cancelled()) {
        return { outcome: "cancelled" };
      }
      return errorResult(error);
    }
  }

  async review(
    ctx: ExtensionContext,
    input: ReviewInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui" || signal?.aborted === true) {
      return await this.applyReview(ctx, input, signal);
    }
    const generation = this.sessionGeneration;
    return await runPlanningOperation(
      this.pi,
      ctx,
      JSON.stringify(["review", input.planId, input.expectedRevision]),
      input,
      () => this.current,
      () => generation === this.sessionGeneration,
      async (begin) => await this.applyReview(ctx, input, signal, begin),
    );
  }

  private async applyReview(
    ctx: ExtensionContext,
    input: ReviewInput,
    signal?: AbortSignal,
    begin?: () => void,
  ): Promise<RuntimeResult> {
    const cancelled = () => signal?.aborted === true;
    if (cancelled()) {
      return { outcome: "cancelled" };
    }
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
        begin?.();
        return await this.interact(ctx, signal);
      }
      return {
        outcome: "error",
        message:
          "An earlier approval needs explicit reconciliation through /plan before another revision.",
      };
    }
    try {
      const next = { ...active, ...presentReview(active, input) };
      begin?.();
      this.current = next;

      this.save(ctx);
      return await this.interact(ctx, signal);
    } catch (error) {
      if (cancelled()) {
        return { outcome: "cancelled" };
      }
      return errorResult(error);
    }
  }

  present(ctx: ExtensionContext): void {
    if (this.current !== undefined) {
      ctx.ui.setStatus("orbis-plan", this.statusLine());
      const status = this.saveTimer === undefined ? `\n\n${this.saveStatus.message}` : "";
      ctx.ui.notify(
        `Planning:\n${fencedObjective(this.current.objective.length === 0 ? "objective not supplied" : this.current.objective)}${status}`,
        "info",
      );
    }
  }

  async implement(
    ctx: ExtensionContext,
    action: "here" | "new" | "options",
    planId?: string,
    signal?: AbortSignal,
    restart = false,
  ): Promise<RuntimeResult> {
    if (ctx.mode !== "tui") {
      return unsupportedMode();
    }
    if (this.controller !== undefined) {
      return {
        outcome: "error",
        message: "Finish the active planning interaction before requesting implementation.",
      };
    }
    const generation = this.generation;
    const plans = [this.current, ...this.archived];
    const inherited = new Map(
      readLaunches(ctx)
        .filter((record) => !plans.some((plan) => plan?.planId === record.approval.planId))
        .map((record) => [record.approval.planId, record.approval]),
    );
    const approvals = [
      ...plans.flatMap((plan) => (plan?.accepted === undefined ? [] : [plan.accepted])),
      ...inherited.values(),
    ];
    let approval = approvals.find((candidate) => candidate.planId === planId);
    if (planId === undefined && approvals.length === 1) {
      approval = approvals[0];
    }
    if (planId === undefined && approvals.length > 1) {
      const labels = approvals.map((candidate) => `${candidate.planPath} [${candidate.planId}]`);
      const selected = await ctx.ui.select(
        "Select an approved plan",
        labels,
        signal === undefined ? undefined : { signal },
      );
      if (selected === undefined) {
        return { outcome: "cancelled" };
      }
      approval = approvals[labels.indexOf(selected)];
    }
    if (generation !== this.generation || signal?.aborted === true) {
      return { outcome: "cancelled" };
    }
    if (approval === undefined) {
      const pending = [this.current, ...this.archived].some(
        (plan) =>
          plan !== undefined &&
          (planId === undefined || plan.planId === planId) &&
          plan.reviews?.at(-1)?.status === "pending",
      );
      if (pending) {
        return {
          outcome: "error",
          message:
            "The current revision or supplementary notes require approval. Call plan_open with replace: false to reopen review before implementation.",
        };
      }
      return {
        outcome: "error",
        message:
          "The approved plan is unavailable on this branch. Select an existing approved plan before requesting implementation.",
      };
    }
    const message = await this.handoff.request(
      ctx,
      approval,
      action,
      signal,
      () => {
        if (this.current !== undefined && this.current.phase !== "accepted") {
          this.current = { ...this.current, phase: "cancelled" };
        }
        this.selectedMode = "default";
        const saved = this.save(ctx);
        if (!saved.saved) {
          throw saveFailure(saved);
        }
      },
      restart,
    );
    if (typeof message !== "string") {
      return this.handoff.result(ctx, message);
    }
    return { outcome: "approval", approval: structuredClone(approval), message };
  }

  async dispatchImplementation(token: string, ctx: ExtensionCommandContext): Promise<void> {
    await this.handoff.dispatch(token, ctx);
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
    const key = approvalKey(payload);
    if (!this.emitted.has(key)) {
      this.emitted.add(key);
      this.pi.events.emit("orbis:plan-approved", structuredClone(payload));
    }
  }
}
