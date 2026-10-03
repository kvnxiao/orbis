import type * as FsPromises from "node:fs/promises";
import { link } from "node:fs/promises";
import { sep } from "node:path";

import * as Effect from "effect/Effect";
import { afterEach, expect, test as vitest, vi } from "vitest";

import type { AssignedSpan, SourceInterval } from "../src/domain/intervals.ts";
import { encodeSpanReference } from "../src/domain/references.ts";
import { Execution } from "../src/pi/execution.ts";
import { parseObserverResponse } from "../src/pi/observer.ts";
import { addUsage, attemptDeadline, WorkerQueue } from "../src/pi/worker.ts";
import type { JobOutcome, WorkerJob } from "../src/pi/worker.ts";
import { fixtureMessage, fixtureModel } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions } from "./pi-fixture.mts";
import { openScope, testServices } from "./storage-harness.mts";
import type { TestServices } from "./storage-harness.mts";
import {
  committedId,
  noteContent,
  referenceDroppingRuntime,
  storeFor,
  test,
} from "./store-fixture.mts";
import {
  advance,
  controlledClock,
  noteReply,
  observerReply,
  ScriptedObserver,
  workerFixture,
} from "./worker-fixture.mts";

const projectId = "a".repeat(64);

function intervalOf(...entryIds: string[]): SourceInterval {
  const spans = entryIds.map((entryId, order): AssignedSpan => ({
    reference: encodeSpanReference({ projectId, sessionId: "s1", entryId, span: 0 }, undefined),
    entryId,
    order,
    role: "user",
    time: {},
    range: undefined,
    entryLength: 4,
    text: "text",
  }));
  return { spans, tokens: 10 };
}

function referenceOf(job: WorkerJob): string {
  return job.interval.spans[0]?.reference ?? "";
}

function jobOf(...entryIds: string[]): WorkerJob {
  return { kind: "observer", interval: intervalOf(...entryIds), enqueuedAt: 0 };
}

vitest("attemptDeadline counts queue waiting against the job's total deadline", () => {
  expect(attemptDeadline({ enqueuedAt: 1000 }, 1600, { index: 0, attempts: 1 }, 1000)).toEqual({
    kind: "attempt",
    timeoutMs: 400,
  });
});

vitest("attemptDeadline divides the remaining time among the attempts left", () => {
  expect(attemptDeadline({ enqueuedAt: 0 }, 100, { index: 0, attempts: 3 }, 1000)).toEqual({
    kind: "attempt",
    timeoutMs: 300,
  });
  expect(attemptDeadline({ enqueuedAt: 0 }, 400, { index: 1, attempts: 3 }, 1000)).toEqual({
    kind: "attempt",
    timeoutMs: 300,
  });
  expect(attemptDeadline({ enqueuedAt: 0 }, 999, { index: 2, attempts: 3 }, 1000)).toEqual({
    kind: "attempt",
    timeoutMs: 1,
  });
});

vitest("attemptDeadline reports expired when no time remains", () => {
  expect(attemptDeadline({ enqueuedAt: 0 }, 1000, { index: 0, attempts: 2 }, 1000)).toEqual({
    kind: "expired",
  });
  expect(attemptDeadline({ enqueuedAt: 0 }, 1500, { index: 1, attempts: 2 }, 1000)).toEqual({
    kind: "expired",
  });
});

interface HeldQueue {
  execution: Execution;
  queue: WorkerQueue;
  started: WorkerJob[];
  finish: (outcome: JobOutcome) => void;
}

// Each job waits until the test finishes it, so the queue's contents stay observable.
async function heldQueue(queuedJobs: number): Promise<HeldQueue> {
  const execution = new Execution(testServices());
  const scope = await openScope(execution);
  const started: WorkerJob[] = [];
  const finishers: ((outcome: JobOutcome) => void)[] = [];
  const starts = Array.from({ length: 4 }, () => Promise.withResolvers<undefined>());
  const queue = WorkerQueue.start(
    execution,
    scope,
    { queuedJobs },
    (job) =>
      Effect.promise(async () => {
        started.push(job);
        const done = Promise.withResolvers<JobOutcome>();
        finishers.push(done.resolve);
        starts[started.length - 1]?.resolve(undefined);
        return await done.promise;
      }),
    () => {
      drains.set(queue, (drains.get(queue) ?? 0) + 1);
    },
  );
  heldStarts.set(queue, starts);
  return {
    execution,
    queue,
    started,
    finish(outcome) {
      finishers.shift()?.(outcome);
    },
  };
}

const heldStarts = new WeakMap<WorkerQueue, PromiseWithResolvers<undefined>[]>();
const drains = new WeakMap<WorkerQueue, number>();

async function untilStarted(held: HeldQueue, count: number): Promise<void> {
  await heldStarts.get(held.queue)?.[count - 1]?.promise;
}

