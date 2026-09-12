import { rawKeyHint } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  matchesKey,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import type {
  Component,
  Editor,
  Keybinding,
  KeybindingsManager,
  KeyId,
} from "@earendil-works/pi-tui";

const hostActions = {
  up: "tui.select.up",
  down: "tui.select.down",
  enter: "tui.select.confirm",
  escape: "tui.select.cancel",
  tab: "tui.input.tab",
  finish: "tui.input.submit",
  newline: "tui.input.newLine",
  cursorUp: "tui.editor.cursorUp",
  cursorDown: "tui.editor.cursorDown",
  pageUp: "tui.select.pageUp",
  pageDown: "tui.select.pageDown",
  backspace: "tui.editor.deleteCharBackward",
} as const satisfies Record<string, Keybinding>;

const extensionKeys = {
  left: "left",
  right: "right",
  previous: "shift+tab",
  presenter: "ctrl+p",
  hints: "f1",
  overall: "f2",
  older: "f3",
  newer: "f4",
} as const satisfies Record<string, KeyId>;

type ModalAction = keyof typeof hostActions | keyof typeof extensionKeys;

const nativeAlternateNewline = "alt+enter" satisfies KeyId;
const kittyFunctionInputs = new Map([
  [57364, "\x1bOP"],
  [57365, "\x1bOQ"],
  [57366, "\x1bOR"],
  [57367, "\x1bOS"],
]);

function normalizeInput(data: string): string {
  if (!data.startsWith("\x1b[")) {
    return data;
  }
  const payload = data.slice(2);
  const kitty = /^(5736[4-7])(?:;1(?::[123])?)?u$/u.exec(payload);
  if (kitty?.[1] !== undefined) {
    return kittyFunctionInputs.get(Number(kitty[1])) ?? data;
  }
  return payload === "13;2~" ? "\x1b[13;2u" : data;
}

function isHostAction(action: ModalAction): action is keyof typeof hostActions {
  return Object.hasOwn(hostActions, action);
}

/** Match and label modal actions through the same effective bindings. */
export class ModalKeybindings {
  private readonly host: KeybindingsManager;
  private readonly isEditing: () => boolean;
  constructor(host: KeybindingsManager = getKeybindings(), isEditing: () => boolean = () => false) {
    this.host = host;
    this.isEditing = isEditing;
  }

  matches(data: string, action: ModalAction): boolean {
    const input = normalizeInput(data);
    if (isHostAction(action)) {
      return this.host.matches(input, hostActions[action]);
    }
    return this.extensionAvailable(action) && matchesKey(input, extensionKeys[action]);
  }

  private extensionAvailable(action: keyof typeof extensionKeys): boolean {
    const nativeConflict =
      this.isEditing() &&
      Object.entries(this.host.getResolvedBindings()).some(
        ([id, bindings]) =>
          id.startsWith("tui.editor.") &&
          (Array.isArray(bindings) ? bindings : [bindings]).some(
            (key) => key?.toLowerCase() === extensionKeys[action].toLowerCase(),
          ),
      );
    return (
      !nativeConflict &&
      !Object.values(hostActions).some((id) =>
        this.host
          .getKeys(id)
          .some((key) => key.toLowerCase() === extensionKeys[action].toLowerCase()),
      )
    );
  }

  edit(editor: Editor, data: string): void {
    if (this.matches(data, "newline")) {
      editor.insertTextAtCursor("\n");
    } else if (
      !TUI_KEYBINDINGS[hostActions.newline].defaultKeys.some((key) =>
        matchesKey(normalizeInput(data), key),
      ) &&
      !matchesKey(data, nativeAlternateNewline)
    ) {
      this.input(editor, data);
    }
  }

  input(component: Component, data: string): void {
    // Pi's native components read the global manager; keep the override synchronous.
    const previous = getKeybindings();
    setKeybindings(this.host);
    try {
      component.handleInput?.(normalizeInput(data));
    } finally {
      setKeybindings(previous);
    }
  }

  hint(action: ModalAction | ModalAction[], description: string, compact = false): string {
    const keys = (Array.isArray(action) ? action : [action]).flatMap((item) => {
      if (isHostAction(item)) {
        return this.host.getKeys(hostActions[item]).slice(0, compact ? 1 : undefined);
      }
      return this.extensionAvailable(item) ? [extensionKeys[item]] : [];
    });
    const label = keys
      .map((key) =>
        key
          .split("+")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("+"),
      )
      .join("/");
    return keys.length === 0
      ? ""
      : rawKeyHint(`${label}${description.length > 0 ? ":" : ""}`, description);
  }
}
