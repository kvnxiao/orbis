import { stripTerminalSequences } from "@earendil-works/pi-tui";

import type { DocumentBlock } from "./blocks.ts";
import { DocumentAnalysis } from "./document-analysis.ts";
import { markdownLines } from "./markdown.ts";

/** Associate terminal rows with stable source targets and one-based line ranges. */
export interface DocumentLayout {
  lines: string[];
  blocks: DocumentBlock[];
  spans: Map<string, { start: number; end: number; range: string }>;
}

/** Render the complete Markdown before mapping annotation ranges to preserve document references. */
export function documentLayout(
  markdown: string,
  width: number,
  analysis = new DocumentAnalysis(markdown),
): DocumentLayout {
  const lines = markdownLines(markdown, width);
  const plain = lines.map((line) => stripTerminalSequences(line).trimEnd());
  const blocks = analysis.blocks.filter((block) => block.kind !== "def");
  const definitions = analysis.definitions;
  const boundaries = new Map<number, number>([
    [0, 0],
    [markdown.length, lines.length],
  ]);
  const roots: { start: number; end: number; row: number }[] = [];
  let rootRow = 0;
  for (const root of analysis.roots) {
    const rendered = markdownLines(
      `${markdown.slice(root.start, root.end)}\n\n${definitions}`,
      width,
    ).map((line) => stripTerminalSequences(line).trimEnd());
    while (rendered.at(-1) === "") {
      rendered.pop();
    }
    let next = rootRow;
    let matches = true;
    for (const line of rendered) {
      if (line.trim().length === 0) {
        continue;
      }
      while (next < plain.length && (plain[next] ?? "").trim().length === 0) {
        next++;
      }
      if (line.trim() !== plain[next]?.trim()) {
        matches = false;
        break;
      }
      next++;
    }
    if (!matches) {
      break;
    }
    roots.push({ ...root, row: rootRow });
    boundaries.set(root.start, rootRow);
    boundaries.set(root.end, next);
    rootRow = next;
  }
  const boundary = (offset: number) => {
    const cached = boundaries.get(offset);
    if (cached !== undefined) {
      return cached;
    }
    let low = 0;
    let high = roots.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((roots[middle]?.start ?? Number.POSITIVE_INFINITY) <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const candidate = roots[low - 1];
    const root = candidate !== undefined && offset <= candidate.end ? candidate : undefined;
    const prefix = markdownLines(
      `${markdown.slice(root?.start ?? 0, offset)}\n\n${definitions}`,
      width,
    ).map((line) => stripTerminalSequences(line).trimEnd());
    while (prefix.at(-1) === "") {
      prefix.pop();
    }
    let index = root?.row ?? 0;
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
  const quotes: number[] = [];
  for (const block of blocks) {
    const first = analysis.lineAt(block.start);
    const last = analysis.lineAt(block.start + Math.max(0, block.excerpt.trimEnd().length - 1));
    let start = boundary(block.start);
    while ((quotes.at(-1) ?? Number.POSITIVE_INFINITY) <= block.start) {
      quotes.pop();
    }
    if (block.kind === "blockquote") {
      quotes.push(block.end);
    }
    const quoted = (quotes.at(-1) ?? -1) >= block.end;
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
