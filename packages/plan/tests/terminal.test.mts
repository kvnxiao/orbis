import { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";

import { documentBlocks } from "../src/blocks.ts";
import type { PlanAppearance } from "../src/config.ts";
import { presentRound, presentReview, transitionRound, transitionReview } from "../src/state.ts";
import type { RoundState } from "../src/state.ts";
import { framedModalLines, markdownLines, modalLines } from "../src/terminal-layout.ts";
import { TerminalRound, TerminalReview } from "../src/terminal.ts";
import { testEditor } from "./terminal-fixture.mts";

const down = "\x1b[B";
const right = "\x1b[C";
const escape = "\x1b";
const enter = "\r";
const tab = "\t";
const shiftEnter = "\x1b[13;2u";

test("F1 overrides configured hints only for the current modal", () => {
  const appearance: PlanAppearance = { symbols: "unicode", border: "rounded", showHints: false };
  const first = roundFixture(appearance);
  expect(text(first.view, 140)).not.toContain("F1: hints");
  keys(first.view, "\x1bOP");
  expect(text(first.view, 140)).toContain("F1: hints");
  const next = roundFixture(appearance);
  expect(text(next.view, 140)).not.toContain("F1: hints");
  const review = reviewFixture("# Plan", appearance);
  const current = review.create();
  expect(text(current, 140)).not.toContain("F1: hints");
  keys(current, "\x1bOP");
  expect(text(current, 140)).toContain("F1: hints");
  expect(text(review.create(), 140)).not.toContain("F1: hints");
  expect(appearance.showHints).toBe(false);
});

test.each([18, 90])(
  "%i-column views hide Escape reminders only when hints are disabled",
  (width) => {
    const round = roundFixture();
    const review = reviewFixture();
    for (const item of [
      { view: round.view, read: round.state },
      { view: review.create(), read: review.state },
    ]) {
      keys(item.view, escape);
      expect(text(item.view, width)).toContain("Press Esc again");
      keys(item.view, "\x1bOP", escape);
      expect(text(item.view, width)).not.toContain("Press Esc again");
      expect(item.read().phase).not.toBe("cancelled");
      keys(item.view, escape);
      expect(item.read().phase).toBe("cancelled");
    }
  },
);

test.each([
  { steps: 2, field: "unfinished" },
  { steps: 3, field: "clarificationDraft" },
] as const)("vertical cursor movement preserves multiline $field text", ({ steps, field }) => {
  const f = roundFixture();
  f.resize(80);
  for (let index = 0; index < steps; index++) {
    keys(f.view, down);
  }
  keys(f.view, "top", shiftEnter, "middle", shiftEnter, "bottom");
  f.view.render(140);
  keys(f.view, "\x1b[A", "!");
  expect(f.state().round?.drafts.scope?.[field]).toBe("top\nmiddle!\nbottom");
});

test("F1 hides frontier hints and divider without losing draft text", () => {
  const f = roundFixture();
  f.resize(80);
  keys(f.view, "Keep this");
  const visible = text(f.view, 140);
  expect(visible).toContain("Shift+Enter: newline");
  keys(f.view, "\x1bOP");
  expect(text(f.view, 140)).not.toContain("Shift+Enter");
  expect(text(f.view, 140)).not.toContain("─".repeat(140));
  expect(text(f.view, 140)).toContain("[notes: Keep this]");
  keys(f.view, "\x1bOP");
  expect(text(f.view, 140)).toBe(visible);
});

test("brainstorm symbols and clarification color distinguish the field roles", () => {
  const f = roundFixture({ symbols: "emoji", border: "rounded" });
  f.resize(80);
  expect(text(f.view, 140)).toContain("❓ 1. Choose scope");
  expect(text(f.view, 140)).toContain("➡️ Recommendation:");
  expect(text(f.view, 140)).not.toContain("💡");
  keys(f.view, down, down, "Answer");
  expect(f.view.render(140).join("\n")).toContain("\x1b[38;2;138;190;183m [answer:");
  keys(f.view, enter, down, "Question");
  expect(f.view.render(140).join("\n")).toContain("\x1b[38;2;129;162;190m [question:");
});

test.for([
  { border: "rounded", glyph: "─" },
  { border: "double", glyph: "═" },
  { border: "ascii", glyph: "-" },
  { border: "none", glyph: "─" },
] as const)(
  "$border question dividers use accent and context is separated from options",
  ({ border, glyph }) => {
    const f = roundFixture({ symbols: "unicode", border });
    f.resize(80);
    const lines = f.view.render(80);
    const plain = lines.map((line) => stripTerminalSequences(line).trimEnd());
    const divider = `\x1b[38;2;138;190;183m${glyph.repeat(78)}\x1b[39m`;
    for (const heading of ["? 1. Choose scope", "? 2. Choose storage"]) {
      expect(lines[plain.indexOf(heading) - 1]).toBe(divider);
    }
    const context = plain.indexOf("Known é 中文 context");
    expect(plain[context + 1]).toBe("");
    expect(plain[context + 2]).toContain("A. Local");
    expect(lines).toContain(`\x1b[38;2;128;128;128m${glyph.repeat(80)}\x1b[39m`);
    keys(f.view, "\x1bOP");
    expect(f.view.render(80).filter((line) => line === divider)).toHaveLength(
      f.state().round?.questions.length ?? 0,
    );
    expect(text(f.view, 80)).not.toContain(glyph.repeat(80));
  },
);

test("option labels are bold before selection and selected rows retain full bold styling", ({
  onTestFinished,
}) => {
  const f = roundFixture();
  f.resize(80);
  const bold = vi
    .spyOn(Theme.prototype, "bold")
    .mockImplementation((value) => `\x1b[1m${value}\x1b[22m`);
  onTestFinished(() => {
    bold.mockRestore();
  });
  f.state().round?.questions[0]?.options.push(
    { id: "hybrid", label: "Hybrid", explanation: "Mixed access" },
    { id: "hosted", label: "Hosted", explanation: "Managed access" },
  );
  const initial = f.view.render(140).join("\n");
  for (const label of [
    "A. Local",
    "B. Remote",
    "C. Hybrid",
    "D. Hosted",
    "E. Other (please specify)",
    "?. Ask for clarification",
  ]) {
    expect(initial).toContain(`\x1b[1m${label}\x1b[22m`);
  }
  expect(initial).toContain("\x1b[22m — Offline");
  expect(f.state().decisions).toEqual({});
  keys(f.view, enter);
  const rendered = f.view.render(140).join("\n");
  expect(rendered.split("\n").find((line) => line.includes("A. Local"))).toContain("\x1b[1m");
  expect(rendered).toContain(
    "\x1b[38;2;138;190;183m\x1b[1m  [ Review answers and submit ]\x1b[22m\x1b[39m",
  );
});

test.for([
  { label: "Local ", paragraphs: ["A. Local"] },
  { label: "First\n\nSecond", paragraphs: ["A. First", "Second"] },
  { label: "Local **files** and `tags`", paragraphs: ["A. Local files and tags"] },
])(
  "option labels preserve Markdown without generated emphasis delimiters: $label",
  ({ label, paragraphs }, { onTestFinished }) => {
    const f = roundFixture();
    f.resize(80);
    const bold = vi
      .spyOn(Theme.prototype, "bold")
      .mockImplementation((value) => `\x1b[1m${value.replaceAll("\x1b[22m", "\x1b[1m")}\x1b[22m`);
    onTestFinished(() => {
      bold.mockRestore();
    });
    const option = f.state().round?.questions[0]?.options[0];
    if (option === undefined) {
      throw new Error("Missing option fixture.");
    }
    option.label = label;
    const rendered = f.view.render(140).join("\n");
    expect(stripTerminalSequences(rendered)).not.toContain("**");
    expect(stripTerminalSequences(rendered)).not.toContain("`tags`");
    for (const paragraph of paragraphs) {
      const line = rendered
        .split("\n")
        .find((value) => stripTerminalSequences(value).includes(paragraph));
      expect(line).toContain("\x1b[1m");
    }
    expect(stripTerminalSequences(rendered)).toContain(" — Offline");
  },
);

test("option explanations wrap around the label and preserve separate Markdown paragraphs", () => {
  const f = roundFixture();
  f.resize(80);
  const option = f.state().round?.questions[0]?.options[0];
  if (option === undefined) {
    throw new Error("Missing option fixture.");
  }
  option.label = "Local storage";
  option.explanation =
    "Keep small files safely on disk with a plain format.\n\nUse `JSON` for export.";
  const lines = f.view.render(40).map((line) => stripTerminalSequences(line).trimEnd());
  const start = lines.indexOf("› A. Local storage — Keep small files");
  expect(start).toBeGreaterThan(-1);
  expect(lines.slice(start, start + 4)).toEqual([
    "› A. Local storage — Keep small files",
    "safely on disk with a plain format.",
    "",
    "Use JSON for export.",
  ]);
});

test("F1 hides review hints while preserving the reachable actions", () => {
  const f = reviewFixture();
  const view = f.create();
  keys(view, "\x1bOP");
  expect(text(view)).not.toContain("PgUp/PgDn");
  expect(text(view)).not.toContain("─".repeat(90));
  expect(text(view)).toContain("Annotate");
  keys(view, tab, right, right, right, enter);
  expect(f.state().phase).toBe("saving");
});

test("starting inline editing preserves modal height and footer position", () => {
  const f = roundFixture();
  f.resize(80);
  const before = f.view.render(140);
  keys(f.view, "x");
  const after = f.view.render(140);
  expect(after).toHaveLength(before.length);
  expect(stripTerminalSequences(after.at(-1) ?? "")).toContain("Esc:");
});

test("Other and clarification use inline suffixes and Enter finishes local editing", () => {
  const f = roundFixture();
  f.resize(80);
  keys(f.view, down, down, enter, "Custom");
  expect(text(f.view, 140)).toContain("C. Other (please specify) [answer: Custom]");
  keys(f.view, shiftEnter, "answer", enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({ custom: "Custom\nanswer" });
  keys(f.view, down, enter, "Explain");
  expect(text(f.view, 140)).toContain("Ask for clarification [question: Explain]");
  expect(text(f.view, 140)).not.toContain("Ask for clarification…");
  keys(f.view, shiftEnter, "this", enter);
  expect(f.state().phase).toBe("round");
  expect(f.view.render(140).join("\n")).not.toContain(CURSOR_MARKER);
  expect(text(f.view, 140)).toContain("Send clarification [question: Explain");
  keys(f.view, enter);
  expect(f.state().round?.clarifications[0]?.request).toBe("Explain\nthis");
});

test("overflow scrollbar shows the viewport at the beginning and end", () => {
  testEditor();
  const content = Array.from({ length: 24 }, (_, index) => `Line ${String(index)}`);
  const render = (scroll: number) =>
    modalLines("Title", content, ["Esc"], 20, 10, scroll).map(stripTerminalSequences);
  const first = render(0);
  expect(first[2]).toBe("Line 0             ┃");
  expect(first[7]).toBe("Line 5             │");
  const last = render(100);
  expect(last[2]).toBe("Line 18            │");
  expect(last[7]).toBe("Line 23            ┃");
  expect(modalLines("Title", ["Fits"], ["Esc"], 20, 10, 0).join("\n")).not.toContain("┃");
});

test.each([6, 8, 12])("%i-row modals keep the final action and note cursor visible", (height) => {
  const f = roundFixture();
  f.resize(height);
  for (let index = 0; index < 8; index++) {
    keys(f.view, down);
  }
  expect(text(f.view, 60)).toContain("Review answers and submit");
  keys(f.view, tab, "A note");
  expect(f.view.render(60).join("\n")).toContain(CURSOR_MARKER);
});

test("question rows omit routine answer status and Right does not open notes", () => {
  const f = roundFixture();
  const initial = text(f.view);
  expect(initial).toMatch(/^Plan questions \(round 1\)\n\n─[^\n]*\n\? 1\. Choose scope/u);
  expect(initial).not.toContain("Unanswered");
  keys(f.view, right);
  expect(text(f.view)).toBe(initial);
  keys(f.view, enter);
  expect(text(f.view)).not.toContain("Answered");
  expect(text(f.view)).toContain("✓ A. Local");
  expect(text(f.view, 200)).toContain("Typing on an option adds notes");
});

test.each(["", "   "])("blank notes %j let arrows leave without confirmation", (blank) => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "x", "\x7f", blank, down);
  expect(text(f.view)).toContain("› B. Remote");
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
  keys(f.view, "x", "\x7f", blank, "\x1b[A");
  expect(text(f.view)).toContain("› A. Local");
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
});

