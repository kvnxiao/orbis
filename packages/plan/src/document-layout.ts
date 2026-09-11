import { Marked, stripTerminalSequences } from "@earendil-works/pi-tui";

import { documentBlocks } from "./blocks.ts";
import type { DocumentBlock } from "./blocks.ts";
import { markdownLines } from "./terminal-layout.ts";

export interface DocumentLayout {
  lines: string[];
  blocks: DocumentBlock[];
  spans: Map<string, { start: number; end: number; range: string }>;
}

/** Render the complete Markdown before mapping annotation ranges to preserve document references. */
export function documentLayout(markdown: string, width: number): DocumentLayout {
  const lines = markdownLines(markdown, width);
  const plain = lines.map((line) => stripTerminalSequences(line).trimEnd());
  const blocks = documentBlocks(markdown).filter((block) => block.kind !== "def");
  const definitions = new Marked()
    .lexer(markdown)
    .filter((token) => token.type === "def")
    .map((token) => token.raw)
    .join("\n");
  const boundaries = new Map<number, number>([
    [0, 0],
    [markdown.length, lines.length],
  ]);
  const boundary = (offset: number) => {
    const cached = boundaries.get(offset);
    if (cached !== undefined) {
      return cached;
    }
    const prefix = markdownLines(`${markdown.slice(0, offset)}\n\n${definitions}`, width).map(
      (line) => stripTerminalSequences(line).trimEnd(),
    );
    while (prefix.at(-1) === "") {
      prefix.pop();
    }
    let index = 0;
    for (const row of prefix) {
      if (row.trim().length === 0) {
        continue;
      }
      while (index < plain.length && (plain[index] ?? "").trim().length === 0) {
        index++;
      }
      if (row.trim() !== plain[index]?.trim()) {
        break;
      }
      index++;
    }
    boundaries.set(offset, index);
    return index;
  };
  const spans = new Map<string, { start: number; end: number; range: string }>();
  for (const block of blocks) {
    const first = markdown.slice(0, block.start).split(/\r\n|\r|\n/u).length;
    const last = first + block.excerpt.trimEnd().split(/\r\n|\r|\n/u).length - 1;
    let start = boundary(block.start);
    const quoted = blocks.some(
      (parent) =>
        parent.kind === "blockquote" && parent.start <= block.start && parent.end >= block.end,
    );
    const literalBar = block.excerpt.replace(/^[\s>]+/u, "").startsWith("│");
    while (start < lines.length && (plain[start] ?? "").trim().length === 0) {
      start++;
    }
    if (quoted && !literalBar) {
      while (start < lines.length && /^(?:\s*│)+\s*$/u.test(plain[start] ?? "")) {
        start++;
      }
    }
    let end = Math.min(lines.length, Math.max(start + 1, boundary(block.end)));
    while (end > start + 1 && plain[end - 1] === "") {
      end--;
    }
    spans.set(block.id, {
      start,
      end,
      range: first === last ? String(first) : `${String(first)}–${String(last)}`,
    });
  }
  return { lines, blocks, spans };
}
