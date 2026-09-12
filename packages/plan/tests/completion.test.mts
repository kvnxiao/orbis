import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test, vi } from "vitest";

import * as terminal from "../src/pi/terminal.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("successful approval finishes without aborting the agent", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const abort = vi.spyOn(f.ctx, "abort");
  vi.spyOn(f.ctx.ui, "select").mockResolvedValue(undefined);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Completion");
  const result = await f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Approved\n",
  });
  expect(result.outcome).toBe("approval");
  expect(abort).not.toHaveBeenCalled();
  expect(await toolResult(result)).toMatchObject({ terminate: true });
});

test("review closes before the immediate selector while the approval tool remains pending", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const selection = Promise.withResolvers<string | undefined>();
  const opened = Promise.withResolvers<undefined>();
  const order: string[] = [];
  vi.spyOn(f.ctx, "isIdle").mockReturnValue(false);
  const abort = vi.spyOn(f.ctx, "abort");
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
      order.push("review closed");
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  const select = vi.spyOn(f.ctx.ui, "select").mockImplementation(async () => {
    order.push("selector opened");
    expect(f.runtime.active?.phase).toBe("accepted");
    opened.resolve(undefined);
    return await selection.promise;
  });
  f.runtime.start(f.ctx, "Ordering");
  const review = f.runtime
    .review(f.ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Exact\r\n",
    })
    .then((result) => {
      order.push("tool completed");
      return result;
    });
  await opened.promise;
  expect(order).toEqual(["review closed", "selector opened"]);
  selection.resolve(undefined);
  expect((await review).outcome).toBe("approval");
  expect(order).toEqual(["review closed", "selector opened", "tool completed"]);
  expect(abort).not.toHaveBeenCalled();
  f.runtime.restore(f.ctx);
  expect(select).toHaveBeenCalledTimes(1);
  expect(f.runtime.active?.phase).toBe("accepted");
});

test("natural-language action routing selects ambiguous saved approvals and rejects unknown identities", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "One");
  await f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# One",
  });
  const firstId = f.runtime.active?.planId;
  f.runtime.start(f.ctx, "Two");
  await f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Two",
  });
  const send = vi.spyOn(f.api, "sendUserMessage").mockImplementation(() => undefined);
  const select = vi.spyOn(f.ctx.ui, "select").mockImplementation(async (_title, labels) => {
    await Promise.resolve();
    return labels.find((label) => label.includes(firstId ?? "missing"));
  });
  const unknown = await f.runtime.implement(f.ctx, "new", "unknown");
  expect(unknown.outcome).toBe("error");
  expect(send).not.toHaveBeenCalled();
  const selected = await f.runtime.implement(f.ctx, "new");
  expect(select.mock.calls[0]?.[0]).toBe("Select an approved plan");
  expect(selected).toMatchObject({ outcome: "approval", approval: { planId: firstId } });
  expect(send).toHaveBeenCalledTimes(1);
});

test("implementing an archived approval pauses unfinished planning", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Approved work");
  const planId = f.runtime.active?.planId;
  await f.runtime.review(f.ctx, {
    planId: planId ?? "",
    expectedRevision: 0,
    markdown: "# Approved",
  });
  f.runtime.start(f.ctx, "Unfinished work");
  const unfinishedId = f.runtime.active?.planId;
  await f.runtime.implement(f.ctx, "options", planId);
  expect(f.runtime.mode).toBe("plan");
  expect(f.runtime.active).toMatchObject({ planId: unfinishedId, phase: "research" });
  vi.spyOn(f.api, "sendUserMessage").mockImplementation(() => {
    expect(f.runtime.mode).toBe("default");
    expect(f.runtime.active).toMatchObject({ planId: unfinishedId, phase: "cancelled" });
  });
  await f.runtime.implement(f.ctx, "here", planId);
  f.runtime.restore(f.ctx);
  expect(f.runtime.mode).toBe("default");
  expect(f.runtime.active).toMatchObject({ planId: unfinishedId, phase: "cancelled" });
});

test("oversized approval retains termination and visible completion guidance", async ({
  onTestFinished,
}) => {
  const result = await toolResult({
    outcome: "approval",
    message: "Approved",
    approval: {
      version: 1,
      planId: "large",
      revision: 1,
      sessionId: "session",
      cwd: "/tmp",
      planPath: "/tmp/large.md",
      planContent: "Long plan\n".repeat(20000),
      approvedAt: "2026-09-12T19:00:00.000Z",
    },
  });
  expect(result.terminate).toBe(true);
  expect(JSON.stringify(result.content)).toContain("Acknowledge approval and finish");
  const details = result.details;
  if (!("resultPath" in details)) {
    throw new Error("Expected truncated approval");
  }
  onTestFinished(async () => {
    await rm(dirname(details.resultPath), { recursive: true, force: true });
  });
  expect(await readFile(details.resultPath, "utf8")).toContain("Long plan");
});