test("notes update the selected answer immediately and Tab navigates questions", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, enter, "Keep local");
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Keep local",
  });
  expect(text(f.view)).not.toContain("Confirm answer");
  keys(f.view, tab);
  expect(f.state().round?.focus).toBe("storage");
  keys(f.view, "Private", "\x1b[Z");
  expect(f.state().round?.focus).toBe("scope");
  expect(f.state().round?.drafts.storage?.answer).toBeUndefined();
  keys(f.view, "\x7f", "\x01", "\x0b", down);
  expect(f.state().round?.drafts.scope?.answer).toEqual({ optionId: "local" });
  expect(text(f.view)).not.toContain("notes: Keep local");
  expect(f.state().decisions).toEqual({});
});

function scopeQuestion(options: { id: string; label: string }[]) {
  return {
    id: "scope",
    prompt: "Choose scope",
    context: "Known context",
    prerequisites: [],
    options: options.map((option) => ({ ...option, explanation: "Explained" })),
    recommendation: { optionId: "local", reason: "Works offline" },
  };
}

test("a revised round that drops the selected option keeps the frontier navigable", () => {
  let state = presentRound(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: [
        scopeQuestion([
          { id: "local", label: "Local" },
          { id: "remote", label: "Remote" },
        ]),
      ],
    },
  );
  state = transitionRound(state, "round", 1, {
    type: "answer",
    questionId: "scope",
    answer: { optionId: "remote" },
  });
  state = presentRound(state, {
    planId: "plan",
    roundId: "round",
    expectedRevision: 1,
    questions: [
      scopeQuestion([
        { id: "local", label: "Local" },
        { id: "hosted", label: "Hosted" },
      ]),
    ],
  });
  expect(state.round?.drafts.scope?.answer).toEqual({ optionId: "remote" });
  const view = new TerminalRound(
    () => state,
    (action) => {
      state = transitionRound(state, "round", state.round?.revision ?? 0, action);
    },
    () => undefined,
    () => undefined,
    testEditor(),
  );
  expect(text(view)).toContain("› A. Local");
  keys(view, down);
  expect(text(view)).toContain("› B. Hosted");
  keys(view, enter);
  expect(state.round?.drafts.scope?.answer).toEqual({ optionId: "hosted" });
  keys(view, escape, escape);
  expect(state.phase).toBe("cancelled");
});

