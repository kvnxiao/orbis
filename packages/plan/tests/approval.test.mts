import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "vitest";

import { saveApproval } from "../src/approval.ts";
import type { PlanningSession } from "../src/runtime.ts";
import { presentReview, transitionReview } from "../src/state.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

async function fixture() {
  const f = await runtimeFixture();
  f.runtime.start(f.ctx, "Approval fixture");
  const active = f.runtime.active;
  if (active === undefined) {
    throw new Error("Missing plan");
  }
  const reviewed = presentReview(active, {
    planId: active.planId,
    expectedRevision: 0,
    markdown: "# Approved text\r\n\r\nPreserve **these bytes**.\r\n",
  });
  const state: PlanningSession = {
    ...active,
    ...transitionReview(reviewed, 1, { type: "approve" }),
  };
  return { ...f, state, directory: join(f.ctx.cwd, "plans") };
}

test("approval persists intent, exact file bytes, and acceptance in order", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const order: string[] = [];
  const result = saveApproval(f.state, f.directory, (state) => {
    order.push(state.phase);
    return f.persist(state);
  });
  expect(result.outcome).toBe("approval");
  expect(order).toEqual(["saving", "accepted"]);
  const accepted = result.state.accepted;
  if (accepted === undefined) {
    throw new Error("Missing acceptance");
  }
  expect(await readFile(accepted.planPath, "utf8")).toBe(f.state.reviews?.at(-1)?.markdown);
  expect(accepted).toEqual({
    version: 1,
    planId: f.state.planId,
    revision: 1,
    sessionId: f.state.sessionId,
    cwd: f.state.cwd,
    planPath: join(f.directory, `${f.state.planId}-1.md`),
    planContent: f.state.reviews?.at(-1)?.markdown,
    approvedAt: accepted.approvedAt,
  });
  expect(new Date(accepted.approvedAt).toISOString()).toBe(accepted.approvedAt);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.accepted).toEqual(accepted);
  expect(f.runtime.active?.phase).toBe("accepted");
  expect(saveApproval(result.state, f.directory, f.persist).outcome).toBe("error");
  expect(await readdir(f.directory)).toEqual([`${f.state.planId}-1.md`]);
});

test("failed acceptance requires explicit retry and reuses the saved artifact", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const failed = saveApproval(f.state, f.directory, (state) =>
    state.phase === "accepted"
      ? { saved: false, message: "Injected acceptance failure" }
      : f.persist(state),
  );
  expect(failed.outcome).toBe("error");
  expect(failed.state.accepted).toBeUndefined();
  expect(failed.state.phase).toBe("review");
  expect(await readdir(f.directory)).toEqual([`${f.state.planId}-1.md`]);
  f.runtime.restore(f.ctx);
  const restored = f.runtime.active;
  if (restored === undefined) {
    throw new Error("Missing restored intent");
  }
  expect(restored.phase).toBe("review");
  const retry = saveApproval(
    { ...restored, ...transitionReview(restored, 1, { type: "approve" }) },
    join(f.directory, "changed-setting"),
    f.persist,
  );
  expect(retry.outcome).toBe("approval");
  expect(retry.state.accepted?.planPath).toBe(failed.state.pendingApproval?.planPath);
  expect(await readdir(f.directory)).toEqual([`${f.state.planId}-1.md`]);
});

test("failed intent saving creates no artifact and traversal identities are rejected", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const failed = saveApproval(f.state, f.directory, () => ({
    saved: false,
    message: "Disk unavailable",
  }));
  expect(failed.outcome).toBe("error");
  await expect(readdir(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    saveApproval({ ...f.state, planId: "../../outside" }, f.directory, f.persist).outcome,
  ).toBe("error");
});

test("a collision preserves unrelated bytes and a fork discards the inherited approval intent", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const approved = saveApproval(f.state, f.directory, f.persist);
  const path = approved.state.accepted?.planPath;
  if (path === undefined) {
    throw new Error("Missing artifact");
  }
  await writeFile(path, "Unrelated content");
  const result = saveApproval(f.state, f.directory, f.persist);
  expect(result.outcome).toBe("error");
  expect(await readFile(path, "utf8")).toBe("Unrelated content");
  f.runtime.restore(f.ctx, true);
  expect(f.runtime.active?.planId).not.toBe(f.state.planId);
  expect(f.runtime.active?.pendingApproval).toBeUndefined();
});
