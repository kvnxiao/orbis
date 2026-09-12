import { rawKeyHint } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

/** Keep extension-owned input bindings independent of host editor overrides. */
export const modalKeys = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  enter: "enter",
  escape: "escape",
  tab: "tab",
  previous: "shift+tab",
  newline: "shift+enter",
  presenter: "ctrl+p",
  pageUp: "pageUp",
  pageDown: "pageDown",
  backspace: "backspace",
} as const satisfies Record<string, KeyId>;

/** Format fixed or effective host bindings with Pi's platform modifier names. */
export function modalKeyHint(key: string, description: string): string {
  const label = key
    .split("/")
    .map((binding) =>
      binding
        .split("+")
        .map((part) => (part === "escape" ? "Esc" : part.charAt(0).toUpperCase() + part.slice(1)))
        .join("+"),
    )
    .join("/");
  return rawKeyHint(`${label}:`, description);
}
