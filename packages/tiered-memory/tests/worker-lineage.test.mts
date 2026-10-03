import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { expect } from "vitest";

import type { ProposalContent } from "../src/pi/lineage.ts";
import type { MemoryRuntime } from "../src/pi/runtime.ts";
import type { JobOutcome } from "../src/pi/worker.ts";
import { writeDurable } from "../src/storage/files.ts";
import { readHead } from "../src/storage/revisions.ts";
import type { Revision } from "../src/storage/revisions.ts";
import { fixtureMessage } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import type { TestServices, TestWrite } from "./storage-harness.mts";
import {
  committedId,
  noteContent,
  readOptional,
  runtimeFor,
  sourceReference,
  storeFor,
  test,
} from "./store-fixture.mts";
import { noteReply, observerReply, ScriptedObserver } from "./worker-fixture.mts";
import type { PendingObserverCall } from "./worker-fixture.mts";

type CreateFixture = (options?: FixtureOptions) => Promise<Fixture>;

// Fails or holds the child extension's writes that match while the fault is set.
class WriteFault {
  failure: Error | undefined;
  hold:
    | { entered: PromiseWithResolvers<undefined>; release: PromiseWithResolvers<undefined> }
    | undefined;
  matches: (path: string) => boolean = () => false;

  readonly write: TestWrite = async (path, contents) => {
    if (this.matches(path)) {
      const hold = this.hold;
      if (hold !== undefined) {
        this.hold = undefined;
        hold.entered.resolve(undefined);
        await hold.release.promise;
      }
      if (this.failure !== undefined) {
        throw this.failure;
      }
    }
    await writeDurable(path, contents);
  };

  holdNext(): { entered: Promise<undefined>; release: () => void } {
    const hold = {
      entered: Promise.withResolvers<undefined>(),
      release: Promise.withResolvers<undefined>(),
    };
    this.hold = hold;
    return {
      entered: hold.entered.promise,
      release: () => {
        hold.release.resolve(undefined);
      },
    };
  }
}

interface Parent {
  parent: Fixture;
  runtime: MemoryRuntime;
  r1: string;
  parentDir: string;
  failViews: { failing: boolean };
}

async function commitParent(
  f: Fixture,
  runtime: MemoryRuntime,
  content: ProposalContent,
): Promise<string> {
  const ctx = f.session.extensionRunner.createContext();
  const source = await sourceReference(f, "Parent evidence.");
  return committedId(
    await runtime.commitProposal(ctx, runtime.captureProposal(ctx, content, [source])),
  );
}

async function parentWithR1(
  createFixture: CreateFixture,
  r1: ProposalContent = noteContent({ "current-work.md": "Parent R1\n" }),
): Promise<Parent> {
  const parent = await createFixture();
  await parent.session.prompt("Parent evidence.");
  const failViews = { failing: false };
  const runtime = runtimeFor(parent, {
    async write(path, contents) {
      if (failViews.failing && path.includes(`${sep}current${sep}`)) {
        throw new Error("Injected parent view failure.");
      }
      await writeDurable(path, contents);
    },
  });
  await runtime.start(parent.session.extensionRunner.createContext());
  const committed = await commitParent(parent, runtime, r1);
  const parentDir = (await storeFor(parent)).sessionDir;
  return { parent, runtime, r1: committed, parentDir, failViews };
}

// Leaves the parent's R2 durable with its views and learnings unwritten.
async function makeR2Pending(
  p: Parent,
  content: ProposalContent = noteContent({
    "current-work.md": "Parent R2\n",
    "journey.md": "Parent journey\n",
  }),
): Promise<string> {
  p.failViews.failing = true;
  await expect(commitParent(p.parent, p.runtime, content)).rejects.toThrow(
    "Injected parent view failure.",
  );
  p.failViews.failing = false;
  const head = await Effect.runPromise(readHead(p.parentDir));
  if (head === undefined || head.materialized || head.revisionId === p.r1) {
    throw new Error("Expected a pending parent head after R1.");
  }
  return head.revisionId;
}