test("notes type directly after the full option and the review action has separate spacing", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "Keep this local");
  const screen = text(f.view, 140);
  expect(screen).toContain("A. Local — Offline [notes: Keep this local");
  expect(screen).not.toContain("Notes (unsubmitted)");
  expect(screen).toMatch(/\n\n[^\n]*Review answers and submit/u);
});

test.each(["", "   "])("cleared or blank notes %j do not appear in the list or preview", (note) => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "Temporary", "\x01", "\x0b", note, enter);
  expect(text(f.view)).not.toContain("notes:");
  keys(f.view, tab, enter);
  for (let i = 0; i < 4; i++) {
    keys(f.view, down);
  }
  keys(f.view, enter);
  const preview = text(f.view);
  expect(preview).toContain("Review answers");
  expect(preview).not.toContain("Details:");
  expect(preview).not.toContain("notes:");
});

test("inline notes preserve cursor edits, literal punctuation, and accent color through preview", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "ab😀cd", "\x1b[D", "\x1b[D", "X");
  expect(text(f.view, 120)).toContain("[notes: ab😀Xcd]");
  // oxlint-disable-next-line no-control-regex -- The assertion checks the ANSI color boundary before the notes suffix.
  expect(f.view.render(120).join("\n")).toMatch(/\u001b\[[\d;]+m \[notes:/u);
  keys(f.view, "\x05", " **literal** [x]", enter);
  expect(text(f.view, 120)).toContain("[notes: ab😀Xcd **literal** [x]]");
  keys(f.view, tab, enter);
  for (let i = 0; i < 4; i++) {
    keys(f.view, down);
  }
  keys(f.view, enter);
  const preview = text(f.view, 120);
  expect(preview).toContain("Local [notes: ab😀Xcd **literal** [x]]");
  expect(preview).not.toContain("Details:");
});

