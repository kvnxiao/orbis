import { expect, test, vi } from "vitest";

import { errorResult, isPlanningError, PlanningError, superseded } from "../src/domain/errors.ts";
import type { PlanningErrorKind } from "../src/domain/errors.ts";
import { presentReview, transitionReview } from "../src/domain/state.ts";
import { presentationAction } from "../src/pi/presenters.ts";
import * as terminal from "../src/pi/terminal.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import * as config from "../src/storage/config.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("stale review input carries the supplied and current revisions", () => {
  const state = presentReview(
    { phase: "research", roundNumber: 0, questionNumbers: {}, decisions: {} },
    { planId: "plan", expectedRevision: 0, markdown: "# Plan" },
  );
  expect(() => transitionReview(state, 3, { type: "approve" })).toThrow(
    expect.objectContaining({ kind: "revision-conflict", data: { expected: 3, current: 1 } }),
  );
});

const failures = {
  "invalid-input": {
    error: new PlanningError("invalid-input", "Invalid payload."),
    text: "Invalid payload. Correct the payload and retry.",
  },
  rejected: {
    error: new PlanningError("rejected", "Submit the unresolved round."),
    text: "Submit the unresolved round.",
  },
  "revision-conflict": {
    error: new PlanningError("revision-conflict", "Review changed.", {
      data: { expected: 2, current: 4 },
    }),
    text: "Review changed. Current revision: 4. Reload this revision before retrying.",
  },
  "interaction-closed": {
    error: new PlanningError("interaction-closed", "Interaction ended."),
    text: "Interaction ended. Stop using this interaction. Reopen current input with plan_open.",
  },
  persistence: {
    error: new PlanningError("persistence", "Write failed."),
    text: "Write failed. Correct the storage error and reload Pi before retrying; preserve unsaved changes before reload.",
  },
  settings: {
    error: new PlanningError("settings", "Invalid settings at /settings.json.", {
      data: { path: "/settings.json" },
    }),
    text: "Invalid settings at /settings.json. Correct the named settings file and retry.",
  },
  "artifact-conflict": {
    error: new PlanningError("artifact-conflict", "Artifact conflict at /plan.md.", {
      data: { path: "/plan.md" },
    }),
    text: "Artifact conflict at /plan.md. Preserve the file and resolve the conflict before retrying.",
  },
} satisfies Record<PlanningErrorKind, { error: Error; text: string }>;

test.for(Object.values(failures))(
  "tool remediation has one owner: $text",
  async ({ error, text }) => {
    await expect(toolResult(errorResult(error))).rejects.toMatchObject({
      message: text,
      cause: error,
    });
    await expect(toolResult(Promise.reject(error))).rejects.toMatchObject({
      message: text,
      cause: error,
    });
  },
);

test("deferred saves do not prescribe storage repair or reload", async () => {
  const error = new PlanningError("persistence", "Awaiting the first assistant write.", {
    data: { deferred: true },
  });
  await expect(toolResult(errorResult(error))).rejects.toMatchObject({
    message: "Awaiting the first assistant write.",
    cause: error,
  });
});

test("structural extension copies retain revision data without shared class identity", async () => {
  const error = {
    kind: "revision-conflict",
    message: "Revision changed.",
    data: { expected: 1, current: 2 },
  };
  expect(isPlanningError(error)).toBe(true);
  await expect(toolResult(errorResult(error))).rejects.toMatchObject({
    message: "Revision changed. Current revision: 2. Reload this revision before retrying.",
    cause: error,
  });
});

test.for([
  null,
  "revision-conflict",
  { kind: "unknown", message: "Unknown" },
  { kind: "settings", message: "Missing path" },
  { kind: "artifact-conflict", message: "Empty path", data: { path: "" } },
  { kind: "revision-conflict", message: "Missing revision", data: { expected: 1 } },
  { kind: "revision-conflict", message: "Invalid revision", data: { expected: 1, current: -1 } },
  { kind: "revision-conflict", message: "Invalid revision", data: { expected: 1, current: NaN } },
  { kind: "rejected", message: "Unexpected data", data: { current: 1 } },
  { kind: "persistence", message: "Invalid deferred", data: { deferred: false } },
])("malformed failure contracts receive no remediation: %j", async (error) => {
  expect(isPlanningError(error)).toBe(false);
  const result = errorResult(error);
  await expect(toolResult(result)).rejects.toMatchObject({ message: result.message });
});

