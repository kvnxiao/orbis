import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import type { PlanApproval } from "../src/domain/state.ts";
import { PlanHandoff } from "../src/pi/handoff.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import { readLaunches } from "../src/storage/launches.ts";
import * as persistence from "../src/storage/persistence.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

type ReplacementOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>;
type FreshContext = Parameters<NonNullable<ReplacementOptions["withSession"]>>[0];
const unused = () => {
  throw new Error("Unexpected session operation");
};

async function fixture(notes = false) {
  const f = await runtimeFixture();
  const send = vi.spyOn(f.api, "sendUserMessage").mockImplementation(() => undefined);
  const planId = randomUUID();
  const bootstrap = vi.spyOn(f.api, "sendMessage").mockImplementation(() => undefined);
  const approval: PlanApproval = {
    version: 1,
    planId,
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
          notesContent: `# Supplementary notes\n\nPlan: ${planId}\nRevision: 1\n\nKeep Unicode: 日本語\n`,
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
  const freshSend = vi.fn<FreshContext["sendMessage"]>().mockResolvedValue(undefined);
  const fresh: FreshContext = {
    ...ctx,
    sessionManager: { ...ctx.sessionManager, getSessionId: () => "replacement" },
    sendUserMessage: async () => {
      await Promise.resolve();
    },
    sendMessage: freshSend,
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
  return { ...f, handoff, approval, send, bootstrap, ctx, wait, replace, fresh, freshSend, token };
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
    const stored = readLaunches(f.ctx).at(-1);
    if (stored === undefined) {
      throw new Error("Missing launch receipt");
    }
    const result = f.handoff.result(destination === "here" ? f.ctx : f.fresh, {
      ...stored,
      status: "received",
      sessionId: destination === "here" ? f.manager.getSessionId() : "replacement",
    });
    const content = "message" in result ? result.message : "";
    expect(content).toContain(JSON.stringify(f.approval.planPath));
    expect(content).toContain("Implement the approved plan: Approved");
    expect(content).toContain("authorizes execution now");
    expect(content).toContain(f.approval.notesContent);
    expect(f.replace).toHaveBeenCalledTimes(destination === "here" ? 0 : 1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.bootstrap).toHaveBeenCalledTimes(destination === "here" ? 1 : 0);
    await expect(f.handoff.dispatch(f.token(), f.ctx)).rejects.toThrow("already consumed");
    expect(await f.handoff.request(f.ctx, f.approval, destination)).toMatchObject({
      id: stored.id,
    });
    expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
  },
);

test.for([
  ["```md\n# Not the title\n```\n\n# Add `/clear` — 日本語\n", "Add `/clear` — 日本語"],
  ["Setext title\n============\n\nBody\n", "Setext title"],
  ["#\n\n# Useful title\n\n# Later title\n", "Useful title"],
  ["> # Quoted heading\n\nOrdinary text\n", ""],
] as const)(
  "handoff derives its title from top-level Markdown headings: %s",
  async ([markdown, title], { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    f.approval.planContent = markdown;
    await writeFile(f.approval.planPath, markdown);
    await f.handoff.request(f.ctx, f.approval, "here");
    await f.handoff.dispatch(f.token(), f.ctx);
    const record = readLaunches(f.ctx).at(-1);
    if (record === undefined) {
      throw new Error("Missing receipt");
    }
    const result = f.handoff.result(f.ctx, record);
    const content = "message" in result ? result.message : "";
    expect(content).toContain(
      title === ""
        ? "Implement the approved plan at this absolute Markdown path:"
        : `Implement the approved plan: ${title}`,
    );
    expect(content).toContain(JSON.stringify(f.approval.planPath));
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
  await expect(
    f.handoff.request(f.ctx, f.approval, "here", undefined, undefined, true),
  ).resolves.toContain("authorized");
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
    const repeated = await f.handoff.request(f.ctx, f.approval, "new");
    expect(repeated).toMatchObject({ status: "failed" });
    if (typeof repeated === "string") {
      throw new Error("Missing failure receipt");
    }
    expect(f.handoff.result(f.ctx, repeated)).toMatchObject({ outcome: "error" });
    expect(f.replace).toHaveBeenCalledTimes(1);
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
    await expect(
      f.handoff.request(f.ctx, f.approval, "new", undefined, undefined, true),
    ).resolves.toContain("authorized");
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

test("repeated destinations reuse a pending launch across restoration", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  await f.handoff.request(f.ctx, f.approval, "new");
  const original = readLaunches(f.ctx).at(-1);
  expect(await f.handoff.request(f.ctx, f.approval, "here")).toEqual(original);
  const restored = new PlanHandoff(f.api);
  expect(await restored.request(f.ctx, f.approval, "new")).toEqual(original);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.replace).not.toHaveBeenCalled();
  if (original === undefined) {
    throw new Error("Missing receipt");
  }
  expect(await toolResult(restored.result(f.ctx, original))).toMatchObject({ terminate: true });
});

test("receiving tools continue a saved launch without a planning record or another prompt", async ({
  onTestFinished,
}) => {
  const f = await fixture(true);
  onTestFinished(f.dispose);
  await f.handoff.request(f.ctx, f.approval, "here");
  await f.handoff.dispatch(f.token(), f.ctx);
  const original = readLaunches(f.ctx).at(-1);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active).toBeUndefined();
  const first = await f.runtime.implement(f.ctx, "here", f.approval.planId);
  const repeated = await f.runtime.implement(f.ctx, "new", f.approval.planId);
  expect(repeated).toEqual(first);
  expect(first).toMatchObject({
    outcome: "implementation",
    status: "received",
    launchId: original?.id,
  });
  expect(await toolResult(first)).not.toHaveProperty("terminate");
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.bootstrap).toHaveBeenCalledTimes(1);
  expect(f.bootstrap.mock.calls[0]?.[0]).toMatchObject({ display: false });
  expect(f.replace).not.toHaveBeenCalled();
});

