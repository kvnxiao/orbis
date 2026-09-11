import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Markdown, truncateToWidth } from "@earendil-works/pi-tui";

export function markdownLines(text: string, width: number): string[] {
  return new Markdown(text, 0, 0, getMarkdownTheme()).render(Math.max(1, width));
}

export function modalLines(
  title: string,
  lines: string[],
  footer: string[],
  width: number,
  rows: number,
  scroll: number,
): string[] {
  const available = Math.max(1, rows - 2);
  const cursorLine = footer.find((line) => line.includes(CURSOR_MARKER));
  const controls =
    footer.length <= available
      ? footer
      : cursorLine === undefined
        ? footer.slice(-available)
        : [cursorLine, ...footer.slice(-Math.max(0, available - 1))];
  const height = Math.max(1, rows - controls.length - 1);
  const start = Math.max(0, Math.min(scroll, lines.length - height));
  return [title, ...lines.slice(start, start + height), ...controls].map((line) =>
    truncateToWidth(line, width),
  );
}
