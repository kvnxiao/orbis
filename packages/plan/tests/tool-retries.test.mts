import { writeFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import { PlanHandoff } from "../src/pi/handoff.ts";
import * as terminal from "../src/pi/terminal.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import { saveLaunch } from "../src/storage/launches.ts";
import { runPlanningOperation } from "../src/storage/operations.ts";
import * as persistence from "../src/storage/persistence.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("completed review retries return feedback without another revision or UI", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "feedback", text: "Use the other approach" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Retry review");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Review",
  };
  const first = await f.runtime.review(f.ctx, input);
  expect(first).toMatchObject({ outcome: "feedback" });
  expect(await f.runtime.review(f.ctx, input)).toEqual(first);
  f.runtime.restore(f.ctx);
  expect(await f.runtime.review(f.ctx, input)).toEqual(first);
  expect(view).toHaveBeenCalledTimes(1);
  expect(f.runtime.active?.reviews).toHaveLength(1);
});

test("review retries reject conflicts and superseded results", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "feedback", text: "Revise it" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Conflict");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Original",
  };
  const first = await f.runtime.review(f.ctx, input);
  expect(
    await f.runtime.review(f.ctx, {
      markdown: input.markdown,
      expectedRevision: 0,
      planId: input.planId,
    }),
  ).toEqual(first);
  expect(await f.runtime.review(f.ctx, { ...input, markdown: "# Changed" })).toMatchObject({
    outcome: "error",
    message: expect.stringContaining("conflicts") as unknown,
  });
  await f.runtime.review(f.ctx, { ...input, expectedRevision: 1, markdown: "# Next" });
  expect(await f.runtime.review(f.ctx, input)).toMatchObject({
    outcome: "error",
    message: expect.stringContaining("superseded") as unknown,
  });
  expect(view).toHaveBeenCalledTimes(2);
});

test("cancelled review retries remain cancelled and explicit opening restores drafts", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Private unfinished notes" });
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Cancel");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Original",
  };
  const cancelled = await f.runtime.review(f.ctx, input);
  f.runtime.restore(f.ctx);
  expect(await f.runtime.review(f.ctx, input)).toEqual(cancelled);
  expect(JSON.stringify(await toolResult(cancelled))).not.toContain("Private unfinished notes");
  expect(view).toHaveBeenCalledTimes(1);
  await f.runtime.requestOpen(f.ctx, "", false);
  expect(view).toHaveBeenCalledTimes(2);
  expect(f.runtime.active?.reviews?.at(-1)?.feedbackDraft).toBe("Private unfinished notes");
});

test("approval retries preserve notes without another selector or approval event", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const select = vi.spyOn(f.ctx.ui, "select").mockResolvedValue("Decide later");
  const events = vi.spyOn(f.api.events, "emit");
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Approved notes" });
      dispatch({ type: "approve-with-notes" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.runtime.start(f.ctx, "Approve");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Original",
  };
  const approved = await f.runtime.review(f.ctx, input);
  f.runtime.settled(f.ctx);
  const count = events.mock.calls.filter(([name]) => name === "orbis:plan-approved").length;
  expect(await f.runtime.review(f.ctx, input)).toEqual(approved);
  f.runtime.settled(f.ctx);
  expect(events.mock.calls.filter(([name]) => name === "orbis:plan-approved")).toHaveLength(count);
  expect(view).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(approved)).toContain("Approved notes");
  const path = f.runtime.active?.accepted?.planPath;
  if (path === undefined) {
    throw new Error("Missing approval");
  }
  await writeFile(path, "Changed");
  expect(await f.runtime.review(f.ctx, input)).toMatchObject({
    outcome: "error",
    message: expect.stringContaining("artifacts changed") as unknown,
  });
});

test("replacement retries reuse their plan and a new identity permits another replacement", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "First");
  const confirm = vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(true);
  onTestFinished(() => {
    confirm.mockRestore();
  });
  const first = await f.runtime.requestOpen(f.ctx, "Second", true, undefined, "second");
  expect(first.outcome).toBe("started");
  f.runtime.restore(f.ctx);
  expect(await f.runtime.requestOpen(f.ctx, "Second", true, undefined, "second")).toEqual(first);
  expect(await f.runtime.requestOpen(f.ctx, "Different", true, undefined, "second")).toMatchObject({
    outcome: "error",
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  const next = await f.runtime.requestOpen(f.ctx, "Second", true, undefined, "third");
  expect(next).not.toEqual(first);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(await f.runtime.requestOpen(f.ctx, "Second", true, undefined, "second")).toMatchObject({
    outcome: "error",
    message: expect.stringContaining("superseded") as unknown,
  });
});

