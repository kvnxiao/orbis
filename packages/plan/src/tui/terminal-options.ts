import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Editor } from "@earendil-works/pi-tui";

import type { RoundState } from "../domain/state.ts";
import type { PlanAppearance } from "./appearance.ts";

/** Supply modal input, rendering, and completion capabilities for one owned interaction. */
export interface TerminalOptions<Action> {
  read: () => RoundState;
  dispatch: (action: Action) => void;
  done: () => void;
  refresh: () => void;
  editor: Editor;
  rows?: () => number;
  columns?: () => number;
  switchView?: (() => void) | undefined;
  appearance?: PlanAppearance;
  theme?: Theme;
  keys?: Pick<KeybindingsManager, "getKeys">;
}
