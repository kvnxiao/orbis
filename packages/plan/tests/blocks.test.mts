import { expect, test } from "vitest";

import { documentBlocks } from "../src/document/blocks.ts";

test("source blocks distinguish repeated Unicode paragraphs and preserve CRLF offsets", () => {
  const markdown = "# Plan\r\n\r\né repeated.\r\n\r\né repeated.\r\n\r\n```ts\r\n- code\r\n```\r\n";
  const blocks = documentBlocks(markdown);
  expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "paragraph", "code"]);
  expect(blocks[1]?.id).not.toBe(blocks[2]?.id);
  expect(blocks[1]?.excerpt).toBe("é repeated.");
  expect(blocks[3]?.excerpt).toBe("```ts\r\n- code\r\n```\r\n");
  for (const block of blocks) {
    expect(markdown.slice(block.start, block.end)).toBe(block.excerpt);
  }
});

test("nested list targets and fenced list content retain distinct source ranges", () => {
  const markdown = "- parent\n  - repeated\n  - repeated\n- next\n  ```\n  - code\n  ```\n";
  const blocks = documentBlocks(markdown);
  expect(
    blocks.filter((block) => block.kind === "list_item").map((block) => block.excerpt),
  ).toEqual([
    "- parent\n  - repeated\n  - repeated\n",
    "- repeated\n",
    "- repeated",
    "- next\n  ```\n  - code\n  ```",
  ]);
  expect(blocks.find((block) => block.kind === "code")?.excerpt).toBe("```\n  - code\n  ```");
  expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
});

test("indented code in lists is a code target and does not invent nested list items", () => {
  const markdown = "- outer\n\n      - literal code\n\n- next";
  const blocks = documentBlocks(markdown);
  expect(blocks.filter((block) => block.kind === "list_item")).toHaveLength(2);
  expect(blocks.find((block) => block.kind === "code")?.excerpt).toContain("- literal code");
});

test("nested quotes, headings, code, task lists, and tab indentation retain source excerpts", () => {
  const markdown =
    "> ## Heading\r\n>\r\n> ```\r\n> code\r\n> ```\r\n\r\n- [x] task\r\n\t- nested\r\n";
  const blocks = documentBlocks(markdown);
  expect(blocks.map((block) => block.kind)).toContain("heading");
  expect(blocks.map((block) => block.kind)).toContain("code");
  expect(blocks.filter((block) => block.kind === "list_item")).toHaveLength(2);
  for (const block of blocks) {
    expect(markdown.slice(block.start, block.end)).toBe(block.excerpt);
  }
});

test("tables remain whole annotation blocks", () => {
  const blocks = documentBlocks("| A | B |\n| - | - |\n| one | two |\n");
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.kind).toBe("table");
});

test.each([
  "- [x] task\n\n- next",
  "- a\tb",
  "> text\n===",
  "- outer\n\n  - [ ] nested task\n\n  - next",
  "[x]: /one\n\n> [x]: /two\n> paragraph",
])("parser-normalized nested Markdown retains original source targets: %s", (markdown) => {
  const blocks = documentBlocks(markdown);
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(markdown.slice(block.start, block.end)).toBe(block.excerpt);
  }
});

test.each([
  ["- a\tb", "a\tb"],
  ["- [x] task\n\n- next", "[x] task\n"],
  ["[x]: /one\n\n> [x]: /two\n> paragraph", "paragraph"],
])("normalized paragraph targets contain original source: %s", (markdown, excerpt) => {
  expect(documentBlocks(markdown).find((block) => block.kind === "paragraph")?.excerpt).toBe(
    excerpt,
  );
});