test("Up and Down follow the displayed suffix rows before inserting text", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "one two three four five six seven eight nine ten");
  expect(text(f.view, 40)).toContain("three four five six seven eight nine\nten]");
  keys(f.view, "\x1b[A");
  f.view.render(40);
  keys(f.view, "X");
  expect(f.state().round?.drafts.scope?.options?.local).toBe(
    "one two thrXee four five six seven eight nine ten",
  );
  f.view.render(40);
  keys(f.view, down);
  f.view.render(40);
  keys(f.view, "!");
  expect(f.state().round?.drafts.scope?.options?.local).toBe(
    "one two thrXee four five six seven eight nine ten!",
  );
});

test("reopening another option starts vertical navigation at its own cursor column", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, down, "one two three four five six seven eight nine ten extra", enter);
  keys(f.view, "\x1b[A", "one two three four five six seven eight nine ten");
  f.view.render(42);
  keys(f.view, "\x1b[A", escape, down, "\x7f", "a");
  expect(text(f.view, 42)).toContain("three four five six seven eight nine ten\n extra]");
  keys(f.view, "\x1b[A", "X");
  expect(f.state().round?.drafts.scope?.options?.remote).toBe(
    "one two three Xfour five six seven eight nine ten extra",
  );
});

test("typing and paste open inline option notes without replacing the question list", () => {
  const f = roundFixture();
  f.resize(60);
  keys(f.view, "Keep ", "\x1b[200~é 中文\x1b[201~");
  const rendered = text(f.view, 120);
  expect(rendered).toContain("1. Choose scope");
  expect(rendered).toContain("2. Choose storage");
  expect(rendered).toContain("B. Remote");
  expect(rendered).toContain("Keep é 中文");
  expect(f.view.render(120).join("\n")).toContain(CURSOR_MARKER);
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
  for (const width of [18, 40, 120]) {
    f.resize(8);
    const lines = f.view.render(width);
    expect(lines.join("\n")).toContain(CURSOR_MARKER);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(8);
  }
  keys(f.view, enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Keep é 中文",
  });
  expect(f.state().decisions).toEqual({});
});

