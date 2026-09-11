import { randomUUID } from "node:crypto";

import { matchesKey } from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import type { RoundAction, RoundState, Question } from "./state.ts";
import { markdownLines, modalLines } from "./terminal-layout.ts";

type Row =
  | { question: Question; optionId?: string; kind: "option" | "other" | "clarify" }
  | { kind: "review" };

export class TerminalRound implements Component {
  focused = true;
  private selected = 0;
  private mode: "list" | "details" | "clarify" | "preview" = "list";
  private control = 0;
  private scroll = 0;
  private armed = false;
  private closed = false;
  private error = "";
  private followFocus = true;
  private viewport = { scroll: 0, length: 0 };

  private readonly read: () => RoundState;
  private readonly dispatch: (action: RoundAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly switchView: (() => void) | undefined;

  constructor(
    read: () => RoundState,
    dispatch: (action: RoundAction) => void,
    done: () => void,
    refresh: () => void,
    editor: Editor,
    rows: () => number = () => 24,
    switchView?: () => void,
  ) {
    this.read = read;
    this.dispatch = dispatch;
    this.done = done;
    this.refresh = refresh;
    this.editor = editor;
    this.rows = rows;
    this.switchView = switchView;
    const question = read().round?.questions.find((item) => item.id === read().round?.focus);
    if (question !== undefined) {
      this.jump(question);
    }
  }

  invalidate(): void {
    this.editor.invalidate();
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.done();
    }
  }
  private send(action: RoundAction): void {
    this.dispatch(action);
    if (this.read().phase !== "round") {
      this.close();
    }
  }
  private items(): Row[] {
    const rows: Row[] = [];
    for (const question of this.read().round?.questions ?? []) {
      rows.push({ question, kind: "other" });
      for (const option of question.options) {
        rows.push({ question, kind: "option", optionId: option.id });
      }
      rows.push({ question, kind: "clarify" });
    }
    rows.push({ kind: "review" });
    return rows;
  }
  private jump(question: Question): void {
    const answer = this.read().round?.drafts[question.id]?.answer;
    this.selected = this.items().findIndex(
      (row) =>
        row.kind !== "review" &&
        row.question.id === question.id &&
        (answer?.optionId === undefined ? row.kind === "other" : row.optionId === answer.optionId),
    );
    this.followFocus = true;
  }
  private edit(row: Exclude<Row, { kind: "review" }>): void {
    const draft = this.read().round?.drafts[row.question.id];
    this.mode = row.kind === "clarify" ? "clarify" : "details";
    this.control = 0;
    this.editor.setText(
      row.kind === "clarify"
        ? (draft?.clarificationDraft ?? "")
        : row.optionId === undefined
          ? (draft?.unfinished ?? "")
          : (draft?.options?.[row.optionId]?.unfinished ??
            draft?.options?.[row.optionId]?.confirmed ??
            ""),
    );
  }
  private confirm(row: Exclude<Row, { kind: "review" }>): void {
    if (this.mode === "clarify") {
      this.send({
        type: "clarify",
        questionId: row.question.id,
        request: this.editor.getExpandedText(),
        id: randomUUID(),
      });
    } else {
      if (row.optionId === undefined) {
        this.send({
          type: "answer",
          questionId: row.question.id,
          answer: { custom: this.editor.getExpandedText() },
        });
      } else {
        this.send({ type: "confirm-option", questionId: row.question.id, optionId: row.optionId });
      }
      this.mode = "list";
    }
  }

  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    try {
      this.error = "";
      const row = this.items()[this.selected];
      if (row === undefined) {
        return;
      }
      if (matchesKey(data, "escape")) {
        if (this.mode !== "list") {
          this.mode = "list";
          this.armed = false;
          this.followFocus = true;
        } else if (this.armed) {
          this.send({ type: "cancel" });
        } else {
          this.armed = true;
        }
      } else {
        this.armed = false;
        if (matchesKey(data, "ctrl+p")) {
          this.switchView?.();
        } else if (this.mode === "details" || this.mode === "clarify") {
          if (row.kind === "review") {
            return;
          }
          if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            this.control = 1 - this.control;
          } else if (matchesKey(data, "enter") && (this.mode === "details" || this.control === 1)) {
            this.confirm(row);
          } else if (this.control === 0) {
            if (matchesKey(data, "enter")) {
              this.editor.insertTextAtCursor("\n");
            } else {
              this.editor.handleInput(data);
            }
            const text = this.editor.getExpandedText();
            if (this.mode === "clarify") {
              this.send({ type: "edit-clarification", questionId: row.question.id, text });
            } else if (row.optionId === undefined) {
              this.send({ type: "edit", questionId: row.question.id, unfinished: text });
            } else {
              this.send({
                type: "edit-option",
                questionId: row.question.id,
                optionId: row.optionId,
                text,
              });
            }
          }
        } else if (this.mode === "preview") {
          if (
            matchesKey(data, "tab") ||
            matchesKey(data, "shift+tab") ||
            matchesKey(data, "left") ||
            matchesKey(data, "right")
          ) {
            this.control = 1 - this.control;
          } else if (matchesKey(data, "enter")) {
            if (this.control === 0) {
              this.send({ type: "submit" });
            } else {
              const missing = this.read().round?.questions.find((question) => {
                const draft = this.read().round?.drafts[question.id];
                return draft?.answer === undefined || draft.revision !== question.revision;
              });
              this.mode = "list";
              if (missing !== undefined) {
                this.jump(missing);
                this.send({ type: "focus", questionId: missing.id });
              }
            }
          } else if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
            this.scroll++;
          } else if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
            this.scroll = Math.max(0, this.scroll - 1);
          }
        } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
          const questions = this.read().round?.questions ?? [];
          const index =
            row.kind === "review" ? -1 : questions.findIndex((item) => item.id === row.question.id);
          const next =
            questions[
              (index + (matchesKey(data, "tab") ? 1 : -1) + questions.length) % questions.length
            ];
          if (next !== undefined) {
            this.jump(next);
            this.send({ type: "focus", questionId: next.id });
          }
        } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
          this.selected = Math.max(
            0,
            Math.min(this.items().length - 1, this.selected + (matchesKey(data, "down") ? 1 : -1)),
          );
          const next = this.items()[this.selected];
          if (next !== undefined && next.kind !== "review") {
            this.send({ type: "focus", questionId: next.question.id });
          }
          this.followFocus = true;
        } else if (matchesKey(data, "pageDown") || matchesKey(data, "pageUp")) {
          this.scroll = Math.max(
            0,
            Math.min(
              this.viewport.length - 1,
              this.viewport.scroll +
                (matchesKey(data, "pageDown") ? 1 : -1) * Math.max(1, this.rows() - 8),
            ),
          );
          this.followFocus = false;
        } else if (matchesKey(data, "enter") || matchesKey(data, "right")) {
          if (row.kind === "review") {
            this.mode = "preview";
            this.control = 0;
            this.scroll = 0;
          } else if (
            row.kind === "option" &&
            matchesKey(data, "enter") &&
            row.optionId !== undefined
          ) {
            this.send({
              type: "answer",
              questionId: row.question.id,
              answer: { optionId: row.optionId },
            });
          } else {
            this.edit(row);
          }
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }

  render(width: number): string[] {
    const round = this.read().round;
    if (round === undefined) {
      return ["No active round."];
    }
    const focusedRow = this.items()[this.selected];
    const editing = this.mode === "details" || this.mode === "clarify";
    this.editor.focused = this.focused && editing && this.control === 0;
    if (this.mode === "preview") {
      const preview = round.questions
        .map((question) => {
          const draft = round.drafts[question.id];
          const answer = draft?.answer;
          const label = question.options.find((option) => option.id === answer?.optionId)?.label;
          return `### ${String(question.number)}. ${question.prompt}\n\n${answer === undefined || draft?.revision !== question.revision ? "UNANSWERED — answer or reconfirm" : (answer.custom ?? `${label ?? ""}${answer.details === undefined ? "" : `\n\nDetails: ${answer.details}`}`)}`;
        })
        .join("\n\n");
      return modalLines(
        "Review answers · unsubmitted",
        markdownLines(preview, width),
        [
          this.error,
          `${this.control === 0 ? "→" : ""}Submit round`,
          `${this.control === 1 ? "→" : ""}Next unanswered`,
          "Tab: action · Enter: activate · Esc: back",
        ],
        width,
        this.rows(),
        this.scroll,
      );
    }
    if (editing && focusedRow !== undefined && focusedRow.kind !== "review") {
      const row = focusedRow;
      const excerpt = markdownLines(
        `${String(row.question.number)}. ${row.question.prompt}\n\n${row.kind === "clarify" ? "Clarification note" : row.optionId === undefined ? "Other (required)" : (row.question.options.find((item) => item.id === row.optionId)?.label ?? "Details")}`,
        width,
      );
      return modalLines(
        "Planning · local draft",
        excerpt,
        [
          ...this.editor.render(width),
          this.error,
          `${this.control === 1 ? "→" : ""}${this.mode === "clarify" ? "Send clarification" : "Confirm answer"}`,
          this.mode === "clarify"
            ? "Enter: newline · Tab: Send · Esc: back"
            : "Enter: confirm · Esc: back",
        ],
        width,
        this.rows(),
        0,
      );
    }
    const lines: string[] = [];
    const positions: number[] = [];
    for (const [index, row] of this.items().entries()) {
      if (row.kind === "other") {
        const question = row.question;
        const draft = round.drafts[question.id];
        lines.push(
          ...markdownLines(
            `### ${String(question.number ?? index + 1)}. ${question.prompt}\n\n${question.context}\n\n${question.recommendation === undefined ? "" : `Recommendation: ${question.options.find((option) => option.id === question.recommendation?.optionId)?.label ?? ""}. ${question.recommendation.reason}`}\n\n${draft?.answer === undefined ? "Unanswered" : draft.revision !== question.revision ? "Changed question: reconfirm" : "Answered"}`,
            width,
          ),
        );
      }
      positions.push(lines.length);
      const answer = row.kind === "review" ? undefined : round.drafts[row.question.id]?.answer;
      const option =
        row.kind === "option"
          ? row.question.options.find((item) => item.id === row.optionId)
          : undefined;
      const selected =
        row.kind === "other"
          ? answer?.custom !== undefined
          : row.kind === "option" && answer?.optionId === row.optionId;
      const label =
        row.kind === "review"
          ? "Review answers / Submit…"
          : row.kind === "clarify"
            ? "Ask for clarification…"
            : row.kind === "other"
              ? "Other (please specify)"
              : (option?.label ?? "");
      lines.push(
        ...markdownLines(
          `${index === this.selected ? "→" : "·"} ${selected ? "[selected] " : ""}${label}${option === undefined ? "" : ` — ${option.explanation}`}`,
          width,
        ),
      );
      if (row.kind === "clarify") {
        for (const clarification of round.clarifications.filter(
          (item) => item.questionId === row.question.id,
        )) {
          lines.push(
            ...markdownLines(
              `Clarification: ${clarification.request}\n\n${clarification.response ?? "Awaiting response"}`,
              width,
            ),
          );
        }
      }
    }
    const focus = positions[this.selected] ?? 0;
    const viewport = Math.max(1, this.rows() - 8);
    const scroll = this.followFocus ? Math.max(0, focus - Math.floor(viewport / 2)) : this.scroll;
    this.viewport = {
      scroll: Math.max(
        0,
        Math.min(
          scroll,
          lines.length - Math.max(1, this.rows() - (this.switchView === undefined ? 4 : 5)),
        ),
      ),
      length: lines.length,
    };
    return modalLines(
      "Planning · frontier",
      lines,
      [
        this.error,
        this.armed
          ? "Press Esc again to close; drafts retained"
          : "↑↓: move · Enter: select/open · →: details",
        "Tab: question · PgUp/PgDn: read · Esc: close",
        ...(this.switchView === undefined ? [] : ["Ctrl+P: presenter"]),
      ],
      width,
      this.rows(),
      scroll,
    );
  }
}