vitest("addUsage sums reported fields and keeps unreported ones unknown", () => {
  const none = {
    attempts: 0,
    reported: 0,
    input: undefined,
    output: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
    cost: undefined,
  };
  const usage = {
    input: 10,
    output: 4,
    cacheRead: Number.NaN,
    cacheWrite: 2,
    totalTokens: 16,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
  };
  expect(addUsage(none, undefined)).toEqual({ ...none, attempts: 1 });
  expect(addUsage(addUsage(addUsage(none, undefined), usage), usage)).toEqual({
    attempts: 3,
    reported: 2,
    input: 20,
    output: 8,
    cacheRead: undefined,
    cacheWrite: 4,
    cost: 1,
  });
});

vitest("WorkerQueue offer defers when the queue is full and counts the deferral", async () => {
  const held = await heldQueue(1);
  expect(held.queue.offer(jobOf("e1"))).toEqual({ kind: "queued" });
  await untilStarted(held, 1);
  expect(held.queue.offer(jobOf("e2"))).toEqual({ kind: "queued" });
  expect(held.queue.offer(jobOf("e3"))).toEqual({ kind: "deferred", reason: "full" });
  expect(held.queue.status).toMatchObject({ queued: 1, deferred: 1 });
  expect(held.queue.status.running?.interval.spans[0]?.entryId).toBe("e1");
  await held.execution.shutdown(new Error("Test shutdown."));
});

vitest("WorkerQueue offer defers after its storage scope closes", async () => {
  const held = await heldQueue(2);
  held.queue.offer(jobOf("e1"));
  await untilStarted(held, 1);
  await held.execution.shutdown(new Error("Test shutdown."));
  expect(held.queue.isStopped).toBe(true);
  expect(held.queue.offer(jobOf("e2"))).toEqual({ kind: "deferred", reason: "stopped" });
  expect(held.queue.status).toMatchObject({ queued: 0, running: undefined, deferred: 0 });
});

vitest("WorkerQueue claims the spans of queued, running, and exhausted jobs", async () => {
  const held = await heldQueue(2);
  const first = jobOf("e1");
  const second = jobOf("e2");
  held.queue.offer(first);
  await untilStarted(held, 1);
  held.queue.offer(second);
  expect(held.queue.claimed).toEqual(new Set([referenceOf(first), referenceOf(second)]));
  held.finish({
    kind: "exhausted",
    failures: [{ kind: "truncated" }],
    deadline: false,
    commit: false,
  });
  await untilStarted(held, 2);
  held.finish({ kind: "stale", reason: "changed" });
  await held.queue.idle();
  expect(held.queue.claimed).toEqual(new Set([referenceOf(first)]));
  expect(held.queue.status).toMatchObject({
    queued: 0,
    running: undefined,
    exhausted: new Set([referenceOf(first)]),
    last: { kind: "stale", reason: "changed" },
  });
  await held.execution.shutdown(new Error("Test shutdown."));
});

vitest("WorkerQueue clear discards waiting jobs and keeps the running one", async () => {
  const held = await heldQueue(2);
  held.queue.offer(jobOf("e1"));
  await untilStarted(held, 1);
  held.queue.offer(jobOf("e2"));
  held.queue.clear();
  expect(held.queue.status).toMatchObject({ queued: 0 });
  expect(held.queue.status.running?.interval.spans[0]?.entryId).toBe("e1");
  held.finish({ kind: "committed", revisionId: "r1" });
  await held.queue.idle();
  expect(held.started).toHaveLength(1);
  await held.execution.shutdown(new Error("Test shutdown."));
});

vitest(
  "WorkerQueue calls its drain callback once per drain after a commit, never after only skips",
  async () => {
    const held = await heldQueue(2);
    held.queue.offer(jobOf("e1"));
    await untilStarted(held, 1);
    held.queue.offer(jobOf("e2"));
    held.finish({ kind: "committed", revisionId: "r1" });
    await untilStarted(held, 2);
    expect(drains.get(held.queue) ?? 0).toBe(0);
    held.finish({ kind: "stale", reason: "oversize" });
    await held.queue.idle();
    expect(drains.get(held.queue)).toBe(1);
    held.queue.offer(jobOf("e3"));
    await untilStarted(held, 3);
    held.finish({ kind: "stale", reason: "oversize" });
    await held.queue.idle();
    expect(drains.get(held.queue)).toBe(1);
    await held.execution.shutdown(new Error("Test shutdown."));
  },
);