test.for(["sessionId", "planId", "interactionId", "revision"] as const)(
  "presenter mismatch identifies recovery for %s",
  (field) => {
    const identity = {
      version: 1 as const,
      sessionId: "session",
      planId: "plan",
      interactionId: "interaction",
      revision: 2,
    };
    const stale = { ...identity, [field]: field === "revision" ? 1 : "expired" };
    expect(() =>
      presentationAction(
        { identity: stale, action: { type: "edit-feedback", text: "Draft" } },
        identity,
        true,
      ),
    ).toThrow(
      expect.objectContaining(
        field === "revision"
          ? { kind: "revision-conflict", data: { expected: 1, current: 2 } }
          : { kind: "interaction-closed" },
      ),
    );
  },
);

test.for([false, true])(
  "supersession preserves replacement work after prior cancellation: %s",
  async (cancelFirst, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    const settings = await config.readSettings(f.ctx.cwd, f.ctx.cwd, false);
    const started = Promise.withResolvers<AbortSignal | undefined>();
    const release = Promise.withResolvers<undefined>();
    const read = vi
      .spyOn(config, "readSettings")
      .mockImplementationOnce(async (_agent, _cwd, _trusted, signal) => {
        started.resolve(signal);
        await release.promise;
        return settings;
      });
    onTestFinished(() => {
      read.mockRestore();
    });
    f.runtime.start(f.ctx, "Original");
    const controller = new AbortController();
    const pending = f.runtime.review(
      f.ctx,
      { planId: f.runtime.active?.planId ?? "", expectedRevision: 0, markdown: "# Original" },
      controller.signal,
    );
    const signal = await started.promise;
    if (cancelFirst) {
      controller.abort();
    }
    const reason: unknown = cancelFirst ? signal?.reason : superseded;
    f.runtime.restore(f.ctx);
    f.runtime.start(f.ctx, "Replacement", true);
    const replacement = f.runtime.active;
    release.resolve(undefined);
    expect(await pending).toMatchObject({ outcome: "cancelled" });
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(reason);
    expect(f.runtime.active).toEqual(replacement);
    expect(f.runtime.mode).toBe("plan");
  },
);

test("unexpected interaction defects reach the tool without retry advice", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  const defect = new Error("Renderer invariant failed", { cause: new Error("Original cause") });
  const view = vi.spyOn(terminal, "terminalRound").mockRejectedValue(defect);
  onTestFinished(() => {
    view.mockRestore();
  });
  f.runtime.start(f.ctx, "Objective");
  const result = await f.runtime.round(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    roundId: "round",
    expectedRevision: 0,
    questions: [
      { id: "scope", prompt: "Scope?", context: "Known", prerequisites: [], options: [] },
    ],
  });
  await expect(toolResult(result)).rejects.toBe(defect);
});

test("unexpected persistence defects preserve identity and cause through the tool", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Objective");
  const defect = new TypeError("Append invariant failed", { cause: new Error("Original cause") });
  const append = vi.spyOn(f.api, "appendEntry").mockImplementation(() => {
    throw defect;
  });
  onTestFinished(() => {
    append.mockRestore();
  });
  const pending = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Plan",
  });
  await expect(toolResult(pending)).rejects.toBe(defect);
  expect(f.runtime.active?.phase).toBe("research");
});

test("filesystem save failures preserve their cause and receive storage remediation", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.runtime.start(f.ctx, "Objective");
  const failure = Object.assign(new Error("Disk full"), { code: "ENOSPC" });
  const append = vi.spyOn(f.api, "appendEntry").mockImplementation(() => {
    throw failure;
  });
  onTestFinished(() => {
    append.mockRestore();
  });
  const pending = f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Plan",
  });
  await expect(toolResult(pending)).rejects.toMatchObject({
    message:
      "Planning state is unsaved: Disk full Correct the storage error and reload Pi before retrying; preserve unsaved changes before reload.",
    cause: { kind: "persistence", cause: { saved: false, cause: failure } },
  });
  expect(f.runtime.active?.phase).toBe("research");
});