test("Other and clarification follow generated choices and precede the recommendation", () => {
  const f = roundFixture();
  f.resize(60);
  const rendered = text(f.view);
  const expected = [
    "A. Local",
    "B. Remote",
    "C. Other",
    "?. Ask for clarification",
    "Recommendation: A.",
  ];
  let previous = -1;
  for (const value of expected) {
    const position = rendered.indexOf(value);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
  expect(rendered).toMatch(/Works offline[^\n]*\n\n─[^\n]*\n\? 2\. Choose storage/u);
  expect(rendered).toContain("Plan questions (round 1)");
});

test.each(["unicode", "emoji"] as const)(
  "selected %s markers persist when the cursor moves",
  (symbols) => {
    const f = roundFixture({ symbols, border: "rounded" });
    keys(f.view, enter);
    const check = symbols === "emoji" ? "✅" : "✓";
    expect(text(f.view)).toContain(`${check} A. Local`);
    expect(text(f.view)).not.toContain("[selected]");
    keys(f.view, down);
    expect(text(f.view)).toContain(`${check} A. Local`);
  },
);

test.each([
  ["rounded", "╭──────╮", "╰──────╯", "─"],
  ["square", "┌──────┐", "└──────┘", "─"],
  ["double", "╔══════╗", "╚══════╝", "═"],
  ["ascii", "+------+", "+------+", "-"],
] as const)(
  "%s frames and dividers preserve exact terminal widths",
  (border, top, bottom, separator) => {
    testEditor();
    const lines = framedModalLines(
      () => ["中文"],
      8,
      (value) => value,
      10,
      border,
    );
    expect(lines[0]).toBe(top);
    expect(lines.at(-1)).toBe(bottom);
    expect(lines.every((line) => visibleWidth(line) === 8)).toBe(true);
    expect(
      stripTerminalSequences(
        modalLines("Title", ["text"], ["Esc"], 8, 8, 0, true, border).join("\n"),
      ),
    ).toContain(separator.repeat(8));
  },
);

test("None omits the outer frame while retaining the content divider", () => {
  testEditor();
  const lines = framedModalLines(
    (width) => modalLines("Title", ["text"], ["Esc"], width, 8, 0, true, "none"),
    8,
    (value) => value,
    10,
    "none",
  );
  expect(lines[0]).toBe("Title");
  expect(stripTerminalSequences(lines.join("\n"))).toContain("─".repeat(8));
});

test("footer dividers stay between scrolled content and controls without consuming the last content row", () => {
  testEditor();
  const content = ["First paragraph", "Second paragraph", "Third paragraph"];
  const footer = ["→Approve", "Esc: back"];
  const render = (rows: number, scroll: number) =>
    stripTerminalSequences(
      modalLines("Review", content, footer, 24, rows, scroll).join("\n"),
    ).split("\n");
  expect(render(5, 0)).toEqual(["Review", "First paragraph        ┃", "─".repeat(24), ...footer]);
  expect(render(5, 1)).toEqual(["Review", "Second paragraph       ┃", "─".repeat(24), ...footer]);
  expect(render(4, 1)).toEqual(["Review", "Second paragraph       ┃", ...footer]);
});

function roundFixture(appearance?: PlanAppearance) {
  let state = presentRound(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: ["scope", "storage"].map((id) => ({
        id,
        prompt: `Choose ${id}`,
        context: "Known é 中文 context",
        prerequisites: [],
        options: [
          { id: "local", label: "Local", explanation: "Offline" },
          { id: "remote", label: "Remote", explanation: "Shared" },
        ],
        recommendation: { optionId: "local", reason: "Works offline" },
      })),
    },
  );
  let closed = false;
  let rows = 24;
  let columns = 90;
  const view = new TerminalRound(
    () => state,
    (action) => {
      state = transitionRound(state, "round", state.round?.revision ?? 0, action);
    },
    () => {
      closed = true;
    },
    () => undefined,
    testEditor(),
    () => rows,
    undefined,
    appearance,
    () => columns,
  );
  const render = view.render.bind(view);
  view.render = (width) => {
    columns = width;
    return render(width);
  };
  return {
    view,
    state: () => state,
    closed: () => closed,
    resize: (height: number) => {
      rows = height;
    },
  };
}

function reviewFixture(
  markdown = "# Plan\n\nKeep these bytes.\n\nKeep these bytes.\n",
  appearance?: PlanAppearance,
) {
  let state: RoundState = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown },
  );
  let closed = false;
  let rows = 24;
  let columns = 90;
  const create = () => {
    const revision = state.reviews?.at(-1)?.revision ?? 0;
    const view = new TerminalReview(
      () => state,
      (action) => {
        state = transitionReview(state, revision, action);
      },
      () => {
        closed = true;
      },
      () => undefined,
      testEditor(),
      () => rows,
      undefined,
      appearance,
      () => columns,
    );
    const render = view.render.bind(view);
    view.render = (width) => {
      columns = width;
      return render(width);
    };
    return view;
  };
  return {
    create,
    state: () => state,
    closed: () => closed,
    set: (next: RoundState) => {
      state = next;
    },
    resize: (height: number) => {
      rows = height;
    },
  };
}

function keys(view: TerminalRound | TerminalReview, ...input: string[]) {
  for (const key of input) {
    view.handleInput(key);
  }
}
function text(view: TerminalRound | TerminalReview, width = 90) {
  return stripTerminalSequences(view.render(width).join("\n"));
}