vitest(
  "parseObserverResponse classifies length, error, aborted, malformed, and oversized output",
  () => {
    const valid = JSON.stringify({ observations: [], workNote: { status: "empty" } });
    expect(parseObserverResponse(fixtureMessage(valid, "length"), 100)).toEqual({
      kind: "failed",
      failure: { kind: "truncated" },
    });
    expect(parseObserverResponse(fixtureMessage("", "error", "Rate limited."), 100)).toEqual({
      kind: "failed",
      failure: { kind: "provider", message: "Rate limited." },
    });
    expect(parseObserverResponse(fixtureMessage("", "aborted"), 100)).toMatchObject({
      kind: "failed",
      failure: { kind: "provider" },
    });
    expect(parseObserverResponse(fixtureMessage("```json\n{}\n```"), 100)).toEqual({
      kind: "failed",
      failure: { kind: "malformed", detail: "Invalid JSON at observer response." },
    });
    expect(parseObserverResponse(fixtureMessage('{"observations":[]}'), 100)).toMatchObject({
      kind: "failed",
      failure: {
        kind: "malformed",
        detail: "Invalid record at observer response: /: must have required properties workNote",
      },
    });
    expect(parseObserverResponse(fixtureMessage(valid), 10)).toEqual({
      kind: "failed",
      failure: { kind: "oversized", tokens: Math.ceil(valid.length / 4), limit: 10 },
    });
    expect(parseObserverResponse(fixtureMessage(valid), 100)).toEqual({
      kind: "parsed",
      output: { observations: [], workNote: { status: "empty" } },
    });
  },
);

const secondModel = { ...fixtureModel, id: "fixture-b", name: "Fixture B" };

async function observing(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options: FixtureOptions = {},
): Promise<{ f: Fixture; observer: ScriptedObserver }> {
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer, options);
  return { f, observer };
}

function lastOutcome(f: Fixture): JobOutcome | undefined {
  return f.memory().work.status?.last;
}

async function head(f: Fixture): Promise<string | null> {
  return await (await storeFor(f)).currentHead();
}

async function selectModel(f: Fixture, id: string): Promise<void> {
  const model = f.session.extensionRunner
    .createContext()
    .modelRegistry.find(fixtureModel.provider, id);
  if (model === undefined) {
    throw new Error(`Missing fixture model ${id}.`);
  }
  await f.session.setModel(model);
}

const malformed = fixtureMessage("not json");

test("Pi queued observer jobs dispatch one at a time", async ({ createFixture }) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("First goal.");
  const first = await observer.next();
  await f.session.prompt("Second goal.");
  expect(f.memory().work.status).toMatchObject({ queued: 1 });
  expect(observer.calls).toHaveLength(1);
  first.reply(noteReply("First.", first.call));
  const second = await observer.next();
  expect(second.call.prompt).toContain("Second goal.");
  expect(second.call.prompt).not.toContain("First goal.");
  second.reply(noteReply("Second.", second.call));
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(2);
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a full queue leaves deferred spans on disk until the queue drains after a commit", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { queuedJobs: 1 } },
  });
  await f.session.prompt("First goal.");
  const first = await observer.next();
  await f.session.prompt("Second goal.");
  await f.session.prompt("Third goal.");
  expect(f.memory().work.status).toMatchObject({ queued: 1, deferred: 1 });
  first.reply(noteReply("First.", first.call));
  const second = await observer.next();
  expect(second.call.prompt).not.toContain("Third goal.");
  await f.command("status");
  expect(f.report()).toContain("Processing coverage: 4 gaps (4 unprocessed)");
  second.reply(noteReply("Second.", second.call));
  const drained = await observer.next();
  expect(drained.call.prompt).toContain("Third goal.");
  drained.reply(noteReply("Drained.", drained.call));
  await f.memory().work.idle();
  await f.command("status");
  expect(f.report()).toContain("Processing coverage: no gaps");
});

test("Pi a job whose total deadline passes in the queue releases its spans for a later pass", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 2 } },
  });
  await f.session.prompt("Slow goal.");
  const first = await observer.next();
  await f.session.prompt("Waiting goal.");
  expect(first.call.options.timeoutMs).toBe(333);
  await advance(clock, 1000);
  await f.memory().work.idle();
  expect(observer.calls.map((call) => call.options.timeoutMs)).toEqual([333, 333, 334]);
  expect(observer.calls.every((call) => !call.prompt.includes("Waiting goal."))).toBe(true);
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "expired" });
  expect(f.memory().work.status?.exhausted.size).toBe(2);
  await f.command("status");
  expect(f.report()).toContain("Processing coverage: 4 gaps (2 unprocessed, 2 failed)");
  expect(await head(f)).toBeNull();
  // The slow job's two timed-out retries arrived unanswered before the later job's call.
  await observer.next();
  await observer.next();
  await f.session.prompt("Later goal.");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Waiting goal.");
  expect(later.call.prompt).not.toContain("Slow goal.");
  later.reply(noteReply("Later.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a job whose every attempt timed out within its deadline is exhausted", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 1 } },
  });
  await f.session.prompt("Slow goal.");
  await observer.next();
  await advance(clock, 1000);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({
    kind: "exhausted",
    failures: [
      { kind: "timeout", timeoutMs: 500 },
      { kind: "timeout", timeoutMs: 500 },
    ],
    deadline: false,
    commit: false,
  });
  expect(f.memory().work.status?.exhausted.size).toBe(2);
});

