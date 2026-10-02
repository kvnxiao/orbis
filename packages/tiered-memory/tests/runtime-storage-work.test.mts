import type * as FsPromises from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, vi } from "vitest";

import type { MemoryProposal } from "../src/domain/proposal.ts";
import { Execution } from "../src/pi/execution.ts";
import { referencesIn } from "../src/pi/revision-references.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import { buildStatus, renderStatus } from "../src/pi/status.ts";
import { writeDurable } from "../src/storage/files.ts";
import { fixtureModel } from "./pi-fixture.mts";
import type { Fixture } from "./pi-fixture.mts";
import { afterHeadWrite } from "./storage-harness.mts";
import type { TestWrite } from "./storage-harness.mts";
import {
  committedId,
  noteContent,
  referenceDroppingRuntime,
  runtimeFor,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  test,
  unresolvedLine,
  validReferences,
} from "./store-fixture.mts";

interface Hold {
  entered: PromiseWithResolvers<undefined>;
  release: PromiseWithResolvers<undefined>;
  matches?: (path: string) => boolean;
}

const gates = vi.hoisted(() => {
  const confirm: Hold[] = [];
  const layout: Hold[] = [];
  const read: Hold[] = [];
  const lockRelease: Hold[] = [];
  const created: Hold[] = [];
  const take = (queue: Hold[], path: unknown): Hold | undefined => {
    const index = queue.findIndex(
      (hold) => hold.matches === undefined || (typeof path === "string" && hold.matches(path)),
    );
    return index === -1 ? undefined : queue.splice(index, 1)[0];
  };
  const pass = async (hold: Hold | undefined): Promise<void> => {
    if (hold !== undefined) {
      hold.entered.resolve(undefined);
      await hold.release.promise;
    }
  };
  return { confirm, layout, read, lockRelease, created, take, pass };
});

// A hold left by a failed test would capture the next test's I/O, and an uninterruptible fsync
// held that way would also block teardown.
afterEach(() => {
  for (const hold of gates.created) {
    hold.release.resolve(undefined);
  }
  gates.created.length = 0;
  gates.confirm.length = 0;
  gates.layout.length = 0;
  gates.read.length = 0;
  gates.lockRelease.length = 0;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const { take, pass } = gates;
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      await pass(args[1] === "r+" ? take(gates.confirm, args[0]) : undefined);
      return await actual.open(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await pass(take(gates.read, args[0]));
      return await actual.readFile(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      await actual.rm(...args);
      await pass(take(gates.lockRelease, args[0]));
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      await pass(take(gates.layout, args[0]));
      return await actual.lstat(...args);
    },
  };
});

function newHold(matches?: (path: string) => boolean): Hold {
  const hold = {
    entered: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
    ...(matches === undefined ? {} : { matches }),
  };
  gates.created.push(hold);
  return hold;
}

function holdNextConfirmation(applies?: () => boolean): Hold {
  const hold = newHold(applies === undefined ? undefined : () => applies());
  gates.confirm.push(hold);
  return hold;
}

// Holds the next project-lock release once it has finished: its last step removes the private
// owner record, after which the lock is free.
function holdAfterNextLockRelease(): Hold {
  const hold = newHold((path) => path.includes(`${sep}.lock${sep}private${sep}`));
  gates.lockRelease.push(hold);
  return hold;
}

function holdNextRead(matches: (path: string) => boolean): Hold {
  const hold = newHold(matches);
  gates.read.push(hold);
  return hold;
}

function registrationLog(events: string[]): TestWrite {
  return async (path, contents) => {
    await writeDurable(path, contents);
    if (path.endsWith("sources.json")) {
      events.push("registration");
    }
  };
}

// An unserialized commit registers within a few hundred turns; a serialized one never does, so the
// bound limits only how reliably a regression is detected.
async function drainUntil(done: () => boolean, turns = 1000): Promise<void> {
  for (let turn = 0; turn < turns && !done(); turn++) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn lets the previous turn's continuations run.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function after(events: readonly string[], marker: string): string[] {
  return events.slice(events.indexOf(marker));
}

function failingRoles(ctx: ExtensionContext, failure: Error): ExtensionContext {
  return Object.defineProperty({ ...ctx }, "model", {
    get() {
      throw failure;
    },
  });
}

function gatedRoles(ctx: ExtensionContext): {
  ctx: ExtensionContext;
  entered: PromiseWithResolvers<undefined>;
  release: PromiseWithResolvers<undefined>;
} {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const registry = ctx.modelRegistry;
  const modelRegistry = new Proxy(registry, {
    get(target, key, receiver): unknown {
      if (key !== "getApiKeyAndHeaders") {
        return Reflect.get(target, key, receiver);
      }
      return async (...args: Parameters<typeof registry.getApiKeyAndHeaders>) => {
        entered.resolve(undefined);
        await release.promise;
        return await target.getApiKeyAndHeaders(...args);
      };
    },
  });
  return { ctx: { ...ctx, modelRegistry }, entered, release };
}

function admissions(
  onTestFinished: (teardown: () => void) => void,
): PromiseWithResolvers<undefined> {
  const queued = Promise.withResolvers<undefined>();
  // oxlint-disable-next-line typescript/unbound-method -- The spy calls the original with its Execution receiver.
  const original = Execution.prototype.runInStorage;
  const admit = vi.spyOn(Execution.prototype, "runInStorage").mockImplementation(async function (
    this: Execution,
    scope,
    effect,
  ) {
    queued.resolve(undefined);
    await original.call(this, scope, effect);
  });
  onTestFinished(() => {
    admit.mockRestore();
  });
  return queued;
}

