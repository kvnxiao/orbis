import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import { DocumentAnalysis } from "../document/document-analysis.ts";
import { documentLayout } from "../document/document-layout.ts";
import type { DocumentLayout } from "../document/document-layout.ts";
import { markdownLines } from "../document/markdown.ts";
import { hasReviewNotes } from "../domain/state.ts";
import type { ReviewAction, RoundState } from "../domain/state.ts";
import { defaultAppearance } from "./appearance.ts";
import type { PlanAppearance } from "./appearance.ts";
import { ModalKeybindings } from "./terminal-keys.ts";
import { borderGlyphs, modalContentWidth, modalLines } from "./terminal-layout.ts";
import type { TerminalOptions } from "./terminal-options.ts";

const home = homedir();
const blockMarker = "→ ";
const approvalActions = [{ type: "approve", label: "Approve" }] as const;
const feedbackActions = [
  { type: "approve-with-notes", label: "Approve with notes" },
  { type: "submit-feedback", label: "Request revision" },
] as const;

/** Own revision browsing and annotation editing without changing Markdown. */
export class TerminalReview implements Component {
  private hasFocus = true;
  get focused(): boolean {
    return this.hasFocus;
  }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.syncFocus();
  }
  private viewed: number;
  private readonly revision: number;
  private block = 0;
  private action = 0;
  private mode: "document" | "actions" | "note" | "overall" = "document";
  private scroll = 0;
  private follow = true;
  private bookmark = {
    scroll: 0,
    block: 0,
    mode: "document" as "document" | "actions" | "note" | "overall",
    action: 0,
  };
  private armed = false;
  private showHints: boolean;
  private closed = false;
  private error = "";
  private cached: { markdown: string; width: number; layout: DocumentLayout } | undefined;
  private analysis: DocumentAnalysis | undefined;
  private readonly read: () => RoundState;
  private readonly dispatch: (action: ReviewAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly columns: () => number;
  private readonly switchView: (() => void) | undefined;
  private readonly appearance: PlanAppearance;
  private readonly theme: Theme | undefined;
  private readonly keys: ModalKeybindings;

  constructor(options: TerminalOptions<ReviewAction>) {
    const {
      read,
      dispatch,
      done,
      refresh,
      editor,
      rows = () => 24,
      switchView,
      appearance = defaultAppearance,
      columns = () => 80,
      theme,
    } = options;
    this.read = read;
    this.dispatch = dispatch;
    this.done = done;
    this.refresh = refresh;
    this.editor = editor;
    this.rows = rows;
    this.columns = columns;
    this.switchView = switchView;
    this.appearance = appearance;
    this.theme = theme;
    this.keys = new ModalKeybindings(
      options.keys,
      () => this.mode === "note" || this.mode === "overall",
    );
    this.showHints = appearance.showHints;
    this.viewed = Math.max(0, (read().reviews?.length ?? 1) - 1);
    this.revision = read().reviews?.at(-1)?.revision ?? 0;
    this.syncFocus();
  }
  private syncFocus(): void {
    this.editor.focused = this.hasFocus && (this.mode === "note" || this.mode === "overall");
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.done();
    }
  }
  invalidate(): void {
    this.cached = undefined;
    this.editor.invalidate();
  }
  private current(): boolean {
    return this.viewed === (this.read().reviews?.length ?? 0) - 1;
  }
  private send(action: ReviewAction): void {
    if (
      (action.type !== "cancel" && !this.current()) ||
      this.read().reviews?.at(-1)?.revision !== this.revision
    ) {
      throw new Error("Return to the latest pending revision before changing review.");
    }
    this.dispatch(action);
    if (this.read().phase !== "review") {
      this.close();
    }
  }
  private layout(width: number): DocumentLayout {
    const markdown = this.read().reviews?.[this.viewed]?.markdown ?? "";
    if (this.analysis?.markdown !== markdown) {
      this.analysis = new DocumentAnalysis(markdown);
    }
    if (this.cached?.markdown !== markdown || this.cached.width !== width) {
      this.cached = { markdown, width, layout: documentLayout(markdown, width, this.analysis) };
    }
    return this.cached.layout;
  }
  private open(overall: boolean): void {
    if (!this.current()) {
      throw new Error("Earlier revisions are read-only.");
    }
    const review = this.read().reviews?.[this.viewed];
    const blocks = this.layout(this.contentWidth()).blocks;
    const block = blocks[this.block];
    if (overall) {
      this.block = blocks.length;
    }
    this.mode = overall ? "overall" : "note";
    this.editor.setText(
      overall
        ? (review?.feedbackDraft ?? "")
        : (review?.notes?.find((note) => note.blockId === block?.id)?.text ?? ""),
    );
    this.follow = true;
    this.syncFocus();
  }
  private contentWidth(): number {
    return Math.max(1, modalContentWidth(this.columns()) - this.gutterWidth() * 2);
  }
  private gutterWidth(outerWidth = this.columns()): number {
    return Math.min(
      Math.max(0, Math.floor((modalContentWidth(outerWidth) - 1) / 2)),
      visibleWidth(blockMarker),
    );
  }
  private browse(direction: number): void {
    const latest = (this.read().reviews?.length ?? 1) - 1;
    const next = Math.max(0, Math.min(latest, this.viewed + direction));
    if (next === this.viewed) {
      return;
    }
    if (this.current()) {
      this.bookmark = {
        scroll: this.scroll,
        block: this.block,
        mode: this.mode,
        action: this.action,
      };
    }
    this.viewed = next;
    if (this.current()) {
      Object.assign(this, this.bookmark);
    } else {
      this.scroll = 0;
      this.block = 0;
      this.mode = "document";
    }
    this.follow = false;
    this.armed = false;
    this.syncFocus();
  }
  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    try {
      this.error = "";
      this.scroll = this.renderLayout(this.columns()).scroll;
      const review = this.read().reviews?.[this.viewed];
      if (review === undefined) {
        return;
      }
      const actions = hasReviewNotes(review) ? feedbackActions : approvalActions;
      this.action = Math.min(this.action, actions.length - 1);
      const layout = this.layout(this.contentWidth());
      const blocks = layout.blocks;
      if (this.keys.matches(data, "hints")) {
        this.showHints = !this.showHints;
        this.armed = false;
      } else if (this.keys.matches(data, "older") || this.keys.matches(data, "newer")) {
        this.browse(this.keys.matches(data, "older") ? -1 : 1);
      } else if (this.keys.matches(data, "escape")) {
        if (this.mode === "note" || this.mode === "overall") {
          this.mode = "document";
          this.armed = false;
        } else if (this.armed) {
          this.send({ type: "cancel" });
        } else {
          this.armed = true;
        }
      } else {
        this.armed = false;
        if (this.keys.matches(data, "presenter")) {
          this.switchView?.();
        } else if (this.keys.matches(data, "overall")) {
          this.open(true);
        } else if (this.keys.matches(data, "tab") || this.keys.matches(data, "previous")) {
          const count = actions.length;
          const direction = this.keys.matches(data, "tab") ? 1 : -1;
          if (this.mode !== "actions") {
            this.mode = "actions";
            this.action = direction > 0 ? 0 : count - 1;
          } else {
            this.action += direction;
            if (this.action < 0 || this.action >= count) {
              this.mode = "document";
              this.action = Math.max(0, Math.min(count - 1, this.action));
              if (this.block === blocks.length && this.current()) {
                this.open(true);
              }
            }
          }
        } else if (this.mode === "note" || this.mode === "overall") {
          if (this.keys.matches(data, "finish") && !this.keys.matches(data, "newline")) {
            this.mode = "document";
          } else {
            const before = this.editor.getCursor();
            this.keys.edit(this.editor, data);
            const after = this.editor.getCursor();
            if (
              this.mode === "overall" &&
              this.keys.matches(data, "cursorUp") &&
              before.line === after.line &&
              before.col === after.col &&
              blocks.length > 0
            ) {
              this.mode = "document";
              this.moveBlock(-1, layout);
            } else {
              const block = blocks[this.block];
              if (this.mode === "overall") {
                this.send({ type: "edit-feedback", text: this.editor.getExpandedText() });
              } else if (block !== undefined) {
                this.send({
                  type: "edit-note",
                  blockId: block.id,
                  excerpt: block.excerpt,
                  text: this.editor.getExpandedText(),
                });
              }
            }
            this.follow = true;
          }
        } else if (this.mode === "actions") {
          const count = actions.length;
          if (this.keys.matches(data, "left") || this.keys.matches(data, "right")) {
            this.action =
              (this.action + (this.keys.matches(data, "right") ? 1 : -1) + count) % count;
          } else if (this.keys.matches(data, "enter")) {
            const action = actions[this.action];
            if (action !== undefined) {
              this.send({ type: action.type });
            }
          }
        } else if (this.keys.matches(data, "pageUp") || this.keys.matches(data, "pageDown")) {
          this.scroll = Math.max(
            0,
            this.scroll +
              (this.keys.matches(data, "pageDown") ? 1 : -1) * Math.max(1, this.rows() - 10),
          );
          this.follow = false;
        } else if (this.keys.matches(data, "up") || this.keys.matches(data, "down")) {
          this.moveBlock(this.keys.matches(data, "down") ? 1 : -1, layout);
        } else if (
          this.current() &&
          (this.keys.matches(data, "enter") ||
            this.keys.matches(data, "backspace") ||
            data.startsWith("\x1b[200~") ||
            decodeKittyPrintable(data) !== undefined ||
            /^[^\p{Cc}]+$/u.test(data))
        ) {
          this.open(this.block === blocks.length);
          if (!this.keys.matches(data, "enter")) {
            this.handleInput(data);
            return;
          }
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncFocus();
    }
    this.refresh();
  }
  render(outerWidth: number): string[] {
    return this.renderLayout(outerWidth).lines;
  }
  private moveBlock(direction: number, layout: DocumentLayout): void {
    const blocks = layout.blocks;
    const notes = this.read().reviews?.[this.viewed]?.notes;
    do {
      this.block = Math.max(0, Math.min(blocks.length, this.block + direction));
      const block = blocks[this.block];
      const parent = blocks[this.block - 1];
      const span = block === undefined ? undefined : layout.spans.get(block.id);
      const parentSpan = parent === undefined ? undefined : layout.spans.get(parent.id);
      if (
        block?.kind !== "paragraph" ||
        parent?.kind !== "list_item" ||
        block.start < parent.start ||
        block.end > parent.end ||
        span === undefined ||
        span.range !== parentSpan?.range ||
        notes?.some((note) => note.blockId === block.id && note.text.trim().length > 0) === true
      ) {
        break;
      }
    } while (this.block > 0 && this.block < blocks.length);
    if (this.block === blocks.length && this.current()) {
      this.open(true);
    }
    this.follow = true;
  }
  private renderLayout(outerWidth: number): { lines: string[]; scroll: number } {
    const review = this.read().reviews?.[this.viewed];
    if (review === undefined) {
      return { lines: ["Plan review unavailable."], scroll: 0 };
    }
    const width = modalContentWidth(outerWidth);
    const gutter = this.gutterWidth(outerWidth);
    const contentWidth = Math.max(1, width - gutter * 2);
    const layout = this.layout(contentWidth);
    const target = layout.blocks[this.block];
    const selected = target === undefined ? undefined : layout.spans.get(target.id);
    const markdown = getMarkdownTheme();
    const noteBackground = (text: string) =>
      this.theme?.bg("customMessageBg", text) ?? `\x1b[48;5;236m${text}\x1b[49m`;
    const noteForeground = (text: string) => this.theme?.fg("warning", text) ?? text;
    const lines: string[] = [];
    let selectedPosition = 0;
    const insertions = new Map<number, typeof layout.blocks>();
    const notes = new Map(review.notes?.map((note) => [note.blockId, note]));
    for (const block of layout.blocks) {
      const note = notes.get(block.id);
      if (
        (note?.text.trim().length ?? 0) > 0 ||
        (this.mode === "note" && target?.id === block.id)
      ) {
        const end = layout.spans.get(block.id)?.end ?? layout.lines.length;
        insertions.set(
          end,
          [...(insertions.get(end) ?? []), block].toSorted(
            (a, b) => a.end - a.start - (b.end - b.start),
          ),
        );
      }
    }
    for (let row = 0; row <= layout.lines.length; row++) {
      for (const block of insertions.get(row) ?? []) {
        const active = this.mode === "note" && target?.id === block.id;
        const note = notes.get(block.id);
        const annotation = active
          ? this.editor.render(contentWidth)
          : wrapTextWithAnsi(stripTerminalSequences(note?.text ?? ""), contentWidth);
        for (const [index, text] of ["↑ Note", ...annotation].entries()) {
          const colored = index === 0 || !active ? noteForeground(text) : text;
          const styled = target?.id === block.id && !active ? markdown.bold(colored) : colored;
          lines.push(
            " ".repeat(gutter) +
              noteBackground(styled + " ".repeat(Math.max(0, contentWidth - visibleWidth(text)))),
          );
        }
      }
      const content = layout.lines[row];
      if (content === undefined) {
        continue;
      }
      if (row === selected?.start) {
        selectedPosition = lines.length;
      }
      const marker = row === selected?.start ? blockMarker.slice(0, gutter) : " ".repeat(gutter);
      const text = marker + content;
      lines.push(
        selected !== undefined && row >= selected.start && row < selected.end
          ? markdown.bold(text)
          : text,
      );
    }
    const overallPosition = lines.length;
    const indent = " ".repeat(gutter);
    lines.push(
      "",
      indent + markdown.hr(borderGlyphs[this.appearance.border].divider.repeat(contentWidth)),
      "",
      ...wrapTextWithAnsi("Overall feedback (optional)", contentWidth).map((line) => indent + line),
    );
    if (this.mode === "overall") {
      lines.push(...this.editor.render(contentWidth).map((line) => indent + line));
    } else {
      const placeholder = this.current()
        ? "Add overall feedback"
        : "No overall feedback · read-only";
      const value =
        review.feedbackDraft.length > 0
          ? noteForeground(stripTerminalSequences(review.feedbackDraft))
          : (this.theme?.fg("dim", placeholder) ?? `\x1b[2m${placeholder}\x1b[22m`);
      const border =
        this.theme?.fg("border", "─".repeat(contentWidth)) ?? markdown.hr("─".repeat(contentWidth));
      lines.push(
        indent + border,
        ...wrapTextWithAnsi(value, Math.max(1, contentWidth - 1)).map((line) => indent + line),
        indent + border,
      );
    }
    const cursor = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    const selectedFocus = this.block === layout.blocks.length ? overallPosition : selectedPosition;
    const focus = cursor >= 0 ? cursor : selectedFocus;
    const requested =
      this.follow && this.mode !== "actions"
        ? Math.max(0, focus - Math.floor(Math.max(1, this.rows() - 10) / 2))
        : this.scroll;
    const scroll = Math.max(0, Math.min(requested, lines.length - 1));
    const labels = (hasReviewNotes(review) ? feedbackActions : approvalActions).map(
      (action) => action.label,
    );
    const action = Math.min(this.action, labels.length - 1);
    const path = review.path;
    const displayedPath =
      path !== undefined && (path.startsWith(home + "/") || path.startsWith(home + "\\"))
        ? `~${path.slice(home.length)}`
        : path;
    const link =
      path === undefined
        ? ""
        : markdownLines(
            `[${displayedPath?.replaceAll("[", "\\[").replaceAll("]", "\\]") ?? ""}](${pathToFileURL(path).href})`,
            Math.max(width, visibleWidth(displayedPath ?? "") + 4),
          ).join(" ");
    const title = `Plan review · revision ${String(review.revision)} · ${this.current() ? "latest" : "older — read-only"}${link.length > 0 ? ` · ${link}` : ""}`;
    const suffix = [this.keys.hint("hints", "hints"), this.keys.hint("escape", "back")]
      .filter(Boolean)
      .join(" · ");
    let hint = [
      this.keys.hint(["up", "down"], "block"),
      "Type: note",
      this.keys.hint("tab", "focus"),
      this.keys.hint("overall", "overall feedback"),
      this.keys.hint(["older", "newer"], "revisions"),
    ]
      .filter(Boolean)
      .join(" · ");
    if (this.mode === "note" || this.mode === "overall") {
      hint = [
        this.keys.hint("finish", "finish"),
        this.keys.hint("newline", "newline"),
        this.keys.hint("tab", "actions"),
        this.keys.hint("overall", "overall feedback"),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (this.armed) {
      hint = this.keys.hint("escape", "press again to close; drafts retained");
    }
    if (this.switchView !== undefined) {
      hint += ` · ${this.keys.hint("presenter", "presenter")}`;
    }
    return {
      lines: modalLines(
        title,
        lines.map((line) => " ".repeat((outerWidth - width) / 2) + line),
        {
          buttons: labels.map((label) =>
            this.current()
              ? { label }
              : {
                  label,
                  disabled: true,
                  reason: "Return to the latest revision before submitting.",
                },
          ),
          ...(this.mode === "actions" ? { focus: action } : {}),
          ...(this.follow && this.mode !== "actions" ? { contentFocus: focus } : {}),
          ...(this.showHints
            ? {
                hint: `${hint} · ${suffix}`,
                hintSuffix: suffix,
                compactHint: this.armed
                  ? this.keys.hint("escape", "close?", true)
                  : [
                      this.keys.hint(
                        this.mode === "note" || this.mode === "overall" ? "finish" : "tab",
                        "",
                        true,
                      ),
                      this.keys.hint("hints", "", true),
                      this.keys.hint("escape", "", true),
                    ]
                      .filter(Boolean)
                      .join(" "),
              }
            : {}),
          error: this.error,
          ...(this.theme === undefined ? {} : { theme: this.theme }),
        },
        outerWidth,
        this.rows(),
        scroll,
        this.appearance.border,
      ),
      scroll,
    };
  }
}
