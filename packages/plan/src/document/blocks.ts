import { Marked } from "@earendil-works/pi-tui";
import type { Token, Tokens } from "@earendil-works/pi-tui";

/** Bind an annotation to exact UTF-16 source offsets and its unchanged excerpt. */
export interface DocumentBlock {
  id: string;
  kind: string;
  start: number;
  end: number;
  excerpt: string;
}

interface MappedText {
  text: string;
  offsets: number[];
}

function list(token: Token): token is Tokens.List {
  return token.type === "list";
}
function quote(token: Token): token is Tokens.Blockquote {
  return token.type === "blockquote";
}
function listItem(token: Token): token is Tokens.ListItem {
  return token.type === "list_item";
}

function childSource(source: MappedText, text: string): MappedText {
  const offsets: number[] = [];
  const sourceLines = source.text.split("\n");
  let cursor = 0;
  let sourceLine = 0;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const content = line.replace(/\s/g, "");
    let raw = sourceLines[sourceLine];
    while (raw !== undefined) {
      const original = raw.replace(/\s/g, "");
      const prefix =
        content.length === 0 ? original : original.slice(0, original.length - content.length);
      if (
        content.length === 0 ||
        (original.endsWith(content) && /^(?:>|[-+*]|\d+[.)]|\[[xX]\])*$/.test(prefix))
      ) {
        break;
      }
      cursor += raw.length + 1;
      sourceLine++;
      raw = sourceLines[sourceLine];
    }
    if (raw === undefined) {
      throw new Error("Cannot map nested Markdown lines.");
    }
    const lineOffsets: number[] = [];
    let sourcePosition = raw.length - 1;
    for (let position = line.length - 1; position >= 0; position--) {
      const character = line[position] ?? "";
      let mapped: number;
      if (/\s/.test(character)) {
        mapped = /\s/.test(raw[sourcePosition] ?? "") ? sourcePosition-- : sourcePosition + 1;
      } else {
        mapped = raw.lastIndexOf(character, sourcePosition);
        if (sourcePosition < 0 || mapped < 0) {
          throw new Error("Cannot map nested Markdown text to its source.");
        }
        sourcePosition = mapped - 1;
      }
      const offset = source.offsets[cursor + mapped];
      if (offset === undefined) {
        throw new Error("Invalid nested Markdown offset.");
      }
      lineOffsets[position] = offset;
    }
    offsets.push(...lineOffsets);
    cursor += raw.length;
    sourceLine++;
    if (index < lines.length - 1) {
      const newline = source.offsets[cursor];
      if (newline === undefined) {
        throw new Error("Invalid nested Markdown newline.");
      }
      offsets.push(newline);
      cursor++;
    }
  }
  offsets.push(source.offsets[cursor] ?? source.offsets.at(-1) ?? 0);
  return { text, offsets };
}

/** Derive stable annotation targets from original Markdown source offsets. */
export function documentBlocks(markdown: string): DocumentBlock[] {
  const offsets: number[] = [];
  for (let index = 0; index < markdown.length; index++) {
    offsets.push(index);
    if (markdown[index] === "\r" && markdown[index + 1] === "\n") {
      index++;
    }
  }
  offsets.push(markdown.length);
  const source = { text: markdown.replace(/\r\n?/g, "\n"), offsets };
  const blocks: DocumentBlock[] = [];
  const add = (kind: string, mapped: MappedText) => {
    const start = mapped.offsets[0];
    const last = mapped.offsets[mapped.text.length - 1];
    if (start === undefined || last === undefined) {
      throw new Error("Invalid Markdown range.");
    }
    const end = last + (markdown[last] === "\r" && markdown[last + 1] === "\n" ? 2 : 1);
    blocks.push({
      id: `${String(start)}-${String(end)}-${kind}`,
      kind,
      start,
      end,
      excerpt: markdown.slice(start, end),
    });
  };
  const visit = (tokens: Token[], mapped: MappedText) => {
    let cursor = 0;
    for (const token of tokens) {
      if (token.type === "checkbox" || token.type === "space") {
        continue;
      }
      const start = mapped.text.indexOf(token.raw, cursor);
      if (start < 0) {
        throw new Error("Cannot locate Markdown source block.");
      }
      const end = start + token.raw.length;
      cursor = end;
      const part = { text: token.raw, offsets: mapped.offsets.slice(start, end + 1) };
      if (list(token)) {
        visit(token.items, part);
      } else if (listItem(token)) {
        add("list_item", part);
        visit(token.tokens, childSource(part, token.tokens.map((child) => child.raw).join("")));
      } else if (quote(token)) {
        add("blockquote", part);
        visit(token.tokens, childSource(part, token.tokens.map((child) => child.raw).join("")));
      } else {
        add(token.type === "text" ? "paragraph" : token.type, part);
      }
    }
  };
  visit(new Marked().lexer(source.text), source);
  return blocks;
}