const failedLine =
  "Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.";
const reconcilingLine =
  "Memory commits: blocked while memory reconciles with the current settings and models.";

function unsavedLine(revisionId: string): string {
  return `Memory commits: blocked until the branch reference to revision ${revisionId} is saved in the session file. Pi saves a new session file after its first assistant response.`;
}

test("a commit started while another commit applies its lineage registers only after that work ends, then returns a head conflict and keeps the winner selected", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Concurrent commits.");
  const events: string[] = [];
  const runtime = runtimeFor(f, { write: registrationLog(events) });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, "Concurrent commits.");
  const winning = runtime.captureProposal(ctx, noteContent({ "current-work.md": "One\n" }), [
    source,
  ]);
  const losing = runtime.captureProposal(ctx, noteContent({ "journey.md": "Two\n" }), [source]);
  const confirmation = holdNextConfirmation();
  const first = runtime.commitProposal(ctx, winning);
  await confirmation.entered.promise;
  const second = runtime.commitProposal(ctx, losing);
  events.push("confirmation released");
  confirmation.release.resolve(undefined);
  const winner = committedId(await first);
  expect(await second).toMatchObject({ kind: "conflict", actualRevision: winner, reason: "head" });
  expect(after(events, "confirmation released")).toEqual(["confirmation released", "registration"]);
  expect(storageOf(runtime)).toMatchObject({
    lineage: {
      selected: { state: "selected", revisionId: winner },
      pending: { state: "none" },
    },
    latestRevision: winner,
    registration: { event: "commit" },
    error: undefined,
    reconciliation: "current",
  });
  const next = runtime.captureProposal(ctx, noteContent({ "journey.md": "Three\n" }), [source]);
  expect(next.baseRevision).toMatchObject({ revisionId: winner });
  expect(next.expectedRevision).toBe(winner);
});

const blueEvidence = "The setting is blue.";

interface BlueSelection {
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  source: string;
  selected: string;
  attempts: [MemoryProposal, MemoryProposal];
  events: string[];
  holdAfterNextRegistration: () => Hold;
  failLockTicketAfterNextRegistration: (failure: Error) => void;
}

async function selectBlueNote(f: Fixture): Promise<BlueSelection> {
  await f.session.prompt(blueEvidence);
  const afterRegistration: (() => void)[] = [];
  const lockTicket: { failure: Error | undefined } = { failure: undefined };
  const events: string[] = [];
  const write: TestWrite = async (path, contents) => {
    const failure = path.includes(`${sep}private${sep}`) ? lockTicket.failure : undefined;
    if (failure !== undefined) {
      lockTicket.failure = undefined;
      throw failure;
    }
    await writeDurable(path, contents);
    if (path.endsWith("sources.json")) {
      events.push("registration");
      afterRegistration.shift()?.();
    }
  };
  const runtime = runtimeFor(f, { write });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, blueEvidence);
  const stale = (name: string): MemoryProposal =>
    runtime.captureProposal(ctx, noteContent({ [name]: `${name}\n` }), [source]);
  const attempts: BlueSelection["attempts"] = [stale("topic-a.md"), stale("topic-b.md")];
  const selected = committedId(
    await runtime.commitProposal(
      ctx,
      runtime.captureProposal(ctx, noteContent({ "current-work.md": "Blue\n" }), [source]),
    ),
  );
  return {
    runtime,
    ctx,
    source,
    selected,
    attempts,
    events,
    holdAfterNextRegistration() {
      const hold = newHold();
      afterRegistration.push(() => {
        gates.layout.push(hold);
      });
      return hold;
    },
    failLockTicketAfterNextRegistration(failure) {
      afterRegistration.push(() => {
        lockTicket.failure = failure;
      });
    },
  };
}

async function editToGreenWithTurn(f: Fixture): Promise<void> {
  f.session.sessionManager.appendContextEdit(sourceEntry(f, blueEvidence).id, {
    content: "The setting is green.",
  });
  await f.session.prompt("A later turn.");
}

const headConflict = { kind: "conflict", reason: "head" };
const blueValid = { state: "selected", invalidNotes: [] };
const greenInvalid = {
  state: "selected",
  invalidNotes: ["current-work.md"],
  invalidReason: "note-evidence",
};
const blueCount = { sources: 2, event: "commit" };
const greenCount = { sources: 4, event: "commit" };

