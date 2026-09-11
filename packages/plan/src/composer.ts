import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

import type { PlanRuntime } from "./runtime.ts";

export function installPlanComposer(ctx: ExtensionContext, runtime: PlanRuntime): () => void {
  if (ctx.mode !== "tui") {
    return () => undefined;
  }
  let active = true;
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
    const wrapped = (data: string) => {
      if (active && matchesKey(data, "shift+tab")) {
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