test("frontier separates keyboard focus from selection, preserves option details, and requires explicit submission", () => {
  const f = roundFixture();
  expect(text(f.view)).toContain("Other (please specify)");
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
  keys(f.view, "Only the CLI", enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Only the CLI",
  });
  keys(f.view, " updated", escape, down, enter, "\x1b[A", enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Only the CLI updated",
  });
  keys(f.view, tab, down, enter);
  expect(f.state().decisions).toEqual({});
  keys(f.view, down, down, down, enter);
  expect(text(f.view)).toContain("Submit round");
  expect(f.closed()).toBe(false);
  keys(f.view, enter);
  expect(f.state().phase).toBe("research");
  expect(f.state().decisions.scope?.answer).toEqual({
    optionId: "local",
    details: "Only the CLI updated",
  });
});

test("unanswered preview identifies missing questions and returns to the next unanswered option", () => {
  const f = roundFixture();
  for (let i = 0; i < 8; i++) {
    keys(f.view, down);
  }
  keys(f.view, enter, enter);
  expect(f.closed()).toBe(false);
  expect(text(f.view)).toContain("UNANSWERED");
  keys(f.view, tab, enter);
  expect(f.state().round?.focus).toBe("scope");
  expect(text(f.view)).toContain("› A. Local");
});

test("Other rejects blank text and nested Escape preserves drafts without arming close", () => {
  const f = roundFixture();
  keys(f.view, down, down, enter, enter);
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
  keys(f.view, "uncertain", escape, escape);
  expect(f.closed()).toBe(false);
  keys(f.view, down, escape);
  expect(f.closed()).toBe(false);
  keys(f.view, escape);
  expect(f.closed()).toBe(true);
  expect(f.state().round?.drafts.scope?.unfinished).toBe("uncertain");
  expect(f.state().decisions).toEqual({});
});

test("clarification Shift+Enter inserts a newline and separate Send records the request", () => {
  const f = roundFixture();
  keys(f.view, down, down, down, enter, "Explain", shiftEnter, "offline", enter);
  expect(f.state().phase).toBe("round");
  expect(f.state().round?.drafts.scope?.clarificationDraft).toBe("Explain\noffline");
  keys(f.view, enter);
  expect(f.state().phase).toBe("clarification");
  expect(f.state().round?.clarifications[0]?.request).toBe("Explain\noffline");
});

test("inline notes cannot edit Markdown and unfinished edits are excluded from the batch preview", () => {
  const f = reviewFixture();
  const view = f.create();
  const original = f.state().reviews?.[0]?.markdown;
  keys(view, down, enter, "Clarify", enter, "this block", tab, enter);
  expect(f.state().reviews?.[0]?.markdown).toBe(original);
  expect(f.state().reviews?.[0]?.notes?.[0]?.confirmed).toBe("Clarify\nthis block");
  keys(view, enter, " unfinished", escape, tab, right, right, enter);
  expect(text(view)).toContain("Unconfirmed edit excluded");
  keys(view, enter);
  expect(f.state().reviews?.[0]?.feedback).toContain("Clarify\nthis block");
  expect(f.state().reviews?.[0]?.feedback).not.toContain("unfinished");
  expect(f.state().phase).toBe("research");
});

test("editing a block note retains surrounding plan text and the review action bar", () => {
  const f = reviewFixture("# Context\n\nTarget paragraph.\n\nFollowing paragraph.");
  f.resize(40);
  const view = f.create();
  keys(view, down, enter, "Inline note");
  const rendered = text(view, 160);
  expect(rendered).toContain("Context");
  expect(rendered).toContain("Target paragraph.");
  expect(rendered).toContain("Following paragraph.");
  expect(rendered.indexOf("Target paragraph.")).toBeLessThan(rendered.indexOf("Inline note"));
  expect(rendered.indexOf("Inline note")).toBeLessThan(rendered.indexOf("Following paragraph."));
  for (const label of [
    "Annotate",
    "Overall feedback",
    "Review feedback",
    "Approve",
    "Discard notes and approve…",
  ]) {
    expect(rendered).toContain(label);
  }
});

test("scrolling above a late annotation target preserves its note and anchor", () => {
  const paragraphs = Array.from({ length: 35 }, (_, index) => `Paragraph ${String(index)}.`);
  const f = reviewFixture(paragraphs.join("\n\n"));
  const view = f.create();
  keys(view, ...Array<string>(28).fill(down));
  expect(text(view)).not.toContain("Paragraph 0.");
  keys(view, ...Array<string>(12).fill("\x1b[5~"));
  expect(text(view)).toContain("Paragraph 0.");
  keys(view, enter, "Retain this target", tab, tab, tab);
  keys(view, ...Array<string>(100).fill("\x1b[A"));
  expect(text(view)).toContain("Paragraph 0.");
  expect(f.state().reviews?.[0]?.notes?.[0]).toMatchObject({
    excerpt: "Paragraph 28.",
    unfinished: "Retain this target",
  });
});