test("a commit that waits behind an earlier commit registers after it, and the refreshes leave the newer registration's note invalidation and source count", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, selected, attempts, events, holdAfterNextRegistration } =
    await selectBlueNote(f);
  const [older, newer] = attempts;
  const olderHeld = holdAfterNextRegistration();
  const first = runtime.commitProposal(ctx, older);
  await olderHeld.entered.promise;
  await editToGreenWithTurn(f);
  const second = runtime.commitProposal(ctx, newer);
  events.push("older released");
  olderHeld.release.resolve(undefined);
  expect(await first).toMatchObject(headConflict);
  expect(await second).toMatchObject(headConflict);
  expect(after(events, "older released")).toEqual(["older released", "registration"]);
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    ...greenInvalid,
    revisionId: selected,
  });
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test("a rejected commit runs no refresh, and its registration supplies the next role check's reconciliation", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, failLockTicketAfterNextRegistration } = await selectBlueNote(f);
  await editToGreenWithTurn(f);
  const failure = new Error("Injected lock ticket write failure.");
  failLockTicketAfterNextRegistration(failure);
  await expect(runtime.commitProposal(ctx, attempts[1])).rejects.toBe(failure);
  expect(storageOf(runtime).lineage.selected).toMatchObject(blueValid);
  expect(storageOf(runtime).registration).toMatchObject(blueCount);
  await runtime.refreshRoles(ctx);
  expect(storageOf(runtime).lineage.selected).toMatchObject(greenInvalid);
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test("a commit started while another commit confirms its branch reference registers only after that commit's refresh, which judges validity by the edited effective sources and keeps the earlier registration's counts", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source, attempts, events, holdAfterNextRegistration } =
    await selectBlueNote(f);
  const committing = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Blue again\n" }),
    [source],
  );
  const confirmation = holdNextConfirmation();
  const first = runtime.commitProposal(ctx, committing);
  await confirmation.entered.promise;
  await editToGreenWithTurn(f);
  const secondHeld = holdAfterNextRegistration();
  const second = runtime.commitProposal(ctx, attempts[0]);
  events.push("confirmation released");
  confirmation.release.resolve(undefined);
  const committed = committedId(await first);
  await secondHeld.entered.promise;
  expect(after(events, "confirmation released")).toEqual(["confirmation released", "registration"]);
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    ...greenInvalid,
    revisionId: committed,
  });
  expect(storageOf(runtime).registration).toMatchObject(blueCount);
  secondHeld.release.resolve(undefined);
  expect(await second).toMatchObject(headConflict);
  expect(storageOf(runtime).lineage.selected).toMatchObject({
    ...greenInvalid,
    revisionId: committed,
  });
  expect(storageOf(runtime).registration).toMatchObject(greenCount);
});

test.for(["host abort", "replacement"] as const)(
  "a $0 while a commit waits for its storage turn returns cancelled with that reason and writes no head",
  async (cancellation, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Waiting commit.");
    const runtime = runtimeFor(f);
    const ctx = f.session.extensionRunner.createContext();
    await runtime.start(ctx);
    const source = await sourceReference(f, "Waiting commit.");
    const winning = runtime.captureProposal(ctx, noteContent({ "current-work.md": "One\n" }), [
      source,
    ]);
    const waiting = runtime.captureProposal(ctx, noteContent({ "journey.md": "Two\n" }), [source]);
    const confirmation = holdNextConfirmation();
    const first = runtime.commitProposal(ctx, winning);
    await confirmation.entered.promise;
    const controller = new AbortController();
    const second = runtime.commitProposal({ ...ctx, signal: controller.signal }, waiting);
    const reason = new Error("cancelled while waiting for the storage turn");
    const replacing = cancellation === "replacement" ? runtime.selectBranch(ctx) : undefined;
    if (cancellation === "host abort") {
      controller.abort(reason);
    }
    const result = await second;
    confirmation.release.resolve(undefined);
    const winner = committedId(await first);
    await replacing;
    const cancelled = result.kind === "cancelled" ? result.reason : undefined;
    expect(result.kind).toBe("cancelled");
    expect(cancelled instanceof Error ? cancelled.message : undefined).toBe(
      cancellation === "host abort"
        ? reason.message
        : "Tiered memory storage stopped for a session change or shutdown.",
    );
    expect(cancellation === "replacement" || cancelled === reason).toBe(true);
    const store = await storeFor(f);
    expect(await store.currentHead()).toBe(winner);
    expect((await store.readRevision(winner))?.notes).toEqual({ "current-work.md": "One\n" });
  },
);

const orphanEvidence = "Evidence under the first model.";
const otherModel = { ...fixtureModel, id: "another-model" };
const orphanBases = [
  { label: "no base", withOlder: false },
  { label: "a confirmed base", withOlder: true },
] as const;

interface ModelOrphan {
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  source: string;
  older: string | null;
  orphan: string;
  anchorId: string;
  stale: MemoryProposal;
  events: string[];
}

async function orphanUnderFirstModel(f: Fixture, withOlder: boolean): Promise<ModelOrphan> {
  await f.session.prompt(orphanEvidence);
  const events: string[] = [];
  const { runtime, dropNextReference } = referenceDroppingRuntime(f, {
    write: registrationLog(events),
  });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, orphanEvidence);
  const capture = (notes: Record<string, string>): MemoryProposal =>
    runtime.captureProposal(ctx, noteContent(notes), [source]);
  const older = withOlder
    ? committedId(await runtime.commitProposal(ctx, capture({ "current-work.md": "R0\n" })))
    : null;
  const stale = capture({ "topic-stale.md": "Stale\n" });
  const proposal = capture({ "current-work.md": "H\n" });
  dropNextReference();
  const orphan = committedId(await runtime.commitProposal(ctx, proposal));
  await runtime.start({ ...ctx, model: otherModel });
  expect(storageOf(runtime)).toMatchObject({
    lineage: {
      selected: older === null ? { state: "none" } : { state: "selected", revisionId: older },
    },
    latestRevision: orphan,
  });
  return { runtime, ctx, source, older, orphan, anchorId: proposal.anchorId, stale, events };
}

function selects(runtime: MemoryRuntime, revisionId: string): boolean {
  const storage = runtime.snapshot.storage;
  return (
    storage.state === "open" &&
    storage.lineage.selected.state === "selected" &&
    storage.lineage.selected.revisionId === revisionId
  );
}

function referencesTo(f: Fixture, runtime: MemoryRuntime, revisionId: string): string[] {
  return validReferences(f, storageOf(runtime).projectId).filter((id) => id === revisionId);
}

function statusLines(runtime: MemoryRuntime, ctx: ExtensionContext): string[] {
  return renderStatus(buildStatus(runtime, ctx)).split("\n");
}

async function headNotes(f: Fixture): Promise<Record<string, string> | undefined> {
  const store = await storeFor(f);
  const head = await store.currentHead();
  return head === null ? undefined : (await store.readRevision(head))?.notes;
}

