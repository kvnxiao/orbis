import { matchesKey } from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import { documentBlocks } from "./blocks.ts";
import { hasReviewNotes, reviewFeedback } from "./state.ts";
import type { ReviewAction, RoundState } from "./state.ts";
import { markdownLines, modalLines } from "./terminal-layout.ts";

const actions = [
  "Annotate",
  "Overall feedback",
  "Review feedback",
  "Approve",
  "Discard notes and approve…",
];

export class TerminalReview implements Component {
  focused = true;
  private viewed: number;
  private readonly revision: number;
  private block = 0;
  private action = 0;
  private mode: "document" | "actions" | "note" | "overall" | "preview" | "discard" = "document";
  private control = 0;
  private scroll = 0;
  private latestPosition = { scroll: 0, block: 0 };
  private armed = false;
  private closed = false;
  private error = "";
  private width = 80;
  private resizedScroll: number | undefined;

  private readonly read: () => RoundState;
  private readonly dispatch: (action: ReviewAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly switchView: (() => void) | undefined;

  constructor(
    read: () => RoundState,
    dispatch: (action: ReviewAction) => void,
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
    this.viewed = Math.max(0, (read().reviews?.length ?? 1) - 1);
    this.revision = read().reviews?.at(-1)?.revision ?? 0;
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.done();
    }
  }
  invalidate(): void {
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
  private document(width: number): { lines: string[]; position: number } {
    const review = this.read().reviews?.[this.viewed];
    if (review === undefined) {
      return { lines: [], position: 0 };
    }
    const blocks = documentBlocks(review.markdown);
    const lines = markdownLines(review.markdown, width);
    const target = blocks[this.block];
    const position =
      target === undefined
        ? 0
        : Math.max(0, markdownLines(review.markdown.slice(0, target.start), width).length - 1);
    return { lines, position };
  }
  private openAction(): void {
    const review = this.read().reviews?.at(-1);
    if (!this.current() || review?.revision !== this.revision) {
      throw new Error("Older revisions are read-only. Press ] with document focus to return.");
    }
    if (this.action === 0) {
      const block = documentBlocks(review.markdown)[this.block];
      if (block === undefined) {
        throw new Error("Select a document block to annotate.");
      }
      this.mode = "note";
      this.control = 0;
      this.editor.setText(
        review.notes?.find((note) => note.blockId === block.id)?.unfinished ?? "",
      );
    } else if (this.action === 1) {
      this.mode = "overall";
      this.control = 0;
      this.editor.setText(review.feedbackDraft);
    } else if (this.action === 2) {
      this.mode = "preview";
      this.control = 0;
      this.scroll = 0;
    } else if (this.action === 3) {
      this.send({ type: "approve" });
    } else {
      this.mode = "discard";
      this.control = 0;
    }
  }
  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    if (this.resizedScroll !== undefined) {
      this.scroll = this.resizedScroll;
      this.resizedScroll = undefined;
    }
    try {
      this.error = "";
      const review = this.read().reviews?.[this.viewed];
      if (review === undefined) {
        return;
      }
      if (matchesKey(data, "escape")) {
        if (this.mode !== "document" && this.mode !== "actions") {
          this.mode = "document";
          this.armed = false;
        } else if (this.armed) {
          this.send({ type: "cancel" });
        } else {
          this.armed = true;
        }
      } else {
        this.armed = false;
        if (matchesKey(data, "ctrl+p")) {
          this.switchView?.();
        } else if (this.mode === "note" || this.mode === "overall") {
          const block = documentBlocks(review.markdown)[this.block];
          if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            const count = this.mode === "note" ? 3 : 2;
            this.control = (this.control + (matchesKey(data, "tab") ? 1 : -1) + count) % count;
          } else if (this.control > 0 && matchesKey(data, "enter")) {
            if (this.mode === "overall") {
              this.send({ type: "confirm-feedback" });
            } else if (block !== undefined) {
              if (this.control === 2) {
                const note = review.notes?.find((item) => item.blockId === block.id);
                if (note !== undefined) {
                  this.send({ type: "remove-note", blockId: block.id });
                }
              } else {
                this.send({ type: "confirm-note", blockId: block.id });
              }
            }
            this.mode = "document";
          } else if (this.control === 0) {
            if (matchesKey(data, "enter")) {
              this.editor.insertTextAtCursor("\n");
            } else {
              this.editor.handleInput(data);
            }
            const text = this.editor.getExpandedText();
            if (this.mode === "overall") {
              this.send({ type: "edit-feedback", text });
            } else if (block !== undefined) {
              this.send({ type: "edit-note", blockId: block.id, excerpt: block.excerpt, text });
            }
          }
        } else if (this.mode === "preview" || this.mode === "discard") {
          if (
            matchesKey(data, "tab") ||
            matchesKey(data, "shift+tab") ||
            matchesKey(data, "left") ||
            matchesKey(data, "right")
          ) {
            this.control = 1 - this.control;
          } else if (matchesKey(data, "enter")) {
            if (this.control === 1) {
              this.mode = "document";
            } else {
              this.send({ type: this.mode === "preview" ? "submit-feedback" : "discard-approve" });
            }
          } else if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
            this.scroll++;
          } else if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
            this.scroll = Math.max(0, this.scroll - 1);
          }
        } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
          this.mode = this.mode === "document" ? "actions" : "document";
        } else if (this.mode === "actions") {
          if (matchesKey(data, "left") || matchesKey(data, "up")) {
            this.action = (this.action + actions.length - 1) % actions.length;
          } else if (matchesKey(data, "right") || matchesKey(data, "down")) {
            this.action = (this.action + 1) % actions.length;
          } else if (matchesKey(data, "enter")) {
            this.openAction();
          }
        } else if (data === "[" || data === "]") {
          if (this.current()) {
            this.latestPosition = { scroll: this.scroll, block: this.block };
          }
          this.viewed = Math.max(
            0,
            Math.min((this.read().reviews?.length ?? 1) - 1, this.viewed + (data === "[" ? -1 : 1)),
          );
          this.scroll = this.current() ? this.latestPosition.scroll : 0;
          this.block = this.current() ? this.latestPosition.block : 0;
        } else if (matchesKey(data, "pageDown") || matchesKey(data, "pageUp")) {
          this.scroll = Math.max(
            0,
            Math.min(
              Math.max(0, this.document(this.width).lines.length - 1),
              this.scroll + (matchesKey(data, "pageDown") ? 1 : -1) * Math.max(1, this.rows() - 10),
            ),
          );
        } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
          this.block = Math.max(
            0,
            Math.min(
              documentBlocks(review.markdown).length - 1,
              this.block + (matchesKey(data, "down") ? 1 : -1),
            ),
          );
          this.scroll = this.document(this.width).position;
        } else if (matchesKey(data, "enter")) {
          this.action = 0;
          this.openAction();
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }
  render(width: number): string[] {
    if (width !== this.width && this.mode === "document") {
      this.resizedScroll = this.document(width).position;
    }
    this.width = width;
    const review = this.read().reviews?.[this.viewed];
    if (review === undefined) {
      return ["Plan review unavailable."];
    }
    const title = `Plan review · revision ${String(review.revision)} · ${this.current() ? "latest" : "older — read-only"}`;
    const editing = this.mode === "note" || this.mode === "overall";
    this.editor.focused = this.focused && editing && this.control === 0;
    if (editing) {
      const block = documentBlocks(review.markdown)[this.block];
      const context = this.mode === "note" ? (block?.excerpt ?? "") : review.markdown;
      return modalLines(
        title,
        markdownLines(context, width),
        [
          ...this.editor.render(width),
          this.error,
          `${this.control === 1 ? "→" : ""}Confirm note`,
          ...(this.mode === "note" ? [`${this.control === 2 ? "→" : ""}Remove note`] : []),
          "Enter: note newline · Tab: controls · Esc: back",
        ],
        width,
        this.rows(),
        0,
      );
    }
    if (this.mode === "discard") {
      return modalLines(
        title,
        markdownLines(
          `Discard ALL unsent block notes, overall feedback and unfinished note text for revision ${String(review.revision)}, and approve its unchanged Markdown?`,
          width,
        ),
        [
          this.error,
          `${this.control === 0 ? "→" : ""}Discard + approve`,
          `${this.control === 1 ? "→" : ""}Back`,
          "Tab: control · Enter: activate · Esc: back",
        ],
        width,
        this.rows(),
        0,
      );
    }
    if (this.mode === "preview") {
      const unfinished = (review.notes ?? []).filter(
        (note) => note.unfinished !== (note.confirmed ?? ""),
      );
      const feedback = reviewFeedback(review);
      const text = `${feedback.length === 0 ? "No confirmed feedback." : feedback}\n\n${unfinished.map((note) => `Unconfirmed edit excluded: block ${note.blockId}`).join("\n")}${review.feedbackDraft !== (review.overallConfirmed ?? "") ? "\nUnconfirmed overall feedback excluded." : ""}`;
      return modalLines(
        title,
        markdownLines(text, width),
        [
          this.error,
          `${this.control === 0 ? "→" : ""}Send feedback`,
          `${this.control === 1 ? "→" : ""}Back`,
          "Tab: control · Enter: activate · Esc: back",
        ],
        width,
        this.rows(),
        this.scroll,
      );
    }
    const shortActions = [
      "Annotate",
      "Overall note",
      "Review feedback",
      "Approve",
      "Discard + approve",
    ];
    const bar =
      width < 120
        ? `${this.mode === "actions" ? "→" : "·"}${shortActions[this.action] ?? "Annotate"}`
        : actions
            .map(
              (label, index) =>
                `${this.mode === "actions" && this.action === index ? "→" : ""}${label}`,
            )
            .join(" | ");
    const footer = [
      this.error,
      `Block ${String(this.block + 1)}: ${documentBlocks(review.markdown)[this.block]?.excerpt.split(/\r?\n/)[0] ?? ""}`,
      bar,
      this.armed
        ? "Press Esc again to close; drafts retained"
        : this.mode === "actions"
          ? "Arrows: action · Enter: activate · Tab: document"
          : "↑↓: block · PgUp/PgDn: read · Enter: annotate · Tab: actions",
      "[ / ]: revisions · Esc: close",
      ...(this.switchView === undefined ? [] : ["Ctrl+P: presenter"]),
    ];
    if (this.current() && hasReviewNotes(review)) {
      footer.unshift("Unsent notes: send feedback or discard before approval.");
    }
    return modalLines(
      title,
      this.document(width).lines,
      footer,
      width,
      this.rows(),
      this.resizedScroll ?? this.scroll,
    );
  }
}