test("Pi attempts run with maxRetries 0 so provider retries stay within the retry budget", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, { services: { clock } });
  await f.session.prompt("Budget goal.");
  const pending = await observer.next();
  const { signal, ...options } = pending.call.options;
  expect(options).toEqual({ maxTokens: 2048, maxRetries: 0, timeoutMs: 30000 });
  expect(signal).toBeInstanceOf(AbortSignal);
  pending.reply(noteReply("Budget.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi retries stop after the configured retries and later intervals still proceed", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { retries: 1 } },
  });
  await f.session.prompt("First goal.");
  (await observer.next()).reply(malformed);
  (await observer.next()).reply(fixtureMessage("", "length"));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({
    kind: "exhausted",
    failures: [
      { kind: "malformed", detail: "Invalid JSON at observer response." },
      { kind: "truncated" },
    ],
    deadline: false,
    commit: false,
  });
  await f.session.prompt("Second goal.");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Second goal.");
  expect(later.call.prompt).not.toContain("First goal.");
  later.reply(noteReply("Second.", later.call));
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(3);
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a conflicted job is not retried with its old output, and a later schedule asks again", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, { models: [secondModel] });
  await f.session.prompt("Model goal.");
  const pending = await observer.next();
  await selectModel(f, secondModel.id);
  pending.reply(noteReply("Old output.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "configuration" });
  expect(observer.calls).toHaveLength(1);
  expect(await head(f)).toBeNull();
  await f.session.prompt("Next goal.");
  const fresh = await observer.next();
  expect(fresh.call.model).toBe(`${fixtureModel.provider}/${secondModel.id}`);
  expect(fresh.call.prompt).toContain("Model goal.");
  fresh.reply(noteReply("New output.", fresh.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi disable cancels the running job, and re-enabling schedules bounded catch-up", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { queuedJobs: 1 } },
  });
  await f.session.prompt("First goal.");
  const cancelled = await observer.next();
  await f.session.prompt("Second goal.");
  await f.command("off");
  await f.memory().work.idle();
  expect(cancelled.call.options.signal?.aborted).toBe(true);
  cancelled.reply(noteReply("Late.", cancelled.call));
  expect(lastOutcome(f)).toMatchObject({ kind: "cancelled" });
  expect(f.memory().work.status).toMatchObject({ queued: 0 });
  await f.session.prompt("Disabled goal.");
  expect(observer.calls).toHaveLength(1);
  await f.command("on");
  const catchUp = await observer.next();
  expect(catchUp.call.prompt).toContain("First goal.");
  expect(catchUp.call.prompt).toContain("Disabled goal.");
  expect(f.memory().work.status).toMatchObject({ queued: 0 });
  catchUp.reply(noteReply("Caught up.", catchUp.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(await head(f)).not.toBeNull();
});

test.for(["reload", "tree navigation", "shutdown"] as const)(
  "Pi %s cancels the running job and its late success commits nothing",
  async (transition, { createFixture }) => {
    const { f, observer } = await observing(createFixture);
    await f.session.prompt("Replaced goal.");
    const pending = await observer.next();
    const work = f.memory().work;
    observer.respond(() => malformed);
    if (transition === "reload") {
      await f.reload();
    } else if (transition === "tree navigation") {
      const first = f.session.sessionManager.getBranch()[0];
      await f.session.navigateTree(first?.id ?? "");
    } else {
      await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }
    await work.idle();
    expect(pending.call.options.signal?.aborted).toBe(true);
    pending.reply(noteReply("Late.", pending.call));
    await f.memory().work.idle();
    expect(await head(f)).toBeNull();
    expect(f.memory().work.status?.last?.kind).not.toBe("committed");
  },
);

test("Pi a late provider rejection after tree navigation changes no replacement state", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Abandoned goal.");
  const pending = await observer.next();
  const first = f.session.sessionManager.getBranch()[0];
  await f.session.navigateTree(first?.id ?? "");
  const replacement = f.memory().work.status;
  pending.fail(new Error("Late provider failure."));
  await f.memory().work.idle();
  expect(f.memory().work.status).toEqual(replacement);
  expect(f.memory().work.status?.last).toBeUndefined();
  expect(await head(f)).toBeNull();
});

test.for([
  { label: "a context edit", change: "edit", reason: "evidence" },
  { label: "an omitted source", change: "omit", reason: "evidence" },
  { label: "a model change", change: "model", reason: "configuration" },
] as const)(
  "Pi a late success after $label is rejected with $reason",
  async ({ change, reason }, { createFixture }) => {
    const { f, observer } = await observing(createFixture, { models: [secondModel] });
    await f.session.prompt("The setting is blue.");
    const pending = await observer.next();
    const user = f.session.sessionManager
      .getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "user");
    if (change === "model") {
      await selectModel(f, secondModel.id);
    } else {
      f.session.sessionManager.appendContextEdit(
        user?.id ?? "",
        change === "edit" ? { content: "The setting is green." } : null,
      );
    }
    pending.reply(noteReply("The setting is blue.", pending.call));
    await f.memory().work.idle();
    expect(lastOutcome(f)).toEqual({ kind: "conflict", reason });
    expect(await head(f)).toBeNull();
  },
);

