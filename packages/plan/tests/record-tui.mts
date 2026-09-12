import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { initTheme, getMarkdownTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  Editor,
  stripTerminalSequences,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";

import {
  presentRound,
  presentReview,
  transitionRound,
  transitionReview,
} from "../src/domain/state.ts";
import type { QuestionInput, RoundState } from "../src/domain/state.ts";
import type { PlanAppearance } from "../src/tui/appearance.ts";
import { defaultAppearance } from "../src/tui/appearance.ts";
import { framedModalLines } from "../src/tui/terminal-layout.ts";
import { TerminalReview } from "../src/tui/terminal-review.ts";
import { TerminalRound } from "../src/tui/terminal-round.ts";

const output = new URL("../implementation/evidence/tui-recordings/", import.meta.url);
const key = {
  down: "\x1b[B",
  up: "\x1b[A",
  right: "\x1b[C",
  enter: "\r",
  shiftEnter: "\x1b[13;2u",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  esc: "\x1b",
  tab: "\t",
};
const questions: QuestionInput[] = [
  {
    id: "scope",
    prerequisites: [],
    prompt: "What should the reminder do?",
    context: "A small CLI for a local project.",
    options: [
      { id: "list", label: "List reminders", explanation: "Print pending reminders." },
      { id: "notify", label: "Notify", explanation: "Show desktop notifications." },
    ],
    recommendation: { optionId: "list", reason: "Easy to test in the terminal." },
  },
  {
    id: "storage",
    prerequisites: [],
    prompt: "Where should reminders be saved?",
    context: "The CLI runs on one computer.",
    options: [
      { id: "file", label: "Project file", explanation: "Save reminders beside the project." },
      { id: "home", label: "User directory", explanation: "Share reminders across projects." },
    ],
    recommendation: { optionId: "file", reason: "Keep the example self-contained." },
  },
];
const markdown =
  "# Reminder CLI\n\nList pending reminders for the current project.\n\n## Approach\n\n- Store reminders in a project JSON file.\n- Print each reminder on its own line.\n\n## Verification\n\nUse a temporary directory and check the printed reminders.\n";
const revisedMarkdown = markdown.replace(
  "Print each reminder on its own line.",
  "Print each reminder on its own line, ordered by creation time.",
);
initTheme("dark", false);
const noop = () => undefined;

interface Frame {
  time: number;
  label: string;
  phase: RoundState["phase"];
  closed: boolean;
  text: string;
  ansi: string;
}
interface Recording {
  id: string;
  title: string;
  width: number;
  height: number;
  frames: Frame[];
}
const recordings: Recording[] = [];

function capture(
  id: string,
  title: string,
  kind: "round" | "review",
  width = 100,
  height = 42,
  appearance: PlanAppearance = defaultAppearance,
) {
  let state =
    kind === "round"
      ? presentRound(
          { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
          { planId: "fixture", roundId: "frontier", expectedRevision: 0, questions },
        )
      : presentReview(
          { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
          { planId: "fixture", expectedRevision: 0, markdown },
        );
  let closed = false;
  const terminal: Terminal = {
    columns: width,
    rows: height + 2,
    kittyProtocolActive: false,
    start: noop,
    stop: noop,
    async drainInput() {
      await Promise.resolve();
    },
    write: noop,
    moveBy: noop,
    hideCursor: noop,
    showCursor: noop,
    clearLine: noop,
    clearFromCursor: noop,
    clearScreen: noop,
    setTitle: noop,
    setProgress: noop,
  };
  const create = () => {
    closed = false;
    const editor = new Editor(new TuiMainScreen(terminal), {
      borderColor: getMarkdownTheme().hr,
      selectList: getSelectListTheme(),
    });
    const done = () => {
      closed = true;
    };
    const rows = () => height - 2;
    if (kind === "round") {
      const revision = state.round?.revision ?? 0;
      return new TerminalRound({
        read: () => state,
        dispatch: (action) => {
          state = transitionRound(state, "frontier", revision, action);
        },
        done: done,
        refresh: noop,
        editor: editor,
        rows: rows,
        appearance: appearance,
      });
    }
    const revision = state.reviews?.at(-1)?.revision ?? 0;
    return new TerminalReview({
      read: () => state,
      dispatch: (action) => {
        state = transitionReview(state, revision, action);
      },
      done: done,
      refresh: noop,
      editor: editor,
      rows: rows,
      appearance: appearance,
    });
  };
  let view = create();
  const recording: Recording = { id, title, width, height, frames: [] };
  recordings.push(recording);
  function frame(label: string) {
    const lines = closed
      ? ["[Capture harness] Modal closed."]
      : framedModalLines(
          (contentWidth) => view.render(contentWidth),
          width,
          getMarkdownTheme().hr,
          height,
          appearance.border,
        );
    assert(lines.length <= height, `${id}: viewport height exceeded`);
    for (const line of lines) {
      assert(visibleWidth(line) <= width, `${id}: viewport width exceeded`);
    }
    const ansi = lines.join("\r\n").replaceAll(CURSOR_MARKER, "");
    recording.frames.push({
      time: recording.frames.length * 2,
      label,
      phase: state.phase,
      closed,
      text: stripTerminalSequences(ansi),
      ansi,
    });
  }
  frame("Open modal");
  return {
    state: () => state,
    press(name: keyof typeof key) {
      view.handleInput(key[name]);
      frame(name === "esc" ? "Esc" : name.slice(0, 1).toUpperCase() + name.slice(1));
    },
    type(text: string) {
      view.handleInput(text);
      frame(`Type: ${text}`);
    },
    revision(direction: "[" | "]") {
      view.handleInput(direction === "[" ? "\x1bOR" : "\x1bOS");
      frame(direction === "[" ? "F3 — previous revision" : "F4 — next revision");
    },
    reopen(next: RoundState, label: string) {
      state = next;
      view = create();
      frame(label);
    },
    contains(text: string) {
      assert(
        recording.frames.at(-1)?.text.includes(text) === true,
        `${id}: expected screen text ${text}`,
      );
    },
  };
}

const answers = capture(
  "answers",
  "Questions, per-option details and explicit submission",
  "round",
);
answers.type("Keep output local; do not add a service.");
answers.press("enter");
assert.deepEqual(answers.state().round?.drafts.scope?.answer, {
  optionId: "list",
  details: "Keep output local; do not add a service.",
});
answers.press("down");
answers.press("enter");
answers.press("up");
answers.press("enter");
answers.press("tab");
answers.press("down");
answers.press("down");
answers.press("enter");
answers.press("enter");
assert.equal(answers.state().round?.drafts.storage?.answer, undefined);
answers.type("Save to reminders.json in the project.");
answers.press("enter");
for (let i = 0; i < 4; i++) {
  answers.press("down");
}
answers.press("enter");
answers.contains("Submit round");
assert.deepEqual(answers.state().decisions, {});
answers.press("enter");
assert.equal(answers.state().phase, "research");
assert.deepEqual(answers.state().decisions.storage?.answer, {
  custom: "Save to reminders.json in the project.",
});

const missing = capture(
  "unanswered",
  "Missing answer and narrow terminal navigation",
  "round",
  48,
  18,
);
missing.press("down");
missing.press("enter");
for (let i = 0; i < 7; i++) {
  missing.press("down");
}
missing.press("enter");
missing.contains("Question 2");
missing.contains("not answered");
missing.press("enter");
assert.equal(missing.state().phase, "round");
missing.press("tab");
missing.press("tab");
assert.equal(missing.state().round?.focus, "storage");
missing.press("enter");
for (let i = 0; i < 4; i++) {
  missing.press("down");
}
missing.press("enter");
missing.contains("Submit round");

const clarify = capture(
  "clarification",
  "Multiline clarification and scripted agent reply",
  "round",
);
clarify.type("No background service.");
clarify.press("enter");
clarify.press("down");
clarify.press("down");
clarify.press("down");
clarify.press("enter");
clarify.type("Does a project file need setup?");
clarify.press("shiftEnter");
clarify.type("I want the first run to work offline.");
clarify.press("enter");
assert.equal(clarify.state().phase, "round");
clarify.contains("Send clarification");
clarify.press("f1");
clarify.press("f1");
clarify.press("enter");
assert.equal(clarify.state().phase, "clarification");
const request = clarify.state().round?.clarifications.at(-1);
assert(request !== undefined);
clarify.reopen(
  presentRound(clarify.state(), {
    planId: "fixture",
    roundId: "frontier",
    expectedRevision: clarify.state().round?.revision ?? 0,
    questions,
    clarification: {
      id: request.id,
      response:
        "No setup is needed. The CLI creates the project file on its first write and works offline.",
    },
  }),
  "Scripted agent reply; reopen the same frontier",
);
assert.deepEqual(clarify.state().round?.drafts.scope?.answer, {
  optionId: "list",
  details: "No background service.",
});
clarify.contains("No setup is needed");

const feedback = capture(
  "feedback",
  "Block annotations, overall notes and batch feedback",
  "review",
);
feedback.press("down");
feedback.press("enter");
feedback.type("Please state the reminder ordering.");
feedback.press("shiftEnter");
feedback.type("Keep the output deterministic.");
feedback.press("enter");
feedback.press("f2");
feedback.type("Keep the implementation small.");
feedback.press("tab");
feedback.press("right");
feedback.press("enter");
assert.equal(feedback.state().phase, "research");
assert.equal(feedback.state().reviews?.[0]?.markdown, markdown);
assert(
  feedback.state().reviews?.[0]?.feedback?.includes("Keep the implementation small.") === true,
);
feedback.reopen(
  presentReview(feedback.state(), {
    planId: "fixture",
    expectedRevision: 1,
    markdown: revisedMarkdown,
  }),
  "Scripted agent revision; open latest Markdown",
);
feedback.revision("[");
feedback.press("enter");
feedback.contains("read-only");
feedback.revision("]");
feedback.contains("latest");
assert.equal(feedback.state().reviews?.at(-1)?.markdown, revisedMarkdown);

const approval = capture(
  "approval",
  "Approve the displayed plan with supplementary notes",
  "review",
  90,
  28,
);
approval.press("down");
approval.press("enter");
approval.type("Maybe add notifications later.");
approval.press("esc");
approval.press("tab");
approval.contains("Approve with notes");
assert.equal(approval.state().reviews?.[0]?.notes?.[0]?.text, "Maybe add notifications later.");
approval.press("enter");
assert.equal(approval.state().phase, "saving");
assert.equal(approval.state().reviews?.[0]?.markdown, markdown);

const recovery = capture(
  "escape",
  "Nested Escape, close protection and restored drafts",
  "round",
  64,
  22,
);
recovery.press("down");
recovery.press("down");
recovery.press("enter");
recovery.type("A tiny reminder command.");
recovery.press("esc");
recovery.press("esc");
recovery.contains("Press Esc again");
recovery.press("down");
recovery.press("esc");
assert.equal(recovery.state().phase, "round");
recovery.press("esc");
assert.equal(recovery.state().phase, "cancelled");
recovery.reopen(
  { ...structuredClone(recovery.state()), phase: "round" },
  "Restore cancelled draft in memory and reopen modal",
);
recovery.press("up");
recovery.press("enter");
recovery.contains("A tiny reminder");
recovery.contains("command.");
assert.equal(recovery.state().round?.drafts.scope?.unfinished, "A tiny reminder command.");

for (const border of ["rounded", "square", "double", "ascii", "none"] as const) {
  const appearance = capture(
    `border-${border}`,
    `${border} border with inline notes`,
    "round",
    100,
    42,
    { border, symbols: "emoji", showHints: true },
  );
  appearance.type("Keep this choice simple.");
  appearance.press("enter");
  appearance.press("down");
}

await mkdir(output, { recursive: true });
await Promise.all(
  recordings.map(async (recording) => {
    const events: unknown[] = [
      {
        version: 2,
        width: recording.width,
        height: recording.height,
        title: `Mock Pi modal: ${recording.title}`,
        duration: recording.frames.length * 2,
      },
    ];
    for (const frame of recording.frames) {
      events.push([frame.time, "m", frame.label]);
      events.push([frame.time, "o", `\x1b[?25l\x1b[0m\x1b[2J\x1b[H${frame.ansi}`]);
    }
    events.push([recording.frames.length * 2, "o", "\x1b[0m\x1b[?25h"]);
    await writeFile(
      new URL(`${recording.id}.cast`, output),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
  }),
);
await writeFile(new URL("frames.json", output), JSON.stringify(recordings, null, 2) + "\n");
const template = await readFile(new URL("./fixtures/tui-player.html", import.meta.url), "utf8");
const previews = recordings.map((recording) => ({
  id: recording.id,
  title: recording.title,
  width: recording.width,
  height: recording.height,
  frames: recording.frames.map(({ ansi: _ansi, ...frame }) => frame),
}));
const data = JSON.stringify(previews).replaceAll("<", "\\u003c");
await writeFile(
  new URL("index.html", output),
  template.replace("__RECORDINGS__", () => data),
);
console.log(`Recorded modal scenarios: ${fileURLToPath(new URL("index.html", output))}`);