async function currentWorkView(f: Fixture): Promise<string> {
  const store = await storeFor(f);
  return await readFile(join(store.sessionDir, "current", "current-work.md"), "utf8");
}

test.for(orphanBases)(
  "an orphan head committed under another model with $label keeps the selection and head, names the head in status, and refuses capture",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, older, orphan, anchorId } = await orphanUnderFirstModel(
      f,
      withOlder,
    );
    const otherCtx = { ...ctx, model: otherModel };
    expect(statusLines(runtime, otherCtx)).toContain(
      unresolvedLine(orphan, anchorId, "it was committed with other settings or models"),
    );
    expect(() =>
      runtime.captureProposal(otherCtx, noteContent({ "journey.md": "Other\n" }), [source]),
    ).toThrow(`Memory revision ${orphan} is not recorded on this branch`);
    expect(storageOf(runtime).lineage).toMatchObject({
      selected: older === null ? { state: "none" } : { state: "selected", revisionId: older },
    });
    expect(storageOf(runtime).lineage.pending).toEqual({
      state: "unresolved",
      revisionId: orphan,
      anchorId,
      reason: "configuration",
    });
    expect(storageOf(runtime).latestRevision).toBe(orphan);
  },
);

test.for(orphanBases)(
  "a capture while the role check for the orphan head's model with $label is in flight refuses, and status reports the reconciliation",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source } = await orphanUnderFirstModel(f, withOlder);
    const changing = runtime.refreshRoles(ctx);
    expect(() =>
      runtime.captureProposal(ctx, noteContent({ "journey.md": "During\n" }), [source]),
    ).toThrow("Memory storage is reconciling with the current settings and models.");
    expect(statusLines(runtime, ctx)).toContain(
      "Memory commits: blocked while memory reconciles with the current settings and models.",
    );
    await changing;
  },
);

test.for(orphanBases)(
  "after an awaited role check for the orphan head's model with $label, the next commit inherits the head's notes",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, orphan } = await orphanUnderFirstModel(f, withOlder);
    await runtime.refreshRoles(ctx);
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "P\n" }), [source]);
    const committed = committedId(await runtime.commitProposal(ctx, proposal));
    expect(await headNotes(f)).toEqual({ "current-work.md": "H\n", "journey.md": "P\n" });
    expect(await currentWorkView(f)).toBe("H\n");
    expect(proposal).toMatchObject({
      baseRevision: { revisionId: orphan },
      expectedRevision: orphan,
    });
    expect(storageOf(runtime).lineage.selected).toMatchObject({ revisionId: committed });
    expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
  },
);

test.for(orphanBases)(
  "a branch refresh after the role check for the orphan head's model with $label selects the head, and the next commit inherits its notes",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, orphan } = await orphanUnderFirstModel(f, withOlder);
    await runtime.refreshRoles(ctx);
    await runtime.selectBranch(ctx);
    expect(storageOf(runtime).lineage.selected).toMatchObject({
      state: "selected",
      revisionId: orphan,
    });
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "P\n" }), [source]);
    expect(proposal).toMatchObject({
      baseRevision: { revisionId: orphan },
      expectedRevision: orphan,
    });
    committedId(await runtime.commitProposal(ctx, proposal));
    expect(await headNotes(f)).toEqual({ "current-work.md": "H\n", "journey.md": "P\n" });
  },
);

test.for(orphanBases)(
  "a retained proposal committed while the model change back confirms the recovered reference of an orphan head with $label registers only after the reconciliation, returns a head conflict, and keeps the head's notes",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, orphan, stale, events } = await orphanUnderFirstModel(
      f,
      withOlder,
    );
    const { projectId } = storageOf(runtime);
    const confirmation = holdNextConfirmation(
      () =>
        referencesIn(f.session.sessionManager.getBranch(), projectId).some(
          (reference) => reference.revisionId === orphan,
        ) && !selects(runtime, orphan),
    );
    const changing = runtime.refreshRoles(ctx);
    await confirmation.entered.promise;
    expect(() =>
      runtime.captureProposal(ctx, noteContent({ "journey.md": "During\n" }), [source]),
    ).toThrow("Memory storage is reconciling with the current settings and models.");
    const committing = runtime.commitProposal(ctx, stale);
    events.push("confirmation released");
    confirmation.release.resolve(undefined);
    await changing;
    expect(await committing).toMatchObject({
      kind: "conflict",
      reason: "head",
      expectedRevision: stale.expectedRevision,
      actualRevision: orphan,
    });
    expect(after(events, "confirmation released")).toEqual([
      "confirmation released",
      "registration",
    ]);
    expect(storageOf(runtime).lineage).toMatchObject({
      selected: { state: "selected", revisionId: orphan },
      pending: { state: "none" },
    });
    expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
    expect((await (await storeFor(f)).readRevision(orphan))?.notes).toEqual({
      "current-work.md": "H\n",
    });
    expect(await currentWorkView(f)).toBe("H\n");
  },
);

