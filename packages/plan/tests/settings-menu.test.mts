import { join } from "node:path";

import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";

import * as config from "../src/config.ts";
import { showPlanSettings } from "../src/settings-menu.ts";
import { runtimeFixture } from "./runtime-fixture.mts";
import type { RuntimeFixture } from "./runtime-fixture.mts";

interface MenuDriver {
  press: (key: string) => void;
  rendered: () => string;
  finish: () => Promise<void>;
}

function menuContext(
  f: RuntimeFixture,
  notify: ExtensionContext["ui"]["notify"],
  drive: (menu: MenuDriver) => Promise<void>,
  bindings: Record<string, string> = {},
): ExtensionContext {
  return {
    ...f.ctx,
    ui: {
      ...f.ctx.ui,
      notify,
      async select(_title, options) {
        await Promise.resolve();
        return options[0];
      },
      async custom<T>(
        factory: (
          tui: TUI,
          theme: Theme,
          keys: KeybindingsManager,
          done: (result: T) => void,
        ) => Component | Promise<Component>,
      ): Promise<T> {
        const completed = Promise.withResolvers<T>();
        const component: unknown = await Reflect.apply(factory, undefined, [
          {
            requestRender() {
              return undefined;
            },
          },
          { bold: (text: string) => text },
          { getResolvedBindings: () => bindings },
          completed.resolve,
        ]);
        if (
          typeof component !== "object" ||
          component === null ||
          !("handleInput" in component) ||
          typeof component.handleInput !== "function" ||
          !("render" in component) ||
          typeof component.render !== "function"
        ) {
          throw new Error("Missing settings component");
        }
        const handleInput = component.handleInput;
        const render = component.render;
        await drive({
          press(key) {
            Reflect.apply(handleInput, component, [key]);
          },
          rendered() {
            const lines: unknown = Reflect.apply(render, component, [100]);
            if (!Array.isArray(lines)) {
              throw new Error("Missing settings rows");
            }
            return stripTerminalSequences(lines.join("\n"));
          },
          async finish() {
            Reflect.apply(handleInput, component, ["\x1b"]);
            await completed.promise;
          },
        });
        return await completed.promise;
      },
    },
  };
}

test("confirming the directory field without edits writes nothing and edits write the typed path", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  initTheme("dark", false);
  vi.spyOn(config, "readSettings").mockResolvedValue({
    planDirectory: join(f.ctx.cwd, ".pi", "plans"),
    symbols: "unicode",
    border: "rounded",
    showHints: true,
    shortcut: "shift+tab",
  });
  vi.spyOn(config, "readSettingsFile").mockResolvedValue({});
  const write = vi.spyOn(config, "writeSettings").mockResolvedValue(undefined);
  const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
  const ctx = menuContext(f, notify, async (menu) => {
    expect(menu.rendered()).toContain(".pi/plans/");
    expect(menu.rendered()).not.toContain(f.ctx.cwd);
    menu.press("\r");
    menu.press("\r");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(write).not.toHaveBeenCalled();
    menu.press("\r");
    menu.press("\x05");
    menu.press("x");
    menu.press("\r");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(write).toHaveBeenCalledWith(expect.any(String), { planDirectory: ".pi/plans/x" });
    expect(menu.rendered()).toContain(".pi/plans/x");
    await menu.finish();
  });
  await showPlanSettings(ctx, join(f.ctx.cwd, "agent"));
  expect(write).toHaveBeenCalledTimes(1);
  expect(notify).not.toHaveBeenCalled();
});

