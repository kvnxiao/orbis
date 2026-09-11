import { readFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import type { PlanApproval } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
import { selectPresenter } from "./presenter-fixture.mts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("sibling continuations save distinct artifacts without changing identity during navigation", async ({
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
  f.runtime.start(f.ctx, "Branch objective");
  const planId = f.runtime.active?.planId;
  const origin = f.manager.getLeafId();
  if (planId === undefined || origin === null) {
    throw new Error("Missing branch origin");
  }
  const first = await f.runtime.review(f.ctx, {
    planId,
    expectedRevision: 0,
    markdown: "# First branch",
  });
  f.manager.branch(origin);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.planId).toBe(planId);
  const second = await f.runtime.review(f.ctx, {
    planId,
    expectedRevision: 0,
    markdown: "# Second branch",
  });
  if (first.outcome !== "approval" || second.outcome !== "approval") {
    throw new Error("Approval failed");
  }
  expect(first.approval.planId).toBe(planId);
  expect(second.approval.planId).not.toBe(planId);
  expect(await readFile(first.approval.planPath, "utf8")).toBe("# First branch");
  expect(await readFile(second.approval.planPath, "utf8")).toBe("# Second branch");
});

test("foreign-session continuation assigns its own artifact identity before acceptance", async ({
  onTestFinished,
}) => {
  const origin = await runtimeFixture();
  const foreign = await runtimeFixture();
  onTestFinished(origin.dispose);
  onTestFinished(foreign.dispose);
  origin.runtime.start(origin.ctx, "Continue elsewhere");
  const plan = origin.runtime.active;
  if (plan === undefined) {
    throw new Error("Missing original plan");
  }
  expect(foreign.persist(plan).saved).toBe(true);
  foreign.runtime.restore(foreign.ctx);
  expect(foreign.runtime.active?.planId).toBe(plan.planId);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  const result = await foreign.runtime.review(foreign.ctx, {
    planId: plan.planId,
    expectedRevision: 0,
    markdown: "# Foreign continuation",
  });
  if (result.outcome !== "approval") {
    throw new Error("Approval failed");
  }
  expect(result.approval.planId).not.toBe(plan.planId);
  expect(result.approval.sessionId).toBe(foreign.manager.getSessionId());
  expect(result.approval.cwd).toBe(foreign.ctx.cwd);
  expect(await readFile(result.approval.planPath, "utf8")).toBe("# Foreign continuation");
});

test.for([false, true])(
  "pending approval notification is invalidated by replacement: %s",
  async (replace, { onTestFinished }) => {
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
    let idle = false;
    const ctx = { ...f.ctx, isIdle: () => idle, abort: vi.fn<() => void>() };
    const events: unknown[] = [];
    f.api.events.on("orbis:plan-approved", (payload) => events.push(payload));
    f.runtime.start(ctx, "Pending notification");
    const result = await f.runtime.review(ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Approved",
    });
    expect(result.outcome).toBe("approval");
    expect(events).toEqual([]);
    f.runtime.settled(ctx);
    expect(events).toEqual([]);
    if (replace) {
      f.runtime.restore(ctx);
    }
    idle = true;
    f.runtime.settled(ctx);
    f.runtime.settled(ctx);
    expect(events).toEqual(replace || result.outcome !== "approval" ? [] : [result.approval]);
  },
);

test.each(["terminal", "presenter"])(
  "%s approval saves exact Markdown before one idle notification",
  async (view) => {
    const f = await runtimeFixture();
    const cleanup =
      view === "presenter"
        ? selectPresenter(f, async (request) => {
            await Promise.resolve();
            return { identity: request.identity, action: { type: "approve" } };
          })
        : (() => {
            const mock = vi
              .spyOn(terminal, "terminalReview")
              .mockImplementation(async (_ctx, _read, dispatch) => {
                dispatch({ type: "approve" });
                await Promise.resolve();
              });
            return () => {
              mock.mockRestore();
            };
          })();
    try {
      const notifications: unknown[] = [];
      f.api.events.on("orbis:plan-approved", (payload) => {
        expect(f.ctx.isIdle()).toBe(true);
        notifications.push(payload);
      });
      f.runtime.start(f.ctx, "End-to-end review");
      const content = "# Objective\r\n\r\nUse **these** bytes. é\r\n";
      const result = await f.runtime.review(f.ctx, {
        planId: f.runtime.active?.planId ?? "",
        expectedRevision: 0,
        markdown: content,
      });
      expect(result.outcome).toBe("approval");
      if (result.outcome !== "approval") {
        throw new Error("Approval failed");
      }
      const approved: PlanApproval = result.approval;
      expect(await readFile(approved.planPath, "utf8")).toBe(content);
      expect(f.runtime.active?.accepted).toEqual(approved);
      await expect.poll(() => notifications).toEqual([approved]);
      f.runtime.restore(f.ctx);
      expect(f.runtime.active?.phase).toBe("accepted");
      expect(notifications).toEqual([approved]);
    } finally {
      cleanup();
      await f.dispose();
    }
  },
);
