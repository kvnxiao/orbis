import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import type { PlanApproval } from "../src/domain/state.ts";
import { PlanHandoff } from "../src/pi/handoff.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

type ReplacementOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>;
type FreshContext = Parameters<NonNullable<ReplacementOptions["withSession"]>>[0];
const unused = () => {
  throw new Error("Unexpected session operation");
};

async function fixture(notes = false) {
  const f = await runtimeFixture();
  const send = vi.spyOn(f.api, "sendUserMessage").mockImplementation(() => undefined);
  const approval: PlanApproval = {
    version: 1,
    planId: "approved-plan",
    revision: 1,
    sessionId: f.manager.getSessionId(),
    cwd: f.ctx.cwd,
    planPath: join(f.ctx.cwd, "approved.md"),
    planContent: "# Approved\nImplementation awaits separate authorization.\n",
    approvedAt: "2026-09-12T19:00:00.000Z",
    ...(notes
      ? {
          notes: { overall: "Keep Unicode: 日本語", blocks: [] },
          notesPath: join(f.ctx.cwd, "approved.notes.md"),
          notesContent: "# Supplementary notes\nKeep Unicode: 日本語\n",
        }
      : {}),
  };
  await writeFile(approval.planPath, approval.planContent);
  if (approval.notesPath !== undefined) {
    await writeFile(approval.notesPath, approval.notesContent ?? "");
  }
  const wait = vi.fn<ExtensionCommandContext["waitForIdle"]>().mockResolvedValue(undefined);
  const replace = vi.fn<ExtensionCommandContext["newSession"]>();
  const ctx: ExtensionCommandContext = {
    ...f.ctx,
    getSystemPromptOptions: unused,
    waitForIdle: wait,
    newSession: replace,
    fork: unused,
    navigateTree: unused,
    switchSession: unused,
    reload: unused,
  };
  const freshSend = vi.fn<FreshContext["sendUserMessage"]>().mockResolvedValue(undefined);
  const fresh: FreshContext = {
    ...ctx,
    sessionManager: { ...ctx.sessionManager, getSessionId: () => "replacement" },
    sendUserMessage: freshSend,
    sendMessage: async () => {
      await Promise.resolve();
    },
  };
  replace.mockImplementation(async (options) => {
    await options?.withSession?.(fresh);
    return { cancelled: false };
  });
  const handoff = new PlanHandoff(f.api);
  const token = () => {
    const value = send.mock.calls[0]?.[0];
    if (typeof value !== "string" || !value.startsWith("/plan __handoff ")) {
      throw new Error("Missing internal command");
    }
    return value.slice("/plan __handoff ".length);
  };
  return { ...f, handoff, approval, send, ctx, wait, replace, fresh, freshSend, token };
}

test.for([undefined, "Decide later"])(
  "selector dismissal %s preserves approval and composer text",
  async (selection, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    const editor = "Unsent composer text";
    vi.spyOn(f.ctx.ui, "getEditorText").mockReturnValue(editor);
    const setText = vi.spyOn(f.ctx.ui, "setEditorText");
    const select = vi.spyOn(f.ctx.ui, "select").mockResolvedValue(selection);
    expect(await f.handoff.request(f.ctx, f.approval, "options")).toContain(
      "No implementation requested",
    );
    expect(select.mock.calls[0]?.slice(0, 2)).toEqual([
      "Implement approved plan?",
      ["Implement in this session", "Implement in a new session", "Decide later"],
    ]);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.wait).not.toHaveBeenCalled();
    expect(setText).not.toHaveBeenCalled();
    expect(f.ctx.ui.getEditorText()).toBe(editor);
    expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
  },
);

test.for(["here", "new"] as const)(
  "%s implementation waits for idle and includes explicit authorization and notes",
  async (destination, { onTestFinished }) => {
    const f = await fixture(true);
    onTestFinished(f.dispose);
    const idle = Promise.withResolvers<undefined>();
    f.wait.mockReturnValue(idle.promise);
    await f.handoff.request(f.ctx, f.approval, destination);
    expect(f.send.mock.calls[0]?.[1]).toEqual({ expandPromptTemplates: true });
    const launch = f.handoff.dispatch(f.token(), f.ctx);
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.freshSend).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
    idle.resolve(undefined);
    await launch;
    const content =
      destination === "here" ? f.send.mock.calls[1]?.[0] : f.freshSend.mock.calls[0]?.[0];
    expect(content).toContain(JSON.stringify(f.approval.planPath));
    expect(content).toContain("authorizes execution now");
    expect(content).toContain(f.approval.notesContent);
    expect(f.replace).toHaveBeenCalledTimes(destination === "here" ? 0 : 1);
    expect(f.send).toHaveBeenCalledTimes(destination === "here" ? 2 : 1);
    await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("already consumed");
    await expect(f.handoff.request(f.ctx, f.approval, destination)).rejects.toThrow(
      "already dispatched",
    );
    expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
  },
);