test("submitted frontier retries return decisions without another confirmation", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "answer", questionId: "scope", answer: { custom: "Keep it small" } });
      dispatch({ type: "submit" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Frontier");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    roundId: "frontier",
    expectedRevision: 0,
    questions: [
      { id: "scope", context: "Known", prompt: "Scope?", prerequisites: [], options: [] },
    ],
  };
  const first = await f.runtime.round(f.ctx, input);
  expect(first).toMatchObject({ outcome: "answers" });
  f.runtime.restore(f.ctx);
  expect(await f.runtime.round(f.ctx, input)).toEqual(first);
  expect(view).toHaveBeenCalledTimes(1);
  expect(f.runtime.active?.round?.revision).toBe(1);
});

test.for(["pending", "complete"] as const)(
  "failed %s operation persistence prevents automatic repetition",
  async (status, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    f.runtime.start(f.ctx, "Save failure");
    const view = vi
      .spyOn(terminal, "terminalReview")
      .mockImplementation(async (_ctx, _read, dispatch) => {
        dispatch({ type: "feedback", text: "Saved feedback" });
        await Promise.resolve();
      });
    const original = persistence.saveRecord;
    const save = vi
      .spyOn(persistence, "saveRecord")
      .mockImplementation((pi, ctx, data, file, kind) => {
        if (
          kind === "orbis-plan-operation" &&
          typeof data === "object" &&
          data !== null &&
          "status" in data &&
          data.status === status
        ) {
          return { saved: false, message: "Injected receipt failure" };
        }
        return original(pi, ctx, data, file, kind);
      });
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const input = {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Original",
    };
    await expect(
      f.runtime.review(f.ctx, input).then(async (result) => await toolResult(result)),
    ).rejects.toThrow("Injected receipt failure");
    expect(view).toHaveBeenCalledTimes(status === "pending" ? 0 : 1);
    save.mockRestore();
    const retried = await f.runtime.review(f.ctx, input);
    expect(retried.outcome).toBe(status === "pending" ? "feedback" : "error");
    expect(view).toHaveBeenCalledTimes(1);
  },
);

test("malformed operation records cannot replay results", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Malformed");
  f.api.appendEntry("orbis-plan-operation", { version: 99 });
  await expect(
    f.runtime.review(f.ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Review",
    }),
  ).rejects.toThrow("Invalid planning operation record");
});

test("clarification and its applied response replay without exposing unfinished drafts", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementationOnce(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit", questionId: "scope", unfinished: "Private custom draft" });
      dispatch({ type: "clarify", questionId: "scope", request: "Explain scope", id: "explain" });
      await Promise.resolve();
    })
    .mockImplementationOnce(async (_ctx, _read, dispatch) => {
      dispatch({ type: "answer", questionId: "scope", answer: { custom: "Small scope" } });
      dispatch({ type: "submit" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Clarify");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    roundId: "frontier",
    expectedRevision: 0,
    questions: [
      { id: "scope", context: "Known", prompt: "Scope?", prerequisites: [], options: [] },
    ],
  };
  const first = await f.runtime.round(f.ctx, input);
  expect(first).toMatchObject({ outcome: "clarification", draftsSubmitted: false });
  const replay = await f.runtime.round(f.ctx, input);
  expect(replay).toEqual(first);
  expect(JSON.stringify(await toolResult(replay))).not.toContain("Private custom draft");
  const update = {
    ...input,
    expectedRevision: 1,
    clarification: { id: "explain", response: "Scope excludes deployment" },
  };
  const answers = await f.runtime.round(f.ctx, update);
  expect(answers).toMatchObject({ outcome: "answers" });
  f.runtime.restore(f.ctx);
  expect(await f.runtime.round(f.ctx, update)).toEqual(answers);
  expect(await f.runtime.round(f.ctx, input)).toMatchObject({ outcome: "error" });
  expect(view).toHaveBeenCalledTimes(2);
});

test("unfinished retry and restoration cannot complete an obsolete operation", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const opened = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const view = vi.spyOn(terminal, "terminalReview").mockImplementation(async () => {
    opened.resolve(undefined);
    await release.promise;
  });
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Pending");
  const input = {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Pending",
  };
  const waiting = f.runtime.review(f.ctx, input);
  await opened.promise;
  expect(await f.runtime.review(f.ctx, input)).toMatchObject({ outcome: "error" });
  f.runtime.restore(f.ctx);
  release.resolve(undefined);
  expect(await waiting).toMatchObject({ outcome: "cancelled" });
  expect(await f.runtime.review(f.ctx, input)).toMatchObject({
    outcome: "error",
    message: expect.stringContaining("unfinished") as unknown,
  });
  expect(view).toHaveBeenCalledTimes(1);
  expect(
    f.manager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === "orbis-plan-operation"),
  ).toHaveLength(1);
});

