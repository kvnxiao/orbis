import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

import { defaultAppearance } from "./config.ts";
import type { PlanAppearance } from "./config.ts";
import type { RoundState, RoundAction, ReviewAction } from "./state.ts";
import { frameContentWidth, framedModalLines } from "./terminal-layout.ts";
import { TerminalReview } from "./terminal-review.ts";
import { TerminalRound } from "./terminal-round.ts";

export { TerminalRound } from "./terminal-round.ts";

const waitingIndicators = new WeakMap<ExtensionContext["ui"], symbol>();
const modalWidth = "96%";
export { TerminalReview } from "./terminal-review.ts";

async function show(
  ctx: ExtensionContext,
  create: (
    editor: Editor,
    done: () => void,
    refresh: () => void,
    rows: () => number,
    columns: () => number,
  ) => TerminalRound | TerminalReview,
  signal?: AbortSignal,
  appearance: PlanAppearance = defaultAppearance,
): Promise<void> {
  if (signal?.aborted === true) {
    return;
  }
  const owner = Symbol("plan-wait");
  waitingIndicators.set(ctx.ui, owner);
  ctx.ui.setWorkingMessage("Awaiting Plan");
  ctx.ui.setWorkingIndicator({ frames: ["◴", "◷", "◶", "◵"], intervalMs: 350 });
  const restore = () => {
    if (waitingIndicators.get(ctx.ui) === owner) {
      waitingIndicators.delete(ctx.ui);
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
    }
  };
  signal?.addEventListener("abort", restore, { once: true });
  try {
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
          () => Math.max(6, tui.terminal.rows - 4),
          () =>
            frameContentWidth(
              Math.floor((tui.terminal.columns * Number.parseFloat(modalWidth)) / 100),
              tui.terminal.rows,
              appearance.border,
            ),
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
          render: (width) =>
            framedModalLines(
              (contentWidth) => component.render(contentWidth),
              width,
              (text) => theme.fg("border", text),
              tui.terminal.rows,
              appearance.border,
            ),
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
      {
        overlay: true,
        overlayOptions: {
          width: modalWidth,
          maxHeight: "100%",
          anchor: "center",
        },
      },
    );
  } finally {
    signal?.removeEventListener("abort", restore);
    restore();
  }
}

export async function terminalRound(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: RoundAction) => void,
  signal?: AbortSignal,
  switchView?: () => void,
  appearance: PlanAppearance = defaultAppearance,
): Promise<void> {
  await show(
    ctx,
    (editor, done, refresh, rows, columns) =>
      new TerminalRound(
        read,
        dispatch,
        done,
        refresh,
        editor,
        rows,
        switchView,
        appearance,
        columns,
      ),
    signal,
    appearance,
  );
}

export async function terminalReview(
  ctx: ExtensionContext,
  read: () => RoundState,
  dispatch: (action: ReviewAction) => void,
  signal?: AbortSignal,
  switchView?: () => void,
  appearance: PlanAppearance = defaultAppearance,
): Promise<void> {
  await show(
    ctx,
    (editor, done, refresh, rows, columns) =>
      new TerminalReview(
        read,
        dispatch,
        done,
        refresh,
        editor,
        rows,
        switchView,
        appearance,
        columns,
      ),
    signal,
    appearance,
  );
}
