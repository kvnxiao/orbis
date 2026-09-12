import { join } from "node:path";

import { CustomEditor, getAgentDir, rawKeyHint } from "@earendil-works/pi-coding-agent";
import type {
  AppKeybinding,
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";

import { isPlanShortcut, normalizePlanKey } from "../storage/config.ts";
import type { PlanRuntime } from "./runtime.ts";

const composerActions = [
  "app.interrupt",
  "app.clear",
  "app.exit",
  "app.suspend",
  "app.editor.external",
  "app.message.copy",
  "app.message.followUp",
  "app.message.dequeue",
  "app.clipboard.pasteImage",
  "app.tools.expand",
  "app.model.cycleForward",
  "app.model.cycleBackward",
  "app.model.select",
  "app.thinking.cycle",
  "app.thinking.save",
  "app.thinking.toggle",
  "app.session.new",
  "app.session.tree",
  "app.session.fork",
  "app.session.resume",
] as const satisfies readonly AppKeybinding[];

/** Find a conflicting host binding, including equivalent terminal encodings. */
export function shortcutConflict(
  keys: Pick<KeybindingsManager, "getResolvedBindings">,
  shortcut: KeyId,
): string | undefined {
  const parts = shortcut.toLowerCase().split("+");
  const character = parts.find((part) => part !== "ctrl");
  const candidate =
    parts.length === 2 && parts.includes("ctrl") && character?.length === 1
      ? String.fromCharCode(character === "-" ? 31 : character.toUpperCase().charCodeAt(0) & 31)
      : undefined;
  const controlInput =
    candidate !== undefined && matchesKey(candidate, shortcut) ? candidate : undefined;
  return Object.entries(keys.getResolvedBindings()).find(([action, binding]) => {
    const composer =
      action.startsWith("tui.editor.") ||
      action.startsWith("tui.input.") ||
      action.startsWith("tui.select.") ||
      composerActions.some((id) => id === action);
    const bindings = Array.isArray(binding) ? binding : [binding];
    return (
      composer &&
      bindings.some(
        (key) =>
          typeof key === "string" &&
          (normalizePlanKey(key) === normalizePlanKey(shortcut) ||
            (controlInput !== undefined && isPlanShortcut(key) && matchesKey(controlInput, key))),
      )
    );
  })?.[0];
}

/** Include the conflicting host action and its keybindings file in the warning. */
export function shortcutWarning(shortcut: string, conflict: string): string {
  return `Planning shortcut ${shortcut} is blocked by Pi's ${conflict}. Rebind ${conflict} in ${join(getAgentDir(), "keybindings.json")}, then run /reload. Use /plan until the conflict is cleared.`;
}

/** Register the configured shortcut and preserve the existing editor factory. */
export function installPlanComposer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  runtime: PlanRuntime,
  reloadBindings = false,
): () => void {
  if (ctx.mode !== "tui") {
    return () => undefined;
  }
  let active = true;
  let registered = false;
  const shortcut = runtime.shortcut;
  const previous = ctx.ui.getEditorComponent();
  const factory: NonNullable<typeof previous> = (tui, theme, keys) => {
    if (reloadBindings) {
      keys.reload();
      reloadBindings = false;
    }
    const editor = previous?.(tui, theme, keys) ?? new CustomEditor(tui, theme, keys);
    if (!active) {
      return editor;
    }
    const conflict = shortcut === null ? undefined : shortcutConflict(keys, shortcut);
    runtime.setShortcutStatus(
      ctx,
      shortcut === null
        ? undefined
        : stripTerminalSequences(
            rawKeyHint(shortcut, conflict === undefined ? "" : "blocked; use /plan"),
          ).trim(),
    );
    if (conflict !== undefined && shortcut !== null) {
      ctx.ui.notify(shortcutWarning(shortcut, conflict), "warning");
    } else if (!registered && shortcut !== null) {
      registered = true;
      pi.registerShortcut(shortcut, {
        description: "Switch between Plan and Default modes",
        handler(current) {
          if (active && shortcutConflict(keys, shortcut) === undefined) {
            runtime.toggleMode(current);
          }
        },
      });
    }
    return editor;
  };
  ctx.ui.setEditorComponent(factory);
  return () => {
    active = false;
    if (ctx.ui.getEditorComponent() === factory) {
      ctx.ui.setEditorComponent(previous);
    }
  };
}
