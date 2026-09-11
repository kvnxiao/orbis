import { CustomEditor, getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionContext,
  ExtensionEvent,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";

import { installPlanComposer } from "../src/composer.ts";
import extension from "../src/index.ts";
import { presentRound } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
import { runtimeFixture } from "./runtime-fixture.mts";
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Pi exports the nominal keybindings type without its constructor; this fixture only uses matches.
const keybindings = { matches: () => false } as unknown as KeybindingsManager;
const editorTheme = () => ({
  borderColor: (text: string) => text,
  selectList: getSelectListTheme(),
});

test("composer wraps an existing editor, preserves text, rejects busy toggles, and restores its factory", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  const editor = new CustomEditor(tui, editorTheme(), keybindings);
  editor.setText("Existing objective");
  const previous = vi.fn<NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>>(
    () => editor,
  );
  let factory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]> = previous;
  let idle = true;
  const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
  const ctx: ExtensionContext = {
    ...f.ctx,
    isIdle: () => idle,
    ui: {
      ...f.ctx.ui,
      notify,
      getEditorComponent: () => factory,
      setEditorComponent: (next) => {
        factory = next;
      },
    },
  };
  const cleanup = installPlanComposer(ctx, f.runtime);
  const wrapped = factory(tui, editorTheme(), keybindings);
  expect(wrapped).toBe(editor);
  wrapped.handleInput("\x1b[Z");
  expect(f.runtime.mode).toBe("plan");
  expect(f.runtime.active).toBeUndefined();
  expect(editor.getText()).toBe("Existing objective");
  idle = false;
  wrapped.handleInput("\x1b[Z");
  expect(f.runtime.mode).toBe("plan");
  expect(notify).toHaveBeenCalledWith("Stop the current turn to switch modes.", "info");
  idle = true;
  wrapped.handleInput(" more");
  expect(editor.getText()).toBe("Existing objective more");
  expect(f.runtime.mode).toBe("plan");
  wrapped.handleInput("\x1b[Z");
  expect(f.runtime.mode).toBe("default");
  cleanup();
  expect(factory).toBe(previous);
  editor.handleInput("\x1b[Z");
  expect(f.runtime.mode).toBe("default");
  const removeAgain = installPlanComposer(ctx, f.runtime);
  factory(tui, editorTheme(), keybindings);
  factory(tui, editorTheme(), keybindings);
  editor.handleInput("\x1b[Z");
  expect(f.runtime.mode).toBe("plan");
  removeAgain();
});

test("paused round resumes through model entry with drafts and round count preserved", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Original objective");
  const plan = f.runtime.active;
  if (plan === undefined) {
    throw new Error("Missing plan");
  }
  f.persist({
    ...plan,
    ...presentRound(plan, {
      planId: plan.planId,
      roundId: "first",
      expectedRevision: 0,
      questions: [
        { id: "scope", prompt: "Scope?", context: "Known", prerequisites: [], options: [] },
      ],
    }),
  });
  f.runtime.restore(f.ctx);
  f.runtime.pause(f.ctx);
  const abort = vi.fn<() => void>();
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, read, dispatch) => {
      expect(read().roundNumber).toBe(1);
      dispatch({ type: "edit", questionId: "scope", unfinished: "local draft" });
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  const result = await f.runtime.requestStart({ ...f.ctx, abort }, "Resume planning", false);
  expect(result.outcome).toBe("cancelled");
  expect(abort).toHaveBeenCalledOnce();
  expect(f.runtime.active?.objective).toBe("Original objective");
  expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("local draft");
  expect(f.runtime.mode).toBe("default");
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.roundNumber).toBe(1);
  expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("local draft");
  expect(f.runtime.mode).toBe("default");
});

test("saved-plan selection exposes archived work and cancellation preserves the current plan", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "First");
  const first = f.runtime.active?.planId;
  f.runtime.start(f.ctx, "Second", true);
  const ctx: ExtensionContext = {
    ...f.ctx,
    ui: {
      ...f.ctx.ui,
      select: async (_title, choices) =>
        await Promise.resolve(choices.find((choice) => choice.startsWith("First ["))),
    },
  };
  expect(await f.runtime.selectUnfinished(ctx)).toBe(true);
  expect(f.runtime.active?.planId).toBe(first);
  expect(
    await f.runtime.selectUnfinished({
      ...ctx,
      ui: {
        ...ctx.ui,
        select: async () => {
          await Promise.resolve();
          return undefined;
        },
      },
    }),
  ).toBe(false);
  expect(f.runtime.active?.planId).toBe(first);
  expect(f.runtime.unfinished.some((plan) => plan.objective === "Second")).toBe(true);
  const resumed = await f.runtime.requestStart(
    {
      ...ctx,
      ui: {
        ...ctx.ui,
        async select(_title, choices) {
          await Promise.resolve();
          return choices.find((choice) => choice.startsWith("Second ["));
        },
      },
    },
    "Resume the saved plan",
    false,
  );
  expect(resumed.outcome).toBe("active");
  expect(f.runtime.active?.objective).toBe("Second");
});