test.for(orphanBases)(
  "a model change while the change back reconciles an orphan head with $label appends no reference, and only the latest change's reconciliation publishes",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, older, orphan, anchorId } = await orphanUnderFirstModel(
      f,
      withOlder,
    );
    const read = holdNextRead((path) => path.endsWith(`${orphan}.json`));
    const back = runtime.refreshRoles(ctx);
    await read.entered.promise;
    const otherCtx = { ...ctx, model: otherModel };
    const away = runtime.refreshRoles(otherCtx);
    read.release.resolve(undefined);
    await Promise.all([back, away]);
    expect(referencesTo(f, runtime, orphan)).toEqual([]);
    expect(storageOf(runtime)).toMatchObject({
      lineage: {
        selected: older === null ? { state: "none" } : { state: "selected", revisionId: older },
        pending: { state: "unresolved", revisionId: orphan, reason: "configuration" },
      },
      reconciliation: "current",
    });
    expect(statusLines(runtime, otherCtx)).toContain(
      unresolvedLine(orphan, anchorId, "it was committed with other settings or models"),
    );
    await runtime.refreshRoles(ctx);
    expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
    expect(storageOf(runtime).lineage.selected).toMatchObject({ revisionId: orphan });
    expect(
      runtime.captureProposal(ctx, noteContent({ "journey.md": "P\n" }), [source]),
    ).toMatchObject({ baseRevision: { revisionId: orphan }, expectedRevision: orphan });
  },
);

test("a retained proposal's commit does not register while a role check's reconciliation is held after it releases the project lock, and commits after it", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source, selected, events } = await selectBlueNote(f);
  const retained = runtime.captureProposal(ctx, noteContent({ "journey.md": "Kept\n" }), [source]);
  const unlocked = holdAfterNextLockRelease();
  const checking = runtime.refreshRoles(ctx);
  await unlocked.entered.promise;
  events.push("reconciliation held");
  const committing = runtime.commitProposal(ctx, retained);
  await drainUntil(() => after(events, "reconciliation held").length > 1);
  expect(after(events, "reconciliation held")).toEqual(["reconciliation held"]);
  unlocked.release.resolve(undefined);
  await checking;
  const committed = committedId(await committing);
  expect(after(events, "reconciliation held")).toEqual(["reconciliation held", "registration"]);
  expect((await (await storeFor(f)).readRevision(committed))?.baseRevision).toMatchObject({
    revisionId: selected,
  });
});
test("a disable during the role check for an orphan head's model skips its reconciliation, and enabling again reconciles and selects the head", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, orphan } = await orphanUnderFirstModel(f, false);
  const changing = runtime.refreshRoles(ctx);
  runtime.disable();
  await changing;
  expect(referencesTo(f, runtime, orphan)).toEqual([]);
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "none" } },
    reconciliation: "reconciling",
  });
  await runtime.enable(ctx);
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: orphan }, pending: { state: "none" } },
    reconciliation: "current",
  });
  expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
});

test.for(orphanBases)(
  "a role change during the recovery confirmation of an orphan head with $label keeps capture refused, and the newer reconciliation confirms and selects the head",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, orphan, stale } = await orphanUnderFirstModel(f, withOlder);
    const { projectId } = storageOf(runtime);
    const confirmation = holdNextConfirmation(
      () =>
        referencesIn(f.session.sessionManager.getBranch(), projectId).some(
          (reference) => reference.revisionId === orphan,
        ) && !selects(runtime, orphan),
    );
    const back = runtime.refreshRoles(ctx);
    await confirmation.entered.promise;
    const again = runtime.refreshRoles(ctx);
    confirmation.release.resolve(undefined);
    expect(() =>
      runtime.captureProposal(ctx, noteContent({ "journey.md": "During\n" }), [source]),
    ).toThrow("Memory storage is reconciling with the current settings and models.");
    await back;
    await again;
    expect(storageOf(runtime)).toMatchObject({
      lineage: { selected: { state: "selected", revisionId: orphan }, pending: { state: "none" } },
      reconciliation: "current",
    });
    expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
    expect(await runtime.commitProposal(ctx, stale)).toMatchObject({
      kind: "conflict",
      reason: "head",
      actualRevision: orphan,
    });
    const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "P\n" }), [source]);
    expect(proposal).toMatchObject({
      baseRevision: { revisionId: orphan },
      expectedRevision: orphan,
    });
    committedId(await runtime.commitProposal(ctx, proposal));
    expect(await headNotes(f)).toEqual({ "current-work.md": "H\n", "journey.md": "P\n" });
  },
);

test("a role check that completes while storage starts reconciles after the startup publishes, so storage ends ready", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  const { runtime, ctx, orphan } = await orphanUnderFirstModel(f, false);
  const otherCtx = { ...ctx, model: otherModel };
  const startup = holdNextRead((path) => path.endsWith(`${orphan}.json`));
  const navigating = runtime.selectBranch(otherCtx);
  await startup.entered.promise;
  const queued = admissions(onTestFinished);
  const changing = runtime.refreshRoles(ctx);
  await Promise.race([queued.promise, changing]);
  startup.release.resolve(undefined);
  await navigating;
  await changing;
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: orphan }, pending: { state: "none" } },
    reconciliation: "current",
  });
  expect(statusLines(runtime, ctx).filter((line) => line.startsWith("Memory commits:"))).toEqual(
    [],
  );
});

async function unrecordedHead(f: Fixture): Promise<{
  runtime: MemoryRuntime;
  ctx: ExtensionContext;
  head: string;
}> {
  await f.session.prompt("Unrecorded head.");
  const failure = new Error("Injected view write failure.");
  const runtime = runtimeFor(f, {
    write: afterHeadWrite(async () => {
      await Promise.reject(failure);
    }),
  });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": "Kept\n" }), [
    await sourceReference(f, "Unrecorded head."),
  ]);
  await expect(runtime.commitProposal(ctx, proposal)).rejects.toBe(failure);
  const head = String(storageOf(runtime).latestRevision);
  expect(storageOf(runtime).lineage.pending).toEqual({ state: "unappended", revisionId: head });
  return { runtime, ctx, head };
}