test("settings menu keeps successful writes quiet and restores the displayed value after failure", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  initTheme("dark", false);
  vi.spyOn(config, "readSettings").mockResolvedValue({
    planDirectory: "plans",
    symbols: "unicode",
    border: "rounded",
    showHints: true,
    shortcut: "shift+tab",
  });
  vi.spyOn(config, "readSettingsFile").mockResolvedValue({});
  const write = vi.spyOn(config, "writeSettings").mockResolvedValue(undefined);
  const saving = Promise.withResolvers<undefined>();
  write.mockReturnValueOnce(saving.promise);
  const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
  const ctx = menuContext(f, notify, async ({ press, rendered, finish }) => {
    press("\x1b[B");
    press("\r");
    const changed = rendered();
    expect(changed).not.toContain("Saving");
    expect(changed).toContain("Enter/Space to change · Esc to cancel");
    saving.resolve(undefined);
    await saving.promise;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(rendered()).toBe(changed);
    expect(notify).not.toHaveBeenCalled();
    expect(write).toHaveBeenLastCalledWith(expect.any(String), { symbols: "emoji" });
    expect(rendered()).toContain("emoji");
    write.mockRejectedValueOnce(new Error("Read-only settings file"));
    press("\x1b[B");
    press("\r");
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith("Read-only settings file", "error");
    });
    expect(rendered()).toContain("rounded");
    expect(rendered()).not.toContain("square");
    press("\r");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(rendered()).not.toMatch(/Saving|Saved/u);
    expect(rendered()).toContain("square");
    press("\x1b[B");
    press("\r");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(write).toHaveBeenLastCalledWith(expect.any(String), { showHints: false });
    expect(rendered()).toMatch(/Show hints by default\s+off/u);
    write.mockRejectedValueOnce(new Error("Cannot save hints"));
    press("\r");
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith("Cannot save hints", "error");
    });
    expect(rendered()).toMatch(/Show hints by default\s+off/u);
    await finish();
  });
  await showPlanSettings(ctx, join(f.ctx.cwd, "agent"));
  expect(write).toHaveBeenCalledTimes(5);
});

test("personal settings identify the trusted project value and file that mask a choice", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  initTheme("dark", false);
  const path = join(f.ctx.cwd, ".pi", "plan.json");
  await config.writeSettings(path, { border: "double" });
  const ctx = menuContext(
    f,
    () => undefined,
    async (menu) => {
      menu.press("\x1b[B");
      menu.press("\x1b[B");
      expect(menu.rendered()).toContain("Effective project value: double");
      expect(menu.rendered().replaceAll("\n", "")).toContain(path);
      await menu.finish();
    },
  );
  await showPlanSettings({ ...ctx, isProjectTrusted: () => true }, join(f.ctx.cwd, "agent"));
});

test("shortcut menu rejects invalid keys, applies saves and preserves the active key on write failure", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  initTheme("dark", false);
  const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
  const ctx = menuContext(
    f,
    notify,
    async ({ press, rendered, finish }) => {
      expect(rendered()).toContain("/reload");
      for (let index = 0; index < 4; index++) {
        press("\x1b[B");
      }
      press("\r");
      press("\x01");
      press("\x0b");
      press("ctrl+escape");
      press("\r");
      expect(rendered()).toContain("Use a Pi special or modified key");
      expect(f.runtime.shortcut).toBe("shift+tab");
      press("\x01");
      press("\x0b");
      press("ctrl+alt+p");
      press("\r");
      await vi.waitFor(() => {
        expect(f.runtime.shortcut).toBe("ctrl+alt+p");
      });
      vi.spyOn(config, "writeSettings").mockRejectedValueOnce(new Error("Cannot save shortcut"));
      press("\r");
      press("\x01");
      press("\x0b");
      press("disabled");
      press("\r");
      await vi.waitFor(() => {
        expect(notify).toHaveBeenCalledWith("Cannot save shortcut", "error");
      });
      expect(f.runtime.shortcut).toBe("ctrl+alt+p");
      expect(rendered()).toMatch(/Planning shortcut\s+ctrl\+alt\+p/u);
      await finish();
    },
    { "app.thinking.cycle": "shift+tab" },
  );
  await showPlanSettings(ctx, join(f.ctx.cwd, "agent"), async () => {
    await f.runtime.reloadSettings(ctx);
  });
});

test.for(["rpc", "json", "print"] as const)(
  "%s settings invocation reports the TUI requirement without opening a menu",
  async (mode, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
    const select = vi.fn<ExtensionContext["ui"]["select"]>();
    await showPlanSettings(
      { ...f.ctx, mode, ui: { ...f.ctx.ui, notify, select } },
      join(f.ctx.cwd, "agent"),
    );
    expect(notify).toHaveBeenCalledWith(
      "Planning settings require interactive Pi in TUI mode.",
      "error",
    );
    expect(select).not.toHaveBeenCalled();
  },
);