test("Pi a non-cooperative provider's late result after its deadline is discarded", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 1 } },
  });
  await f.session.prompt("Deadline goal.");
  const late = await observer.next();
  await advance(clock, 500);
  const fresh = await observer.next();
  expect(late.call.options.signal?.aborted).toBe(true);
  late.reply(noteReply("Late note.", late.call));
  fresh.reply(noteReply("Fresh note.", fresh.call));
  await f.memory().work.idle();
  const revisionId = await head(f);
  expect(lastOutcome(f)).toEqual({ kind: "committed", revisionId });
  const revision = await (await storeFor(f)).readRevision(revisionId ?? "");
  expect(revision?.notes["current-work.md"]).toBe("Fresh note.");
});

const observerOverride = { ...fixtureModel, id: "observer-x", name: "Observer X" };

test.for([
  { label: "the session model selected before dispatch", override: false, expected: "fixture-b" },
  { label: "the configured override", override: true, expected: "observer-x" },
])(
  "Pi the observer model resolves at dispatch to $label without substitution",
  async ({ override, expected }, { createFixture }) => {
    const { f, observer } = await observing(createFixture, {
      models: [secondModel, observerOverride],
      ...(override ? { personal: { observerModel: "tiered-fixture/observer-x" } } : {}),
    });
    await selectModel(f, secondModel.id);
    await f.session.prompt("Model goal.");
    const pending = await observer.next();
    expect(pending.call.model).toBe(`${fixtureModel.provider}/${expected}`);
    pending.reply(noteReply("Model.", pending.call));
    await f.memory().work.idle();
    expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  },
);

const noAuth = { ...fixtureModel, provider: "tiered-noauth", id: "observer", name: "No auth" };

test.for([
  {
    label: "an unresolved observer model",
    options: { personal: { observerModel: "tiered-fixture/missing" } },
    line: "observer model: tiered-fixture/missing (personal); tiered-fixture/missing; suspended: Model identifier is unresolved.",
  },
  {
    label: "missing observer credentials",
    options: { noAuthModel: noAuth, personal: { observerModel: "tiered-noauth/observer" } },
    line: "observer model: tiered-noauth/observer (personal); tiered-noauth/observer; suspended: Credentials unavailable. Check this provider’s authentication and retry.",
  },
])("Pi $label suspends dispatch and is reported", async ({ options, line }, { createFixture }) => {
  const { f, observer } = await observing(createFixture, options);
  await f.session.prompt("Suspended goal.");
  await f.memory().work.idle();
  await f.command("status");
  expect(observer.calls).toEqual([]);
  expect(f.memory().work.status).toBeUndefined();
  expect(f.report()).toContain(line);
  expect(f.report()).toContain("Processing coverage: 2 gaps (2 unprocessed)");
});

test("Pi observer input stays within the worker input budget with the previous note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { workerInputTokens: 3000 } },
  });
  observer.respond((call) => noteReply(`Note after ${String(observer.calls.length)}.`, call));
  await f.session.prompt(`Long evidence: ${"x".repeat(12000)}`);
  await f.memory().work.idle();
  const estimates = observer.calls.map(
    (call) => Math.ceil(call.systemPrompt.length / 4) + Math.ceil(call.prompt.length / 4),
  );
  expect(observer.calls.length).toBeGreaterThan(2);
  expect(Math.max(...estimates)).toBeLessThanOrEqual(3000);
  expect(observer.calls[1]?.prompt).toContain("Note after 1.");
  expect(observer.calls.at(-1)?.prompt).toContain("Fixture response");
  await f.command("status");
  expect(f.report()).toContain("Processing coverage: no gaps");
});

const syncFault = vi.hoisted(() => ({ remaining: 0 }));

afterEach(() => {
  syncFault.remaining = 0;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[1] === "r+" && syncFault.remaining > 0) {
        syncFault.remaining--;
        throw new Error("Injected session-file fsync failure.");
      }
      return await actual.open(...args);
    },
  };
});

interface LockHold {
  entered: Promise<undefined>;
  release: () => void;
  fail: (error: Error) => void;
}

// Holds a chosen later project-lock acquisition at ticket publication, through the injected lock
// capability; other acquisitions publish normally.
class LockGate {
  publishes = 0;
  private readonly holds = new Map<number, (hold: LockHold) => void>();
  private readonly pending: PromiseWithResolvers<undefined>[] = [];

