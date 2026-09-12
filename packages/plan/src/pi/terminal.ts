import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

import type { RoundState, RoundAction, ReviewAction } from "../domain/state.ts";
import { defaultAppearance } from "../tui/appearance.ts";
import type { PlanAppearance } from "../tui/appearance.ts";
import { frameContentWidth, framedModalLines } from "../tui/terminal-layout.ts";
import { TerminalReview } from "../tui/terminal-review.ts";
import { TerminalRound } from "../tui/terminal-round.ts";

const waitingIndicators = new WeakMap<ExtensionContext["ui"], symbol>();
const modalWidth = "96%";

async function show(
  ctx: ExtensionContext,
  create: (
    editor: Editor,
    done: () => void,
    refresh: () => void,
    rows: () => number,
    columns: () => number,
    theme: Theme,
    keys: KeybindingsManager,
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
      (tui, theme, keys, done) => {
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
          theme,
          keys,
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

/** Await an abortable question modal and restore the owned working indicator. */
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
    (editor, done, refresh, rows, columns, theme, keys) =>
      new TerminalRound({
        read: read,
        dispatch: dispatch,
        done: done,
        refresh: refresh,
        editor: editor,
        rows: rows,
        switchView: switchView,
        appearance: appearance,
        columns: columns,
        theme: theme,
        keys,
      }),
    signal,
    appearance,
  );
}

/** Await an abortable document modal and restore the owned working indicator. */
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
    (editor, done, refresh, rows, columns, theme, keys) =>
      new TerminalReview({
        read: read,
        dispatch: dispatch,
        done: done,
        refresh: refresh,
        editor: editor,
        rows: rows,
        switchView: switchView,
        appearance: appearance,
        columns: columns,
        theme: theme,
        keys,
      }),
    signal,
    appearance,
  );
}
