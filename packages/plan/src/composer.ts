import { join } from "node:path";

import { CustomEditor, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";

import { isPlanShortcut } from "./config.ts";
import type { PlanRuntime } from "./runtime.ts";

const normalize = (key: string) => key.toLowerCase().split("+").toSorted().join("+");

export function shortcutConflict(
  keys: KeybindingsManager,
  shortcut: KeyId,
  data?: string,
): string | undefined {
  return Object.entries(keys.getResolvedBindings()).find(([action, binding]) => {
    const composer =
      action.startsWith("tui.editor.") ||
      action.startsWith("tui.input.") ||
      action.startsWith("tui.select.") ||
      /^(?:app\.(?:interrupt|clear|exit|suspend|editor\.|message\.|clipboard\.|tools\.|model\.)|app\.thinking\.(?:cycle|toggle)$|app\.session\.(?:new|tree|fork|resume)$)/u.test(
        action,
      );
    const bindings = Array.isArray(binding) ? binding : [binding];
    return (
      composer &&
      bindings.some(
        (key) =>
          typeof key === "string" &&
          (normalize(key) === normalize(shortcut) ||
            (data !== undefined && isPlanShortcut(key) && matchesKey(data, key))),
      )
    );
  })?.[0];
}

export function shortcutWarning(shortcut: string, conflict: string): string {
  return `Planning shortcut ${shortcut} is blocked by Pi's ${conflict}. Rebind ${conflict} in ${join(getAgentDir(), "keybindings.json")}, then run /reload. Use /plan until the conflict is cleared.`;
}

export function installPlanComposer(ctx: ExtensionContext, runtime: PlanRuntime): () => void {
  if (ctx.mode !== "tui") {
    return () => undefined;
  }
  let active = true;
  let lastWarning: string | undefined;
  const previous = ctx.ui.getEditorComponent();
  const editors = new Map<
    ReturnType<NonNullable<typeof previous>>,
    { original: (data: string) => void; wrapped: (data: string) => void }
  >();
  const factory: NonNullable<typeof previous> = (tui, theme, keybindings) => {
    const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
    if (!active || editors.has(editor)) {
      return editor;
    }
    const original = editor.handleInput;
    const update = (data?: string) => {
      const shortcut = runtime.shortcut;
      const conflict =
        shortcut === null ? undefined : shortcutConflict(keybindings, shortcut, data);
      let label: string | undefined;
      if (shortcut !== null) {
        label = conflict === undefined ? shortcut : `${shortcut} blocked`;
      }
      runtime.setShortcutStatus(ctx, label);
      const warning =
        conflict === undefined || shortcut === null
          ? undefined
          : shortcutWarning(shortcut, conflict);
      if (warning !== undefined && warning !== lastWarning) {
        ctx.ui.notify(warning, "warning");
      }
      lastWarning = warning;
      return conflict;
    };
    update();
    const wrapped = (data: string) => {
      const shortcut = runtime.shortcut;
      const pressed = shortcut !== null && matchesKey(data, shortcut);
      const conflict = active ? update(pressed ? data : undefined) : undefined;
      if (active && pressed && conflict === undefined) {
        runtime.toggleMode(ctx);
        tui.requestRender();
      } else {
        original.call(editor, data);
      }
    };
    editors.set(editor, { original, wrapped });
    editor.handleInput = wrapped;
    return editor;
  };
  ctx.ui.setEditorComponent(factory);
  return () => {
    active = false;
    for (const [editor, handlers] of editors) {
      if (editor.handleInput === handlers.wrapped) {
        editor.handleInput = handlers.original;
      }
    }
    editors.clear();
    if (ctx.ui.getEditorComponent() === factory) {
      ctx.ui.setEditorComponent(previous);
    }
  };
}
