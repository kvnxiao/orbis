import { join } from "node:path";

import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Input, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";

import {
  borderSchema,
  defaultPlanDirectory,
  symbolsSchema,
  readSettings,
  readSettingsFile,
  writeSettings,
} from "./config.ts";
import type { SettingsFields } from "./config.ts";

export async function showPlanSettings(ctx: ExtensionContext, agentDir: string): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Planning settings require interactive Pi in TUI mode.", "error");
    return;
  }
  const scope = await ctx.ui.select("Plan settings", [
    "Personal defaults",
    ...(ctx.isProjectTrusted() ? ["Project overrides"] : []),
  ]);
  if (scope === undefined) {
    return;
  }
  const project = scope === "Project overrides";
  const personalPath = join(agentDir, "orbis-plan.json");
  const path = project ? join(ctx.cwd, ".pi", "plan.json") : personalPath;
  const effective = await readSettings(agentDir, ctx.cwd, project);
  const stored = await readSettingsFile(path);
  const inherited = project ? await readSettingsFile(personalPath) : {};
  const values = {
    ...effective,
    planDirectory: stored.planDirectory ?? inherited.planDirectory ?? defaultPlanDirectory,
  };
  const displayed = {
    planDirectory: () => values.planDirectory,
    symbols: () => values.symbols,
    border: () => values.border,
    showHints: () => (values.showHints ? "on" : "off"),
  };
  const isField = (id: string): id is keyof typeof displayed => Object.hasOwn(displayed, id);
  const borders = borderSchema.anyOf.map((item) => item.const);
  const symbols = symbolsSchema.anyOf.map((item) => item.const);
  let pending = Promise.resolve();
  await ctx.ui.custom<undefined>((tui, theme, _keys, done) => {
    let busy = false;
    let input: Input | undefined;
    let focused = true;
    const list = new SettingsList(
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
        { id: "border", label: "Modal border", currentValue: displayed.border(), values: borders },
        {
          id: "showHints",
          label: "Show hints by default",
          currentValue: displayed.showHints(),
          values: ["on", "off"],
        },
      ],
      8,
      getSettingsListTheme(),
      (id, value) => {
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
              if (isField(id)) {
                list.updateValue(id, displayed[id]());
              }
              ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
              tui.requestRender();
            },
          )
          .finally(() => {
            busy = false;
          });
      },
      () => {
        done(undefined);
      },
    );
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
        return [theme.bold(`Plan settings · ${scope}`), ...list.render(width)].map((line) =>
          truncateToWidth(line, width),
        );
      },
      invalidate() {
        list.invalidate();
      },
      handleInput(data) {
        if (!busy) {
          list.handleInput(data);
        }
        tui.requestRender();
      },
    };
  });
  await pending;
}