test("declined replacement retries do not reopen confirmation", async ({ onTestFinished }) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Keep current");
  const confirm = vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(false);
  onTestFinished(() => {
    confirm.mockRestore();
  });
  const first = await f.runtime.requestOpen(f.ctx, "Replacement", true, undefined, "declined");
  expect(first).toEqual({ outcome: "cancelled" });
  f.runtime.restore(f.ctx);
  expect(await f.runtime.requestOpen(f.ctx, "Replacement", true, undefined, "declined")).toEqual(
    first,
  );
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("rejected frontier input does not consume an operation identity", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Validate");
  const view = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "answer", questionId: "scope", answer: { custom: "Small" } });
      dispatch({ type: "submit" });
      await Promise.resolve();
    });
  onTestFinished(() => {
    view.mockRestore();
  });
  const input = {
    planId: f.runtime.active?.planId ?? "",
    roundId: "frontier",
    expectedRevision: 0,
    questions: [
      { id: "scope", context: "Known", prompt: "Scope?", prerequisites: [], options: [] },
    ],
  };
  expect(await f.runtime.round(f.ctx, { ...input, questions: [] })).toMatchObject({
    outcome: "error",
  });
  expect(await f.runtime.round(f.ctx, input)).toMatchObject({ outcome: "answers" });
  expect(view).toHaveBeenCalledTimes(1);
});

test.for(["requested", "failed"] as const)(
  "a newer %s launch invalidates cached implementation instructions",
  async (status, { onTestFinished }) => {
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
    f.runtime.start(f.ctx, "Implementation retry");
    const approved = await f.runtime.review(f.ctx, {
      planId: f.runtime.active?.planId ?? "",
      expectedRevision: 0,
      markdown: "# Implement",
    });
    if (approved.outcome !== "approval") {
      throw new Error("Missing approval");
    }
    const receipt = {
      version: 1 as const,
      id: "received-launch",
      approval: approved.approval,
      destination: "here" as const,
      originSessionId: f.manager.getSessionId(),
      sessionId: f.manager.getSessionId(),
      status: "received" as const,
    };
    saveLaunch(f.api, f.ctx, receipt);
    const result = new PlanHandoff(f.api).result(f.ctx, receipt);
    const perform = vi
      .fn<Parameters<typeof runPlanningOperation>[6]>()
      .mockImplementation(async (begin) => {
        begin();
        return await Promise.resolve(result);
      });
    const replay = async () =>
      await runPlanningOperation(
        f.api,
        f.ctx,
        "review-existing-launch",
        { planId: approved.approval.planId },
        () => f.runtime.active,
        () => true,
        perform,
      );
    expect(await replay()).toMatchObject({ outcome: "implementation", status: "received" });
    saveLaunch(f.api, f.ctx, {
      ...receipt,
      id: "restart",
      status,
      ...(status === "failed" ? { failure: "Rejected startup" } : {}),
    });
    expect(await replay()).toMatchObject({
      outcome: "error",
      message: expect.stringContaining("Implementation launch changed") as unknown,
    });
    expect(perform).toHaveBeenCalledTimes(1);
  },
);