  readonly services: TestServices = {
    lock: {
      publish: async (source, ticket) => {
        this.publishes++;
        const arm = this.holds.get(this.publishes);
        if (arm !== undefined) {
          this.holds.delete(this.publishes);
          const entered = Promise.withResolvers<undefined>();
          const outcome = Promise.withResolvers<undefined>();
          this.pending.push(outcome);
          arm({
            entered: entered.promise,
            release: () => {
              outcome.resolve(undefined);
            },
            fail: (error) => {
              outcome.reject(error);
            },
          });
          entered.resolve(undefined);
          await outcome.promise;
        }
        await link(source, ticket);
      },
    },
  };

  /** Hold the acquisition `ahead` publications after the latest one. */
  async hold(ahead = 1): Promise<LockHold> {
    const armed = Promise.withResolvers<LockHold>();
    this.holds.set(this.publishes + ahead, armed.resolve);
    return await armed.promise;
  }

  releaseAll(): void {
    for (const outcome of this.pending.splice(0)) {
      outcome.resolve(undefined);
    }
  }
}

async function gated(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options: FixtureOptions = {},
): Promise<{ f: Fixture; observer: ScriptedObserver; gate: LockGate }> {
  const gate = new LockGate();
  const { f, observer } = await observing(createFixture, {
    ...options,
    services: gate.services,
    personal: { limits: { retries: 0 } },
  });
  f.onDispose(async () => {
    gate.releaseAll();
    await Promise.resolve();
  });
  return { f, observer, gate };
}

// Starts job A, whose observer call stays pending, and queues job B behind it.
async function runningAndQueued(
  f: Fixture,
  observer: ScriptedObserver,
): Promise<Awaited<ReturnType<ScriptedObserver["next"]>>> {
  await f.session.prompt("First goal.");
  const running = await observer.next();
  await f.session.prompt("Second goal.");
  expect(f.memory().work.status).toMatchObject({ queued: 1 });
  return running;
}

async function statusLines(f: Fixture): Promise<string[]> {
  await f.command("status");
  return f.report().split("\n");
}

const reconcilingLine =
  "Memory commits: blocked while memory reconciles with the current settings and models.";
const failedLine =
  "Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.";

test("Pi a queued worker is refused while reconciliation runs", async ({ createFixture }) => {
  const { f, observer, gate } = await gated(createFixture);
  const running = await runningAndQueued(f, observer);
  const held = gate.hold();
  const enabled = f.command("on");
  const hold = await held;
  await hold.entered;
  running.reply(malformed);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "unready" });
  expect(observer.calls).toHaveLength(1);
  hold.release();
  await enabled;
  const later = await observer.next();
  expect(later.call.prompt).toContain("Second goal.");
  later.reply(noteReply("Later.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test.for(["a failed reconciliation", "an unresolved orphan head"] as const)(
  "Pi a queued worker is refused after %s",
  async (cause, { createFixture }) => {
    const { f, observer, gate } = await gated(createFixture, { models: [secondModel] });
    const running = await runningAndQueued(f, observer);
    let blocked: string;
    if (cause === "a failed reconciliation") {
      const held = gate.hold();
      const enabled = f.command("on");
      (await held).fail(new Error("Injected reconciliation failure."));
      await enabled;
      blocked = failedLine;
    } else {
      const ctx = f.session.extensionRunner.createContext();
      const { runtime, dropNextReference } = referenceDroppingRuntime(f);
      const other = ctx.modelRegistry.find(fixtureModel.provider, secondModel.id);
      const otherCtx = { ...ctx, model: other };
      await runtime.start(otherCtx);
      const proposal = runtime.captureProposal(otherCtx, noteContent({ "journey.md": "O\n" }), []);
      dropNextReference();
      const orphan = committedId(await runtime.commitProposal(otherCtx, proposal));
      await runtime.shutdown();
      await f.command("on");
      blocked = `Memory commits: blocked by revision ${orphan}, which is not recorded on this branch: it was committed with other settings or models. Navigate with /tree to a point before entry ${proposal.anchorId} to continue memory work without it.`;
    }
    running.reply(malformed);
    await f.memory().work.idle();
    expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "unready" });
    await f.session.prompt("Third goal.");
    await f.memory().work.idle();
    expect(observer.calls).toHaveLength(1);
    expect(await statusLines(f)).toContain(blocked);
  },
);

test("Pi a retained worker proposal commits only after running reconciliation publishes", async ({
  createFixture,
}) => {
  const { f, observer, gate } = await gated(createFixture);
  await f.session.prompt("Retained goal.");
  const pending = await observer.next();
  const held = gate.hold();
  const enabled = f.command("on");
  const hold = await held;
  await hold.entered;
  pending.reply(noteReply("Retained.", pending.call));
  expect(await head(f)).toBeNull();
  expect(f.memory().work.status?.running).toBeDefined();
  expect(f.memory().runtime.snapshot.storage).toMatchObject({ reconciliation: "reconciling" });
  hold.release();
  await enabled;
  await f.memory().work.idle();
  const revisionId = await head(f);
  expect(lastOutcome(f)).toEqual({ kind: "committed", revisionId });
});