test("explicit restart creates a new launch and preserves the previous receipt", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  await f.handoff.request(f.ctx, f.approval, "here");
  await f.handoff.dispatch(f.token(), f.ctx);
  const first = readLaunches(f.ctx).at(-1);
  await f.handoff.request(f.ctx, f.approval, "new", undefined, undefined, true);
  const records = readLaunches(f.ctx);
  expect(records.at(-1)?.id).not.toBe(first?.id);
  expect(records).toContainEqual(first);
  expect(f.send).toHaveBeenCalledTimes(2);
});

test("restored launch rejects changed artifacts before returning execution instructions", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  await f.handoff.request(f.ctx, f.approval, "here");
  await f.handoff.dispatch(f.token(), f.ctx);
  await writeFile(f.approval.planPath, "Changed");
  expect(await f.runtime.implement(f.ctx, "here", f.approval.planId)).toMatchObject({
    outcome: "error",
  });
  await writeFile(f.approval.planPath, f.approval.planContent);
  expect(await f.runtime.implement(f.ctx, "here", f.approval.planId)).toMatchObject({
    outcome: "implementation",
    status: "received",
  });
  expect(f.bootstrap).toHaveBeenCalledTimes(1);
});

test("invalid saved launch records cannot authorize execution", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  f.api.appendEntry("orbis-plan-launch", { version: 1, approval: f.approval });
  await expect(f.runtime.implement(f.ctx, "here", f.approval.planId)).rejects.toThrow(
    "Invalid implementation launch record",
  );
  expect(f.send).not.toHaveBeenCalled();
});

test("receiving a repeated launch pauses another unfinished plan", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  await f.handoff.request(f.ctx, f.approval, "here");
  await f.handoff.dispatch(f.token(), f.ctx);
  f.runtime.start(f.ctx, "Another unfinished plan");
  expect(f.runtime.mode).toBe("plan");
  expect(await f.runtime.implement(f.ctx, "new", f.approval.planId)).toMatchObject({
    outcome: "implementation",
    status: "received",
  });
  expect(f.runtime.mode).toBe("default");
  expect(f.runtime.active?.phase).toBe("cancelled");
  expect(f.bootstrap).toHaveBeenCalledTimes(1);
});

test.for(["requested", "received"] as const)(
  "failed %s persistence prevents external dispatch",
  async (status, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    const save = persistence.saveRecord;
    const failure = vi
      .spyOn(persistence, "saveRecord")
      .mockImplementation((pi, ctx, data, file, kind) => {
        if (
          kind === "orbis-plan-launch" &&
          typeof data === "object" &&
          data !== null &&
          "status" in data &&
          data.status === status
        ) {
          return { saved: false, message: "Injected receipt persistence failure" };
        }
        return save(pi, ctx, data, file, kind);
      });
    onTestFinished(() => {
      failure.mockRestore();
    });
    const action = async () => {
      await f.handoff.request(f.ctx, f.approval, "here");
      await f.handoff.dispatch(f.token(), f.ctx);
    };
    await expect(action()).rejects.toThrow("Injected receipt persistence failure");
    expect(f.send).toHaveBeenCalledTimes(status === "requested" ? 0 : 1);
    expect(readLaunches(f.ctx).at(-1)?.status).toBe(status === "requested" ? undefined : "failed");
    expect(f.bootstrap).not.toHaveBeenCalled();
    expect(f.replace).not.toHaveBeenCalled();
    failure.mockRestore();
    await f.handoff.request(f.ctx, f.approval, "here", undefined, undefined, true);
    const command = f.send.mock.calls.at(-1)?.[0];
    if (typeof command !== "string") {
      throw new Error("Missing restart command");
    }
    await f.handoff.dispatch(command.slice("/plan __handoff ".length), f.ctx);
    expect(f.bootstrap).toHaveBeenCalledTimes(1);
  },
);
