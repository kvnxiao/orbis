import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

import type { RoundState, RoundAction, ReviewAction } from "./state.ts";
import { TerminalReview } from "./terminal-review.ts";
import { TerminalRound } from "./terminal-round.ts";

export { TerminalRound } from "./terminal-round.ts";
export { TerminalReview } from "./terminal-review.ts";

async function show(
  ctx: ExtensionContext,
  create: (
    editor: Editor,
    done: () => void,
    refresh: () => void,
    rows: () => number,
  ) => TerminalRound | TerminalReview,
  signal?: AbortSignal,
): Promise<void> {
  await ctx.ui.custom<undefined>(
    (tui, theme, _keys, done) => {
      const muted = (text: string) => theme.fg("muted", text);
      const editor = new Editor(tui, {
        borderColor: (text) => theme.fg("border", text),
        selectList: {
          selectedPrefix: muted,
          selectedText: muted,
          description: muted,
          scrollInfo: muted,
          noMatch: muted,
        },
      });
      const component = create(
        editor,
        () => {
          done(undefined);
        },
        () => {
          tui.requestRender();
        },
        () => Math.max(6, tui.terminal.rows - 2),
      );
      const abort = () => {
        component.close();
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) {
        component.close();
      }
      return {
        get focused() {
          return component.focused;
        },
        set focused(value: boolean) {
          component.focused = value;
        },
        render: (width) => component.render(width),
        handleInput: (data) => {
          component.handleInput(data);
        },
        invalidate: () => {
          component.invalidate();
        },
        dispose() {
          signal?.removeEventListener("abort", abort);
        },
      };
    },
    { overlay: true, overlayOptions: { width: "96%", maxHeight: "100%", anchor: "center" } },
  );
}

export async function terminalRound(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: RoundAction) => void,
  signal?: AbortSignal,
  switchView?: () => void,
): Promise<void> {
  await show(
    ctx,
    (editor, done, refresh, rows) =>
      new TerminalRound(read, dispatch, done, refresh, editor, rows, switchView),
    signal,
  );
}

export async function terminalReview(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: ReviewAction) => void,
  signal?: AbortSignal,
  switchView?: () => void,
): Promise<void> {
  await show(
    ctx,
    (editor, done, refresh, rows) =>
      new TerminalReview(read, dispatch, done, refresh, editor, rows, switchView),
    signal,
  );
}
