import { readFile, writeFile, unlink } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import { validSession, validSnapshot } from "../src/domain/state.ts";
import * as terminal from "../src/pi/terminal.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

test("reopening accepted review preserves its plan, Markdown revision, and approval", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "approve" });
      await Promise.resolve();
    });
  f.runtime.start(f.ctx, "Reopen approved content");
  const planId = f.runtime.active?.planId ?? "";
  const first = await f.runtime.review(f.ctx, {
    planId,
    expectedRevision: 0,
    markdown: "# Reviewed\n",
  });
  const reopened = await f.runtime.requestStart(f.ctx, "", false);
  expect(reopened).toMatchObject({ outcome: "approval" });
  expect(f.runtime.active?.planId).toBe(planId);
  expect(f.runtime.active?.reviews).toHaveLength(1);
  expect(reopened).toEqual(first);
  expect(view).toHaveBeenCalledTimes(2);
});

async function approvedFixture(notes = false) {
  const f = await runtimeFixture();
  const view = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementation(async (_ctx, _read, dispatch) => {
      if (notes) {
        dispatch({ type: "edit-feedback", text: "Preserve these notes" });
      }
      dispatch({ type: notes ? "approve-with-notes" : "approve" });
      await Promise.resolve();
    });
  f.runtime.start(f.ctx, "Saved objective");
  const result = await f.runtime.review(f.ctx, {
    planId: f.runtime.active?.planId ?? "",
    expectedRevision: 0,
    markdown: "# Exact revision\n",
  });
  if (result.outcome !== "approval") {
    await f.dispose();
    throw new Error("Fixture approval failed");
  }
  return { ...f, view, approval: result.approval };
}

test("restoration rejects invalid approval identities, histories, and acceptance flags", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const active = structuredClone(f.runtime.active);
  const snapshot = { version: 1, mode: "default", active, unfinished: [] };
  expect(validSnapshot(snapshot)).toBe(true);
  expect(
    validSnapshot({
      ...snapshot,
      active: { ...active, accepted: { ...f.approval, approvalId: "../escape" } },
    }),
  ).toBe(false);
  expect(
    validSnapshot({
      ...snapshot,
      active: { ...active, approvals: [{ ...f.approval, revision: 999 }] },
    }),
  ).toBe(false);
  expect(validSnapshot({ ...snapshot, active: { ...active, approvalRequired: true } })).toBe(false);
});

test.for([false, true])(
  "closing reopened review preserves unchanged approval (notes=%s)",
  async (notes, { onTestFinished }) => {
    const f = await approvedFixture(notes);
    onTestFinished(f.dispose);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    f.view.mockImplementation(async (_ctx, read, dispatch) => {
      expect(read().reviews?.at(-1)?.feedbackDraft).toBe(notes ? "Preserve these notes" : "");
      dispatch({ type: "cancel" });
      await Promise.resolve();
    });
    expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("cancelled");
    expect(f.runtime.active?.accepted).toEqual(f.approval);
    f.runtime.restore(f.ctx);
    expect(f.runtime.active?.accepted).toEqual(f.approval);
  },
);

test("cleared notes require re-approval and leave the previous companion unchanged", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture(true);
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "edit-feedback", text: "" });
    dispatch({ type: "approve" });
    await Promise.resolve();
  });
  await f.runtime.requestStart(f.ctx, "", false);
  expect(f.runtime.active?.accepted?.notes).toBeUndefined();
  expect(f.runtime.active?.accepted?.approvalId).not.toBe(f.approval.approvalId);
  expect(await readFile(f.approval.notesPath ?? "", "utf8")).toBe(f.approval.notesContent);
});

test("checkpoint recovery rejects stale selection and mode toggling preserves the malformed record", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.api.appendEntry("orbis-plan", { version: 999 });
  const leaf = f.manager.getLeafId();
  f.runtime.restore(f.ctx);
  f.runtime.toggleMode(f.ctx);
  expect(f.manager.getLeafId()).toBe(leaf);
  const selected = Promise.withResolvers<string | undefined>();
  const opened = Promise.withResolvers<string>();
  vi.spyOn(f.ctx.ui, "select").mockImplementation(async (_title, choices) => {
    opened.resolve(choices[0] ?? "");
    return await selected.promise;
  });
  const pending = f.runtime.requestStart(f.ctx, "", false);
  const choice = await opened.promise;
  f.runtime.restore(f.ctx);
  selected.resolve(choice);
  expect((await pending).outcome).toBe("cancelled");
  expect(f.runtime.active).toBeUndefined();
  expect(f.manager.getLeafId()).toBe(leaf);
});