test.for([
  { label: "dependencies", reason: "configuration" },
  { label: "base", reason: "head" },
] as const)(
  "Pi a retained worker proposal is rejected when its $label no longer match",
  async ({ label, reason }, { createFixture }) => {
    const { f, observer } = await observing(createFixture, { models: [secondModel] });
    await f.session.prompt("Retained goal.");
    const pending = await observer.next();
    if (label === "dependencies") {
      await selectModel(f, secondModel.id);
    } else {
      const ctx = f.session.extensionRunner.createContext();
      const { runtime } = referenceDroppingRuntime(f);
      await runtime.start(ctx);
      const content = noteContent({ "journey.md": "Other writer.\n" });
      committedId(await runtime.commitProposal(ctx, runtime.captureProposal(ctx, content, [])));
      await runtime.shutdown();
    }
    pending.reply(noteReply("Retained.", pending.call));
    await f.memory().work.idle();
    expect(lastOutcome(f)).toEqual({ kind: "conflict", reason });
  },
);

test("Pi rejection keeps the current selection, committed notes, and coverage", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, { models: [secondModel] });
  await f.session.prompt("Committed goal.");
  const first = await observer.next();
  first.reply(noteReply("Committed note.", first.call));
  await f.memory().work.idle();
  const committed = await head(f);
  await f.session.prompt("Rejected goal.");
  const rejected = await observer.next();
  await selectModel(f, secondModel.id);
  rejected.reply(noteReply("Rejected note.", rejected.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "configuration" });
  expect(await head(f)).toBe(committed);
  const lines = await statusLines(f);
  expect(lines).toContain(`Selected memory revision: ${committed ?? ""}`);
  expect(lines).toContain("Processing coverage: 2 gaps (2 unprocessed)");
  const revision = await (await storeFor(f)).readRevision(committed ?? "");
  expect(revision?.notes["current-work.md"]).toBe("Committed note.");
});

