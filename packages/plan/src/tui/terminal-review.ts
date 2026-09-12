import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  matchesKey,
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
import { modalKeys, modalKeyHint } from "./terminal-keys.ts";
import { functionKey, modalContentWidth, modalLines } from "./terminal-layout.ts";
import type { TerminalOptions } from "./terminal-options.ts";

const home = homedir();
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
  private readonly keys: Pick<KeybindingsManager, "getKeys"> | undefined;

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
    this.keys = options.keys;
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
    const block = this.layout(this.contentWidth()).blocks[this.block];
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
    return Math.max(1, modalContentWidth(this.columns()) - this.gutterWidth());
  }
  private gutterWidth(): number {
    const count = (this.read().reviews?.[this.viewed]?.markdown ?? "").split(/\r\n|\r|\n/u).length;
    return Math.min(
      Math.max(0, modalContentWidth(this.columns()) - 1),
      String(count).length * 2 + 3,
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
      const blocks = this.layout(this.contentWidth()).blocks;
      if (functionKey(data, 1)) {
        this.showHints = !this.showHints;
        this.armed = false;
      } else if (functionKey(data, 3) || functionKey(data, 4)) {
        this.browse(functionKey(data, 3) ? -1 : 1);
      } else if (matchesKey(data, modalKeys.escape)) {
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
        if (matchesKey(data, modalKeys.presenter)) {
          this.switchView?.();
        } else if (functionKey(data, 2)) {
          this.open(true);
        } else if (matchesKey(data, modalKeys.tab) || matchesKey(data, modalKeys.previous)) {
          const count = actions.length;
          const direction = matchesKey(data, modalKeys.tab) ? 1 : -1;
          if (this.mode !== "actions") {
            this.mode = "actions";
            this.action = direction > 0 ? 0 : count - 1;
          } else {
            this.action += direction;
            if (this.action < 0 || this.action >= count) {
              this.mode = "document";
              this.action = Math.max(0, Math.min(count - 1, this.action));
            }
          }
        } else if (this.mode === "note" || this.mode === "overall") {
          if (matchesKey(data, modalKeys.enter)) {
            this.mode = "document";
          } else {
            if (matchesKey(data, modalKeys.newline)) {
              this.editor.insertTextAtCursor("\n");
            } else {
              this.editor.handleInput(data);
            }
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
            this.follow = true;
          }
        } else if (this.mode === "actions") {
          const count = actions.length;
          if (matchesKey(data, modalKeys.left) || matchesKey(data, modalKeys.right)) {
            this.action =
              (this.action + (matchesKey(data, modalKeys.right) ? 1 : -1) + count) % count;
          } else if (matchesKey(data, modalKeys.enter)) {
            const action = actions[this.action];
            if (action !== undefined) {
              this.send({ type: action.type });
            }
          }
        } else if (matchesKey(data, modalKeys.pageUp) || matchesKey(data, modalKeys.pageDown)) {
          this.scroll = Math.max(
            0,
            this.scroll +
              (matchesKey(data, modalKeys.pageDown) ? 1 : -1) * Math.max(1, this.rows() - 10),
          );
          this.follow = false;
        } else if (matchesKey(data, modalKeys.up) || matchesKey(data, modalKeys.down)) {
          this.block = Math.max(
            0,
            Math.min(blocks.length, this.block + (matchesKey(data, modalKeys.down) ? 1 : -1)),
          );
          this.follow = true;
        } else if (
          this.current() &&
          (matchesKey(data, modalKeys.enter) ||
            matchesKey(data, modalKeys.backspace) ||
            data.startsWith("\x1b[200~") ||
            decodeKittyPrintable(data) !== undefined ||
            /^[^\p{Cc}]+$/u.test(data))
        ) {
          this.open(this.block === blocks.length);
          if (!matchesKey(data, modalKeys.enter)) {
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
  private renderLayout(outerWidth: number): { lines: string[]; scroll: number } {
    const review = this.read().reviews?.[this.viewed];
    if (review === undefined) {
      return { lines: ["Plan review unavailable."], scroll: 0 };
    }
    const width = modalContentWidth(outerWidth);
    const gutter = Math.min(
      Math.max(0, width - 1),
      String(review.markdown.split(/\r\n|\r|\n/u).length).length * 2 + 3,
    );
    const contentWidth = Math.max(1, width - gutter);
    const layout = this.layout(contentWidth);
    const target = layout.blocks[this.block];
    const selected = target === undefined ? undefined : layout.spans.get(target.id);
    const markdown = getMarkdownTheme();
    const noteBackground = (text: string) =>
      this.theme?.bg("customMessageBg", text) ?? `\x1b[48;5;236m${text}\x1b[49m`;
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
    const ranges = new Map<number, string>();
    for (const span of layout.spans.values()) {
      if (!ranges.has(span.start)) {
        ranges.set(span.start, span.range);
      }
    }
    for (let row = 0; row <= layout.lines.length; row++) {
      for (const block of insertions.get(row) ?? []) {
        const active = this.mode === "note" && target?.id === block.id;
        const note = notes.get(block.id);
        const span = layout.spans.get(block.id);
        const annotation = active
          ? this.editor.render(contentWidth)
          : wrapTextWithAnsi(stripTerminalSequences(note?.text ?? ""), contentWidth);
        lines.push(noteBackground(" ".repeat(gutter) + `↑ Note on ${span?.range ?? ""}`));
        for (const text of annotation) {
          lines.push(
            noteBackground(
              " ".repeat(gutter) +
                text +
                " ".repeat(Math.max(0, contentWidth - visibleWidth(text))),
            ),
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
      const label = row === selected?.start ? selected.range : (ranges.get(row) ?? "");
      const text = (gutter > 0 ? label.padStart(gutter - 1) + " " : "") + content;
      lines.push(
        selected !== undefined && row >= selected.start && row < selected.end
          ? markdown.bold(text)
          : text,
      );
    }
    const overallPosition = lines.length;
    lines.push(
      "",
      this.block === layout.blocks.length ? markdown.bold("Overall feedback") : "Overall feedback",
    );
    if (this.mode === "overall") {
      lines.push(...this.editor.render(width));
    } else if (review.feedbackDraft.length > 0) {
      lines.push(
        ...wrapTextWithAnsi(stripTerminalSequences(review.feedbackDraft), width).map(
          noteBackground,
        ),
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
    let hint =
      "↑↓: block · Type: note · Tab: focus · F2: overall · F3/F4: revisions · F1: hints · Esc: back";
    if (this.mode === "note" || this.mode === "overall") {
      const newline = [
        ...new Set([modalKeys.newline, ...(this.keys?.getKeys("tui.input.newLine") ?? [])]),
      ].join("/");
      hint = `Enter: finish · ${modalKeyHint(newline, "newline")} · Tab: actions · F2: overall · F1: hints · Esc: back`;
    }
    if (this.armed) {
      hint = "Press Esc again to close; drafts retained · F1: hints";
    }
    if (this.switchView !== undefined) {
      hint += ` · ${modalKeyHint(modalKeys.presenter, "presenter")}`;
    }
    return {
      lines: modalLines(
        title,
        lines,
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
          ...(this.showHints ? { hint } : {}),
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
