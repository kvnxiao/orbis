import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

/** Render Markdown through Pi's active theme at a positive cell width. */
export function markdownLines(text: string, width: number): string[] {
  return new Markdown(text, 0, 0, getMarkdownTheme()).render(Math.max(1, width));
}