async function forkChild(
  createFixture: CreateFixture,
  p: Parent,
  observer: ScriptedObserver,
  services: TestServices = {},
  options: FixtureOptions = {},
): Promise<Fixture> {
  const parentFile = p.parent.session.sessionManager.getSessionFile() ?? "";
  const fork = SessionManager.forkFrom(parentFile, p.parent.cwd, join(p.parent.cwd, "sessions"));
  return await createFixture({
    ...options,
    cwd: p.parent.cwd,
    sessionFile: fork.getSessionFile() ?? "",
    services,
    observer: observer.script,
  });
}

const failedObserver = (): ReturnType<typeof fixtureMessage> =>
  fixtureMessage("", "error", "Replacement observer stopped.");

// Navigates to the leaf's parent entry, which keeps every message and revision reference.
async function navigateBack(child: Fixture): Promise<void> {
  const target = child.session.sessionManager.getBranch().at(-2);
  await child.session.navigateTree(target?.id ?? "", { summarize: false });
}

function childDir(p: Parent, child: Fixture): string {
  return join(dirname(p.parentDir), child.session.sessionManager.getSessionId());
}

function parentView(p: Parent, name: string): string {
  return join(p.parentDir, "current", name);
}

async function expectRepaired(p: Parent, r2: string): Promise<void> {
  expect(await readFile(parentView(p, "current-work.md"), "utf8")).toBe("Parent R2\n");
  expect(await readFile(parentView(p, "journey.md"), "utf8")).toBe("Parent journey\n");
  expect(await Effect.runPromise(readHead(p.parentDir))).toMatchObject({
    revisionId: r2,
    materialized: true,
  });
}

async function expectUnrepaired(p: Parent): Promise<void> {
  expect(await readFile(parentView(p, "current-work.md"), "utf8")).toBe("Parent R1\n");
  expect((await Effect.runPromise(readHead(p.parentDir)))?.materialized).toBe(false);
}

async function childRevisions(p: Parent, child: Fixture): Promise<Revision[]> {
  const store = await storeFor(child);
  let names: string[];
  try {
    names = await readdir(join(childDir(p, child), "revisions"));
  } catch {
    return [];
  }
  const revisions = await Promise.all(
    names.map(async (name) => await store.readRevision(name.replace(/\.json$/u, ""))),
  );
  return revisions.filter((revision) => revision !== undefined);
}

async function childHead(child: Fixture): Promise<Revision | undefined> {
  const store = await storeFor(child);
  const head = await store.currentHead();
  return head === null ? undefined : await store.readRevision(head);
}

function lastOutcome(child: Fixture): JobOutcome | undefined {
  return child.memory().work.status?.last;
}

async function reportLines(child: Fixture): Promise<string[]> {
  await child.command("status");
  return child.report().split("\n");
}

// Answers the child's pending call with a note that retains R1's claims and cites the new spans.
function inheritingReply(pending: PendingObserverCall): void {
  pending.reply(noteReply("Child continues Parent R1.", pending.call));
}

test("Pi startup repairs a fork ancestor's pending R2 before worker capture from selected R1", async ({
  createFixture,
}) => {
  const p = await parentWithR1(createFixture);
  const r2 = await makeR2Pending(p);
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer);
  const pending = await observer.next();
  await expectRepaired(p, r2);
  expect(pending.call.prompt).toContain("Parent R1");
  expect(pending.call.prompt).not.toContain("Parent R2");
  inheritingReply(pending);
  await child.memory().work.idle();
  expect(lastOutcome(child)).toMatchObject({ kind: "committed" });
});

