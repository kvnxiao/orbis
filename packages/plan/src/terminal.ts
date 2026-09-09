import { randomUUID } from "node:crypto";

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { RoundAction, RoundState, ReviewAction } from "./state.ts";

export class TerminalRound implements Component {
  private readonly input = new Input({ prompt: "> " });
  private mode: "options" | "custom" | "clarify" | "review" = "options";
  private option = 0;
  private scroll = 0;
  private error = "";
  private closed = false;
  focused = true;

  private readonly read: () => RoundState;
  private readonly dispatch: (action: RoundAction) => void;
  private readonly done: () => void;
  private readonly refresh: () => void;
  private readonly rows: number;
  private readonly switchView: () => void;

  constructor(
    read: () => RoundState,
    dispatch: (action: RoundAction) => void,
    done: () => void,
    refresh: () => void,
    rows = 24,
    switchView: () => void = () => undefined,
  ) {
    this.read = read;
    this.dispatch = dispatch;
    this.done = done;
    this.refresh = refresh;
    this.rows = rows;
    this.switchView = switchView;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private send(action: RoundAction) {
    this.dispatch(action);
    this.error = "";
    if (this.read().phase !== "round") {
      this.close();
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.done();
    }
  }

  handleInput(data: string): void {
    if (this.closed) {
      return;
    }
    const round = this.read().round;
    const question = round?.questions.find((item) => item.id === round.focus);
    if (round === undefined || question === undefined) {
      return;
    }
    try {
      if (matchesKey(data, "ctrl+b")) {
        this.switchView();
      } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
        const index = round.questions.findIndex((item) => item.id === question.id);
        const next =
          round.questions[
            (index + (matchesKey(data, "tab") ? 1 : -1) + round.questions.length) %
              round.questions.length
          ];
        if (next !== undefined) {
          this.send({ type: "focus", questionId: next.id });
        }
        this.mode = "options";
        this.option = 0;
        this.scroll = 0;
      } else if (matchesKey(data, "escape")) {
        this.send({ type: "cancel" });
      } else if (matchesKey(data, "pageDown")) {
        this.scroll += Math.max(1, this.rows - 12);
      } else if (matchesKey(data, "pageUp")) {
        this.scroll = Math.max(0, this.scroll - Math.max(1, this.rows - 12));
      } else if (matchesKey(data, "ctrl+r")) {
        this.mode = this.mode === "review" ? "options" : "review";
        this.scroll = 0;
      } else if (this.mode === "review") {
        if (matchesKey(data, "ctrl+s")) {
          this.send({ type: "submit" });
        }
      } else if (matchesKey(data, "ctrl+q")) {
        this.mode = "clarify";
        this.input.setValue("");
      } else if (matchesKey(data, "ctrl+e")) {
        this.mode = "custom";
        this.input.setValue(round.drafts[question.id]?.unfinished ?? "");
      } else if (this.mode === "custom" || this.mode === "clarify") {
        if (matchesKey(data, "enter")) {
          if (this.mode === "custom") {
            this.send({
              type: "answer",
              questionId: question.id,
              answer: { custom: this.input.getValue() },
            });
            this.mode = "options";
          } else {
            this.send({
              type: "clarify",
              questionId: question.id,
              request: this.input.getValue(),
              id: randomUUID(),
            });
          }
        } else {
          this.input.handleInput(data);
          if (this.mode === "custom") {
            this.send({ type: "edit", questionId: question.id, unfinished: this.input.getValue() });
          }
        }
      } else if (matchesKey(data, "up")) {
        this.option = Math.max(0, this.option - 1);
      } else if (matchesKey(data, "down")) {
        this.option = Math.min(Math.max(0, question.options.length - 1), this.option + 1);
      } else if (matchesKey(data, "enter")) {
        const option = question.options[this.option];
        if (option !== undefined) {
          this.send({ type: "answer", questionId: question.id, answer: { optionId: option.id } });
        }
      } else if (matchesKey(data, "ctrl+a") && question.recommendation !== undefined) {
        this.send({
          type: "answer",
          questionId: question.id,
          answer: { optionId: question.recommendation.optionId },
        });
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }

  render(width: number): string[] {
    const state = this.read();
    const round = state.round;
    const question = round?.questions.find((item) => item.id === round.focus);
    if (round === undefined || question === undefined) {
      return ["No active round."];
    }
    const draft = round.drafts[question.id];
    const prose =
      this.mode === "review"
        ? round.questions
            .map((item) => {
              const answer = round.drafts[item.id];
              return `### ${item.prompt}\n${answer?.answer === undefined ? "Unanswered" : answer.revision !== item.revision ? "Changed question: reconfirm answer" : JSON.stringify(answer.answer)}`;
            })
            .join("\n\n")
        : `## ${question.prompt}\n\n${question.context}\n\n${question.options.map((item, index) => `${index === this.option ? "→" : " "} **${item.label}**${draft?.answer?.optionId === item.id ? " [selected]" : ""}\n\n${item.explanation}`).join("\n\n")}\n\n${question.recommendation === undefined ? "" : `Recommendation: ${question.options.find((item) => item.id === question.recommendation?.optionId)?.label ?? ""}. ${question.recommendation.reason}`}\n\n${round.clarifications
            .filter((item) => item.questionId === question.id)
            .map(
              (item) =>
                `**Clarification:** ${item.request}\n\n${item.response ?? "Awaiting main-agent response"}`,
            )
            .join(
              "\n\n",
            )}\n\n${draft !== undefined && draft.revision !== question.revision ? "Question changed: reconfirm your answer." : ""}\n\nDraft: ${draft?.answer === undefined ? "Unanswered" : JSON.stringify(draft.answer)}`;
    const content = new Markdown(prose, 0, 0, getMarkdownTheme()).render(width);
    const height = Math.max(1, this.rows - 10);
    this.scroll = Math.min(this.scroll, Math.max(0, content.length - height));
    this.input.focused = this.focused;
    return [
      `Plan: ${state.phase} • round ${String(round.revision)}`,
      round.questions
        .map(
          (item) =>
            `${item.id === question.id ? ">" : ""}${item.id} ${round.drafts[item.id]?.answer === undefined ? "○" : "●"}`,
        )
        .join(" | "),
      ...content.slice(this.scroll, this.scroll + height),
      ...(this.mode === "custom" || this.mode === "clarify"
        ? [
            `${this.mode === "custom" ? "Custom answer" : "Clarification request"} (Enter confirms)`,
            ...this.input.render(width),
          ]
        : []),
      this.error,
      "Tab/Shift+Tab: questions • ↑/↓: options • Enter: select",
      "Ctrl+A: accept recommendation • Ctrl+E: custom • Ctrl+Q: clarify",
      "Ctrl+R: review/back • Ctrl+S: submit from review • Esc: cancel",
      "PgUp/PgDn: scroll • Ctrl+B: browser • Drafts remain unsubmitted",
    ].map((line) => truncateToWidth(line, width));
  }
}

export async function terminalRound(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: RoundAction) => void,
  signal?: AbortSignal,
  switchView: () => void = () => undefined,
): Promise<void> {
  await ctx.ui.custom<undefined>((tui, _theme, _keys, done) => {
    const component = new TerminalRound(
      read,
      dispatch,
      () => {
        done(undefined);
      },
      () => {
        tui.requestRender();
      },
      tui.terminal.rows,
      switchView,
    );
    const abort = () => {
      component.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) {
      component.close();
    }
    return {
      render: (width) => component.render(width),
      handleInput: (data) => {
        component.handleInput(data);
      },
      invalidate: () => {
        component.invalidate();
      },
      dispose: () => {
        signal?.removeEventListener("abort", abort);
      },
    };
  });
}

export async function terminalReview(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: ReviewAction) => void,
  signal?: AbortSignal,
  switchView: () => void = () => undefined,
): Promise<void> {
  await ctx.ui.custom<undefined>((tui, _theme, _keys, done) => {
    const input = new Input({ prompt: "Changes: " });
    input.focused = true;
    input.setValue(read().reviews?.at(-1)?.feedbackDraft ?? "");
    let editing = false;
    let scroll = 0;
    let error = "";
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        done(undefined);
      }
    };
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted === true) {
      close();
    }
    return {
      render(width) {
        const review = read().reviews?.at(-1);
        if (review === undefined) {
          return ["Plan review is unavailable. Reopen from Pi."];
        }
        const lines = new Markdown(review.markdown, 0, 0, getMarkdownTheme()).render(width);
        const height = Math.max(1, tui.terminal.rows - 9);
        scroll = Math.min(scroll, Math.max(0, lines.length - height));
        return [
          `Plan review · revision ${String(review.revision)}`,
          ...lines.slice(scroll, scroll + height),
          ...(editing ? input.render(width) : []),
          error,
          "PgUp/PgDn: read plan • Ctrl+A: approve this revision",
          "Ctrl+E: changes • Enter: send • Ctrl+B: browser • Esc: cancel",
        ].map((line) => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (closed) {
          return;
        }
        try {
          if (matchesKey(data, "ctrl+b")) {
            switchView();
          } else if (matchesKey(data, "escape")) {
            dispatch({ type: "cancel" });
            close();
          } else if (matchesKey(data, "pageDown")) {
            scroll += Math.max(1, tui.terminal.rows - 9);
          } else if (matchesKey(data, "pageUp")) {
            scroll = Math.max(0, scroll - Math.max(1, tui.terminal.rows - 9));
          } else if (matchesKey(data, "ctrl+a") && !editing) {
            dispatch({ type: "approve" });
            close();
          } else if (matchesKey(data, "ctrl+e")) {
            editing = !editing;
          } else if (editing && matchesKey(data, "enter")) {
            dispatch({ type: "feedback", text: input.getValue() });
            close();
          } else if (editing) {
            input.handleInput(data);
            dispatch({ type: "edit-feedback", text: input.getValue() });
          }
          error = "";
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
        }
        tui.requestRender();
      },
      invalidate(): void {
        input.invalidate();
      },
      dispose() {
        signal?.removeEventListener("abort", close);
      },
    };
  });
}
