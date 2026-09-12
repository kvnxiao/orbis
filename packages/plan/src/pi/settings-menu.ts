import { join } from "node:path";

import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Input, SettingsList, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { SettingItem } from "@earendil-works/pi-tui";

import {
  defaultPlanDirectory,
  isPlanShortcut,
  normalizePlanKey,
  readSettings,
  readSettingsFile,
  writeSettings,
} from "../storage/config.ts";
import type { SettingsFields } from "../storage/config.ts";
import { borderSchema, symbolsSchema } from "../tui/appearance.ts";
import { ModalKeybindings } from "../tui/terminal-keys.ts";
import { shortcutConflict, shortcutWarning } from "./composer.ts";

/** Edit the chosen settings scope until cancellation or session teardown. */
export async function showPlanSettings(
  ctx: ExtensionContext,
  agentDir: string,
  signal: AbortSignal | undefined = ctx.signal,
): Promise<void> {
  const cancelled = () => signal?.aborted === true;
  if (cancelled()) {
    return;
  }
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Planning settings require interactive Pi in TUI mode.", "error");
    return;
  }
  const scope = await ctx.ui.select(
    "Plan settings",
    ["Personal defaults", ...(ctx.isProjectTrusted() ? ["Project overrides"] : [])],
    signal === undefined ? undefined : { signal },
  );
  if (scope === undefined || cancelled()) {
    return;
  }
  const project = scope === "Project overrides";
  const personalPath = join(agentDir, "orbis-plan.json");
  const path = project ? join(ctx.cwd, ".pi", "plan.json") : personalPath;
  const effective = await readSettings(agentDir, ctx.cwd, project, signal);
  const stored = await readSettingsFile(path, signal);
  const inherited = project ? await readSettingsFile(personalPath, signal) : {};
  const projectPath = join(ctx.cwd, ".pi", "plan.json");
  const overrides =
    !project && ctx.isProjectTrusted() ? await readSettingsFile(projectPath, signal) : {};
  if (cancelled()) {
    return;
  }
  const masking = new Map(Object.entries(overrides));
  const values = {
    ...effective,
    planDirectory: stored.planDirectory ?? inherited.planDirectory ?? defaultPlanDirectory,
  };
  const displayed = {
    planDirectory: () => values.planDirectory,
    symbols: () => values.symbols,
    border: () => values.border,
    showHints: () => (values.showHints ? "on" : "off"),
    shortcut: () => values.shortcut ?? "disabled",
  };
  const isField = (id: string): id is keyof typeof displayed => Object.hasOwn(displayed, id);
  const borders = borderSchema.anyOf.map((item) => item.const);
  const symbols = symbolsSchema.anyOf.map((item) => item.const);
  let pending = Promise.resolve();
  await ctx.ui.custom<undefined>((tui, theme, keys, done) => {
    const modalKeys = new ModalKeybindings(keys);
    let closed = false;
    const finish = () => {
      if (!closed) {
        closed = true;
        signal?.removeEventListener("abort", finish);
        done(undefined);
      }
    };
    signal?.addEventListener("abort", finish, { once: true });
    let busy = false;
    let input: Input | undefined;
    let focused = true;
    let shortcutError = "";
    const list = new SettingsList(
      (
        [
          {
            id: "planDirectory",
            label: "Approved-plan directory",
            currentValue: displayed.planDirectory(),
            submenu(value, close) {
              input = new Input({ prompt: "Directory: " });
              input.setValue(value);
              input.focused = focused;
              input.onSubmit = (text) => {
                input = undefined;
                close(text);
              };
              input.onEscape = () => {
                input = undefined;
                close();
              };
              return input;
            },
          },
          {
            id: "symbols",
            label: "Symbols",
            currentValue: displayed.symbols(),
            values: symbols,
          },
          {
            id: "border",
            label: "Modal border",
            currentValue: displayed.border(),
            values: borders,
          },
          {
            id: "showHints",
            label: "Show hints by default",
            currentValue: displayed.showHints(),
            values: ["on", "off"],
          },
          {
            id: "shortcut",
            label: "Planning shortcut",
            currentValue: displayed.shortcut(),
            submenu(value, close) {
              input = new Input({ prompt: "Shortcut (or disabled): " });
              input.setValue(value);
              input.focused = focused;
              input.onSubmit = (text) => {
                const shortcut = text.trim();
                if (shortcut !== "disabled" && !isPlanShortcut(shortcut)) {
                  shortcutError = "Use a Pi special or modified key, or disabled.";
                  return;
                }
                shortcutError = "";
                input = undefined;
                close(shortcut);
              };
              input.onEscape = () => {
                input = undefined;
                shortcutError = "";
                close();
              };
              return input;
            },
          },
        ] satisfies SettingItem[]
      ).map((item) =>
        Object.assign(
          item,
          masking.has(item.id)
            ? {
                description: `Effective project value: ${String(masking.get(item.id))}. Overrides personal setting in ${projectPath}.`,
              }
            : {},
        ),
      ),
      8,
      {
        ...getSettingsListTheme(),
        hint: () =>
          [modalKeys.hint("enter", "change"), modalKeys.hint("escape", "cancel")]
            .filter(Boolean)
            .join(" · "),
      },
      (id, value) => {
        if (closed || signal?.aborted === true) {
          return;
        }
        const fields: SettingsFields = {};
        const border = borders.find((item) => item === value);
        const symbol = symbols.find((item) => item === value);
        if (id === "planDirectory") {
          if (value === values.planDirectory) {
            return;
          }
          fields.planDirectory = value;
        } else if (id === "symbols" && symbol !== undefined) {
          fields.symbols = symbol;
        } else if (id === "border" && border !== undefined) {
          fields.border = border;
        } else if (id === "showHints" && (value === "on" || value === "off")) {
          fields.showHints = value === "on";
        } else if (id === "shortcut" && (value === "disabled" || isPlanShortcut(value))) {
          fields.shortcut = value === "disabled" ? null : value;
          if (
            fields.shortcut === values.shortcut ||
            (fields.shortcut !== null &&
              values.shortcut !== null &&
              normalizePlanKey(fields.shortcut) === normalizePlanKey(values.shortcut))
          ) {
            return;
          }
        } else {
          return;
        }
        busy = true;
        pending = writeSettings(path, fields)
          .then(
            () => {
              Object.assign(values, fields);
            },
            (error: unknown) => {
              if (signal?.aborted === true) {
                return;
              }
              if (!closed && isField(id)) {
                list.updateValue(id, displayed[id]());
              }
              ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
              if (!closed) {
                tui.requestRender();
              }
            },
          )
          .finally(() => {
            busy = false;
          });
      },
      finish,
    );
    if (signal?.aborted === true) {
      finish();
    }
    return {
      get focused() {
        return focused;
      },
      set focused(value: boolean) {
        focused = value;
        if (input !== undefined) {
          input.focused = value;
        }
      },
      render(width) {
        const shortcut = overrides.shortcut === undefined ? values.shortcut : overrides.shortcut;
        const conflict =
          shortcut === null || !isPlanShortcut(shortcut)
            ? undefined
            : shortcutConflict(keys, shortcut);
        return [
          theme.bold(`Plan settings · ${scope}`),
          ...list.render(width),
          ...wrapTextWithAnsi(
            "Shortcut changes require /reload. Use /plan when the shortcut is disabled or blocked.",
            width,
          ),
          ...(shortcutError.length === 0 ? [] : wrapTextWithAnsi(shortcutError, width)),
          ...(conflict === undefined || shortcut === null
            ? []
            : wrapTextWithAnsi(shortcutWarning(shortcut, conflict), width)),
        ].map((line) => truncateToWidth(line, width));
      },
      invalidate() {
        list.invalidate();
      },
      handleInput(data) {
        if (closed) {
          return;
        }
        if (busy && keys.matches(data, "tui.select.cancel")) {
          finish();
          return;
        }
        if (!busy) {
          modalKeys.input(list, data);
        }
        tui.requestRender();
      },
      dispose() {
        closed = true;
        signal?.removeEventListener("abort", finish);
      },
    };
  });
  await pending;
}
