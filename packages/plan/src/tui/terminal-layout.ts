import { getMarkdownTheme, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { PlanAppearance } from "./appearance.ts";

/** Select separators from the resolved border style. */
export const dividerGlyphs: Record<PlanAppearance["border"], string> = {
  rounded: "─",
  square: "─",
  double: "═",
  ascii: "-",
  none: "─",
};

/** Deduct frame cells only when the available geometry displays a frame. */
export function frameContentWidth(
  width: number,
  rows: number,
  style: PlanAppearance["border"],
): number {
  return style === "none" || width < 4 || rows < 8
    ? Math.max(1, width)
    : width - 2 - (width >= 6 ? 2 : 0);
}

/** Bound framed rows to the outer terminal width. */
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

/** Reserve horizontal padding only when the modal is wide enough. */
export function modalContentWidth(width: number): number {
  return width >= 12 ? width - 2 : width;
}

/** Describe action availability, focus, hints, and the viewport’s selected content row. */
export interface ModalActions {
  buttons: { label: string; disabled?: boolean; reason?: string }[];
  focus?: number;
  contentFocus?: number;
  hint?: string;
  hintSuffix?: string;
  compactHint?: string;
  error?: string;
  theme?: Theme;
}

/** Keep submission controls visible while removing decoration in short viewports. */
export function modalLines(
  title: string,
  lines: string[],
  actions: ModalActions,
  width: number,
  rows: number,
  scroll: number,
  style: PlanAppearance["border"] = "rounded",
): string[] {
  width = Math.max(1, width);
  const markdown = getMarkdownTheme();
  const divider = markdown.hr(dividerGlyphs[style].repeat(width));
  const buttons: string[] = [];
  let row = "";
  for (const [index, button] of actions.buttons.entries()) {
    const focused = index === actions.focus;
    const label = `${focused ? "›" : " "} [ ${button.label} ]`;
    const colored =
      button.disabled === true
        ? getSelectListTheme().description(markdown.bold(label))
        : getSelectListTheme().selectedText(markdown.bold(label));
    const styled =
      focused && button.disabled !== true
        ? (actions.theme?.bg("selectedBg", actions.theme.fg("text", markdown.bold(label))) ??
          `\x1b[7m${colored}\x1b[27m`)
        : colored;
    if (row.length > 0 && visibleWidth(row) + visibleWidth(styled) + 2 > width) {
      buttons.push(...wrapTextWithAnsi(row, width));
      row = "";
    }
    row += `${row.length > 0 ? "  " : ""}${styled}${focused && (button.reason?.length ?? 0) > 0 ? ` ${button.reason ?? ""}` : ""}`;
  }
  if (row.length > 0) {
    buttons.push(...wrapTextWithAnsi(row, width));
  }
  const messages = [actions.error]
    .filter((text): text is string => text !== undefined && text.length > 0)
    .flatMap((text) => wrapTextWithAnsi(text, width));
  let controls = [...messages, ...buttons];
  const maximum = Math.max(1, rows - 2);
  if (controls.length > maximum) {
    controls = buttons;
    if (controls.length > maximum) {
      const button = actions.buttons[actions.focus ?? 0];
      controls = wrapTextWithAnsi(`› [ ${button?.label ?? ""} ]`, width).slice(0, maximum);
    }
  }
  let header = [truncateToWidth(title, width)];
  let footer = controls;
  if (rows >= controls.length + 8) {
    header = [...header, divider, ""];
    footer = ["", divider, "", ...controls, ""];
  } else if (rows >= controls.length + 4) {
    header.push(divider);
    footer = [divider, ...controls];
  }
  if (actions.hint !== undefined && rows >= header.length + footer.length + 3) {
    const suffix = actions.hintSuffix === undefined ? "" : ` · ${actions.hintSuffix}`;
    let hint = actions.hint;
    if (width < 60 && visibleWidth(hint) > width && actions.compactHint !== undefined) {
      hint = actions.compactHint;
    }
    if (hint.includes("press again to close")) {
      hint = truncateToWidth(hint, width);
    } else if (visibleWidth(hint) > width) {
      hint = truncateToWidth(hint, Math.max(1, width - visibleWidth(suffix))) + suffix;
    }
    footer = [...footer, divider, hint];
  }
  const height = Math.max(1, rows - header.length - footer.length);
  const requested =
    actions.contentFocus === undefined ? scroll : actions.contentFocus - Math.floor(height / 2);
  const start = Math.max(0, Math.min(requested, lines.length - height));
  const overflow = lines.length > height && modalContentWidth(width) < width;
  const thumbSize = Math.max(1, Math.floor((height * height) / Math.max(1, lines.length)));
  const thumbStart = Math.round(
    (start * (height - thumbSize)) / Math.max(1, lines.length - height),
  );
  const body = lines.slice(start, start + height).map((line, index) => {
    if (!overflow) {
      return truncateToWidth(line, width);
    }
    const content = truncateToWidth(line, modalContentWidth(width));
    const glyphs = style === "ascii" ? ["#", "|"] : ["┃", "│"];
    const marker = glyphs[index >= thumbStart && index < thumbStart + thumbSize ? 0 : 1] ?? "";
    return (
      content + " ".repeat(Math.max(1, width - visibleWidth(content) - 1)) + markdown.hr(marker)
    );
  });
  return [...header, ...body, ...footer].map((line) => truncateToWidth(line, width));
}
