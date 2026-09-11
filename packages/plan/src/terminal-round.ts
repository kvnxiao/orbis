import { randomUUID } from "node:crypto";

import { getMarkdownTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import { defaultAppearance } from "./config.ts";
import type { PlanAppearance } from "./config.ts";
import type { Draft, RoundAction, RoundState, Question } from "./state.ts";
import { markdownLines, modalContentWidth, modalLines } from "./terminal-layout.ts";

type Row =
  | { question: Question; optionId?: string; kind: "option" | "other" | "clarify" }
  | { kind: "review" };

function reconfirmationWarning(draft: Draft | undefined, revision: number): string {
  if (draft?.answer !== undefined && draft.revision !== revision) {
    return "\n\nChanged question: reconfirm";
  }
  return "";
}

function rowLabel(row: Row, ready = false): string {
  switch (row.kind) {
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

function fieldText(row: Exclude<Row, { kind: "review" }>, draft: Draft | undefined): string {
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
  focused = true;
  private selected = 0;
  private mode: "list" | "edit" | "preview" = "list";
  private control = 0;
  private scroll = 0;
  private armed = false;
  private showHints: boolean;
  private closed = false;
  private error = "";
  private followFocus = true;
  private viewport = { scroll: 0, length: 0 };
  private notePositions: { offset: number; row: number; col: number }[] = [];
  private noteColumn: number | undefined;
  private noteWidth = 0;

  private readonly read: () => RoundState;
  private readonly dispatch: (action: RoundAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly switchView: (() => void) | undefined;
  private readonly appearance: PlanAppearance;

  constructor(
    read: () => RoundState,
    dispatch: (action: RoundAction) => void,
    done: () => void,
    refresh: () => void,
    editor: Editor,
    rows: () => number = () => 24,
    switchView?: () => void,
    appearance: PlanAppearance = defaultAppearance,
  ) {
    this.read = read;
    this.dispatch = dispatch;
    this.done = done;
    this.refresh = refresh;
    this.editor = editor;
    this.rows = rows;
    this.switchView = switchView;
    this.appearance = appearance;
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
  private send(action: RoundAction): void {
    this.dispatch(action);
    if (this.read().phase !== "round") {
      this.close();
    }
  }
  private items(): Row[] {
    const rows: Row[] = [];
    for (const question of this.read().round?.questions ?? []) {
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
    const answer = this.read().round?.drafts[question.id]?.answer;
    const items = this.items();
    const preferred = items.findIndex(
      (row) =>
        row.kind !== "review" &&
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
  private edit(row: Exclude<Row, { kind: "review" }>): void {
    this.noteColumn = undefined;
    this.notePositions = [];
    const draft = this.read().round?.drafts[row.question.id];
    this.mode = "edit";
    this.control = 0;
    this.editor.setText(fieldText(row, draft));
  }
  private confirm(row: Exclude<Row, { kind: "review" }>): void {
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

  private editInput(row: Exclude<Row, { kind: "review" }>, data: string): void {
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
    const currentOffset = this.noteOffset();
    const current = this.notePositions.find((position) => position.offset === currentOffset);
    if (current === undefined) {
      return;
    }
    this.noteColumn ??= current.col;
    const row = this.notePositions.filter((position) => position.row === current.row + direction);
    const target =
      row.findLast((position) => position.col <= (this.noteColumn ?? current.col)) ?? row[0];
    if (target === undefined) {
      return;
    }
    const key = target.offset < currentOffset ? "\x1b[D" : "\x1b[C";
    let remaining = this.notePositions.length;
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
    if (matchesKey(data, "f1")) {
      this.showHints = !this.showHints;
      this.armed = false;
      this.refresh();
      return;
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
        this.control = 0;
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
          if (row.kind === "review") {
            return;
          }
          if (matchesKey(data, "enter")) {
            this.confirm(row);
          } else {
            this.editInput(row, data);
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
        } else if (matchesKey(data, "enter")) {
          if (row.kind === "review") {
            this.mode = "preview";
            this.control = 0;
            this.scroll = 0;
          } else if (row.kind === "option" && row.optionId !== undefined) {
            this.send({
              type: "answer",
              questionId: row.question.id,
              answer: { optionId: row.optionId },
            });
          } else if (
            row.kind === "clarify" &&
            (this.read().round?.drafts[row.question.id]?.clarificationDraft?.trim().length ?? 0) > 0
          ) {
            this.send({
              type: "clarify",
              questionId: row.question.id,
              request: this.read().round?.drafts[row.question.id]?.clarificationDraft ?? "",
              id: randomUUID(),
            });
          } else {
            this.edit(row);
          }
        } else if (
          row.kind !== "review" &&
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
    }
    this.refresh();
  }

  render(outerWidth: number): string[] {
    const width = modalContentWidth(outerWidth);
    const round = this.read().round;
    if (round === undefined) {
      return ["No active round."];
    }
    const editing = this.mode === "edit";
    this.editor.focused = this.focused && editing;
    if (this.mode === "preview") {
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
          ...body,
          ...wrapTextWithAnsi(last + suffix, Math.max(1, width)),
        ];
      });
      return modalLines(
        "Review answers · unsubmitted",
        preview,
        [
          this.error,
          `${this.control === 0 ? "›" : ""}Submit round`,
          `${this.control === 1 ? "›" : ""}Next unanswered`,
          ...(this.showHints ? ["Tab: action · Enter: activate · F1: hints · Esc: back"] : []),
        ],
        outerWidth,
        this.rows(),
        this.scroll,
        this.showHints,
        this.appearance.border,
      );
    }
    const lines: string[] = [];
    const positions: number[] = [];
    let previousQuestion: string | undefined;
    for (const [index, row] of this.items().entries()) {
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
        );
      }
      if (row.kind === "review") {
        lines.push("");
      }
      positions.push(lines.length);
      if (row.kind === "review") {
        const marker = index === this.selected ? "›" : " ";
        lines.push(
          ...wrapTextWithAnsi(
            getSelectListTheme().selectedText(
              getMarkdownTheme().bold(`${marker} [ ${rowLabel(row)} ]`),
            ),
            Math.max(1, width),
          ),
        );
        continue;
      }
      const answer = round.drafts[row.question.id]?.answer;
      const option =
        row.kind === "option"
          ? row.question.options.find((item) => item.id === row.optionId)
          : undefined;
      const selected =
        row.kind === "other"
          ? answer?.custom !== undefined
          : row.kind === "option" && answer?.optionId === row.optionId;
      const marker = rowMarker(selected, index === this.selected, this.appearance.symbols);
      const letter = rowLetter(row);
      const label = rowLabel(
        row,
        !(editing && index === this.selected) &&
          (round.drafts[row.question.id]?.clarificationDraft?.trim().length ?? 0) > 0,
      );
      const content = `${marker} ${letter === undefined ? "" : `${letter}. `}${label}${option === undefined ? "" : ` — ${option.explanation}`}`;
      const activeField = editing && index === this.selected;
      const rendered = markdownLines(content, width).map((line) => line.trimEnd());
      const draft = round.drafts[row.question.id];
      let note = stripTerminalSequences(fieldText(row, draft));
      let suffixLabel: string;
      switch (row.kind) {
        case "option":
          suffixLabel = "notes";
          break;
        case "other":
          suffixLabel = "answer";
          break;
        case "clarify":
          suffixLabel = "question";
          break;
      }
      let suffix = "";
      let offsets: number[] = [];
      if (activeField) {
        if (this.noteWidth !== width) {
          this.noteColumn = undefined;
          this.noteWidth = width;
        }
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
        const value = ` [${suffixLabel}: ${note}]`;
        suffix =
          row.kind === "clarify"
            ? getMarkdownTheme().link(value)
            : getSelectListTheme().selectedText(value);
      } else if (activeField && this.editor.focused) {
        suffix = ` ${note} `;
      }
      const last = rendered.pop() ?? "";
      lines.push(...rendered.map((line) => (selected ? getMarkdownTheme().bold(line) : line)));
      const styled = selected ? getMarkdownTheme().bold(last + suffix) : last + suffix;
      const wrapped = wrapTextWithAnsi(styled, Math.max(1, width));
      if (activeField) {
        this.notePositions = [];
        let offsetIndex = 0;
        const cursorOffset = this.noteOffset();
        for (const [visualRow, line] of wrapped.entries()) {
          const parts = line.split(CURSOR_MARKER);
          let output = parts[0] ?? "";
          let col = visibleWidth(output);
          for (const part of parts.slice(1)) {
            const offset = offsets[offsetIndex++];
            if (offset !== undefined) {
              this.notePositions.push({ offset, row: visualRow, col });
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
        for (const clarification of round.clarifications.filter(
          (item) => item.questionId === row.question.id,
        )) {
          lines.push(
            ...markdownLines(
              `Clarification: ${clarification.request}

${clarification.response ?? "Awaiting response"}`,
              width,
            ),
          );
        }
      }
    }
    let help =
      "↑↓: move · Enter: select/open · Tab/Shift+Tab: question · Typing on an option adds notes · PgUp/PgDn: scroll";
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
    const footer: string[] = [];
    if (this.showHints) {
      if (this.armed) {
        footer.push(truncateToWidth(help, outerWidth));
      } else {
        footer.push(
          truncateToWidth(help, Math.max(1, outerWidth - visibleWidth(escapeHelp))) + escapeHelp,
        );
      }
    } else if (this.error.length > 0) {
      footer.push(this.error);
    }
    const cursor = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    const focus = cursor >= 0 ? cursor : (positions[this.selected] ?? 0);
    const bodyHeight = Math.max(1, this.rows() - footer.length - 3);
    const start = this.followFocus ? Math.max(0, focus - Math.floor(bodyHeight / 2)) : this.scroll;
    const scroll = Math.max(0, Math.min(start, lines.length - bodyHeight));
    this.viewport = { scroll, length: lines.length };
    return modalLines(
      `Plan questions (round ${String(this.read().roundNumber)})`,
      lines,
      footer,
      outerWidth,
      this.rows(),
      scroll,
      this.showHints,
      this.appearance.border,
    );
  }
}
