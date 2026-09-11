import { mkdir, readFile, rename, rm } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import { presentReview, presentRound, transitionReview, transitionRound } from "../src/state.ts";
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
  expect(
    f.persist({
      ...active,
      ...transitionRound(edited, "round", 1, {
        type: "clarify",
        questionId: "scope",
        id: "request",
        request: "Does the CLI include import?",
      }),
    }).saved,
  ).toBe(true);
  f.runtime.restore(f.ctx);
  const branchA = f.manager.getLeafId();
  f.runtime.start(f.ctx, "Sibling objective", true);
  const branchB = f.manager.getLeafId();
  if (branchA === null || branchB === null) {
    throw new Error("Missing branch leaves");
  }
  f.manager.branch(branchA);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.objective).toBe("Branch objective");
  expect(f.runtime.active?.planId).toBe(active.planId);
  expect(f.runtime.active?.phase).toBe("clarification");
  expect(f.runtime.active?.round?.drafts.scope?.unfinished).toBe("CLI first");
  expect(f.runtime.active?.round?.clarifications[0]?.response).toBeUndefined();
  expect(f.runtime.active?.decisions).toEqual({});
  expect(f.runtime.active?.round?.questions[0]?.number).toBe(1);
  expect(f.runtime.active?.questionNumbers).toEqual({ scope: 1 });
  f.manager.branch(branchB);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.objective).toBe("Sibling objective");
});

test.for(["mode", "round", "review", "saving", "accepted", "answer", "stale-answer"])(
  "saved records validate %s before restoration",
  async (field, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(async () => {
      await f.dispose();
    });
    f.runtime.start(f.ctx, "Saved objective");
    const plan = f.runtime.active;
    if (plan === undefined) {
      throw new Error("Missing plan");
    }
    const active = {
      ...plan,
      ...presentRound(plan, {
        planId: plan.planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "scope", context: "Known", prompt: "Scope?", prerequisites: [], options: [] },
        ],
      }),
    };
    const record = { version: 1, mode: "plan", active, unfinished: [] };
    switch (field) {
      case "mode":
        Reflect.deleteProperty(record, "mode");
        break;
      case "round":
        Reflect.deleteProperty(active, "round");
        break;
      case "review":
      case "saving":
      case "accepted":
        active.phase = field;
        break;
      default:
        Reflect.set(active.round?.drafts ?? {}, "scope", {
          revision: 1,
          unfinished: "",
          answer: { optionId: "missing" },
        });
        if (field === "stale-answer") {
          const question = active.round?.questions[0];
          if (question !== undefined) {
            question.revision = 2;
          }
        }
    }
    f.manager.appendCustomEntry("orbis-plan", record);
    const path = f.manager.getSessionFile();
    if (path === undefined) {
      throw new Error("Missing session file");
    }
    const saved = await readFile(path, "utf8");
    const notify = vi.spyOn(f.ctx.ui, "notify");
    f.runtime.restore(f.ctx);
    const restorable = field === "stale-answer";
    expect(f.runtime.active !== undefined).toBe(restorable);
    expect(f.runtime.active?.round?.drafts.scope?.answer).toEqual(
      restorable ? { optionId: "missing" } : undefined,
    );
    const errors = notify.mock.calls.filter((call) => call[1] === "error").map((call) => call[0]);
    expect(errors).toEqual(
      restorable
        ? []
        : ["Cannot restore malformed planning state. The saved record remains unchanged."],
    );
    expect(await readFile(path, "utf8")).toBe(saved);
  },
);

test("an unreadable session file reports an error and restores nothing until it is readable", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.runtime.start(f.ctx, "Saved objective");
  const path = f.manager.getSessionFile();
  if (path === undefined) {
    throw new Error("Missing session file");
  }
  await rename(path, `${path}.backup`);
  await mkdir(path);
  const notify = vi.spyOn(f.ctx.ui, "notify");
  f.runtime.restore(f.ctx);
  expect(f.runtime.active).toBeUndefined();
  expect(f.runtime.mode).toBe("default");
  const errors = notify.mock.calls.filter((call) => call[1] === "error").map((call) => call[0]);
  expect(errors).toEqual([expect.stringContaining("Cannot read the Pi session file")]);
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.objective).toBe("Saved objective");
});

test("reopened questions supersede pending review and resume without approving obsolete text", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.runtime.start(f.ctx, "Reconsider storage");
  const active = f.runtime.active;
  if (active === undefined) {
    throw new Error("Missing plan");
  }
  const review = presentReview(active, {
    planId: active.planId,
    expectedRevision: 0,
    markdown: "# Old plan",
  });
  const questions = presentRound(review, {
    planId: active.planId,
    roundId: "reconsider",
    expectedRevision: 0,
    questions: [
      {
        id: "storage",
        prerequisites: [],
        prompt: "Storage?",
        context: "New constraint",
        options: [],
      },
    ],
  });
  expect(
    f.persist({
      ...active,
      ...transitionRound(questions, "reconsider", 1, { type: "cancel" }),
    }).saved,
  ).toBe(true);
  f.runtime.restore(f.ctx);
  expect(f.runtime.resumeCurrent(f.ctx)).toBe(true);
  expect(f.runtime.active?.phase).toBe("round");
  expect(f.runtime.active?.reviews?.at(-1)?.markdown).toBe("# Old plan");
  expect(f.runtime.active?.reviews?.at(-1)?.status).toBe("superseded");
  expect(() => transitionReview({ ...questions, phase: "review" }, 1, { type: "approve" })).toThrow(
    "Plan review changed",
  );
});

test("explicit resumption restores cancelled research while model review remains stopped", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  f.runtime.start(f.ctx, "Research objective");
  f.runtime.pause(f.ctx);
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