test("missing checkpoints reject ordinary entry and permit explicit replacement without deleting history", async ({
  onTestFinished,
}) => {
  const f = await runtimeFixture();
  onTestFinished(f.dispose);
  f.api.appendEntry("orbis-plan", { version: 999 });
  const leaf = f.manager.getLeafId();
  f.runtime.restore(f.ctx);
  await expect(f.runtime.requestStart(f.ctx, "", false)).rejects.toThrow("No valid earlier");
  expect(f.runtime.active).toBeUndefined();
  expect((await f.runtime.requestStart(f.ctx, "Replacement objective", true)).outcome).toBe(
    "started",
  );
  expect(f.manager.getEntry(leaf ?? "")).toMatchObject({ data: { version: 999 } });
});

test("artifact recovery dismissal preserves the existing file and approval history", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  await writeFile(f.approval.planPath, "External edit");
  vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(false);
  const calls = f.view.mock.calls.length;
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("cancelled");
  expect(f.view).toHaveBeenCalledTimes(calls);
  expect(await readFile(f.approval.planPath, "utf8")).toBe("External edit");
  expect(f.runtime.active?.approvals).toContainEqual(f.approval);
});

test("recovery never selects a checkpoint from an abandoned sibling branch", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const root = f.manager.getBranch()[0];
  if (root === undefined) {
    throw new Error("Missing branch root");
  }
  f.manager.branch(root.id);
  f.api.appendEntry("orbis-plan", { version: 999 });
  f.runtime.restore(f.ctx);
  await expect(f.runtime.requestStart(f.ctx, "", false)).rejects.toThrow("No valid earlier");
  expect(f.runtime.active).toBeUndefined();
});

test("archived accepted plans can be selected for review without replacing their identity", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.runtime.start(f.ctx, "Another objective");
  vi.spyOn(f.ctx.ui, "select").mockImplementation(
    async (title, options) =>
      await Promise.resolve(
        title === "Continue a saved plan"
          ? options.find((label) => label.includes(f.approval.planId))
          : undefined,
      ),
  );
  const result = await f.runtime.requestStart(f.ctx, "", false);
  expect(result).toMatchObject({ outcome: "approval", approval: { planId: f.approval.planId } });
});

test("changed notes stay unapproved across dismissal and receive an immutable approval on the same revision", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture(true);
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "edit-feedback", text: "Changed supplementary notes" });
    dispatch({ type: "cancel" });
    await Promise.resolve();
  });
  await f.runtime.requestStart(f.ctx, "", false);
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.accepted).toBeUndefined();
  expect(f.runtime.active?.reviews?.at(-1)?.feedbackDraft).toBe("Changed supplementary notes");
  expect((await f.runtime.implement(f.ctx, "here", f.approval.planId)).outcome).toBe("error");
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "approve-with-notes" });
    await Promise.resolve();
  });
  const result = await f.runtime.requestStart(f.ctx, "", false);
  expect(result.outcome).toBe("approval");
  const state = f.runtime.active;
  expect(state?.accepted?.revision).toBe(1);
  expect(state?.accepted?.planPath).toBe(f.approval.planPath);
  expect(state?.accepted?.approvalId).not.toBe(f.approval.approvalId);
  expect(state?.accepted?.notesPath).not.toBe(f.approval.notesPath);
  expect(await readFile(f.approval.notesPath ?? "", "utf8")).toBe(f.approval.notesContent);
  expect(state !== undefined && validSession(state)).toBe(true);
});

test("feedback on an approved plan requires approval of the agent's next Markdown revision", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "edit-feedback", text: "Revise the approach" });
    dispatch({ type: "submit-feedback" });
    await Promise.resolve();
  });
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("feedback");
  expect(f.runtime.active?.accepted).toBeUndefined();
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "approve" });
    await Promise.resolve();
  });
  const result = await f.runtime.review(f.ctx, {
    planId: f.approval.planId,
    expectedRevision: 1,
    markdown: "# Revised approach\n",
  });
  expect(result).toMatchObject({
    outcome: "approval",
    approval: { revision: 2, planContent: "# Revised approach\n" },
  });
  expect(await readFile(f.approval.planPath, "utf8")).toBe(f.approval.planContent);
});

