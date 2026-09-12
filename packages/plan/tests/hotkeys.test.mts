import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
} from "@earendil-works/pi-tui";
import type { KeybindingsConfig } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import {
  presentReview,
  presentRound,
  transitionReview,
  transitionRound,
} from "../src/domain/state.ts";
import type { RoundState } from "../src/domain/state.ts";
import { TerminalReview } from "../src/tui/terminal-review.ts";
import { TerminalRound } from "../src/tui/terminal-round.ts";
import { testEditor } from "./terminal-fixture.mts";

function fixture(kind: "round" | "review", bindings: KeybindingsConfig = {}) {
  const initial: RoundState = {
    phase: "research",
    roundNumber: 0,
    questionNumbers: {},
    decisions: {},
  };
  let state =
    kind === "review"
      ? presentReview(initial, {
          planId: "plan",
          expectedRevision: 0,
          markdown: "# Plan\n\nContent",
        })
      : presentRound(initial, {
          planId: "plan",
          roundId: "round",
          expectedRevision: 0,
          questions: [
            {
              id: "q",
              prompt: "Choose",
              context: "Context",
              prerequisites: [],
              options: [
                { id: "a", label: "A", explanation: "First" },
                { id: "b", label: "B", explanation: "Second" },
              ],
              recommendation: { optionId: "a", reason: "Local choice" },
            },
          ],
        });
  const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
  const options = {
    read: () => state,
    editor: testEditor(),
    keys,
    done: () => undefined,
    refresh: () => undefined,
    columns: () => 240,
  };
  const view =
    kind === "review"
      ? new TerminalReview({
          ...options,
          dispatch: (action) => {
            state = transitionReview(state, 1, action);
          },
        })
      : new TerminalRound({
          ...options,
          dispatch: (action) => {
            state = transitionRound(state, "round", 1, action);
          },
        });
  return {
    view,
    keys,
    state: () => state,
    text: () =>
      kind === "review" ? state.reviews?.[0]?.notes?.[0]?.text : state.round?.drafts.q?.options?.a,
    rendered: (width = 240) => stripTerminalSequences(view.render(width).join("\n")),
  };
}

test.for(["round", "review"] as const)(
  "%s fields accept both default newline keys and Enter finishes without submission",
  (kind) => {
    const f = fixture(kind);
    for (const input of [
      "one",
      "\x1b[13;2u",
      "two",
      "\n",
      "three",
      "\x1b[106;5u",
      "four",
      "\x1b[13;2~",
      "five",
    ]) {
      f.view.handleInput(input);
    }
    expect(f.text()).toBe("one\ntwo\nthree\nfour\nfive");
    expect(f.rendered()).toContain("Shift+Enter/Ctrl+J: newline");
    f.view.handleInput("\r");
    expect(f.state().phase).toBe(kind);
    expect(f.rendered()).not.toContain(": newline");
  },
);

test.for(["round", "review"] as const)(
  "%s uses injected newline and finish bindings independently of global bindings",
  (kind) => {
    const f = fixture(kind, { "tui.input.newLine": "ctrl+n", "tui.input.submit": "ctrl+s" });
    for (const input of ["one", "\x0e", "two", "\n", "\x1b[13;2u", "\x1b\r", "\x1b[13;2~"]) {
      f.view.handleInput(input);
    }
    expect(f.text()).toBe("one\ntwo");
    expect(f.rendered()).toContain("Ctrl+N: newline");
    expect(f.rendered()).toContain("Ctrl+S:");
    expect(f.rendered()).not.toContain("Shift+Enter");
    expect(f.rendered()).not.toContain("Ctrl+J");
    f.view.handleInput("\x13");
    expect(f.rendered()).not.toContain(": newline");
    expect(f.state().phase).toBe(kind);
  },
);

test.for(["round", "review"] as const)(
  "%s omits disabled newline and cancel hints and rejects their default keys",
  (kind) => {
    const f = fixture(kind, { "tui.input.newLine": [], "tui.select.cancel": [] });
    for (const input of ["draft", "\x1b\r", "\x1b[13;2~", "\n", "\x1b[13;2u", "\x1b", "\x1b"]) {
      f.view.handleInput(input);
    }
    expect(f.text()).toBe("draft");
    expect(f.state().phase).toBe(kind);
    expect(f.rendered()).not.toContain(": newline");
    expect(f.rendered()).not.toContain("Escape");
  },
);

test.for(["round", "review"] as const)("%s preserves Kitty function-key input", (kind) => {
  const f = fixture(kind);
  expect(f.rendered()).toContain("F1: hints");
  f.view.handleInput("\x1b[57364u");
  expect(f.rendered()).not.toContain("F1: hints");
  f.view.handleInput("\x1b[57364;1u");
  expect(f.rendered()).toContain("F1: hints");
});

test.for(["round", "review"] as const)(
  "%s native editor honors injected movement bindings and restores global input",
  (kind) => {
    const f = fixture(kind, { "tui.editor.cursorLeft": "ctrl+r" });
    f.view.handleInput("ab");
    f.view.handleInput("\x12");
    f.view.handleInput("X");
    expect(f.text()).toBe("aXb");
    const other = fixture(kind);
    other.view.handleInput("ab");
    other.view.handleInput("\x1b[D");
    other.view.handleInput("Y");
    expect(other.text()).toBe("aYb");
  },
);

test("a host binding takes precedence over a modal-owned function key and its hint", () => {
  const f = fixture("round", { "tui.select.down": "f1" });
  f.view.handleInput("\x1bOP");
  expect(f.rendered()).toContain("F1: move");
  expect(f.rendered()).not.toContain("F1: hints");
  f.view.handleInput("\r");
  expect(f.state().round?.drafts.q?.answer).toEqual({ optionId: "b" });
});

test("empty fields use the editor movement binding to return to adjacent rows", () => {
  const f = fixture("round", { "tui.editor.cursorDown": "ctrl+r", "tui.select.down": "ctrl+n" });
  f.view.handleInput("x");
  f.view.handleInput("\x7f");
  f.view.handleInput("\x12");
  f.view.handleInput("\r");
  expect(f.state().round?.drafts.q?.answer).toEqual({ optionId: "b" });
});

test.for(["round", "review"] as const)(
  "%s editor movement takes precedence over the hints shortcut",
  (kind) => {
    const f = fixture(kind, { "tui.editor.cursorLeft": "f1" });
    f.view.handleInput("ab");
    expect(f.rendered()).not.toContain("F1: hints");
    f.view.handleInput("\x1bOP");
    f.view.handleInput("X");
    expect(f.text()).toBe("aXb");
    expect(f.rendered()).toContain(": newline");
  },
);

test("round selection follows updated host bindings and labels without accepting navigation as an answer", () => {
  const f = fixture("round", { "tui.select.down": "ctrl+n", "tui.select.confirm": "ctrl+s" });
  f.view.handleInput("\x0e");
  expect(f.state().round?.drafts.q?.answer).toBeUndefined();
  expect(f.rendered()).toContain("Ctrl+N: move");
  expect(f.rendered()).toContain("Ctrl+S: toggle/open");
  f.view.handleInput("\x13");
  expect(f.state().round?.drafts.q?.answer).toEqual({ optionId: "b" });
  f.keys.setUserBindings({ "tui.select.cancel": "ctrl+x" });
  f.view.handleInput("\x18");
  expect(f.rendered(18)).toContain("Ctrl+X: close?");
  expect(f.rendered(18)).not.toContain("Escape");
  f.view.handleInput("\x18");
  expect(f.state().phase).toBe("cancelled");
});
