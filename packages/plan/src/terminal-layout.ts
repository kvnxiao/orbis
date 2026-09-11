import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { PlanAppearance } from "./config.ts";

export const dividerGlyphs: Record<PlanAppearance["border"], string> = {
  rounded: "─",
  square: "─",
  double: "═",
  ascii: "-",
  none: "─",
};

export function frameContentWidth(
  width: number,
  rows: number,
  style: PlanAppearance["border"],
): number {
  return style === "none" || width < 4 || rows < 8
    ? Math.max(1, width)
    : width - 2 - (width >= 6 ? 2 : 0);
}

export function framedModalLines(
  render: (width: number) => string[],
  width: number,
  border: (text: string) => string = (text) => text,
  rows = Number.POSITIVE_INFINITY,
  style: PlanAppearance["border"] = "rounded",
): string[] {
  if (style === "none" || width < 4 || rows < 8) {
    return render(Math.max(1, width)).map((line) => truncateToWidth(line, width));
  }
  const padding = width >= 6 ? 1 : 0;
  const contentWidth = frameContentWidth(width, rows, style);
  const glyphs = {
    rounded: ["╭", "╮", "╰", "╯", "─", "│"],
    square: ["┌", "┐", "└", "┘", "─", "│"],
    double: ["╔", "╗", "╚", "╝", "═", "║"],
    ascii: ["+", "+", "+", "+", "-", "|"],
  } as const;
  const [topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical] = glyphs[style];
  const edge = horizontal.repeat(width - 2);
  return [
    border(`${topLeft}${edge}${topRight}`),
    ...render(contentWidth).map((line) => {
      const content = truncateToWidth(line, contentWidth);
      return `${border(vertical)}${" ".repeat(padding)}${content}\x1b[0m${" ".repeat(contentWidth - visibleWidth(content) + padding)}${border(vertical)}`;
    }),
    border(`${bottomLeft}${edge}${bottomRight}`),
  ];
}

export function markdownLines(text: string, width: number): string[] {
  return new Markdown(text, 0, 0, getMarkdownTheme()).render(Math.max(1, width));
}

export function modalContentWidth(width: number): number {
  return width >= 12 ? width - 2 : width;
}

export function modalLines(
  title: string,
  lines: string[],
  footer: string[],
  width: number,
  rows: number,
  scroll: number,
  separateFooter = true,
  style: PlanAppearance["border"] = "rounded",
): string[] {
  const available = Math.max(1, rows - 2);
  const cursorLine = footer.find((line) => line.includes(CURSOR_MARKER));
  let controls = footer;
  if (footer.length > available) {
    controls = footer.slice(-available);
    if (cursorLine !== undefined) {
      controls = [cursorLine, ...footer.slice(-Math.max(0, available - 1))];
    }
  }
  const divider =
    separateFooter && rows > controls.length + 2
      ? [getMarkdownTheme().hr(dividerGlyphs[style].repeat(Math.max(0, width)))]
      : [];
  const headingGap = rows > controls.length + divider.length + 2 ? [""] : [];
  const height = Math.max(1, rows - controls.length - divider.length - headingGap.length - 1);
  const start = Math.max(0, Math.min(scroll, lines.length - height));
  const overflow = lines.length > height && modalContentWidth(width) < width;
  const thumbSize = Math.max(1, Math.floor((height * height) / Math.max(1, lines.length)));
  const thumbStart = Math.round(
    (start * (height - thumbSize)) / Math.max(1, lines.length - height),
  );
  const body = lines.slice(start, start + height).map((line, index) => {
    if (!overflow) {
      return line;
    }
    let marker = style === "ascii" ? "|" : "│";
    if (index >= thumbStart && index < thumbStart + thumbSize) {
      marker = style === "ascii" ? "#" : "┃";
    }
    const content = truncateToWidth(line, modalContentWidth(width));
    return (
      content +
      " ".repeat(Math.max(1, width - visibleWidth(content) - 1)) +
      getMarkdownTheme().hr(marker)
    );
  });
  return [title, ...headingGap, ...body, ...divider, ...controls].map((line) =>
    truncateToWidth(line, width),
  );
}
