import { readFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import type { PlanApproval } from "../src/state.ts";
import * as terminal from "../src/terminal.ts";
import { selectPresenter } from "./presenter-fixture.mts";
import { runtimeFixture } from "./runtime-fixture.mts";

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