test.for(["missing", "changed", "notes"] as const)(
  "artifact recovery preserves existing files and requires fresh approval: %s",
  async (damage, { onTestFinished }) => {
    const f = await approvedFixture(damage === "notes");
    onTestFinished(f.dispose);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const path = damage === "notes" ? (f.approval.notesPath ?? "") : f.approval.planPath;
    if (damage === "missing") {
      await unlink(path);
    } else {
      await writeFile(path, "External edit");
    }
    vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(true);
    f.view.mockImplementation(async (_ctx, read, dispatch) => {
      expect(read().phase).toBe("review");
      dispatch({ type: damage === "notes" ? "approve-with-notes" : "approve" });
      await Promise.resolve();
    });
    await f.runtime.requestStart(f.ctx, "", false);
    const recovered = f.runtime.active?.accepted;
    expect(recovered?.planPath).not.toBe(f.approval.planPath);
    expect(recovered?.approvalId).not.toBe(f.approval.approvalId);
    expect(await readFile(recovered?.planPath ?? "", "utf8")).toBe("# Exact revision\n");
    const originalBytes = damage === "missing" ? undefined : await readFile(path, "utf8");
    expect(originalBytes).toBe(damage === "missing" ? undefined : "External edit");
    f.runtime.restore(f.ctx);
    expect(f.runtime.active?.accepted).toEqual(recovered);
  },
);

test.for([false, true])(
  "invalid latest records offer explicit checkpoint recovery (recover=%s)",
  async (recover, { onTestFinished }) => {
    const f = await approvedFixture();
    onTestFinished(f.dispose);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    f.api.appendEntry("orbis-plan", { version: 999 });
    const damagedId = f.manager.getLeafId();
    f.runtime.restore(f.ctx);
    const select = vi
      .spyOn(f.ctx.ui, "select")
      .mockImplementation(
        async (title, choices) =>
          await Promise.resolve(title === "Recover planning" && recover ? choices[0] : undefined),
      );
    await f.runtime.requestStart(f.ctx, "", false);
    expect(select).toHaveBeenCalledWith(
      "Recover planning",
      expect.arrayContaining(["Decide later"]),
      expect.anything(),
    );
    expect(f.manager.getEntry(damagedId ?? "")).toMatchObject({ data: { version: 999 } });
    expect(f.runtime.active?.accepted?.revision).toBe(recover ? 1 : undefined);
    expect(f.runtime.active?.accepted?.approvalId).not.toBe(f.approval.approvalId);
    expect(f.manager.getLeafId() === damagedId).toBe(!recover);
  },
);

test("closing unchanged review after failed reapproval restores valid acceptance", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const originalSave = f.runtime.save.bind(f.runtime);
  const save = vi
    .spyOn(f.runtime, "save")
    .mockImplementation((ctx) =>
      f.runtime.active?.pendingApproval === undefined
        ? originalSave(ctx)
        : { saved: false, message: "Injected approval persistence failure" },
    );
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("error");
  expect(f.runtime.active?.pendingApproval).toBeDefined();
  save.mockRestore();
  f.view.mockImplementation(async (_ctx, _read, dispatch) => {
    dispatch({ type: "cancel" });
    await Promise.resolve();
  });
  await f.runtime.requestStart(f.ctx, "", false);
  expect(f.runtime.active?.accepted).toEqual(f.approval);
  expect(f.runtime.active?.pendingApproval).toBeUndefined();
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.accepted).toEqual(f.approval);
});

test.for([false, true])(
  "damaged pending notes offer recovery before approval retry (checkpoint=%s)",
  async (checkpoint, { onTestFinished }) => {
    const f = await runtimeFixture();
    onTestFinished(f.dispose);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    vi.spyOn(terminal, "terminalReview").mockImplementation(async (_ctx, _read, dispatch) => {
      dispatch({ type: "edit-feedback", text: "Pending notes" });
      dispatch({ type: "approve-with-notes" });
      await Promise.resolve();
    });
    f.runtime.start(f.ctx, "Pending notes recovery");
    const originalSave = f.runtime.save.bind(f.runtime);
    const save = vi
      .spyOn(f.runtime, "save")
      .mockImplementation((ctx) =>
        f.runtime.active?.phase === "accepted"
          ? { saved: false, message: "Injected acceptance failure" }
          : originalSave(ctx),
      );
    expect(
      (
        await f.runtime.review(f.ctx, {
          planId: f.runtime.active?.planId ?? "",
          expectedRevision: 0,
          markdown: "# Pending\n",
        })
      ).outcome,
    ).toBe("error");
    const pending = f.runtime.active?.pendingApproval;
    expect(pending?.notesPath).toBeDefined();
    await writeFile(pending?.notesPath ?? "", "Changed pending notes");
    save.mockRestore();
    if (checkpoint) {
      f.api.appendEntry("orbis-plan", { version: 999 });
      f.runtime.restore(f.ctx);
      vi.spyOn(f.ctx.ui, "select").mockImplementation(
        async (title, choices) =>
          await Promise.resolve(title === "Recover planning" ? choices[0] : undefined),
      );
    }
    const confirm = vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(true);
    expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("approval");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.runtime.active?.accepted?.approvalId).not.toBe(pending?.approvalId);
    expect(f.runtime.active?.accepted?.planPath).not.toBe(pending?.planPath);
    expect(await readFile(pending?.notesPath ?? "", "utf8")).toBe("Changed pending notes");
  },
);