function commitLines(runtime: MemoryRuntime, ctx: ExtensionContext): string[] {
  return statusLines(runtime, ctx).filter((line) => line.startsWith("Memory commits:"));
}

test("a failed confirmation after a role check appends the reference of an unrecorded head reports it as unsaved, and the retry confirms it without a second reference", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, head } = await unrecordedHead(f);
  const confirmation = holdNextConfirmation();
  const checking = runtime.refreshRoles(ctx);
  await confirmation.entered.promise;
  expect(referencesTo(f, runtime, head)).toEqual([head]);
  confirmation.release.reject(new Error("EIO: injected confirmation failure"));
  await checking;
  expect(storageOf(runtime).reconciliation).toBe("failed");
  expect(commitLines(runtime, ctx)).toEqual([failedLine, unsavedLine(head)]);
  await runtime.refreshRoles(ctx);
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: head }, pending: { state: "none" } },
    reconciliation: "current",
  });
  expect(referencesTo(f, runtime, head)).toEqual([head]);
});

test("a role change during the confirmation of an unrecorded head's appended reference reports it as unsaved, and the newer reconciliation confirms it without a second reference", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, head } = await unrecordedHead(f);
  const confirmation = holdNextConfirmation();
  const first = runtime.refreshRoles(ctx);
  await confirmation.entered.promise;
  const second = runtime.refreshRoles(ctx);
  expect(commitLines(runtime, ctx)).toEqual([reconcilingLine, unsavedLine(head)]);
  confirmation.release.resolve(undefined);
  await first;
  await second;
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: head }, pending: { state: "none" } },
    reconciliation: "current",
  });
  expect(referencesTo(f, runtime, head)).toEqual([head]);
});

test("a role check that fails while storage starts leaves storage failed with its error and capture refused until a retry succeeds", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source, orphan } = await orphanUnderFirstModel(f, false);
  const otherCtx = { ...ctx, model: otherModel };
  const startup = holdNextRead((path) => path.endsWith(`${orphan}.json`));
  const navigating = runtime.selectBranch(otherCtx);
  await startup.entered.promise;
  const failure = new Error("Injected role check failure.");
  await expect(runtime.refreshRoles(failingRoles(ctx, failure))).rejects.toBe(failure);
  startup.release.resolve(undefined);
  await navigating;
  expect(storageOf(runtime)).toMatchObject({ reconciliation: "failed", error: failure.message });
  expect(statusLines(runtime, otherCtx)).toContain(failedLine);
  expect(() =>
    runtime.captureProposal(otherCtx, noteContent({ "journey.md": "Failed\n" }), [source]),
  ).toThrow("The latest memory reconciliation failed.");
  await runtime.refreshRoles(ctx);
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: orphan } },
    reconciliation: "current",
    error: undefined,
  });
});

test("a startup that captures its identity while a role check is pending publishes reconciling, and that check's reconciliation makes storage ready", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source } = await selectBlueNote(f);
  const beforeIdentity = holdNextRead((path) => path.endsWith("sources.json"));
  const navigating = runtime.selectBranch(ctx);
  await beforeIdentity.entered.promise;
  const roles = gatedRoles({ ...ctx, model: otherModel });
  const changing = runtime.refreshRoles(roles.ctx);
  await roles.entered.promise;
  beforeIdentity.release.resolve(undefined);
  await navigating;
  expect(storageOf(runtime).reconciliation).toBe("reconciling");
  expect(() =>
    runtime.captureProposal(roles.ctx, noteContent({ "journey.md": "During\n" }), [source]),
  ).toThrow("Memory storage is reconciling with the current settings and models.");
  roles.release.resolve(undefined);
  await changing;
  expect(storageOf(runtime).reconciliation).toBe("current");
  expect(commitLines(runtime, roles.ctx)).toEqual([]);
  expect(() =>
    runtime.captureProposal(roles.ctx, noteContent({ "journey.md": "After\n" }), [source]),
  ).not.toThrow();
});

test("a replacement that interrupts a pending role check lets the replacement's storage end ready", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source } = await selectBlueNote(f);
  const roles = gatedRoles({ ...ctx, model: otherModel });
  const changing = runtime.refreshRoles(roles.ctx);
  await roles.entered.promise;
  const startup = holdNextRead((path) => path.endsWith("sources.json"));
  const replacing = runtime.selectBranch(ctx);
  await changing;
  startup.release.resolve(undefined);
  await replacing;
  roles.release.resolve(undefined);
  expect(storageOf(runtime).reconciliation).toBe("current");
  expect(commitLines(runtime, ctx)).toEqual([]);
  expect(() =>
    runtime.captureProposal(ctx, noteContent({ "journey.md": "After\n" }), [source]),
  ).not.toThrow();
});

test("a commit's conflict refresh keeps a failed role check reported and capture refused until a role check succeeds", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, source, attempts } = await selectBlueNote(f);
  const failure = new Error("Injected role check failure.");
  await expect(runtime.refreshRoles(failingRoles(ctx, failure))).rejects.toBe(failure);
  expect(storageOf(runtime).reconciliation).toBe("failed");
  expect(await runtime.commitProposal(ctx, attempts[0])).toMatchObject(headConflict);
  expect(storageOf(runtime)).toMatchObject({ reconciliation: "failed", error: failure.message });
  expect(() =>
    runtime.captureProposal(ctx, noteContent({ "journey.md": "Failed\n" }), [source]),
  ).toThrow("The latest memory reconciliation failed.");
  await runtime.refreshRoles(ctx);
  expect(storageOf(runtime)).toMatchObject({ reconciliation: "current", error: undefined });
});