test.for(["Implement in this session", "Implement in a new session"])(
  "selector routes %s without confirmation",
  async (selection, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    vi.spyOn(f.ctx.ui, "select").mockResolvedValue(selection);
    const confirm = vi.spyOn(f.ctx.ui, "confirm");
    await f.handoff.request(f.ctx, f.approval, "options");
    await f.handoff.dispatch(f.token(), f.ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(f.replace).toHaveBeenCalledTimes(selection === "Implement in a new session" ? 1 : 0);
  },
);

test("replacement cancellation preserves approval and allows an explicit later action", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  f.replace.mockResolvedValue({ cancelled: true });
  await f.handoff.request(f.ctx, f.approval, "new");
  await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("replacement was cancelled");
  expect(f.freshSend).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
  await expect(f.handoff.request(f.ctx, f.approval, "here")).resolves.toContain("authorized");
});

test.for(["replace", "prompt"] as const)(
  "%s failure preserves artifacts and does not retry ambiguous launch",
  async (failure, { onTestFinished }) => {
    const f = await fixture(true);
    onTestFinished(f.dispose);
    if (failure === "replace") {
      f.replace.mockRejectedValue(new Error("Replacement failed"));
    } else {
      f.freshSend.mockRejectedValue(new Error("Submission failed"));
    }
    await f.handoff.request(f.ctx, f.approval, "new");
    await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("No automatic retry");
    expect(f.replace).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
    await expect(f.handoff.request(f.ctx, f.approval, "new")).rejects.toThrow("already dispatched");
  },
);

test.for(["invalidate", "session", "interrupt"] as const)(
  "%s during idle wait prevents stale launch",
  async (change, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    const idle = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    f.wait.mockReturnValue(idle.promise);
    await f.handoff.request(f.ctx, f.approval, "new", controller.signal);
    const launch = f.handoff.dispatch(f.token(), f.ctx);
    if (change === "invalidate") {
      f.handoff.invalidate();
    } else if (change === "session") {
      vi.spyOn(f.ctx.sessionManager, "getSessionId").mockReturnValue("changed");
    } else {
      controller.abort();
    }
    idle.resolve(undefined);
    await launch;
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);

test("invalidated selector ignores a late affirmative result", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const selection = Promise.withResolvers<string | undefined>();
  vi.spyOn(f.ctx.ui, "select").mockReturnValue(selection.promise);
  const request = f.handoff.request(f.ctx, f.approval, "options");
  f.handoff.invalidate();
  selection.resolve("Implement in a new session");
  await request;
  expect(f.send).not.toHaveBeenCalled();
});

test.for(["plan", "notes"] as const)(
  "changed %s artifact blocks dispatch and permits retry after repair",
  async (artifact, { onTestFinished }) => {
    const f = await fixture(true);
    onTestFinished(f.dispose);
    const path = artifact === "plan" ? f.approval.planPath : (f.approval.notesPath ?? "");
    await f.handoff.request(f.ctx, f.approval, "new");
    await writeFile(path, "Changed");
    await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("artifacts changed");
    expect(f.replace).not.toHaveBeenCalled();
    await writeFile(
      path,
      artifact === "plan" ? f.approval.planContent : (f.approval.notesContent ?? ""),
    );
    await expect(f.handoff.request(f.ctx, f.approval, "new")).resolves.toContain("authorized");
  },
);

test("duplicate command while waiting cannot claim the action twice", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const idle = Promise.withResolvers<undefined>();
  f.wait.mockReturnValue(idle.promise);
  await f.handoff.request(f.ctx, f.approval, "new");
  const pending = f.handoff.dispatch(f.token(), f.ctx);
  await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("already consumed");
  idle.resolve(undefined);
  await pending;
  expect(f.replace).toHaveBeenCalledTimes(1);
});

test.for([
  { keys: ["\r"], launch: true },
  { keys: ["\u001b"], launch: false },
  { keys: ["\u001b[B", "\u001b[B", "\r"], launch: false },
])(
  "native selector input $keys starts on the first option and dismisses normally",
  async ({ keys, launch }, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    initTheme("dark", false);
    vi.spyOn(f.ctx.ui, "select").mockImplementation(async (title, items) => {
      const selected = Promise.withResolvers<string | undefined>();
      const component = new ExtensionSelectorComponent(title, items, selected.resolve, () => {
        selected.resolve(undefined);
      });
      const rendered = component.render(100).join("\n");
      expect(rendered).toContain("Implement in this session");
      expect(rendered).toContain("Implement in a new session");
      expect(rendered).toContain("Decide later");
      for (const key of keys) {
        component.handleInput(key);
      }
      const result = await selected.promise;
      component.dispose();
      return result;
    });
    await f.handoff.request(f.ctx, f.approval, "options");
    expect(f.send).toHaveBeenCalledTimes(launch ? 1 : 0);
    if (launch) {
      await f.handoff.dispatch(f.token(), f.ctx);
    }
    expect(f.replace).not.toHaveBeenCalled();
  },
);