test("focus propagates before rendering and repeated renders preserve subsequent editing", () => {
  const state = presentRound(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: [
        { id: "scope", prerequisites: [], prompt: "Scope?", context: "Known", options: [] },
      ],
    },
  );
  let current = state;
  const editor = testEditor();
  const view = new TerminalRound(
    () => current,
    (action) => {
      current = transitionRound(current, "round", 1, action);
    },
    () => undefined,
    () => undefined,
    editor,
  );
  view.handleInput("Draft");
  expect(editor.focused).toBe(true);
  const before = Object.entries(view).filter(([name]) => name !== "editor");
  view.render(20);
  view.render(120);
  expect(Object.entries(view).filter(([name]) => name !== "editor")).toEqual(before);
  view.focused = false;
  expect(editor.focused).toBe(false);
  expect(view.render(40).join("\n")).not.toContain(CURSOR_MARKER);
  view.focused = true;
  view.handleInput("!");
  expect(current.round?.drafts.scope?.unfinished).toBe("Draft!");
});

test("clarification response is restored beside its question without submitting existing answers", () => {
  const f = roundFixture();
  const existing = f.state();
  const clarified = transitionRound(existing, "round", 1, {
    type: "clarify",
    questionId: "scope",
    id: "request",
    request: "What does local mean?",
  });
  const restored = presentRound(clarified, {
    planId: "plan",
    roundId: "round",
    expectedRevision: 1,
    questions: (existing.round?.questions ?? []).map(
      ({ revision: _revision, number: _number, ...question }) => question,
    ),
    clarification: { id: "request", response: "Local stores data on this device." },
  });
  const view = new TerminalRound(
    () => restored,
    () => undefined,
    () => undefined,
    () => undefined,
    testEditor(),
    () => 80,
  );
  const rendered = text(view, 100);
  expect(rendered).toContain("What does local mean?");
  expect(rendered).toContain("Local stores data on this device.");
  expect(rendered.indexOf("Local stores data")).toBeLessThan(rendered.indexOf("2. Choose storage"));
  expect(restored.round?.submitted).toBe(false);
});

test("unsent notes block approval and discard confirmation requires another explicit action", () => {
  const f = reviewFixture();
  const view = f.create();
  keys(view, enter, "Unsent", escape, tab, right, right, right, enter);
  expect(f.state().phase).toBe("review");
  expect(text(view)).toContain("Send or discard");
  keys(view, right, enter, escape);
  expect(f.state().reviews?.[0]?.notes?.[0]?.unfinished).toBe("Unsent");
  keys(view, tab, enter, enter);
  expect(f.state().phase).toBe("saving");
  expect(f.state().reviews?.[0]?.notes).toEqual([]);
});

test("older revisions reject editing and approval and latest drafts survive revision browsing", () => {
  const f = reviewFixture();
  let state = transitionReview(f.state(), 1, { type: "feedback", text: "Revise" });
  state = presentReview(state, {
    planId: "plan",
    expectedRevision: 1,
    markdown: "# Latest\n\nUpdated text.\n",
  });
  const block = documentBlocks(state.reviews?.at(-1)?.markdown ?? "")[1];
  if (block === undefined) {
    throw new Error("Missing fixture block");
  }
  state = transitionReview(state, 2, {
    type: "edit-note",
    blockId: block.id,
    excerpt: block.excerpt,
    text: "latest draft",
  });
  f.set(state);
  const view = f.create();
  keys(view, "[", enter);
  expect(text(view)).toContain("older");
  expect(text(view)).toContain("read-only");
  keys(view, tab, right, right, right, enter);
  expect(f.state().phase).toBe("review");
  keys(view, tab, "]", down, enter, "[]");
  expect(f.state().reviews?.at(-1)?.notes?.[0]?.unfinished).toBe("latest draft[]");
  expect(f.state().reviews?.at(-1)?.revision).toBe(2);
});

test("stale discard confirmation cannot clear replacement review notes", () => {
  const f = reviewFixture();
  const view = f.create();
  keys(view, tab, right, right, right, right, enter);
  const newer = presentReview(
    transitionReview(f.state(), 1, { type: "feedback", text: "Revise" }),
    { planId: "plan", expectedRevision: 1, markdown: "New plan" },
  );
  f.set(newer);
  keys(view, enter);
  expect(f.state()).toEqual(newer);
  expect(f.closed()).toBe(false);
});

test("older revision browsing still permits consecutive Escape cancellation", () => {
  const f = reviewFixture();
  f.set(
    presentReview(transitionReview(f.state(), 1, { type: "feedback", text: "Revise" }), {
      planId: "plan",
      expectedRevision: 1,
      markdown: "Latest",
    }),
  );
  const view = f.create();
  keys(view, "[", escape, escape);
  expect(f.closed()).toBe(true);
  expect(f.state().phase).toBe("cancelled");
});

test("narrow controls display focus for unanswered navigation, note removal and confirmation Back", () => {
  const f = roundFixture();
  for (let i = 0; i < 8; i++) {
    keys(f.view, down);
  }
  keys(f.view, enter, tab);
  expect(text(f.view, 18)).toContain("›Next unanswered");
  const r = reviewFixture();
  const view = r.create();
  keys(view, enter, "Draft", tab, tab);
  expect(text(view, 18)).toContain("›Remove note");
  keys(view, escape, tab, right, right, enter, tab);
  expect(text(view, 18)).toContain("›Back");
  keys(view, escape, tab, right, right, enter, tab);
  expect(text(view, 18)).toContain("›Back");
});

