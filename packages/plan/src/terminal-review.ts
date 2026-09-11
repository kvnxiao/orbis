import { matchesKey } from "@earendil-works/pi-tui";
import type { Component, Editor } from "@earendil-works/pi-tui";

import { documentBlocks } from "./blocks.ts";
import type { DocumentBlock } from "./blocks.ts";
import { defaultAppearance } from "./config.ts";
import type { PlanAppearance } from "./config.ts";
import { hasReviewNotes, reviewFeedback } from "./state.ts";
import type { ReviewAction, RoundState } from "./state.ts";
import { markdownLines, modalContentWidth, modalLines } from "./terminal-layout.ts";

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
  private showHints: boolean;
  private closed = false;
  private error = "";
  private width = 80;
  private resizedScroll: number | undefined;
  private blockCache: { markdown: string; blocks: DocumentBlock[] } | undefined;

  private readonly read: () => RoundState;
  private readonly dispatch: (action: ReviewAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly editor: Editor;
  private readonly rows: () => number;
  private readonly switchView: (() => void) | undefined;
  private readonly appearance: PlanAppearance;

  constructor(
    read: () => RoundState,
    dispatch: (action: ReviewAction) => void,
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
  private blocks(markdown: string): DocumentBlock[] {
    if (this.blockCache?.markdown !== markdown) {
      this.blockCache = { markdown, blocks: documentBlocks(markdown) };
    }
    return this.blockCache.blocks;
  }
  private documentLines(width: number): string[] {
    const review = this.read().reviews?.[this.viewed];
    return review === undefined ? [] : markdownLines(review.markdown, width);
  }
  private blockPosition(width: number): number {
    const review = this.read().reviews?.[this.viewed];
    const target = review === undefined ? undefined : this.blocks(review.markdown)[this.block];
    if (review === undefined || target === undefined) {
      return 0;
    }
    return Math.max(0, markdownLines(review.markdown.slice(0, target.start), width).length - 1);
  }
  private openAction(): void {
    const review = this.read().reviews?.at(-1);
    if (!this.current() || review?.revision !== this.revision) {
      throw new Error("Older revisions are read-only. Press ] with document focus to return.");
    }
    if (this.action === 0) {
      const block = this.blocks(review.markdown)[this.block];
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
    if (matchesKey(data, "f1")) {
      this.showHints = !this.showHints;
      this.armed = false;
      this.refresh();
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
          const block = this.blocks(review.markdown)[this.block];
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
              Math.max(0, this.documentLines(this.width).length - 1),
              this.scroll + (matchesKey(data, "pageDown") ? 1 : -1) * Math.max(1, this.rows() - 10),
            ),
          );
        } else if (matchesKey(data, "up") || matchesKey(data, "down")) {
          this.block = Math.max(
            0,
            Math.min(
              this.blocks(review.markdown).length - 1,
              this.block + (matchesKey(data, "down") ? 1 : -1),
            ),
          );
          this.scroll = this.blockPosition(this.width);
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
  render(outerWidth: number): string[] {
    const width = modalContentWidth(outerWidth);
    if (width !== this.width && this.mode === "document") {
      this.resizedScroll = this.blockPosition(width);
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
      const block = this.blocks(review.markdown)[this.block];
      const context = this.mode === "note" ? (block?.excerpt ?? "") : review.markdown;
      return modalLines(
        title,
        markdownLines(context, width),
        [
          ...this.editor.render(width),
          this.error,
          `${this.control === 1 ? "›" : ""}Confirm note`,
          ...(this.mode === "note" ? [`${this.control === 2 ? "›" : ""}Remove note`] : []),
          ...(this.showHints
            ? ["Enter: note newline · Tab: controls · F1: hints · Esc: back"]
            : []),
        ],
        outerWidth,
        this.rows(),
        0,
        false,
        this.appearance.border,
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
          `${this.control === 0 ? "›" : ""}Discard + approve`,
          `${this.control === 1 ? "›" : ""}Back`,
          ...(this.showHints ? ["Tab: control · Enter: activate · F1: hints · Esc: back"] : []),
        ],
        outerWidth,
        this.rows(),
        0,
        this.showHints,
        this.appearance.border,
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
          `${this.control === 0 ? "›" : ""}Send feedback`,
          `${this.control === 1 ? "›" : ""}Back`,
          ...(this.showHints ? ["Tab: control · Enter: activate · F1: hints · Esc: back"] : []),
        ],
        outerWidth,
        this.rows(),
        this.scroll,
        this.showHints,
        this.appearance.border,
      );
    }
    const bar =
      width < 120
        ? `${this.mode === "actions" ? "›" : "·"}${actions[this.action] ?? "Annotate"}`
        : actions
            .map(
              (label, index) =>
                `${this.mode === "actions" && this.action === index ? "›" : ""}${label}`,
            )
            .join(" | ");
    let help = "↑↓: block · PgUp/PgDn: scroll · Enter: annotate · Tab: actions";
    if (this.armed) {
      help = "Press Esc again to close; drafts retained";
    } else if (this.mode === "actions") {
      help = "Arrows: action · Enter: activate · Tab: document";
    }
    const footer = [
      this.error,
      `Block ${String(this.block + 1)}: ${this.blocks(review.markdown)[this.block]?.excerpt.split(/\r?\n/)[0] ?? ""}`,
      bar,
      ...(this.showHints ? [help, "[ / ]: revisions · F1: hints · Esc: close"] : []),
      ...(!this.showHints || this.switchView === undefined ? [] : ["Ctrl+P: presenter"]),
    ];
    if (this.current() && hasReviewNotes(review)) {
      footer.unshift("Unsent notes: send feedback or discard before approval.");
    }
    return modalLines(
      title,
      this.documentLines(width),
      footer,
      outerWidth,
      this.rows(),
      this.resizedScroll ?? this.scroll,
      this.showHints,
      this.appearance.border,
    );
  }
}