test("Plan composer submits ordinary text while Default and noninteractive sources preserve routing", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  extension(f.api);
  const loaded = f.resources.getExtensions().extensions[0];
  if (loaded === undefined) {
    throw new Error("Missing extension");
  }
  const emit = async (event: ExtensionEvent, ctx = f.ctx) => {
    const results: unknown[] = [];
    for (const handler of loaded.handlers.get(event.type) ?? []) {
      // oxlint-disable-next-line no-await-in-loop -- Pi invokes extension handlers in registration order.
      results.push(await handler(event, ctx));
    }
    return results;
  };
  let factory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
  const ctx: ExtensionContext = {
    ...f.ctx,
    ui: {
      ...f.ctx.ui,
      getEditorComponent: () => factory,
      setEditorComponent: (next) => {
        factory = next;
      },
    },
  };
  await emit({ type: "session_start", reason: "startup" }, ctx);
  initTheme("dark", false);
  const editor = factory?.(new TuiMainScreen(new ProcessTerminal()), editorTheme(), keybindings);
  const before = {
    type: "before_agent_start" as const,
    prompt: "Task",
    systemPrompt: "Original",
    systemPromptOptions: { cwd: f.ctx.cwd },
  };
  await emit({ type: "input", source: "interactive", text: "Ordinary task" }, ctx);
  expect(await emit(before, ctx)).toEqual([undefined]);
  editor?.handleInput("\x1b[Z");
  await emit({ type: "input", source: "interactive", text: "/settings" }, ctx);
  await emit({ type: "input", source: "interactive", text: "!echo hello" }, ctx);
  await emit({ type: "input", source: "extension", text: "Injected" }, ctx);
  expect(await emit(before, ctx)).toEqual([undefined]);
  expect(await emit({ type: "input", source: "interactive", text: "A reminder CLI" }, ctx)).toEqual(
    [{ action: "continue" }],
  );
  const planning = await emit(before, ctx);
  const result = planning[0];
  if (typeof result !== "object" || result === null || !("systemPrompt" in result)) {
    throw new Error("Missing planning instructions");
  }
  expect(result.systemPrompt).toContain("Planning is active");
  expect(result.systemPrompt).toContain("Original");
  const saved = f.manager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (saved?.type !== "message" || saved.message.role !== "assistant") {
    throw new Error("Missing assistant fixture");
  }
  await emit({ type: "agent_end", messages: [{ ...saved.message, stopReason: "error" }] }, ctx);
  expect(await emit(before, ctx)).toEqual(planning);
  await emit({ type: "agent_start" }, ctx);
  await emit({ type: "agent_end", messages: [saved.message] }, ctx);
  await emit({ type: "agent_settled" }, ctx);
  expect(await emit(before, ctx)).toEqual(planning);
  await emit({ type: "agent_start" }, ctx);
  await emit({ type: "agent_end", messages: [{ ...saved.message, stopReason: "error" }] }, ctx);
  await emit({ type: "agent_settled" }, ctx);
  expect(await emit(before, ctx)).toEqual([undefined]);
  editor?.handleInput("\x1b[Z");
  await emit({ type: "input", source: "interactive", text: "Continue" }, ctx);
  await emit({ type: "agent_start" }, ctx);
  await emit(
    { type: "agent_end", messages: [{ ...saved.message, stopReason: "toolUse" }] },
    { ...ctx, signal: AbortSignal.abort() },
  );
  await emit({ type: "agent_settled" }, ctx);
  expect(await emit(before, ctx)).toEqual([undefined]);
  editor?.handleInput("\x1b[Z");
  editor?.handleInput("\x1b[Z");
  await emit({ type: "input", source: "interactive", text: "An unrelated question" }, ctx);
  expect(await emit(before, ctx)).toEqual([undefined]);
  await emit({ type: "session_shutdown", reason: "quit" }, ctx);
});