test("Pi models or settings changed and changed back block worker capture until reconciliation", async ({
  createFixture,
}) => {
  const { f, observer, gate } = await gated(createFixture, { models: [secondModel] });
  const running = await runningAndQueued(f, observer);
  await selectModel(f, secondModel.id);
  const held = gate.hold();
  const changedBack = selectModel(f, fixtureModel.id);
  const hold = await held;
  await hold.entered;
  running.reply(malformed);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "unready" });
  expect(await statusLines(f)).toContain(reconcilingLine);
  hold.release();
  await changedBack;
  await f.session.prompt("Third goal.");
  const later = await observer.next();
  expect(later.call.model).toBe("tiered-fixture/fixture");
  later.reply(noteReply("Later.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a pending reference confirmation blocks worker capture with the previous selection", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { retries: 0 } },
  });
  const running = await runningAndQueued(f, observer);
  // The commit's own confirmation and its refresh's confirmation both fail their fsync.
  syncFault.remaining = 2;
  running.reply(noteReply("First.", running.call));
  await f.memory().work.idle();
  const revisionId = await head(f);
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "unready" });
  expect(observer.calls).toHaveLength(1);
  const lines = await statusLines(f);
  expect(lines).toContain("Selected memory revision: none");
  expect(lines).toContain(
    `Memory commits: blocked until the branch reference to revision ${revisionId ?? ""} is saved in the session file. Pi saves a new session file after its first assistant response.`,
  );
  await f.command("on");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Second goal.");
  later.reply(noteReply("Second.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a stale worker result never replaces the recovered revision", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Recovered goal.");
  const pending = await observer.next();
  const ctx = f.session.extensionRunner.createContext();
  const { runtime, dropNextReference } = referenceDroppingRuntime(f);
  await runtime.start(ctx);
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Recovered.\n" }),
    [],
  );
  dropNextReference();
  const recovered = committedId(await runtime.commitProposal(ctx, proposal));
  await runtime.shutdown();
  await f.command("on");
  expect(await statusLines(f)).toContain(`Selected memory revision: ${recovered}`);
  pending.reply(noteReply("Stale.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "head" });
  expect(await head(f)).toBe(recovered);
  expect(await statusLines(f)).toContain(`Selected memory revision: ${recovered}`);
  const revision = await (await storeFor(f)).readRevision(recovered);
  expect(revision?.notes["current-work.md"]).toBe("Recovered.\n");
});

// Registration, then the commit, then the refresh take the project lock in that order.
async function commitWithFailedRefresh(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
): Promise<{ f: Fixture; observer: ScriptedObserver; revisionId: string | null }> {
  const { f, observer, gate } = await gated(createFixture);
  await f.session.prompt("Refreshed goal.");
  const pending = await observer.next();
  const held = gate.hold(3);
  pending.reply(noteReply("Refreshed.", pending.call));
  (await held).fail(new Error("Injected refresh failure."));
  await f.memory().work.idle();
  return { f, observer, revisionId: await head(f) };
}

test("Pi a failed refresh after a worker commit attempt keeps its result and reports the error", async ({
  createFixture,
}) => {
  const { f, revisionId } = await commitWithFailedRefresh(createFixture);
  expect(revisionId).not.toBeNull();
  expect(lastOutcome(f)).toEqual({ kind: "committed", revisionId });
  const lines = await statusLines(f);
  expect(lines).toContain("Storage error: Injected refresh failure.");
  expect(lines).toContain(failedLine);
});

test("Pi capture stays blocked after a failed refresh until reconciliation succeeds", async ({
  createFixture,
}) => {
  const { f, observer } = await commitWithFailedRefresh(createFixture);
  await f.session.prompt("Blocked goal.");
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(1);
  await f.command("on");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Blocked goal.");
  later.reply(noteReply("Unblocked.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a rejected worker commit runs no refresh", async ({ createFixture }) => {
  const writes: string[] = [];
  const gate = new LockGate();
  const { f, observer } = await observing(createFixture, {
    services: {
      ...gate.services,
      async write(path, contents) {
        if (path.includes(`${sep}revisions${sep}`)) {
          throw new Error("Injected revision write failure.");
        }
        writes.push(path);
        const { writeDurable } = await import("../src/storage/files.ts");
        await writeDurable(path, contents);
      },
    },
  });
  await f.session.prompt("Rejected goal.");
  const pending = await observer.next();
  const before = gate.publishes;
  pending.reply(noteReply("Rejected.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "failed", message: "Injected revision write failure." });
  expect(gate.publishes - before).toBe(2);
  expect(await head(f)).toBeNull();
  expect(f.memory().runtime.snapshot.storage).toMatchObject({ error: undefined });
});

test("Pi planning drops a checkpoint that leaves no span budget and dispatches without it", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { workerInputTokens: 6144, checkpointTokens: 4800, retries: 0 } },
  });
  observer.respond(() => malformed);
  await f.session.prompt("Unseen work before compaction.");
  await f.memory().work.idle();
  const calls = observer.calls.length;
  f.session.sessionManager.appendCompaction(
    `Summary: ${"s".repeat(18000)}`,
    f.session.sessionManager.getLeafId(),
    100,
  );
  observer.respond((call) => noteReply("Resumed.", call));
  await f.session.prompt(`Resume later. ${"r".repeat(14000)}`);
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(calls + 1);
  const resumed = observer.calls.at(-1)?.prompt ?? "";
  expect(resumed).toContain("Resume later.");
  expect(resumed).not.toContain("Native checkpoint [C1]");
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(f.memory().work.status?.planningStall).toBeUndefined();
});

test("Pi planning reports a stall when no span fits the observer input cap", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { workerInputTokens: 1700 } },
  });
  await f.session.prompt("Work the observer cannot plan.");
  await f.memory().work.idle();
  expect(observer.calls).toEqual([]);
  expect(f.memory().work.status?.planningStall).toBeLessThanOrEqual(0);
  expect(await statusLines(f)).toContain(
    "Observer planning: stalled; after the instructions, the previous note at its reserve, and its references, the observer input cap leaves 0 estimated tokens for sources, which no source span fits, even without a native checkpoint. Raise limits.workerInputTokens, lower limits.workNoteTokens, or select an observer model with a larger context window.",
  );
});

function citingAll(body: string, call: { prompt: string }) {
  const labels = [...call.prompt.matchAll(/^\[([SP]\d+)\] /gmu)].map((match) => match[1] ?? "");
  return observerReply({
    observations: [],
    workNote: { status: "updated", body, sources: labels },
  });
}

test("Pi a backlog planned before a note grew drains without another turn and skips oversize jobs", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { workerInputTokens: 3000, queuedJobs: 4 } },
  });
  await f.command("off");
  for (let step = 1; step <= 60; step++) {
    // oxlint-disable-next-line no-await-in-loop -- Each prompt appends one turn in order.
    await f.session.prompt(`Step ${String(step)}: record the build output.`);
  }
  await f.command("on");
  const first = await observer.next();
  const note = `Backlog note: ${"n".repeat(3800)}`;
  first.reply(citingAll(note, first.call));
  const replanned = await observer.next();
  expect(lastOutcome(f)).toEqual({ kind: "stale", reason: "oversize" });
  expect(await statusLines(f)).toContainEqual(
    expect.stringContaining(
      "last outcome: skipped because its request no longer fits the observer input cap; its sources will be planned again",
    ),
  );
  observer.respond((call) => noteReply(note, call));
  replanned.reply(noteReply(note, replanned.call));
  await f.memory().work.idle();
  const lines = await statusLines(f);
  expect(lines).toContain("Processing coverage: no gaps");
  expect(lines.some((line) => line.startsWith("Observer planning:"))).toBe(false);
});