test("a role check during a commit's view writes leaves the durable head pending and capture refused, then selects the head once after the commit ends", async ({
  createFixture,
  onTestFinished,
}) => {
  const f = await createFixture();
  await f.session.prompt("Held view.");
  const viewEntered = Promise.withResolvers<undefined>();
  const viewGate = Promise.withResolvers<undefined>();
  const runtime = runtimeFor(f, {
    write: afterHeadWrite(async () => {
      viewEntered.resolve(undefined);
      await viewGate.promise;
    }),
  });
  const ctx = f.session.extensionRunner.createContext();
  await runtime.start(ctx);
  const source = await sourceReference(f, "Held view.");
  const commit = runtime.commitProposal(
    ctx,
    runtime.captureProposal(ctx, noteContent({ "current-work.md": "Held\n" }), [source]),
  );
  await viewEntered.promise;
  const head = String(storageOf(runtime).latestRevision);
  const queued = admissions(onTestFinished);
  let settled = false;
  const checking = runtime.refreshRoles(ctx).then(() => {
    settled = true;
  });
  await queued.promise;
  expect(settled).toBe(false);
  expect(storageOf(runtime).lineage.pending).toEqual({ state: "unappended", revisionId: head });
  expect(() => runtime.captureProposal(ctx, noteContent({}), [source])).toThrow(Error);
  viewGate.resolve(undefined);
  expect(committedId(await commit)).toBe(head);
  await checking;
  expect(storageOf(runtime)).toMatchObject({
    lineage: { selected: { state: "selected", revisionId: head }, pending: { state: "none" } },
    reconciliation: "current",
  });
  expect(referencesTo(f, runtime, head)).toEqual([head]);
});

test.for(orphanBases)(
  "a change back to an orphan head's model paused before its append while a change away and a change back begin appends nothing, and only the latest change's reconciliation publishes, for $label",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, orphan } = await orphanUnderFirstModel(f, withOlder);
    const read = holdNextRead((path) => path.endsWith(`${orphan}.json`));
    const first = runtime.refreshRoles(ctx);
    await read.entered.promise;
    const away = runtime.refreshRoles({ ...ctx, model: otherModel });
    const roles = gatedRoles(ctx);
    const back = runtime.refreshRoles(roles.ctx);
    await away;
    read.release.resolve(undefined);
    await first;
    expect(referencesTo(f, runtime, orphan)).toEqual([]);
    expect(storageOf(runtime).reconciliation).toBe("reconciling");
    await roles.entered.promise;
    roles.release.resolve(undefined);
    await back;
    expect(referencesTo(f, runtime, orphan)).toEqual([orphan]);
    expect(storageOf(runtime)).toMatchObject({
      lineage: { selected: { state: "selected", revisionId: orphan }, pending: { state: "none" } },
      reconciliation: "current",
    });
  },
);

test("a commit's refresh after a role check reconciled with that commit's registration leaves the state unchanged", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const { runtime, ctx, attempts, holdAfterNextRegistration } = await selectBlueNote(f);
  await editToGreenWithTurn(f);
  const held = holdAfterNextRegistration();
  const committing = runtime.commitProposal(ctx, attempts[0]);
  await held.entered.promise;
  const checking = runtime.refreshRoles(ctx);
  held.release.resolve(undefined);
  await checking;
  const { reconciliation: _running, ...reconciled } = storageOf(runtime);
  expect(reconciled.lineage.selected).toMatchObject(greenInvalid);
  expect(reconciled.registration).toMatchObject(greenCount);
  expect(await committing).toMatchObject(headConflict);
  expect(storageOf(runtime)).toEqual({ ...reconciled, reconciliation: "current" });
});

test.for(["start", "selectBranch"] as const)(
  "a $0 whose role check fails leaves status on the failed-reconciliation line with the error, and capture refuses",
  async (transition, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Failed branch role check.");
    const runtime = runtimeFor(f);
    const ctx = f.session.extensionRunner.createContext();
    await runtime.start(ctx);
    const failure = new Error("Injected role check failure.");
    await expect(runtime[transition](failingRoles(ctx, failure))).rejects.toBe(failure);
    expect(storageOf(runtime)).toMatchObject({ reconciliation: "failed", error: failure.message });
    expect(statusLines(runtime, ctx)).toEqual(
      expect.arrayContaining([`Storage error: ${failure.message}`, failedLine]),
    );
    expect(() =>
      runtime.captureProposal(ctx, noteContent({ "journey.md": "Failed\n" }), [
        sourceEntry(f, "Failed branch role check.").id,
      ]),
    ).toThrow("The latest memory reconciliation failed.");
  },
);

async function failedRoleCheck(f: Fixture): Promise<BlueSelection> {
  const selection = await selectBlueNote(f);
  const failure = new Error("Injected role check failure.");
  await expect(selection.runtime.refreshRoles(failingRoles(selection.ctx, failure))).rejects.toBe(
    failure,
  );
  expect(storageOf(selection.runtime).reconciliation).toBe("failed");
  return selection;
}

async function expectReadyCommit(selection: BlueSelection): Promise<void> {
  const { runtime, ctx, source, selected } = selection;
  expect(storageOf(runtime)).toMatchObject({ reconciliation: "current", error: undefined });
  const proposal = runtime.captureProposal(ctx, noteContent({ "journey.md": "Ready\n" }), [source]);
  expect(proposal).toMatchObject({ baseRevision: { revisionId: selected } });
  committedId(await runtime.commitProposal(ctx, proposal));
}

test("tree navigation after a failed role check reconciles, and a capture then commits", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const selection = await failedRoleCheck(f);
  await selection.runtime.selectBranch(selection.ctx);
  await expectReadyCommit(selection);
});

