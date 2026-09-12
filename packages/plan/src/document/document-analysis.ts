import { Marked } from "@earendil-works/pi-tui";

import { documentBlocks } from "./blocks.ts";
import type { DocumentBlock } from "./blocks.ts";

/** Retain immutable source targets independently of terminal width and theme. */
export class DocumentAnalysis {
  readonly markdown: string;
  readonly blocks: readonly DocumentBlock[];
  readonly roots: readonly { start: number; end: number }[];
  readonly definitions: string;
  readonly lineStarts: readonly number[];
  readonly byId: ReadonlyMap<string, DocumentBlock>;

  constructor(markdown: string) {
    this.markdown = markdown;
    this.blocks = Object.freeze(documentBlocks(markdown).map((block) => Object.freeze(block)));
    this.byId = new Map(this.blocks.map((block) => [block.id, block]));
    const offsets: number[] = [];
    const lineStarts = [0];
    for (let index = 0; index < markdown.length; index++) {
      offsets.push(index);
      if (markdown[index] === "\r" && markdown[index + 1] === "\n") {
        index++;
      }
      if (markdown[index] === "\r" || markdown[index] === "\n") {
        lineStarts.push(index + 1);
      }
    }
    offsets.push(markdown.length);
    this.lineStarts = Object.freeze(lineStarts);
    const normalized = markdown.replace(/\r\n?/gu, "\n");
    const tokens = new Marked().lexer(normalized);
    this.definitions = tokens
      .filter((token) => token.type === "def")
      .map((token) => token.raw)
      .join("\n");
    let cursor = 0;
    this.roots = Object.freeze(
      tokens.flatMap((token) => {
        if (token.type === "space") {
          return [];
        }
        cursor = normalized.indexOf(token.raw, cursor);
        if (cursor < 0) {
          throw new Error("Cannot locate Markdown token.");
        }
        const start = offsets[cursor];
        cursor += token.raw.length;
        const end = offsets[cursor];
        if (start === undefined || end === undefined) {
          throw new Error("Invalid Markdown token range.");
        }
        return token.type === "def" ? [] : [Object.freeze({ start, end })];
      }),
    );
  }

  /** Return the one-based source line containing a UTF-16 offset. */
  lineAt(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.lineStarts[middle] ?? 0) <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
}