test.for(["reload", "navigation"] as const)(
  "Pi %s repairs ancestor R2 before worker capture from selected R1",
  async (retry, { createFixture }) => {
    const p = await parentWithR1(createFixture);
    const observer = new ScriptedObserver();
    const child = await forkChild(createFixture, p, observer, {}, { personal: { enabled: false } });
    const r2 = await makeR2Pending(p);
    await expectUnrepaired(p);
    if (retry === "reload") {
      await child.reload();
    } else {
      await navigateBack(child);
    }
    await expectRepaired(p, r2);
    expect(observer.calls).toEqual([]);
    await child.command("on");
    const pending = await observer.next();
    expect(pending.call.prompt).toContain("Parent R1");
    expect(pending.call.prompt).not.toContain("Parent R2");
    inheritingReply(pending);
    await child.memory().work.idle();
    expect(lastOutcome(child)).toMatchObject({ kind: "committed" });
  },
);

test("Pi observer input and the child commit inherit R1 notes, not R2-only notes", async ({
  createFixture,
}) => {
  const p = await parentWithR1(createFixture);
  await makeR2Pending(p);
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer);
  const pending = await observer.next();
  expect(pending.call.prompt).not.toContain("Parent journey");
  pending.reply(observerReply({ observations: [], workNote: { status: "unchanged" } }));
  await child.memory().work.idle();
  const revision = await childHead(child);
  expect(revision?.baseRevision).toEqual({
    sessionId: p.parent.session.sessionManager.getSessionId(),
    revisionId: p.r1,
  });
  expect(revision?.notes).toEqual({ "current-work.md": "Parent R1\n" });
});

test("Pi neither session records unwritten ancestor views as curation during worker capture", async ({
  createFixture,
}) => {
  const p = await parentWithR1(createFixture);
  await makeR2Pending(p);
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer);
  inheritingReply(await observer.next());
  await child.memory().work.idle();
  expect(lastOutcome(child)).toMatchObject({ kind: "committed" });
  expect(await readOptional(join(p.parentDir, "curation.json"))).toBeUndefined();
  expect(await readOptional(join(childDir(p, child), "curation.json"))).toBeUndefined();
  expect(await reportLines(child)).toContain("Selected memory validity: current");
});

// The child's job captures against R1 before the parent's R2 becomes pending.
async function retainedChild(
  createFixture: CreateFixture,
  services: TestServices = {},
): Promise<{
  p: Parent;
  child: Fixture;
  observer: ScriptedObserver;
  pending: PendingObserverCall;
  r2: string;
}> {
  const p = await parentWithR1(createFixture);
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer, services);
  const pending = await observer.next();
  const r2 = await makeR2Pending(p);
  return { p, child, observer, pending, r2 };
}

test("Pi a worker captured against R1 commits after ancestor R2 becomes pending", async ({
  createFixture,
}) => {
  const { p, child, pending, r2 } = await retainedChild(createFixture);
  inheritingReply(pending);
  await child.memory().work.idle();
  const revision = await childHead(child);
  expect(lastOutcome(child)).toEqual({ kind: "committed", revisionId: revision?.id });
  expect(revision?.baseRevision?.revisionId).toBe(p.r1);
  expect(revision?.notes).toEqual({ "current-work.md": "Child continues Parent R1." });
  await expectRepaired(p, r2);
});

test("Pi a retained worker proposal commits without false exclusions after ancestor repair", async ({
  createFixture,
}) => {
  const { p, child, pending } = await retainedChild(createFixture);
  pending.reply(observerReply({ observations: [], workNote: { status: "unchanged" } }));
  await child.memory().work.idle();
  const revision = await childHead(child);
  expect(revision?.excludedInheritedNotes).toEqual([]);
  expect(revision?.notes).toEqual({ "current-work.md": "Parent R1\n" });
  expect(await readOptional(join(p.parentDir, "curation.json"))).toBeUndefined();
  expect(await reportLines(child)).toContain("Selected memory validity: current");
});

