import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";

import { documentLayout } from "../src/document/document-layout.ts";
import { markdownLines } from "../src/document/markdown.ts";
import * as rendering from "../src/document/markdown.ts";
import { testEditor } from "./terminal-fixture.mts";

test.each([24, 90])(
  "source ranges identify repeated and nested rendered blocks at width %i",
  (width) => {
    testEditor();
    const source =
      "# Title\n\nRepeated.\n\nRepeated.\n\n- First item\n  - Nested item\n\n> Quoted paragraph.\n>\n> Second quoted paragraph.\n\n```ts\nconst n = 1;\n```\n";
    const layout = documentLayout(source, width);
    expect(layout.lines).toEqual(markdownLines(source, width));
    const rendered = (id: string) => {
      const span = layout.spans.get(id);
      if (span === undefined) {
        throw new Error("Missing span");
      }
      return stripTerminalSequences(layout.lines.slice(span.start, span.end).join("\n"));
    };
    const repeated = layout.blocks.filter((block) => block.excerpt.trim() === "Repeated.");
    expect(repeated.map((block) => layout.spans.get(block.id)?.range)).toEqual(["3", "5"]);
    expect(layout.spans.get(repeated[0]?.id ?? "")?.start).toBeLessThan(
      layout.spans.get(repeated[1]?.id ?? "")?.start ?? 0,
    );
    for (const target of [
      "First item",
      "Nested item",
      "Quoted paragraph.",
      "Second quoted paragraph.",
      "const n = 1;",
    ]) {
      const block = layout.blocks.find(
        (entry) =>
          entry.excerpt.includes(target) &&
          !entry.excerpt.includes("\n\n") &&
          entry.kind !== "blockquote",
      );
      if (block === undefined) {
        throw new Error(`Missing ${target}`);
      }
      expect(rendered(block.id).replace(/[│\s]/gu, "")).toContain(target.replaceAll(" ", ""));
    }
  },
);

test("a paragraph in a loose ordered list excludes the preceding list item", () => {
  testEditor();
  const layout = documentLayout("1. First\n2. Second\n\n   Paragraph\n\n3. Last\n", 40);
  const paragraph = layout.blocks.find(
    (block) => block.kind === "paragraph" && block.excerpt.trim() === "Paragraph",
  );
  if (paragraph === undefined) {
    throw new Error("Missing paragraph");
  }
  const span = layout.spans.get(paragraph.id);
  expect(span).toEqual({ start: 4, end: 5, range: "4" });
  expect(stripTerminalSequences(layout.lines[4] ?? "").trim()).toBe("Paragraph");
});

test("quoted paragraph boundaries exclude blank quote rows and sibling paragraphs", () => {
  testEditor();
  const layout = documentLayout("> First.\n>\n> Second.\n", 40);
  const paragraphs = layout.blocks.filter((block) => block.kind === "paragraph");
  expect(paragraphs.map((block) => layout.spans.get(block.id))).toEqual([
    { start: 0, end: 1, range: "1" },
    { start: 2, end: 3, range: "3" },
  ]);
});

test("literal vertical bars remain separate annotation targets", () => {
  testEditor();
  const layout = documentLayout("│\n\nAfter\n", 40);
  expect(layout.blocks.map((block) => layout.spans.get(block.id))).toEqual([
    { start: 0, end: 1, range: "1" },
    { start: 2, end: 3, range: "3" },
  ]);
});

test("literal vertical bars inside a quote remain content", () => {
  testEditor();
  const layout = documentLayout("> │\n>\n> After\n", 40);
  const paragraphs = layout.blocks.filter((block) => block.kind === "paragraph");
  expect(paragraphs.map((block) => layout.spans.get(block.id))).toEqual([
    { start: 0, end: 1, range: "1" },
    { start: 2, end: 3, range: "3" },
  ]);
});

test("duplicate reference definitions preserve following source targets", () => {
  testEditor();
  expect(() =>
    documentLayout(
      "[link][ref]\n\n[ref]: https://example.com\n\n[link][ref]\n\n[ref]: https://example.com\n",
      80,
    ),
  ).not.toThrow();
  const source =
    "[link][ref]\n\n[ref]: https://example.com\n\n[link][ref]\n\n[ref]: https://example.com\n\nAfter\n";
  const layout = documentLayout(source, 80);
  const after = layout.blocks.find((block) => block.excerpt.trim() === "After");
  expect(after).toBeDefined();
  expect(layout.spans.get(after?.id ?? "")?.range).toBe("9");
  expect(layout.lines).toEqual(markdownLines(source, 80));
});

test("flat documents render the complete source once without growing prefix renders", () => {
  testEditor();
  const source = Array.from({ length: 80 }, (_, index) => `Paragraph ${String(index)}.`).join(
    "\n\n",
  );
  const render = vi.spyOn(rendering, "markdownLines");
  try {
    const layout = documentLayout(source, 80);
    expect(layout.blocks).toHaveLength(80);
    expect(render.mock.calls.filter(([text]) => text.length > 100)).toEqual([[source, 80]]);
    expect([...layout.spans.values()].map((span) => [span.start, span.end])).toEqual(
      Array.from({ length: 80 }, (_, index) => [index * 2, index * 2 + 1]),
    );
  } finally {
    render.mockRestore();
  }
});
