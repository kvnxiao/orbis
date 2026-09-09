import { expect, test } from "vitest";

import { presentRound, transitionRound } from "../src/state.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("entry preserves active work and replacement archives the unfinished plan", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const initial = f.runtime.start(f.ctx, "Plan local storage");
  expect(initial.outcome).toBe("started");
  const first = structuredClone(f.runtime.active);
  expect(f.runtime.start(f.ctx, "Different objective").outcome).toBe("active");
  expect(f.runtime.active).toEqual(first);
  expect(f.runtime.start({ ...f.ctx, mode: "rpc" }, "Ignored").outcome).toBe("unsupported-mode");
  expect(f.runtime.active).toEqual(first);
  f.runtime.start(f.ctx, "New objective", true);
  expect(f.runtime.unfinished).toEqual([first]);
  expect(f.runtime.active?.planId).not.toBe(first?.planId);
  f.runtime.restore(f.ctx);
  expect(f.runtime.unfinished).toEqual([first]);
  expect(f.runtime.active?.objective).toBe("New objective");
});

test("branch restore preserves its drafts and unanswered clarification without importing sibling answers", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.runtime.start(f.ctx, "Branch objective");
  const active = f.runtime.active;
  if (active === undefined) {
    throw new Error("Missing active plan");
  }
  const input = {
    planId: active.planId,
    roundId: "round",
    expectedRevision: 0,
    questions: [
      {
        id: "scope",
        prerequisites: [],
        prompt: "Scope?",
        context: "Repository inspected",
        options: [],
      },
    ],
  };
  const round = presentRound(active, input);
  const edited = transitionRound(round, "round", 1, {
    type: "edit",
    questionId: "scope",
    unfinished: "CLI first",
  });
  f.runtime.active = {
    ...active,
    ...transitionRound(edited, "round", 1, {
      type: "clarify",
      questionId: "scope",
      id: "request",
      request: "Does the CLI include import?",
    }),
  };
  expect(f.runtime.save(f.ctx).saved).toBe(true);
  const branchA = f.manager.getLeafId();
  f.runtime.start(f.ctx, "Sibling objective", true);
  const branchB = f.manager.getLeafId();
  if (branchA === null || branchB === null) {
    throw new Error("Missing branch leaves");
  }
  f.manager.branch(branchA);
  f.runtime.restore(f.ctx, true);
  expect(f.runtime.active.objective).toBe("Branch objective");
  expect(f.runtime.active.planId).not.toBe(active.planId);
  expect(f.runtime.active.phase).toBe("clarification");
  expect(f.runtime.active.round?.drafts.scope?.unfinished).toBe("CLI first");
  expect(f.runtime.active.round?.clarifications[0]?.response).toBeUndefined();
  expect(f.runtime.active.decisions).toEqual({});
  f.manager.branch(branchB);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active.objective).toBe("Sibling objective");
});

test("malformed branch records cannot initialize an interaction", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.manager.appendCustomEntry("orbis-plan", { version: 1, active: { phase: "round" } });
  f.runtime.restore(f.ctx);
  expect(f.runtime.active).toBeUndefined();
});

test("explicit resumption restores cancelled research while model review remains stopped", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.runtime.start(f.ctx, "Research objective");
  f.runtime.cancel(f.ctx);
  const planId = f.runtime.active?.planId;
  if (planId === undefined) {
    throw new Error("Missing plan identity");
  }
  expect(
    (
      await f.runtime.review(f.ctx, {
        planId,
        expectedRevision: 0,
        markdown: "Not authorized to resume",
      })
    ).outcome,
  ).toBe("error");
  expect(f.runtime.active?.phase).toBe("cancelled");
  expect(f.runtime.resumeCurrent(f.ctx)).toBe(true);
  expect(f.runtime.active?.phase).toBe("research");
  expect(f.runtime.active?.planId).toBe(planId);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.phase).toBe("research");
});
