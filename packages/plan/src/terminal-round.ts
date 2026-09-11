import { randomUUID } from "node:crypto";

import { getMarkdownTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  matchesKey,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import { defaultAppearance } from "./config.ts";
import type { PlanAppearance } from "./config.ts";
import type { Draft, RoundAction, RoundState, Question } from "./state.ts";
import { functionKey, markdownLines, modalContentWidth, modalLines } from "./terminal-layout.ts";

type Row =
  | { question: Question; optionId?: string; kind: "option" | "other" | "clarify" }
  | { kind: "inactive"; question: Question }
  | { kind: "review" };

function reconfirmationWarning(draft: Draft | undefined, revision: number): string {
  if (draft?.answer !== undefined && draft.revision !== revision) {
    return "\n\nPlease select again";
  }
  return "";
}

function rowLabel(row: Row, ready = false): string {
  switch (row.kind) {
    case "inactive":
      return row.question.prompt;
    case "review":
      return "Review answers and submit";
    case "clarify":
      return ready ? "?. Send clarification" : "?. Ask for clarification";
    case "other":
      return "Other (please specify)";
    case "option":
      return row.question.options.find((item) => item.id === row.optionId)?.label ?? "";
  }
  throw new Error("Unknown planning row.");
}

function rowLetter(row: Row): string | undefined {
  switch (row.kind) {
    case "inactive":
    case "review":
    case "clarify":
      return undefined;
    case "other":
      return String.fromCharCode(65 + row.question.options.length);
    case "option":
      return String.fromCharCode(
        65 + row.question.options.findIndex((item) => item.id === row.optionId),
      );
  }
  throw new Error("Unknown planning row.");
}

function rowMarker(
  selected: boolean,
  focused: boolean,
  symbols: PlanAppearance["symbols"],
): string {
  if (selected) {
    return symbols === "emoji" ? "✅" : "✓";
  }
  if (focused) {
    return symbols === "emoji" ? "🔹" : "›";
  }
  return "·";
}

function fieldText(
  row: Exclude<Row, { kind: "review" | "inactive" }>,
  draft: Draft | undefined,
): string {
  switch (row.kind) {
    case "option":
      return draft?.options?.[row.optionId ?? ""] ?? "";
    case "other":
      return draft?.unfinished ?? "";
    case "clarify":
      return draft?.clarificationDraft ?? "";
  }
  throw new Error("Unknown planning field.");
}

export class TerminalRound implements Component {
  private hasFocus = true;
  get focused(): boolean {
    return this.hasFocus;
  }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.editor.focused = value && this.mode === "edit";
  }
  private selected = 0;
  private viewed: number | undefined;
  private bookmark:
    | { selected: number; scroll: number; followFocus: boolean; mode: "list" | "edit" | "preview" }
    | undefined;
  private previewFocus = 0;
  private readonly expanded = new Set<string>();
  private mode: "list" | "edit" | "preview" = "list";
  private scroll = 0;
  private armed = false;
  private showHints: boolean;
  private closed = false;
  private error = "";
  private followFocus = true;
  private noteColumn: number | undefined;
  private noteWidth = 0;

  private readonly read: () => RoundState;
  private readonly dispatch: (action: RoundAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly columns: () => number;
  private readonly switchView: (() => void) | undefined;
  private readonly appearance: PlanAppearance;
  private readonly theme: Theme | undefined;

  constructor(
    read: () => RoundState,
    dispatch: (action: RoundAction) => void,
    done: () => void,
    refresh: () => void,
    editor: Editor,
    rows: () => number = () => 24,
    switchView?: () => void,
    appearance: PlanAppearance = defaultAppearance,
    columns: () => number = () => 80,
    theme?: Theme,
  ) {
    this.read = read;
    this.dispatch = dispatch;
    this.done = done;
    this.refresh = refresh;
    this.editor = editor;
    this.editor.focused = false;
    this.rows = rows;
    this.columns = columns;
    this.switchView = switchView;
    this.appearance = appearance;
    this.theme = theme;
    this.showHints = appearance.showHints ?? defaultAppearance.showHints;
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
  private round() {
    return this.viewed === undefined
      ? this.read().round
      : this.read().history?.[this.viewed]?.round;
  }
  private browse(direction: number): void {
    const length = this.read().history?.length ?? 0;
    const next = Math.max(0, Math.min(length, (this.viewed ?? length) + direction));
    if (next === (this.viewed ?? length)) {
      return;
    }
    if (this.viewed === undefined) {
      this.bookmark = {
        selected: this.selected,
        scroll: this.scroll,
        followFocus: this.followFocus,
        mode: this.mode,
      };
    }
    this.viewed = next === length ? undefined : next;
    this.mode = "list";
    if (this.viewed === undefined && this.bookmark !== undefined) {
      Object.assign(this, this.bookmark);
    } else {
      this.selected = 0;
      this.scroll = 0;
      this.followFocus = false;
    }
    this.editor.focused =
      this.hasFocus && this.viewed === undefined && this.bookmark?.mode === "edit";
    this.armed = false;
    this.refresh();
  }
  private send(action: RoundAction): void {
    if (this.viewed !== undefined && action.type !== "cancel") {
      throw new Error("Earlier frontiers are read-only.");
    }
    this.dispatch(action);
    if (this.read().phase !== "round") {
      this.close();
    }
  }
  private items(): Row[] {
    const rows: Row[] = [];
    for (const question of this.round()?.questions ?? []) {
      if (question.status !== undefined) {
        rows.push({ question, kind: "inactive" });
        continue;
      }
      for (const option of question.options) {
        rows.push({ question, kind: "option", optionId: option.id });
      }
      rows.push({ question, kind: "other" });
      rows.push({ question, kind: "clarify" });
    }
    rows.push({ kind: "review" });
    return rows;
  }
  private jump(question: Question): void {
    const answer = this.round()?.drafts[question.id]?.answer;
    const items = this.items();
    const preferred = items.findIndex(
      (row) =>
        row.kind !== "review" &&
        row.kind !== "inactive" &&
        row.question.id === question.id &&
        (answer?.custom !== undefined
          ? row.kind === "other"
          : row.optionId === (answer?.optionId ?? question.options[0]?.id) &&
            row.kind !== "clarify"),
    );
    this.selected =
      preferred === -1
        ? items.findIndex((row) => row.kind !== "review" && row.question.id === question.id)
        : preferred;
    this.followFocus = true;
  }
  private edit(row: Exclude<Row, { kind: "review" | "inactive" }>): void {
    this.noteColumn = undefined;
    const draft = this.round()?.drafts[row.question.id];
    this.mode = "edit";
    this.editor.setText(fieldText(row, draft));
  }
  private confirm(row: Exclude<Row, { kind: "review" | "inactive" }>): void {
    if (row.kind !== "clarify") {
      if (row.optionId === undefined) {
        this.send({
          type: "answer",
          questionId: row.question.id,
          answer: { custom: this.editor.getExpandedText() },
        });
      } else {
        this.send({
          type: "answer",
          questionId: row.question.id,
          answer: { optionId: row.optionId },
        });
      }
    }
    this.mode = "list";
  }

  private editInput(row: Exclude<Row, { kind: "review" | "inactive" }>, data: string): void {
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.moveNoteCursor(matchesKey(data, "down") ? 1 : -1);
      this.followFocus = true;
      return;
    }
    this.noteColumn = undefined;
    if (matchesKey(data, "shift+enter")) {
      this.editor.insertTextAtCursor("\n");
    } else {
      this.editor.handleInput(data);
    }
    const text = this.editor.getExpandedText();
    if (row.kind === "clarify") {
      this.send({ type: "edit-clarification", questionId: row.question.id, text });
    } else if (row.optionId === undefined) {
      this.send({ type: "edit", questionId: row.question.id, unfinished: text });
    } else {
      this.send({ type: "edit-option", questionId: row.question.id, optionId: row.optionId, text });
    }
    this.followFocus = true;
  }

  private noteOffset(): number {
    const cursor = this.editor.getCursor();
    return this.editor
      .getLines()
      .slice(0, cursor.line)
      .reduce((offset, line) => offset + line.length + 1, cursor.col);
  }

  private moveNoteCursor(direction: number): void {
    const notePositions = this.layout(this.columns()).notePositions;
    const currentOffset = this.noteOffset();
    const current = notePositions.find((position) => position.offset === currentOffset);
    if (current === undefined) {
      return;
    }
    this.noteColumn ??= current.col;
    const row = notePositions.filter((position) => position.row === current.row + direction);
    const target =
      row.findLast((position) => position.col <= (this.noteColumn ?? current.col)) ?? row[0];
    if (target === undefined) {
      return;
    }
    const key = target.offset < currentOffset ? "\x1b[D" : "\x1b[C";
    let remaining = notePositions.length;
    while (remaining-- > 0) {
      const before = this.noteOffset();
      if (before === target.offset) {
        break;
      }
      this.editor.handleInput(key);
      const after = this.noteOffset();
      if (
        after === before ||
        (before < target.offset && after > target.offset) ||
        (before > target.offset && after < target.offset)
      ) {
        break;
      }
    }
  }

  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    if (functionKey(data, 1)) {
      this.showHints = !this.showHints;
      this.armed = false;
      this.refresh();
      return;
    }
    if (functionKey(data, 3) || functionKey(data, 4)) {
      this.browse(functionKey(data, 3) ? -1 : 1);
      return;
    }
    if (this.viewed !== undefined) {
      if (matchesKey(data, "escape")) {
        if (this.armed) {
          this.send({ type: "cancel" });
        } else {
          this.armed = true;
        }
      } else {
        this.armed = false;
        if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
          this.scroll += matchesKey(data, "pageDown") ? Math.max(1, this.rows() - 8) : 1;
        } else if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
          this.scroll = Math.max(
            0,
            this.scroll - (matchesKey(data, "pageUp") ? Math.max(1, this.rows() - 8) : 1),
          );
        }
      }
      this.refresh();
      return;
    }
    const width = modalContentWidth(this.columns());
    if (this.noteWidth !== width) {
      this.noteWidth = width;
      this.noteColumn = undefined;
    }
    try {
      this.error = "";
      const items = this.items();
      this.selected = Math.max(0, Math.min(items.length - 1, this.selected));
      const row = items[this.selected];
      if (row === undefined) {
        return;
      }
      if (
        this.mode === "edit" &&
        (matchesKey(data, "tab") ||
          matchesKey(data, "shift+tab") ||
          (this.editor.getExpandedText().trim().length === 0 &&
            (matchesKey(data, "up") || matchesKey(data, "down"))))
      ) {
        this.mode = "list";
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
        } else if (this.mode === "edit") {
          if (row.kind === "review" || row.kind === "inactive") {
            return;
          }
          if (matchesKey(data, "enter")) {
            this.confirm(row);
          } else {
            this.editInput(row, data);
          }
        } else if (this.mode === "preview") {
          const histories = (this.round()?.questions ?? []).filter(
            (q) => this.round()?.clarifications.some((entry) => entry.questionId === q.id) === true,
          );
          if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            this.previewFocus =
              (this.previewFocus + (matchesKey(data, "tab") ? 1 : -1) + histories.length + 1) %
              (histories.length + 1);
            this.followFocus = true;
          } else if (matchesKey(data, "enter")) {
            const question = histories[this.previewFocus];
            if (question === undefined) {
              this.send({ type: "submit" });
            } else if (this.expanded.has(question.id)) {
              this.expanded.delete(question.id);
            } else {
              this.expanded.add(question.id);
            }
          } else if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
            this.scroll++;
            this.followFocus = false;
          } else if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
            this.scroll = Math.max(0, this.scroll - 1);
            this.followFocus = false;
          }
        } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
          const questions = (this.round()?.questions ?? []).filter((q) => q.status === undefined);
          const index =
            row.kind === "review"
              ? questions.length
              : questions.findIndex((q) => q.id === row.question.id);
          const nextIndex =
            (index + (matchesKey(data, "tab") ? 1 : -1) + questions.length + 1) %
            (questions.length + 1);
          const next = questions[nextIndex];
          if (next === undefined) {
            this.selected = items.length - 1;
            this.followFocus = false;
          } else {
            this.jump(next);
            this.send({ type: "focus", questionId: next.id });
          }
        } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
          this.selected = Math.max(
            0,
            Math.min(this.items().length - 1, this.selected + (matchesKey(data, "down") ? 1 : -1)),
          );
          const next = this.items()[this.selected];
          if (next !== undefined && next.kind !== "review" && next.kind !== "inactive") {
            this.send({ type: "focus", questionId: next.question.id });
          }
          this.followFocus = true;
        } else if (matchesKey(data, "pageDown") || matchesKey(data, "pageUp")) {
          const viewport = this.layout(this.columns()).viewport;
          this.scroll = Math.max(
            0,
            Math.min(
              viewport.length - 1,
              viewport.scroll +
                (matchesKey(data, "pageDown") ? 1 : -1) * Math.max(1, this.rows() - 8),
            ),
          );
          this.followFocus = false;
        } else if (matchesKey(data, "enter")) {
          if (row.kind === "inactive") {
            return;
          }
          if (row.kind === "review") {
            if (!(this.round()?.questions.some((q) => q.status === undefined) ?? false)) {
              this.send({ type: "submit" });
              return;
            }
            if (this.unanswered().length === 0) {
              this.previewFocus = (this.round()?.questions ?? []).filter(
                (q) =>
                  this.round()?.clarifications.some((entry) => entry.questionId === q.id) === true,
              ).length;
              this.mode = "preview";
              this.scroll = 0;
            }
          } else if (row.kind === "option" && row.optionId !== undefined) {
            this.send(
              this.round()?.drafts[row.question.id]?.revision === row.question.revision &&
                this.round()?.drafts[row.question.id]?.answer?.optionId === row.optionId
                ? { type: "clear-answer", questionId: row.question.id }
                : {
                    type: "answer",
                    questionId: row.question.id,
                    answer: { optionId: row.optionId },
                  },
            );
          } else if (row.kind === "other") {
            const draft = this.round()?.drafts[row.question.id];
            if (draft?.revision === row.question.revision && draft.answer?.custom !== undefined) {
              this.send({ type: "clear-answer", questionId: row.question.id });
            } else if ((draft?.unfinished.trim().length ?? 0) > 0) {
              this.send({
                type: "answer",
                questionId: row.question.id,
                answer: { custom: draft?.unfinished ?? "" },
              });
            } else {
              this.edit(row);
            }
          } else if (
            row.kind === "clarify" &&
            (this.round()?.drafts[row.question.id]?.clarificationDraft?.trim().length ?? 0) > 0
          ) {
            this.send({
              type: "clarify",
              questionId: row.question.id,
              request: this.round()?.drafts[row.question.id]?.clarificationDraft ?? "",
              id: randomUUID(),
            });
          } else {
            this.edit(row);
          }
        } else if (
          row.kind !== "review" &&
          row.kind !== "inactive" &&
          (data.startsWith("\x1b[200~") ||
            matchesKey(data, "backspace") ||
            decodeKittyPrintable(data) !== undefined ||
            /^[^\p{Cc}]+$/u.test(data))
        ) {
          this.edit(row);
          this.editInput(row, data);
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.editor.focused = this.focused && this.mode === "edit";
    }
    this.refresh();
  }

  render(outerWidth: number): string[] {
    return this.layout(outerWidth).lines;
  }

  private unanswered(): Question[] {
    const round = this.round();
    return (
      round?.questions.filter((question) => {
        const draft = round.drafts[question.id];
        return (
          question.status === undefined &&
          (draft?.answer === undefined || draft.revision !== question.revision)
        );
      }) ?? []
    );
  }

  private layout(outerWidth: number) {
    const notePositions: { offset: number; row: number; col: number }[] = [];
    const width = modalContentWidth(outerWidth);
    const round = this.round();
    if (round === undefined) {
      return { lines: ["No active round."], viewport: { scroll: 0, length: 0 }, notePositions };
    }
    const editing = this.mode === "edit";
    if (this.mode === "preview") {
      const histories = round.questions.filter((q) =>
        round.clarifications.some((entry) => entry.questionId === q.id),
      );
      const preview = round.questions.flatMap((question, index) => {
        const draft = round.drafts[question.id];
        const answer = draft?.answer;
        const label = question.options.find((option) => option.id === answer?.optionId)?.label;
        let response = "UNANSWERED — answer or reconfirm";
        let suffix = "";
        if (answer !== undefined && draft?.revision === question.revision) {
          response = answer.custom ?? label ?? "";
          if (answer.custom === undefined && (answer.details?.trim().length ?? 0) > 0) {
            suffix = getSelectListTheme().selectedText(
              ` [notes: ${stripTerminalSequences(answer.details ?? "")}]`,
            );
          }
        }
        const body = markdownLines(response, width).map((line) => line.trimEnd());
        const last = body.pop() ?? "";
        return [
          ...(index === 0 ? [] : [""]),
          ...markdownLines(
            `## ${this.appearance.symbols === "emoji" ? "❓" : "?"} ${String(question.number)}. ${question.prompt}`,
            width,
          ),
          "",
          ...(question.status === undefined
            ? [...body, ...wrapTextWithAnsi(last + suffix, Math.max(1, width))]
            : []),
          ...(histories.some((q) => q.id === question.id)
            ? [
                "",
                `${histories[this.previewFocus]?.id === question.id ? "›" : " "} ${this.expanded.has(question.id) ? "▾" : "▸"} Clarification history`,
                ...(this.expanded.has(question.id)
                  ? round.clarifications
                      .filter((entry) => entry.questionId === question.id)
                      .flatMap((entry, number) =>
                        [""].concat(
                          entry.question === undefined
                            ? []
                            : markdownLines(
                                [
                                  `Question ${String(entry.question.number)} · revision ${String(entry.question.revision)}: ${entry.question.prompt}`,
                                  entry.question.context,
                                  ...entry.question.options.map(
                                    (option, optionIndex) =>
                                      `${String.fromCharCode(65 + optionIndex)}. ${option.label} — ${option.explanation}`,
                                  ),
                                  ...(entry.question.recommendation === undefined
                                    ? []
                                    : [
                                        `Recommendation: ${entry.question.options.find((option) => option.id === entry.question?.recommendation?.optionId)?.label ?? ""} — ${entry.question.recommendation.reason}`,
                                      ]),
                                ].join("\n\n"),
                                width,
                              ),
                          [""],
                          markdownLines(
                            `User question ${String(number + 1)}: ${entry.request}`,
                            width,
                          ),
                          [""],
                          markdownLines(entry.response ?? "Awaiting response", width),
                        ),
                      )
                  : []),
              ]
            : []),
        ];
      });
      const focusedHistory = preview.findIndex((line) => line.startsWith("›"));
      if (this.followFocus && focusedHistory >= 0) {
        this.scroll = Math.max(0, focusedHistory - Math.floor(Math.max(1, this.rows() - 10) / 2));
      }
      const controls = {
        buttons: [{ label: "Submit round" }],
        ...(this.previewFocus === histories.length ? { focus: 0 } : {}),
        ...(this.followFocus && focusedHistory >= 0 ? { contentFocus: focusedHistory } : {}),
        ...(this.showHints ? { hint: "Tab: focus · Enter: activate · F1: hints · Esc: back" } : {}),
        error: this.error,
        ...(this.theme === undefined ? {} : { theme: this.theme }),
      };
      return {
        lines: modalLines(
          "Review answers · unsubmitted",
          preview,
          controls,
          outerWidth,
          this.rows(),
          this.scroll,
          this.appearance.border,
        ),
        viewport: { scroll: this.scroll, length: preview.length },
        notePositions,
      };
    }
    const lines: string[] = [];
    const positions: number[] = [];
    let previousQuestion: string | undefined;
    for (const [index, row] of this.items().entries()) {
      if (row.kind === "inactive") {
        positions.push(lines.length);
        lines.push(
          ...markdownLines(
            row.question.status === "withdrawn"
              ? `~~${String(row.question.number)}. ${row.question.prompt}~~`
              : `${String(row.question.number)}. ${row.question.prompt} — deferred`,
            width,
          ),
          "",
        );
        continue;
      }
      if (row.kind !== "review" && row.question.id !== previousQuestion) {
        if (previousQuestion !== undefined) {
          lines.push("");
        }
        previousQuestion = row.question.id;
        const draft = round.drafts[row.question.id];
        lines.push(
          ...markdownLines(
            `## ${this.appearance.symbols === "emoji" ? "❓" : "?"} ${String(row.question.number)}. ${row.question.prompt}

${row.question.context}${reconfirmationWarning(draft, row.question.revision)}`,
            width,
          ),
          "",
        );
      }
      positions.push(lines.length);
      if (row.kind === "review") {
        continue;
      }
      const answer = round.drafts[row.question.id]?.answer;
      const option =
        row.kind === "option"
          ? row.question.options.find((item) => item.id === row.optionId)
          : undefined;
      const selected =
        round.drafts[row.question.id]?.revision === row.question.revision &&
        (row.kind === "other"
          ? answer?.custom !== undefined
          : row.kind === "option" && answer?.optionId === row.optionId);
      const marker = rowMarker(selected, index === this.selected, this.appearance.symbols);
      const letter = rowLetter(row);
      const label = rowLabel(
        row,
        !(editing && index === this.selected) &&
          (round.drafts[row.question.id]?.clarificationDraft?.trim().length ?? 0) > 0,
      );
      const prefix = `${marker} `;
      const content = `${prefix}${letter === undefined ? "" : `${letter}. `}${label}`;
      const activeField = editing && index === this.selected;
      const rendered = markdownLines(content, width).map((line, lineIndex) =>
        lineIndex === 0
          ? prefix +
            getMarkdownTheme().bold(sliceByColumn(line.trimEnd(), visibleWidth(prefix), width))
          : getMarkdownTheme().bold(line.trimEnd()),
      );
      if (option !== undefined) {
        const labelEnd = rendered.pop() ?? "";
        const occupied = visibleWidth(labelEnd);
        // Reserve the label's columns before Pi wraps the explanation's first line.
        const explanation = markdownLines(
          `${"x".repeat(occupied)} — ${option.explanation}`,
          width,
        ).map((line) => line.trimEnd());
        const first = explanation.shift() ?? "";
        rendered.push(labelEnd + sliceByColumn(first, occupied, width), ...explanation);
      }
      const draft = round.drafts[row.question.id];
      let note = stripTerminalSequences(fieldText(row, draft));
      let suffix = "";
      let offsets: number[] = [];
      if (activeField) {
        const text = this.editor.getText();
        const segments = [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
        ];
        offsets = [...segments.map((segment) => segment.index), text.length];
        note =
          segments
            .map((segment) => CURSOR_MARKER + stripTerminalSequences(segment.segment))
            .join("") + CURSOR_MARKER;
      }
      if (stripTerminalSequences(note).trim().length > 0) {
        const value = row.kind === "option" ? ` [notes: ${note}]` : ` ${note}`;
        switch (row.kind) {
          case "clarify":
            suffix = getMarkdownTheme().link(value);
            break;
          case "other":
            suffix = getMarkdownTheme().codeBlock(value);
            break;
          case "option":
            suffix = getSelectListTheme().selectedText(value);
            break;
        }
      } else if (activeField && this.editor.focused) {
        suffix = ` ${note} `;
      }
      const last = rendered.pop() ?? "";
      lines.push(...rendered.map((line) => (selected ? getMarkdownTheme().bold(line) : line)));
      const styled = selected ? getMarkdownTheme().bold(last + suffix) : last + suffix;
      const wrapped = wrapTextWithAnsi(styled, Math.max(1, width));
      if (activeField) {
        let offsetIndex = 0;
        const cursorOffset = this.noteOffset();
        for (const [visualRow, line] of wrapped.entries()) {
          const parts = line.split(CURSOR_MARKER);
          let output = parts[0] ?? "";
          let col = visibleWidth(output);
          for (const part of parts.slice(1)) {
            const offset = offsets[offsetIndex++];
            if (offset !== undefined) {
              notePositions.push({ offset, row: visualRow, col });
              if (this.editor.focused && offset === cursorOffset) {
                output += CURSOR_MARKER;
              }
            }
            output += part;
            col += visibleWidth(part);
          }
          lines.push(output);
        }
      } else {
        lines.push(...wrapped);
      }

      if (row.kind === "clarify") {
        const recommendation = row.question.recommendation;
        if (recommendation !== undefined) {
          const recommended = row.question.options.findIndex(
            (item) => item.id === recommendation.optionId,
          );
          lines.push(
            "",
            ...markdownLines(
              `${this.appearance.symbols === "emoji" ? "➡️ " : "→ "}Recommendation: ${String.fromCharCode(65 + recommended)}. ${row.question.options[recommended]?.label ?? ""} — ${recommendation.reason}`,
              width,
            ),
          );
        }
        const exchanges = round.clarifications.filter(
          (item) => item.questionId === row.question.id,
        );
        const clarification = exchanges.at(-1);
        if (clarification !== undefined) {
          const indent = " ".repeat(Math.min(2, Math.max(0, width - 1)));
          lines.push(
            "",
            ...markdownLines(
              `User question ${String(exchanges.length)}: ${clarification.request}`,
              width,
            ),
            "",
            ...markdownLines(
              clarification.response ?? "Awaiting response",
              width - indent.length,
            ).map((line) => indent + line),
          );
        }
      }
    }
    let help =
      "↑↓: move · Enter: toggle/open · Tab/Shift+Tab: question · Typing on an option adds notes · F3/F4: frontiers · PgUp/PgDn: scroll";
    let escapeHelp = " · F1: hints · Esc: close";
    if (editing) {
      help = "Enter: set · Shift+Enter: newline · Tab/Shift+Tab: question";
      escapeHelp = " · F1: hints · Esc: back";
    } else if (this.armed) {
      help = "Press Esc again to close; drafts retained";
    }
    if (this.switchView !== undefined) {
      help += " · Ctrl+P: presenter";
    }
    if (outerWidth < 40 && !this.armed) {
      help = editing ? "Enter:set" : "↑↓ Enter Tab";
      escapeHelp = " F1 Esc";
    }
    if (this.error.length > 0) {
      help = this.error + " · " + help;
    }
    const unanswered = this.unanswered();
    const inactive = !round.questions.some((q) => q.status === undefined);
    const atButton = this.mode === "list" && this.items()[this.selected]?.kind === "review";
    const reason =
      this.viewed !== undefined
        ? "Return to the current frontier to submit."
        : unanswered
            .map(
              (q) =>
                `Question ${String(q.number)} ${round.drafts[q.id]?.answer === undefined ? "is not answered" : "needs reconfirmation"}`,
            )
            .join("; ");
    const footer = {
      buttons: [
        {
          label: inactive ? "Continue planning" : "Review answers and submit",
          disabled: this.viewed !== undefined || unanswered.length > 0,
          reason,
        },
      ],
      ...(atButton ? { focus: 0 } : {}),
      error: this.error,
      ...(this.theme === undefined ? {} : { theme: this.theme }),
      ...(this.showHints
        ? {
            hint: this.armed
              ? help
              : truncateToWidth(help, Math.max(1, outerWidth - visibleWidth(escapeHelp))) +
                escapeHelp,
          }
        : {}),
    };
    const cursor = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    const focus = cursor >= 0 ? cursor : (positions[this.selected] ?? 0);
    const bodyHeight = Math.max(1, this.rows() - 10);
    const start =
      this.followFocus && !atButton ? Math.max(0, focus - Math.floor(bodyHeight / 2)) : this.scroll;
    const scroll = Math.max(0, Math.min(start, lines.length - bodyHeight));
    return {
      lines: modalLines(
        `Plan questions (round ${String(this.viewed === undefined ? this.read().roundNumber : this.read().history?.[this.viewed]?.number)})${this.viewed === undefined ? "" : " · earlier — read-only"}`,
        lines,
        { ...footer, ...(this.followFocus && !atButton ? { contentFocus: focus } : {}) },
        outerWidth,
        this.rows(),
        scroll,
        this.appearance.border,
      ),
      viewport: { scroll, length: lines.length },
      notePositions,
    };
  }
}
