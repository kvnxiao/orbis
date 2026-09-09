import { readFile } from "node:fs/promises";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";

import { approvalSchema } from "../src/approval.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

const viewSchema = Type.Object({
  version: Type.Number(),
  roundId: Type.String(),
  revision: Type.Number(),
});

test("browser approval saves before one idle notification and recovery never replays it", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const notifications: unknown[] = [];
  f.api.events.on("orbis:plan-approved", (payload) => {
    expect(f.ctx.isIdle()).toBe(true);
    notifications.push(payload);
  });
  let url: URL | undefined;
  const ctx: ExtensionContext = {
    ...f.ctx,
    ui: {
      ...f.ctx.ui,
      notify(message: string) {
        const match = /http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/.exec(message);
        if (match !== null) {
          url = new URL(match[0]);
        }
      },
    },
  };
  ctx.ui.select = async (_title, _items, options) =>
    await new Promise<string | undefined>((resolve) => {
      options?.signal?.addEventListener(
        "abort",
        () => {
          resolve(undefined);
        },
        { once: true },
      );
      if (options?.signal?.aborted === true) {
        resolve(undefined);
      }
    });
  f.runtime.start(ctx, "End-to-end browser review");
  f.runtime.switchInterface("browser");
  const planId = f.runtime.active?.planId;
  if (planId === undefined) {
    throw new Error("Missing plan identity");
  }
  const content = "# Objective\n\nUse the approved decisions.\n\n## Verification\nRun the suite.\n";
  const pending = f.runtime.review(ctx, { planId, expectedRevision: 0, markdown: content });
  await expect.poll(() => url).toBeDefined();
  const address = url;
  if (address === undefined) {
    throw new Error("Browser URL was not displayed");
  }
  const headers = {
    Authorization: `Bearer ${address.hash.slice(1)}`,
    "Content-Type": "application/json",
  };
  const view: unknown = await (await fetch(`${address.origin}/state`, { headers })).json();
  if (!Value.Check(viewSchema, view)) {
    throw new Error("Invalid browser view");
  }
  const body = JSON.stringify({
    version: view.version,
    roundId: view.roundId,
    revision: view.revision,
    action: { type: "approve" },
  });
  expect((await fetch(`${address.origin}/action`, { method: "POST", headers, body })).status).toBe(
    200,
  );
  expect((await pending).outcome).toBe("approval");
  await expect.poll(() => notifications.length).toBe(1);
  const payload = notifications[0];
  if (!Value.Check(approvalSchema, payload)) {
    throw new Error("Invalid approval event");
  }
  expect(payload.planContent).toBe(content);
  expect(await readFile(payload.planPath, "utf8")).toBe(content);
  expect(f.runtime.active?.accepted).toEqual(payload);
  expect((await fetch(`${address.origin}/action`, { method: "POST", headers, body })).status).toBe(
    409,
  );
  f.runtime.restore(ctx);
  expect(f.runtime.active?.phase).toBe("accepted");
  expect(notifications).toHaveLength(1);
  await expect(fetch(`${address.origin}/state`, { headers })).rejects.toThrow("fetch failed");
});
