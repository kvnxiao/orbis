import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import { documentBlocks } from "../src/blocks.ts";
import { presentRound, presentReview, transitionRound, transitionReview } from "../src/state.ts";
import type { RoundState } from "../src/state.ts";
import { markdownLines } from "../src/terminal-layout.ts";
import { TerminalRound, TerminalReview } from "../src/terminal.ts";
import { testEditor } from "./terminal-fixture.mts";

const down = "\x1b[B";
const right = "\x1b[C";
const escape = "\x1b";
const enter = "\r";
const tab = "\t";

function roundFixture() {
  let state = presentRound(
    { phase: "research", decisions: {} },
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
  );
  return {
    view,
    state: () => state,
    closed: () => closed,
    resize: (height: number) => {
      rows = height;
    },
  };
}

function reviewFixture(markdown = "# Plan\n\nKeep these bytes.\n\nKeep these bytes.\n") {
  let state: RoundState = presentReview(
    { phase: "research", decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown },
  );
  let closed = false;
  let rows = 24;
  const create = () => {
    const revision = state.reviews?.at(-1)?.revision ?? 0;
    return new TerminalReview(
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
    );
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
  keys(f.view, down);
  expect(f.state().round?.drafts.scope?.answer).toBeUndefined();
  keys(f.view, right, "Only the CLI", enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Only the CLI",
  });
  keys(f.view, right, " unfinished", escape, down, enter, "\x1b[A", enter);
  expect(f.state().round?.drafts.scope?.answer).toEqual({
    optionId: "local",
    details: "Only the CLI",
  });
  keys(f.view, tab, down, enter);
  expect(f.state().decisions).toEqual({});
  keys(f.view, down, down, down, enter);
  expect(text(f.view)).toContain("Submit round");
  expect(f.closed()).toBe(false);
  keys(f.view, enter);
  expect(f.state().phase).toBe("research");
  expect(JSON.stringify(f.state().decisions)).not.toContain("unfinished");
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
  expect(text(f.view)).toContain("→ Other");
});

test("Other rejects blank text and nested Escape preserves drafts without arming close", () => {
  const f = roundFixture();
  keys(f.view, enter, enter);
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

test("clarification Enter inserts a newline and Send records the request", () => {
  const f = roundFixture();
  keys(f.view, down, down, down, enter, "Explain", enter, "offline");
  expect(f.state().phase).toBe("round");
  expect(f.state().round?.drafts.scope?.clarificationDraft).toBe("Explain\noffline");
  keys(f.view, tab, enter);
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
  expect(text(f.view, 18)).toContain("→Next unanswered");
  const r = reviewFixture();
  const view = r.create();
  keys(view, enter, "Draft", tab, tab);
  expect(text(view, 18)).toContain("→Remove note");
  keys(view, escape, tab, right, right, enter, tab);
  expect(text(view, 18)).toContain("→Back");
  keys(view, escape, tab, right, right, enter, tab);
  expect(text(view, 18)).toContain("→Back");
});

test("review renders cross-block Markdown references in the complete document context", () => {
  const markdown = "See [API][api].\n\nOther text.\n\n[api]: https://example.com\n";
  const f = reviewFixture(markdown);
  f.resize(60);
  const view = f.create();
  const lines = view.render(100);
  const complete = markdownLines(markdown, 100);
  expect(lines.slice(1, complete.length + 1)).toEqual(complete);
});

test("narrow and resized modals fit terminal cells and preserve Unicode drafts", () => {
  const f = roundFixture();
  keys(f.view, enter, "é 中文 👩‍💻");
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
  expect(text(f.view, 40)).not.toContain("### 1. Choose scope");
  expect(text(f.view, 40)).not.toContain("### 1. Choose storage");
  const review = reviewFixture(
    "# Beginning\n\n" + "Long text before target. ".repeat(80) + "\n\nTarget paragraph.",
  );
  const view = review.create();
  keys(view, down, down);
  text(view, 100);
  expect(text(view, 35)).toContain("Target paragraph.");
});
