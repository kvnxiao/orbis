import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import {
  presentReview,
  presentRound,
  transitionReview,
  transitionRound,
  validSession,
} from "../src/domain/state.ts";
import type { PlanningSession } from "../src/domain/state.ts";
import { saveApproval } from "../src/storage/approval.ts";
import { prepareReviewArtifact } from "../src/storage/artifacts.ts";
import { readSavedRecord } from "../src/storage/persistence.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test.for(["planId", "sessionId", "revision", "planContent", "planPath", "approvedAt", "notesPath"])(
  "restoration rejects contradictory approval %s without rewriting the record",
  async (field, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    f.runtime.start(f.ctx, "Validation");
    const active = f.runtime.active;
    if (active === undefined) {
      throw new Error("Missing plan");
    }
    const directory = join(f.ctx.cwd, "plans");
    const prepared = prepareReviewArtifact(
      {
        ...active,
        ...presentReview(active, {
          planId: active.planId,
          expectedRevision: 0,
          markdown: "# Approved",
        }),
      },
      directory,
      f.persist,
    );
    const approval = saveApproval(
      { ...prepared, ...transitionReview(prepared, 1, { type: "approve" }) },
      directory,
      f.persist,
    );
    const invalid = structuredClone(approval.state);
    const accepted = invalid.accepted;
    if (accepted === undefined) {
      throw new Error("Missing approval");
    }
    Reflect.set(accepted, field, field === "revision" ? 5 : "invalid");
    expect(f.persist(invalid).saved).toBe(true);
    const path = f.manager.getSessionFile();
    if (path === undefined) {
      throw new Error("Missing session file");
    }
    const bytes = await readFile(path);
    const notify = vi.spyOn(f.ctx.ui, "notify");
    f.runtime.restore(f.ctx);
    expect(f.runtime.active).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("malformed"), "error");
    expect(await readFile(path)).toEqual(bytes);
    notify.mockRestore();
  },
);

test("restoration ignores JSON object member order", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Member order");
  const path = f.manager.getSessionFile();
  if (path === undefined) {
    throw new Error("Missing session file");
  }
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text
      .split("\n")
      .map((line) => {
        if (line.trim().length === 0) {
          return line;
        }
        const record: unknown = JSON.parse(line);
        if (typeof record !== "object" || record === null) {
          throw new Error("Expected session record");
        }
        return JSON.stringify(Object.fromEntries(Object.entries(record).toReversed()));
      })
      .join("\n"),
  );
  expect(readSavedRecord(f.ctx).status).toBe("record");
});

test("save rejects a branch rewrite during append even when its new record survives", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Append verification");
  const plan = f.runtime.active;
  const path = f.manager.getSessionFile();
  if (plan === undefined || path === undefined) {
    throw new Error("Missing persisted plan");
  }
  const append = f.api.appendEntry.bind(f.api);
  const spy = vi.spyOn(f.api, "appendEntry").mockImplementation((type, data) => {
    append(type, data);
    writeFileSync(path, readFileSync(path, "utf8").replace("Fixture response", "Changed response"));
  });
  onTestFinished(() => {
    spy.mockRestore();
  });
  expect(f.persist(plan).saved).toBe(false);
});

test.for(["unknown-option", "number-gap"])(
  "restoration rejects %s domain contradictions",
  async (field, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    f.runtime.start(f.ctx, "Domain validation");
    const active = f.runtime.active;
    if (active === undefined) {
      throw new Error("Missing plan");
    }
    let plan: PlanningSession = {
      ...active,
      ...presentRound(active, {
        planId: active.planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          { id: "q", prompt: "Scope?", context: "Known", prerequisites: [], options: [] },
        ],
      }),
    };
    plan = {
      ...plan,
      ...transitionRound(plan, "round", 1, {
        type: "answer",
        questionId: "q",
        answer: { custom: "Local" },
      }),
    };
    plan = { ...plan, ...transitionRound(plan, "round", 1, { type: "submit" }) };
    const decision = plan.decisions.q;
    const question = plan.round?.questions[0];
    if (decision === undefined || question === undefined) {
      throw new Error("Missing submitted question");
    }
    if (field === "unknown-option") {
      decision.answer = { optionId: "missing" };
    } else {
      plan.questionNumbers.q = 7;
      question.number = 7;
      decision.question.number = 7;
    }
    expect(f.persist(plan).saved).toBe(true);
    f.runtime.restore(f.ctx);
    expect(f.runtime.active).toBeUndefined();
  },
);

test("restoration retains same-named clarifications from different completed frontiers", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Clarification identity");
  let plan = f.runtime.active;
  if (plan === undefined) {
    throw new Error("Missing plan");
  }
  const questions = ["a", "b"].map((id) => ({
    id,
    prompt: `${id}?`,
    context: "Known",
    prerequisites: [],
    options: [],
  }));
  for (const question of questions) {
    const id = question.id;
    Object.assign(
      plan,
      presentRound(plan, {
        planId: plan.planId,
        roundId: id,
        expectedRevision: 0,
        questions: [question],
      }),
    );
    Object.assign(
      plan,
      transitionRound(plan, id, 1, {
        type: "clarify",
        questionId: id,
        id: "clarification",
        request: "Explain",
      }),
    );
    Object.assign(
      plan,
      presentRound(plan, {
        planId: plan.planId,
        roundId: id,
        expectedRevision: 1,
        questions: [question],
        clarification: { id: "clarification", response: "Details" },
      }),
    );
    Object.assign(
      plan,
      transitionRound(plan, id, 2, {
        type: "answer",
        questionId: id,
        answer: { custom: "Local" },
      }),
    );
    Object.assign(plan, transitionRound(plan, id, 2, { type: "submit" }));
  }
  plan = {
    ...plan,
    ...presentRound(plan, {
      planId: plan.planId,
      roundId: "combined",
      expectedRevision: 0,
      questions,
    }),
  };
  expect(validSession(plan)).toBe(true);
  expect(f.persist(plan).saved).toBe(true);
  f.runtime.restore(f.ctx);
  expect(
    f.runtime.active?.round?.clarifications.map(({ questionId, id }) => [questionId, id]),
  ).toEqual([
    ["a", "clarification"],
    ["b", "clarification"],
  ]);
});