test("a model selection after a failed enable reconciles, and a capture then commits", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const selection = await selectBlueNote(f);
  const { runtime, ctx } = selection;
  const failure = new Error("Injected role check failure.");
  await expect(runtime.enable(failingRoles(ctx, failure))).rejects.toBe(failure);
  expect(storageOf(runtime)).toMatchObject({ reconciliation: "failed", error: failure.message });
  await runtime.refreshRoles(ctx);
  await expectReadyCommit(selection);
});

test("disabling and enabling after a failed role check reconciles, and a capture then commits", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const selection = await failedRoleCheck(f);
  selection.runtime.disable();
  await selection.runtime.enable(selection.ctx);
  await expectReadyCommit(selection);
});

test("a capture while enabling memory's role check is in flight refuses, and the enable then makes storage ready", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const selection = await selectBlueNote(f);
  const { runtime, ctx, source } = selection;
  runtime.disable();
  const roles = gatedRoles(ctx);
  const enabling = runtime.enable(roles.ctx);
  await roles.entered.promise;
  expect(() =>
    runtime.captureProposal(ctx, noteContent({ "journey.md": "During\n" }), [source]),
  ).toThrow("Memory storage is reconciling with the current settings and models.");
  roles.release.resolve(undefined);
  await enabling;
  await expectReadyCommit(selection);
});

test.for(orphanBases)(
  "a startup whose registration overlaps the start of another model's role check appends no reference to an orphan head with $label, and that check leaves it unresolved",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, orphan, anchorId } = await orphanUnderFirstModel(f, withOlder);
    const registration = holdNextRead((path) => path.endsWith("sources.json"));
    const navigating = runtime.selectBranch(ctx);
    await registration.entered.promise;
    const otherCtx = { ...ctx, model: otherModel };
    const roles = gatedRoles(otherCtx);
    const changing = runtime.refreshRoles(roles.ctx);
    await roles.entered.promise;
    registration.release.resolve(undefined);
    await navigating;
    expect(referencesTo(f, runtime, orphan)).toEqual([]);
    expect(storageOf(runtime).reconciliation).toBe("reconciling");
    roles.release.resolve(undefined);
    await changing;
    expect(referencesTo(f, runtime, orphan)).toEqual([]);
    expect(storageOf(runtime).lineage.pending).toEqual({
      state: "unresolved",
      revisionId: orphan,
      anchorId,
      reason: "configuration",
    });
    expect(() =>
      runtime.captureProposal(otherCtx, noteContent({ "journey.md": "Other\n" }), [source]),
    ).toThrow(`Memory revision ${orphan} is not recorded on this branch`);
    expect(statusLines(runtime, otherCtx)).toContain(
      unresolvedLine(orphan, anchorId, "it was committed with other settings or models"),
    );
  },
);

test.for(orphanBases)(
  "a model selection after a context edit judges an orphan head with $label by the edited sources, so it stays unresolved for evidence and gets no reference",
  async ({ withOlder }, { createFixture }) => {
    const f = await createFixture();
    const { runtime, ctx, source, older, orphan, anchorId } = await orphanUnderFirstModel(
      f,
      withOlder,
    );
    f.session.sessionManager.appendContextEdit(sourceEntry(f, orphanEvidence).id, {
      content: "Edited evidence under the other model.",
    });
    await runtime.refreshRoles(ctx);
    expect(referencesTo(f, runtime, orphan)).toEqual([]);
    expect(storageOf(runtime).lineage).toMatchObject({
      selected:
        older === null
          ? { state: "none" }
          : {
              state: "selected",
              revisionId: older,
              invalidNotes: ["current-work.md"],
              invalidReason: "note-evidence",
            },
      pending: { state: "unresolved", revisionId: orphan, anchorId, reason: "evidence" },
    });
    expect(() =>
      runtime.captureProposal(ctx, noteContent({ "journey.md": "Edited\n" }), [source]),
    ).toThrow(`Memory revision ${orphan} is not recorded on this branch`);
    expect(statusLines(runtime, ctx)).toContain(
      unresolvedLine(
        orphan,
        anchorId,
        "its evidence or curated notes changed after it was committed",
      ),
    );
  },
);

test("a role check whose source projection fails on malformed tool-result metadata reports a failed reconciliation and refuses capture, and navigating before that entry makes storage ready", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const selection = await selectBlueNote(f);
  const { runtime, ctx, source } = selection;
  const beforeMalformed = f.session.sessionManager.getLeafId();
  const malformed = {
    role: "toolResult" as const,
    toolCallId: "call-missing-name",
    toolName: "edit",
    isError: false,
    content: [{ type: "text" as const, text: "result" }],
    timestamp: Date.now(),
  };
  Reflect.deleteProperty(malformed, "toolName");
  f.session.sessionManager.appendMessage(malformed);
  await runtime.refreshRoles(ctx);
  expect(storageOf(runtime)).toMatchObject({
    reconciliation: "failed",
    error: "Invalid tool result source metadata.",
  });
  expect(statusLines(runtime, ctx)).toEqual(
    expect.arrayContaining(["Storage error: Invalid tool result source metadata.", failedLine]),
  );
  expect(() =>
    runtime.captureProposal(ctx, noteContent({ "journey.md": "Failed\n" }), [source]),
  ).toThrow("The latest memory reconciliation failed.");
  if (beforeMalformed === null) {
    throw new Error("Missing entry before the malformed tool result.");
  }
  f.session.sessionManager.branch(beforeMalformed);
  await runtime.selectBranch(ctx);
  await expectReadyCommit(selection);
});
