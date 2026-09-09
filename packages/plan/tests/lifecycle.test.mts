import { expect, test, vi } from "vitest";

import * as config from "../src/config.ts";
import { presentRound } from "../src/state.ts";
import type { RoundAction } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
import * as results from "../src/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("browser draft edits preserve delivery of the pending clarification", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Objective");
  const active = f.runtime.active;
  if (active === undefined) {
    throw new Error("Missing plan");
  }
  f.persist({
    ...active,
    ...presentRound(active, {
      planId: active.planId,
      roundId: "round",
      expectedRevision: 0,
      questions: [
        { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
      ],
    }),
  });
  f.runtime.restore(f.ctx);
  f.runtime.switchInterface("browser");
  let address: URL | undefined;
  const post = async (action: RoundAction) => {
    if (address === undefined) {
      throw new Error("Missing browser URL");
    }
    const headers = {
      Authorization: `Bearer ${address.hash.slice(1)}`,
      "Content-Type": "application/json",
    };
    const view: unknown = await (await fetch(`${address.origin}/state`, { headers })).json();
    if (
      typeof view !== "object" ||
      view === null ||
      !("version" in view) ||
      typeof view.version !== "number"
    ) {
      throw new Error("Missing browser version");
    }
    const response = await fetch(`${address.origin}/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: view.version, roundId: "round", revision: 1, action }),
    });
    expect(response.status).toBe(200);
  };
  const preparing = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const serialize = vi.spyOn(results, "toolResult").mockImplementation(async () => {
    preparing.resolve(undefined);
    await release.promise;
    return {
      content: [{ type: "text", text: "Pending clarification" }],
      details: { outcome: "cancelled" },
    };
  });
  const send = vi.spyOn(f.api, "sendMessage");
  const pending = f.runtime.reopen({
    ...f.ctx,
    ui: {
      ...f.ctx.ui,
      async select(title) {
        const match = /http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/.exec(title);
        if (match === null) {
          throw new Error("Missing browser address");
        }
        address = new URL(match[0]);
        await post({
          type: "clarify",
          questionId: "scope",
          id: "why",
          request: "What is included?",
        });
        return undefined;
      },
    },
  });
  try {
    await preparing.promise;
    await post({ type: "edit", questionId: "scope", unfinished: "Keep this draft" });
    release.resolve(undefined);
    await pending;
    expect(send).toHaveBeenCalledOnce();
    expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("Keep this draft");
    expect(f.runtime.active?.phase).toBe("clarification");
  } finally {
    release.resolve(undefined);
    await pending;
    serialize.mockRestore();
    send.mockRestore();
  }
});

test.each([false, true])(
  "prepared input is delivered only to its owning session (restore=%s)",
  async (restore) => {
    const f = await runtimeFixture();
    f.runtime.start(f.ctx, "Objective");
    const active = f.runtime.active;
    if (active === undefined) {
      throw new Error("Missing plan");
    }
    f.persist({
      ...active,
      ...presentRound(active, {
        planId: active.planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
        ],
      }),
    });
    f.runtime.restore(f.ctx);
    const preparing = Promise.withResolvers<undefined>();
    const prepared = Promise.withResolvers<Awaited<ReturnType<typeof results.toolResult>>>();
    const serialize = vi.spyOn(results, "toolResult").mockImplementation(async () => {
      preparing.resolve(undefined);
      return await prepared.promise;
    });
    const view = vi
      .spyOn(terminal, "terminalRound")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "answer", questionId: "scope", answer: { custom: "CLI" } });
        dispatch({ type: "submit" });
        await Promise.resolve();
      });
    const send = vi.spyOn(f.api, "sendMessage");
    const content = [{ type: "text" as const, text: "Prepared answers" }];
    const pending = f.runtime.reopen(f.ctx);
    try {
      await preparing.promise;
      if (restore) {
        f.runtime.restore(f.ctx, true);
      }
      prepared.resolve({
        content,
        details: { outcome: "answers", roundId: "round", revision: 1, decisions: {} },
      });
      await pending;
      expect(send.mock.calls).toEqual(
        restore
          ? []
          : [[{ customType: "orbis-plan-input", content, display: true }, { triggerTurn: true }]],
      );
    } finally {
      prepared.resolve({ content, details: { outcome: "cancelled" } });
      await pending;
      serialize.mockRestore();
      view.mockRestore();
      send.mockRestore();
      await f.dispose();
    }
  },
);

test("an obsolete interaction cannot clear or abort the replacement interaction", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Objective");
  const planId = f.runtime.active?.planId;
  if (planId === undefined) {
    throw new Error("Missing plan");
  }
  const oldSettings = Promise.withResolvers<config.PlanSettings>();
  const settings = vi
    .spyOn(config, "readSettings")
    .mockImplementationOnce(async () => await oldSettings.promise);
  const viewOpened = Promise.withResolvers<undefined>();
  const viewDone = Promise.withResolvers<undefined>();
  let viewSignal: AbortSignal | undefined;
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, _read, _dispatch, signal) => {
      viewSignal = signal;
      viewOpened.resolve(undefined);
      await viewDone.promise;
    });
  try {
    const oldSignal = new AbortController();
    const previous = f.runtime.round(
      f.ctx,
      {
        planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", prerequisites: [], context: "Known", prompt: "Scope?", options: [] },
        ],
      },
      oldSignal.signal,
    );
    f.runtime.restore(f.ctx, true);
    const replacement = f.runtime.interact(f.ctx);
    await viewOpened.promise;
    oldSettings.resolve({ interface: "browser", planDirectory: f.ctx.cwd });
    await expect(previous).resolves.toEqual({ outcome: "cancelled" });
    oldSignal.abort();
    expect(viewSignal?.aborted).toBe(false);
    expect(f.runtime.start(f.ctx, "Must not replace", true).outcome).toBe("error");
    viewDone.resolve(undefined);
    await replacement;
  } finally {
    oldSettings.resolve({ interface: "terminal", planDirectory: f.ctx.cwd });
    viewDone.resolve(undefined);
    settings.mockRestore();
    view.mockRestore();
  }
});

test("session restoration aborts replacement confirmation and rejects a late response", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Original");
  const confirmation = Promise.withResolvers<boolean>();
  const opened = Promise.withResolvers<undefined>();
  let signal: AbortSignal | undefined;
  const pending = f.runtime.requestStart(
    {
      ...f.ctx,
      ui: {
        ...f.ctx.ui,
        async confirm(_title, _message, options) {
          signal = options?.signal;
          opened.resolve(undefined);
          return await confirmation.promise;
        },
      },
    },
    "Obsolete",
    true,
  );
  await opened.promise;
  f.runtime.restore(f.ctx, true);
  const restored = f.runtime.active?.planId;
  expect(signal?.aborted).toBe(true);
  confirmation.resolve(true);
  await expect(pending).resolves.toEqual({ outcome: "cancelled" });
  expect(f.runtime.active?.planId).toBe(restored);
  expect(f.runtime.active?.objective).toBe("Original");
});

test("current interface settings write failures reject the request", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const write = vi
    .spyOn(config, "writeSettings")
    .mockRejectedValue(new Error("Current settings failure"));
  try {
    await expect(f.runtime.chooseInterface(f.ctx, "browser")).rejects.toThrow(
      "Current settings failure",
    );
  } finally {
    write.mockRestore();
  }
});

test.each(["resolve", "reject"])(
  "obsolete interface settings requests that %s do not switch the restored session",
  async (settlement) => {
    const f = await runtimeFixture();
    const pendingWrite = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const write = vi.spyOn(config, "writeSettings").mockImplementation(async () => {
      started.resolve(undefined);
      await pendingWrite.promise;
    });
    const switchView = vi.spyOn(f.runtime, "switchInterface");
    try {
      f.runtime.start(f.ctx, "Original");
      const pending = f.runtime.chooseInterface(f.ctx, "browser");
      await started.promise;
      f.runtime.restore(f.ctx, true);
      if (settlement === "resolve") {
        pendingWrite.resolve(undefined);
      } else {
        pendingWrite.reject(new Error("Old settings failure"));
      }
      await expect(pending).resolves.toBe(false);
      expect(switchView).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      switchView.mockRestore();
      await f.dispose();
    }
  },
);
