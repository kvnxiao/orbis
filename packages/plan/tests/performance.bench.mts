import { expect, test } from "vitest";

import { DocumentAnalysis } from "../src/document/document-analysis.ts";
import { documentLayout } from "../src/document/document-layout.ts";
import {
  presentReview,
  presentRound,
  transitionReview,
  transitionRound,
} from "../src/domain/state.ts";
import type { RoundState } from "../src/domain/state.ts";
import { saveRecord } from "../src/storage/persistence.ts";
import { SessionFile } from "../src/storage/session-file.ts";
import { TerminalReview } from "../src/tui/terminal-review.ts";
import { TerminalRound } from "../src/tui/terminal-round.ts";
import { performanceMarkdown } from "./performance-fixture.mts";
import { runtimeFixture } from "./runtime-fixture.mts";
import { testEditor } from "./terminal-fixture.mts";

const options = { iterations: 5, time: 100, warmupIterations: 1, warmupTime: 0 };
const markdown = performanceMarkdown(80).replaceAll("\n", "\r\n");
const empty: RoundState = { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} };
const review = presentReview(empty, { planId: "plan", expectedRevision: 0, markdown });
const editor = testEditor();
const component = new TerminalReview({
  read: () => review,
  dispatch: () => undefined,
  done: () => undefined,
  refresh: () => undefined,
  editor: editor,
});
component.render(100);
const frontier = presentRound(empty, {
  planId: "plan",
  roundId: "round",
  expectedRevision: 0,
  questions: Array.from({ length: 100 }, (_, index) => ({
    id: `question-${String(index)}`,
    context: "Known constraints",
    prompt: "Choose scope?",
    prerequisites: [],
    options: [],
  })),
});
const questions = new TerminalRound({
  read: () => frontier,
  dispatch: () => undefined,
  done: () => undefined,
  refresh: () => undefined,
  editor: testEditor(),
});

test("interactive planning", async ({ bench, onTestFinished }) => {
  const cold = await bench(
    "cold review",
    { writeResult: "implementation/performance/cold-review.json" },
    () => {
      documentLayout(markdown, 100);
    },
  ).run(options);
  expect(cold.latency.mean).toBeGreaterThan(0);
  await bench("warm review", { writeResult: "implementation/performance/warm-review.json" }, () => {
    component.render(100);
  }).run(options);
  await bench("resize", { writeResult: "implementation/performance/resize.json" }, () => {
    component.render(80);
    component.render(100);
  }).run(options);
  await bench(
    "theme invalidation",
    { writeResult: "implementation/performance/invalidation.json" },
    () => {
      component.invalidate();
      component.render(100);
    },
  ).run(options);
  await bench(
    "frontier render",
    { writeResult: "implementation/performance/frontier.json" },
    () => {
      questions.render(100);
    },
  ).run(options);
  await bench(
    "Unicode draft transition",
    { writeResult: "implementation/performance/draft.json" },
    () => {
      transitionRound(frontier, "round", 1, {
        type: "edit",
        questionId: "question-0",
        unfinished: "界🙂\n".repeat(1000),
      });
    },
  ).run(options);
  await bench(
    "review feedback transition",
    { writeResult: "implementation/performance/feedback.json" },
    () => {
      transitionReview(review, 1, {
        type: "edit-feedback",
        text: "界🙂\n".repeat(1000),
      });
    },
  ).run(options);
  const analysis = new DocumentAnalysis(markdown);
  const block = analysis.blocks[0];
  if (block === undefined) {
    throw new Error("Missing benchmark source target");
  }
  await bench(
    "source-bound note transition",
    { writeResult: "implementation/performance/note.json" },
    () => {
      transitionReview(
        review,
        1,
        { type: "edit-note", blockId: block.id, excerpt: block.excerpt, text: "界🙂".repeat(1000) },
        analysis,
      );
    },
  ).run(options);
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Local save benchmark");
  const active = f.runtime.active;
  if (active === undefined) {
    throw new Error("Missing benchmark session");
  }
  const data = { version: 1, mode: "plan", active: { ...active, ...review }, unfinished: [] };
  await bench("cold save", { writeResult: "implementation/performance/cold-save.json" }, () => {
    expect(saveRecord(f.api, f.ctx, data).saved).toBe(true);
  }).run(options);
  const file = new SessionFile();
  await bench("warm save", { writeResult: "implementation/performance/warm-save.json" }, () => {
    expect(saveRecord(f.api, f.ctx, data, file).saved).toBe(true);
  }).run(options);
});