test("checkpoint recovery checks recorded notes and mints a fresh approval", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture(true);
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  await writeFile(f.approval.notesPath ?? "", "Changed checkpoint notes");
  f.api.appendEntry("orbis-plan", { version: 999 });
  f.runtime.restore(f.ctx);
  vi.spyOn(f.ctx.ui, "select").mockImplementation(
    async (title, choices) =>
      await Promise.resolve(title === "Recover planning" ? choices[0] : undefined),
  );
  const confirm = vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(true);
  await f.runtime.requestStart(f.ctx, "", false);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(f.runtime.active?.accepted?.approvalId).not.toBe(f.approval.approvalId);
  expect(f.runtime.active?.accepted?.planPath).not.toBe(f.approval.planPath);
  expect(await readFile(f.approval.notesPath ?? "", "utf8")).toBe("Changed checkpoint notes");
});

test("checkpoint recovery discards historical pending intent before fresh approval", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const originalSave = f.runtime.save.bind(f.runtime);
  const save = vi
    .spyOn(f.runtime, "save")
    .mockImplementation((ctx) =>
      f.runtime.active?.phase === "accepted"
        ? { saved: false, message: "Injected acceptance failure" }
        : originalSave(ctx),
    );
  await f.runtime.requestStart(f.ctx, "", false);
  expect(f.runtime.active?.pendingApproval?.approvalId).toBe(f.approval.approvalId);
  save.mockRestore();
  f.api.appendEntry("orbis-plan", { version: 999 });
  f.runtime.restore(f.ctx);
  vi.spyOn(f.ctx.ui, "select").mockImplementation(
    async (title, choices) =>
      await Promise.resolve(title === "Recover planning" ? choices[0] : undefined),
  );
  await f.runtime.requestStart(f.ctx, "", false);
  expect(f.runtime.active?.accepted?.approvalId).not.toBe(f.approval.approvalId);
  expect(f.runtime.active?.accepted).toBeDefined();
});

test("failed checkpoint append preserves recovery for an explicit retry", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  f.api.appendEntry("orbis-plan", { version: 999 });
  const damagedId = f.manager.getLeafId();
  f.runtime.restore(f.ctx);
  vi.spyOn(f.ctx.ui, "select").mockImplementation(
    async (title, choices) =>
      await Promise.resolve(title === "Recover planning" ? choices[0] : undefined),
  );
  const save = vi
    .spyOn(f.runtime, "save")
    .mockReturnValueOnce({ saved: false, message: "Injected checkpoint failure" });
  await expect(f.runtime.requestStart(f.ctx, "", false)).rejects.toThrow(
    "Injected checkpoint failure",
  );
  expect(f.runtime.active).toBeUndefined();
  expect(f.manager.getLeafId()).toBe(damagedId);
  save.mockRestore();
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("approval");
  expect(f.manager.getEntry(damagedId ?? "")).toMatchObject({ data: { version: 999 } });
});

test("failed artifact recreation remains retryable after persistence repair", async ({
  onTestFinished,
}) => {
  const f = await approvedFixture();
  onTestFinished(f.dispose);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  await writeFile(f.approval.planPath, "Preserved external edit");
  vi.spyOn(f.ctx.ui, "confirm").mockResolvedValue(true);
  const save = vi
    .spyOn(f.runtime, "save")
    .mockReturnValueOnce({ saved: false, message: "Injected recreation failure" });
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("error");
  save.mockRestore();
  expect((await f.runtime.requestStart(f.ctx, "", false)).outcome).toBe("approval");
  expect(f.runtime.active?.accepted?.planPath).not.toBe(f.approval.planPath);
  expect(await readFile(f.approval.planPath, "utf8")).toBe("Preserved external edit");
  f.runtime.restore(f.ctx);
  expect(f.runtime.active?.accepted).toBeDefined();
});