test("Pi a true external edit of an inherited note blocks a retained worker proposal's replacement", async ({
  createFixture,
}) => {
  const { p, child, pending } = await retainedChild(createFixture);
  await writeFile(parentView(p, "current-work.md"), "User's own note.\n");
  pending.reply(
    observerReply({
      observations: [],
      workNote: { status: "updated", body: "Replacement.", sources: ["P1"] },
    }),
  );
  await child.memory().work.idle();
  expect(lastOutcome(child)).toEqual({ kind: "conflict", reason: "curation" });
  expect(await childRevisions(p, child)).toEqual([]);
  expect(await readFile(parentView(p, "current-work.md"), "utf8")).toBe("User's own note.\n");
});

function learning(name: string, body: string): ProposalContent {
  return {
    ...noteContent({ "current-work.md": "Parent R1\n" }),
    learnings: { [name]: body },
    expectedLearnings: { [name]: { digest: null, sequence: null } },
  };
}

test("Pi inherited worker commits recover connected learnings and keep true external edits", async ({
  createFixture,
}) => {
  const p = await parentWithR1(createFixture, learning("guide.md", "Guide\n"));
  const learnings = join(dirname(dirname(p.parentDir)), "learnings");
  await writeFile(join(learnings, "guide.md"), "User guide edit.\n");
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer);
  const pending = await observer.next();
  await makeR2Pending(p, {
    ...noteContent({ "current-work.md": "Parent R2\n", "journey.md": "Parent journey\n" }),
    learnings: { "index.md": "Learned\n" },
    expectedLearnings: { "index.md": { digest: null, sequence: null } },
  });
  inheritingReply(pending);
  await child.memory().work.idle();
  expect(lastOutcome(child)).toMatchObject({ kind: "committed" });
  expect(await readFile(join(learnings, "index.md"), "utf8")).toBe("Learned\n");
  expect(await readFile(join(learnings, "guide.md"), "utf8")).toBe("User guide edit.\n");
});

// A child whose startup repair of the parent's pending R2 fails at the parent's view writes.
async function failedChildStart(createFixture: CreateFixture): Promise<{
  p: Parent;
  child: Fixture;
  observer: ScriptedObserver;
  fault: WriteFault;
  r2: string;
}> {
  const p = await parentWithR1(createFixture);
  const r2 = await makeR2Pending(p);
  const fault = new WriteFault();
  fault.failure = new Error("Injected parent repair failure.");
  fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
  const observer = new ScriptedObserver();
  const child = await forkChild(createFixture, p, observer, { write: fault.write });
  await child.memory().work.idle();
  return { p, child, observer, fault, r2 };
}

test("Pi a failed ancestor repair reports the error and preserves both curation files", async ({
  createFixture,
}) => {
  const { p, child } = await failedChildStart(createFixture);
  const lines = await reportLines(child);
  expect(lines).toContain("Memory storage: unavailable");
  expect(lines).toContain("Storage error: Injected parent repair failure.");
  expect(await readOptional(join(p.parentDir, "curation.json"))).toBeUndefined();
  expect(await readOptional(join(childDir(p, child), "curation.json"))).toBeUndefined();
  await expectUnrepaired(p);
});

test("Pi a failed ancestor repair publishes no child revision for that worker attempt", async ({
  createFixture,
}) => {
  const fault = new WriteFault();
  const { p, child, pending } = await retainedChild(createFixture, { write: fault.write });
  fault.failure = new Error("Injected parent repair failure.");
  fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
  inheritingReply(pending);
  await child.memory().work.idle();
  expect(lastOutcome(child)).toEqual({
    kind: "failed",
    message: "Injected parent repair failure.",
  });
  expect(await childRevisions(p, child)).toEqual([]);
  await expectUnrepaired(p);
});

test("Pi failed startup dispatches no observer and advances no coverage", async ({
  createFixture,
}) => {
  const { p, child, observer } = await failedChildStart(createFixture);
  await child.session.prompt("Child work.");
  await child.memory().work.idle();
  expect(observer.calls).toEqual([]);
  expect(await childRevisions(p, child)).toEqual([]);
});