test("review renders cross-block Markdown references in the complete document context", () => {
  const markdown = "See [API][api].\n\nOther text.\n\n[api]: https://example.com\n";
  const f = reviewFixture(markdown);
  f.resize(60);
  const view = f.create();
  const lines = view.render(100);
  const complete = markdownLines(markdown, 98);
  expect(lines.slice(2, complete.length + 2)).toEqual(complete);
});

test("narrow and resized modals fit terminal cells and preserve Unicode drafts", () => {
  const f = roundFixture();
  keys(f.view, down, down, enter, "é 中文 👩‍💻");
  for (const width of [18, 40, 120]) {
    f.resize(10);
    const lines = f.view.render(width);
    expect(lines.length).toBeLessThanOrEqual(10);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
  expect(f.state().round?.drafts.scope?.unfinished).toBe("é 中文 👩‍💻");
  const review = reviewFixture("# Long\n\n" + "Long paragraph é 中文. ".repeat(500));
  const view = review.create();
  review.resize(10);
  keys(view, "\x1b[6~");
  const lines = view.render(18);
  expect(lines.length).toBeLessThanOrEqual(10);
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(18);
  }
});

test("paging continues from the focused question and resize keeps the selected document target visible", () => {
  const f = roundFixture();
  f.resize(12);
  keys(f.view, tab);
  text(f.view, 40);
  keys(f.view, "\x1b[6~");
  expect(text(f.view, 40)).not.toContain("1. Choose scope");
  expect(text(f.view, 40)).not.toContain("2. Choose storage");
  const review = reviewFixture(
    "# Beginning\n\n" + "Long text before target. ".repeat(80) + "\n\nTarget paragraph.",
  );
  const view = review.create();
  keys(view, down, down);
  text(view, 100);
  expect(text(view, 35)).toContain("Target paragraph.");
});

test("framed modals pad Unicode and styled content without losing editor focus on resize", () => {
  const f = roundFixture();
  f.resize(8);
  keys(f.view, down, down, enter, "é 中文");
  for (const width of [18, 40, 100]) {
    const lines = framedModalLines((contentWidth) => f.view.render(contentWidth), width);
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines[0]).toMatch(/^╭─+╮$/);
    expect(lines.at(-1)).toMatch(/^╰─+╯$/);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(width);
    }
    for (const line of lines.slice(1, -1)) {
      expect(stripTerminalSequences(line)).toMatch(/^│ .* │$/);
    }
    expect(lines.join("\n")).toContain(CURSOR_MARKER);
    expect(stripTerminalSequences(lines.join("\n"))).toContain("é");
    expect(stripTerminalSequences(lines.join("\n"))).toContain("中文");
  }
  expect(f.state().round?.drafts.scope?.unfinished).toBe("é 中文");
});

test("short terminals omit the frame before it pushes the focused Back action out of view", () => {
  const f = reviewFixture();
  f.resize(6);
  const view = f.create();
  keys(view, tab, right, right, right, right, enter, tab);
  const lines = framedModalLines(
    (width) => view.render(width),
    40,
    (value) => value,
    5,
  );
  expect(lines).toEqual(view.render(40));
  expect(stripTerminalSequences(lines.slice(0, 5).join("\n"))).toContain("›Back");
});

test("short unframed review pages advance without resetting the selected block position", () => {
  const f = reviewFixture("# Plan\n\n" + "Long paragraph to scroll through. ".repeat(60));
  f.resize(6);
  const view = f.create();
  const render = () =>
    framedModalLines(
      (width) => view.render(width),
      40,
      (value) => value,
      7,
    ).join("\n");
  const start = render();
  keys(view, "\x1b[6~");
  const next = render();
  expect(next).not.toBe(start);
  keys(view, "\x1b[6~");
  expect(render()).not.toBe(next);
});

test("question headings omit Markdown hashes, options restart letters, and code retains literal markup", () => {
  const f = roundFixture();
  f.resize(60);
  const question = f.view.render(100).join("\n");
  expect(stripTerminalSequences(question)).toContain("1. Choose scope");
  expect(stripTerminalSequences(question)).not.toMatch(/#+ 1\./);
  const plainQuestion = stripTerminalSequences(question);
  expect(plainQuestion.match(/C\. Other \(please specify\)/g)).toHaveLength(2);
  expect(plainQuestion).toContain("A. Local");
  expect(plainQuestion).toContain("B. Remote");
  const lines = markdownLines(
    "**Bold** and *italic*, [link](https://example.com).\n\n```text\n### literal **code**\n```",
    100,
  ).join("\n");
  const plain = stripTerminalSequences(lines);
  expect(plain).toContain("Bold and italic");
  expect(plain).toContain("### literal **code**");
});