test("Pi failed reconciliation dispatches no observer and advances no coverage", async ({
  createFixture,
}) => {
  const p = await parentWithR1(createFixture);
  const fault = new WriteFault();
  const observer = new ScriptedObserver();
  const child = await forkChild(
    createFixture,
    p,
    observer,
    { write: fault.write },
    { personal: { enabled: false } },
  );
  await makeR2Pending(p);
  fault.failure = new Error("Injected parent repair failure.");
  fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
  await child.command("on");
  await child.session.prompt("Child work.");
  await child.memory().work.idle();
  expect(observer.calls).toEqual([]);
  expect(await childRevisions(p, child)).toEqual([]);
  const lines = await reportLines(child);
  expect(lines).toContain("Storage error: Injected parent repair failure.");
  expect(lines).toContain(
    "Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.",
  );
});

test.for(["/reload", "navigation retry"] as const)(
  "Pi after clearing a repair fault, %s permits one valid worker commit",
  async (retry, { createFixture }) => {
    const { p, child, observer, fault, r2 } = await failedChildStart(createFixture);
    fault.failure = undefined;
    if (retry === "/reload") {
      await child.reload();
    } else {
      await navigateBack(child);
    }
    const pending = await observer.next();
    inheritingReply(pending);
    await child.memory().work.idle();
    expect(lastOutcome(child)).toMatchObject({ kind: "committed" });
    expect(await childRevisions(p, child)).toHaveLength(1);
    await expectRepaired(p, r2);
  },
);

test.for(["disable", "navigation", "reload", "shutdown"] as const)(
  "Pi partial repair racing %s settles its started writes",
  async (transition, { createFixture }) => {
    const fault = new WriteFault();
    const { p, child, observer, pending } = await retainedChild(createFixture, {
      write: fault.write,
    });
    fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
    const held = fault.holdNext();
    inheritingReply(pending);
    await held.entered;
    observer.respond(failedObserver);
    const work = child.memory().work;
    let settled: Promise<void>;
    if (transition === "disable") {
      settled = child.command("off");
    } else if (transition === "navigation") {
      settled = navigateBack(child);
    } else if (transition === "reload") {
      settled = child.reload();
    } else {
      settled = child.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }
    held.release();
    await settled;
    await work.idle();
    await child.memory().work.idle();
    const views = await readdir(join(p.parentDir, "current"));
    expect(views.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await childRevisions(p, child)).toEqual([]);
  },
);

test("Pi a genuine repair write error racing a disable stays observable", async ({
  createFixture,
}) => {
  const fault = new WriteFault();
  const { p, child, pending } = await retainedChild(createFixture, { write: fault.write });
  fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
  fault.failure = new Error("Injected parent repair failure.");
  const held = fault.holdNext();
  inheritingReply(pending);
  await held.entered;
  const disabled = child.command("off");
  held.release();
  await disabled;
  await child.memory().work.idle();
  expect(lastOutcome(child)).toEqual({
    kind: "failed",
    message: "Injected parent repair failure.",
  });
});

test("Pi completed repair writes survive retry and old worker output stays out of replacements", async ({
  createFixture,
}) => {
  const fault = new WriteFault();
  const { p, child, observer, pending, r2 } = await retainedChild(createFixture, {
    write: fault.write,
  });
  fault.matches = (path) => path.startsWith(join(p.parentDir, "current"));
  const held = fault.holdNext();
  pending.reply(noteReply("Old output.", pending.call));
  await held.entered;
  const navigated = navigateBack(child);
  held.release();
  await navigated;
  const retried = await observer.next();
  retried.reply(noteReply("New output.", retried.call));
  await child.memory().work.idle();
  await expectRepaired(p, r2);
  const notes = (await childRevisions(p, child)).map(
    (revision) => revision.notes["current-work.md"],
  );
  expect(notes).toEqual(["New output."]);
});
