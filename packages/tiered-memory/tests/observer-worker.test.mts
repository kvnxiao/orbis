import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { expect } from "vitest";

import { encodeReference } from "../src/domain/references.ts";
import type { JobOutcome } from "../src/pi/worker.ts";
import type { Revision } from "../src/storage/revisions.ts";
import { fixtureMessage } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions, ObserverCall } from "./pi-fixture.mts";
import { noteContent, sourceEntry, sourceReference, storeFor, test } from "./store-fixture.mts";
import {
  advance,
  controlledClock,
  noteReply,
  observerReply,
  ScriptedObserver,
  spanLabels,
  workerFixture,
} from "./worker-fixture.mts";

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

async function headRevision(f: Fixture): Promise<Revision | undefined> {
  const store = await storeFor(f);
  const head = await store.currentHead();
  return head === null ? undefined : await store.readRevision(head);
}

async function viewPath(f: Fixture, name: string): Promise<string> {
  return join((await storeFor(f)).sessionDir, "current", name);
}

async function reportLines(f: Fixture): Promise<string[]> {
  await f.command("status");
  return f.report().split("\n");
}

function userEntryId(f: Fixture, text: string): string {
  return sourceEntry(f, text).id;
}

// Commits one observer job for `text` with an updated note `body` citing every assigned span.
async function commitTurn(
  f: Fixture,
  observer: ScriptedObserver,
  text: string,
  body: string,
): Promise<ObserverCall> {
  await f.session.prompt(text);
  const pending = await observer.next();
  pending.reply(noteReply(body, pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  return pending.call;
}

test("Pi session_start schedules eligible completed turns without an acting-agent tool call", async ({
  createFixture,
}) => {
  const earlier = await createFixture({ personal: { enabled: false } });
  await earlier.session.prompt("Earlier work happened while memory was off.");
  const sessionFile = earlier.session.sessionManager.getSessionFile();
  const { f, observer } = await observing(createFixture, {
    cwd: earlier.cwd,
    personal: { enabled: true },
    ...(sessionFile === undefined ? {} : { sessionFile }),
  });
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("Earlier work happened while memory was off.");
  expect(f.session.messages.some((message) => message.role === "toolResult")).toBe(false);
  pending.reply(noteReply("Earlier work.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi completed turns schedule the next interval after the previous one commits", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Start the parser fix.", "Parser fix in progress.");
  await f.session.prompt("Now add tests.");
  const next = await observer.next();
  expect(next.call.prompt).toContain("Now add tests.");
  expect(next.call.prompt).not.toContain("Start the parser fix.");
  expect(next.call.prompt).toContain("Parser fix in progress.");
  next.reply(noteReply("Parser fix and tests in progress.", next.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi one observer commit records observations, the note, and interval coverage together", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Use port 8080 for the dev server.");
  const pending = await observer.next();
  pending.reply(
    observerReply({
      observations: [{ kind: "constraint", text: "Dev server port is 8080.", sources: ["S1"] }],
      workNote: { status: "updated", body: "Dev server on 8080.", sources: ["S1"] },
    }),
  );
  await f.memory().work.idle();
  const revision = await headRevision(f);
  const user = userEntryId(f, "Use port 8080 for the dev server.");
  expect(revision?.sourceIds).toHaveLength(2);
  expect(revision?.sourceIds[0]).toContain(user);
  expect(revision?.notes["current-work.md"]).toBe("Dev server on 8080.");
  expect(revision?.noteDependencies["current-work.md"]?.sourceIds).toEqual([
    revision?.sourceIds[0],
  ]);
  const entry = sourceEntry(f, "Use port 8080 for the dev server.");
  const recordedAt =
    entry.type === "message" ? new Date(entry.message.timestamp).toISOString() : undefined;
  expect(revision?.observations).toMatchObject([
    {
      kind: "constraint",
      text: "Dev server port is 8080.",
      ordinal: 0,
      citations: [{ kind: "source", reference: revision?.sourceIds[0], time: { recordedAt } }],
    },
  ]);
  expect(await reportLines(f)).toContain("Processing coverage: no gaps");
});

test("Pi an empty extraction commits coverage and keeps the original text registered", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Error: ENOENT reading config.yaml.");
  const pending = await observer.next();
  pending.reply(observerReply({ observations: [], workNote: { status: "empty" } }));
  await f.memory().work.idle();
  const revision = await headRevision(f);
  expect(revision?.observations).toEqual([]);
  expect(revision?.sourceIds).toHaveLength(2);
  expect(revision?.notes["current-work.md"]).toBe("");
  const registry = await readFile(join((await storeFor(f)).sessionDir, "sources.json"), "utf8");
  expect(registry).toContain(userEntryId(f, "Error: ENOENT reading config.yaml."));
  expect(await reportLines(f)).toContain("Processing coverage: no gaps");
});

test("Pi a retry of an already committed interval adds no duplicate observations", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Run the build.");
  const pending = await observer.next();
  pending.reply(
    observerReply({
      observations: [{ kind: "attempt", text: "Ran the build.", sources: ["S1"] }],
      workNote: { status: "updated", body: "Build attempted.", sources: ["S1"] },
    }),
  );
  await f.memory().work.idle();
  const committed = await headRevision(f);
  await f.reload();
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(1);
  expect((await headRevision(f))?.id).toBe(committed?.id);
  expect(f.memory().work.status).toMatchObject({ queued: 0, last: undefined });
  expect(await reportLines(f)).toContain("Processing coverage: no gaps");
});

test("Pi two distinct attempts with identical error text keep their own references", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  observer.respond((call) =>
    observerReply({
      observations: [{ kind: "outcome", text: "npm test failed: EADDRINUSE.", sources: ["S1"] }],
      workNote: { status: "updated", body: "Tests failing.", sources: spanLabels(call) },
    }),
  );
  await f.session.prompt("npm test failed: EADDRINUSE.");
  await f.memory().work.idle();
  const first = await headRevision(f);
  await f.session.prompt("npm test failed: EADDRINUSE.");
  await f.memory().work.idle();
  const second = await headRevision(f);
  expect(first?.observations).toHaveLength(1);
  expect(second?.observations).toHaveLength(1);
  const firstObservation = first?.observations[0];
  const secondObservation = second?.observations[0];
  expect(secondObservation?.text).toBe(firstObservation?.text);
  expect(secondObservation?.id).not.toBe(firstObservation?.id);
  expect(secondObservation?.citations).not.toEqual(firstObservation?.citations);
});

const truncated = fixtureMessage("", "length");

test.for([
  { label: "malformed", reply: () => fixtureMessage("not json") },
  { label: "truncated", reply: () => truncated },
  { label: "oversized", reply: () => fixtureMessage(`{"observations":[${" ".repeat(9000)}]}`) },
] as const)("Pi $label output advances no coverage", async ({ reply }, { createFixture }) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { retries: 0 } },
  });
  observer.respond(() => reply());
  await f.session.prompt("Failing extraction.");
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "exhausted" });
  expect(await headRevision(f)).toBeUndefined();
  expect(await reportLines(f)).toContain("Processing coverage: 2 gaps (2 failed)");
});

test("Pi timed-out output advances no coverage", async ({ createFixture }) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { retries: 0, jobTimeoutMs: 1000 } },
  });
  await f.session.prompt("Slow extraction.");
  const pending = await observer.next();
  await advance(clock, 1000);
  await f.memory().work.idle();
  pending.reply(noteReply("Too late.", pending.call));
  expect(lastOutcome(f)).toMatchObject({ kind: "exhausted" });
  expect(await headRevision(f)).toBeUndefined();
});

test("Pi cancelled output advances no coverage", async ({ createFixture }) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Cancelled extraction.");
  const pending = await observer.next();
  await f.command("off");
  await f.memory().work.idle();
  pending.reply(noteReply("Cancelled.", pending.call));
  expect(lastOutcome(f)).toMatchObject({ kind: "cancelled" });
  expect(await headRevision(f)).toBeUndefined();
  expect(await reportLines(f)).toContain("Processing coverage: 2 gaps (2 unprocessed)");
});

function recallResult(text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "recall-1",
    toolName: "recall",
    isError: false,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

test("Pi generated presentation, status reports, and recalled excerpts are never assigned", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.command("status");
  const manager = f.session.sessionManager;
  manager.appendCustomMessageEntry("orbis-tiered-memory-presentation", "Presented note.", false);
  manager.appendMessage(recallResult("Recalled: old port 3000."));
  await f.session.prompt("Continue the work.");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("Continue the work.");
  expect(pending.call.prompt).not.toContain("Presented note.");
  expect(pending.call.prompt).not.toContain("Recalled: old port 3000.");
  expect(pending.call.prompt).not.toContain("Tiered memory: enabled");
  pending.reply(noteReply("Continuing.", pending.call));
  await f.memory().work.idle();
});

test("Pi a new user correction about recalled material is assigned as evidence", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  f.session.sessionManager.appendMessage(recallResult("Recalled: deploy uses port 3000."));
  await f.session.prompt("That recalled port is wrong; deploy uses 8080.");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("That recalled port is wrong; deploy uses 8080.");
  expect(pending.call.prompt).not.toContain("Recalled: deploy uses port 3000.");
  pending.reply(
    observerReply({
      observations: [{ kind: "correction", text: "Deploy uses 8080.", sources: ["S1"] }],
      workNote: { status: "updated", body: "Deploy on 8080.", sources: ["S1"] },
    }),
  );
  await f.memory().work.idle();
  expect((await headRevision(f))?.observations).toMatchObject([{ kind: "correction" }]);
});

test("Pi a context edit during a pending observer rejects its proposal with evidence", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Use port 3000.");
  const pending = await observer.next();
  f.session.sessionManager.appendContextEdit(userEntryId(f, "Use port 3000."), {
    content: "Use port 8080.",
  });
  pending.reply(noteReply("Port 3000.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "evidence" });
  expect(await headRevision(f)).toBeUndefined();
  await f.session.prompt("Continue.");
  const fresh = await observer.next();
  expect(fresh.call.prompt).toContain("Use port 8080.");
  expect(fresh.call.prompt).not.toContain("Use port 3000.");
  fresh.reply(noteReply("Port 8080.", fresh.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi edited or omitted raw text stays historical evidence and restores no instruction", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.command("off");
  await f.session.prompt("Use port 3000.");
  await f.session.prompt("Delete the cache.");
  const manager = f.session.sessionManager;
  manager.appendContextEdit(userEntryId(f, "Use port 3000."), { content: "Use port 8080." });
  manager.appendContextEdit(userEntryId(f, "Delete the cache."), null);
  await f.command("on");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("Use port 8080.");
  expect(pending.call.prompt).not.toContain("Use port 3000.");
  expect(pending.call.prompt).not.toContain("Delete the cache.");
  pending.reply(noteReply("Port 8080.", pending.call));
  await f.memory().work.idle();
  const raw = manager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "message" && entry.message.role === "user" ? [entry.message.content] : [],
    );
  expect(JSON.stringify(raw)).toContain("Use port 3000.");
  expect(JSON.stringify(raw)).toContain("Delete the cache.");
});

test("Pi navigation before an edit plans later intervals from the earlier effective context", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.command("off");
  await f.session.prompt("Use port 3000.");
  const beforeEdit = f.session.sessionManager.getLeafId();
  f.session.sessionManager.appendContextEdit(userEntryId(f, "Use port 3000."), {
    content: "Use port 8080.",
  });
  await f.session.navigateTree(beforeEdit ?? "");
  await f.command("on");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("Use port 3000.");
  expect(pending.call.prompt).not.toContain("Use port 8080.");
  pending.reply(noteReply("Port 3000.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
});

test("Pi a session switch rejects the old observer completion", async ({ createFixture }) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Old session work.");
  const pending = await observer.next();
  const work = f.memory().work;
  await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
  await work.idle();
  expect(pending.call.options.signal?.aborted).toBe(true);
  pending.reply(noteReply("Old session note.", pending.call));
  await work.idle();
  expect(await headRevision(f)).toBeUndefined();
  expect(work.status).toBeUndefined();
});

test("Pi a correction invalidating a verified test procedure reaches the observation and note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Verified: npm test passes.", "Verified with npm test.");
  await f.session.prompt("Correction: npm test skips integration tests; use npm run test:all.");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("Verified with npm test.");
  expect(pending.call.systemPrompt).toContain('"correction"');
  pending.reply(
    observerReply({
      observations: [
        { kind: "correction", text: "npm test skips integration tests.", sources: ["S1"] },
      ],
      workNote: {
        status: "updated",
        body: "Verification incomplete: run npm run test:all.",
        sources: ["S1"],
      },
    }),
  );
  await f.memory().work.idle();
  const revision = await headRevision(f);
  expect(revision?.observations).toMatchObject([{ kind: "correction" }]);
  expect(revision?.notes["current-work.md"]).toBe("Verification incomplete: run npm run test:all.");
});

test("Pi one observer response supplies observations and the note for a changed goal, active constraint, paused work, and unverified completion claim", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt(
    "Switch goals to the CLI; keep Node 22 support; pause the docs; I think the parser is done.",
  );
  const pending = await observer.next();
  expect(observer.calls).toHaveLength(1);
  for (const kind of ["request", "constraint", "completion-claim", "correction"]) {
    expect(pending.call.systemPrompt).toContain(`"${kind}"`);
  }
  pending.reply(
    observerReply({
      observations: [
        { kind: "request", text: "Goal changed to the CLI.", sources: ["S1"] },
        { kind: "constraint", text: "Keep Node 22 support.", sources: ["S1"] },
        { kind: "decision", text: "Docs are paused.", sources: ["S1"] },
        { kind: "completion-claim", text: "User believes the parser is done.", sources: ["S1"] },
      ],
      workNote: {
        status: "updated",
        body: "Goal: CLI. Constraint: Node 22. Paused: docs. Parser done (unverified).",
        sources: ["S1"],
      },
    }),
  );
  await f.memory().work.idle();
  const revision = await headRevision(f);
  expect(revision?.observations.map((observation) => observation.kind)).toEqual([
    "request",
    "constraint",
    "decision",
    "completion-claim",
  ]);
  expect(revision?.notes["current-work.md"]).toContain("Parser done (unverified).");
  expect(revision?.sourceIds).toHaveLength(2);
});

test("Pi an updated note commits as current-work.md with retained and new references", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const retained = (await headRevision(f))?.noteDependencies["current-work.md"]?.sourceIds ?? [];
  await f.session.prompt("Also update the docs.");
  const pending = await observer.next();
  expect(pending.call.prompt).toMatch(
    /\[P1\] user entry \w+, order \d+; recorded \S+\n\[P2\] assistant entry \w+, order \d+/u,
  );
  pending.reply(
    observerReply({
      observations: [],
      workNote: { status: "updated", body: "Fix the parser; update docs.", sources: ["P1", "S1"] },
    }),
  );
  await f.memory().work.idle();
  const revision = await headRevision(f);
  const dependency = revision?.noteDependencies["current-work.md"];
  expect(revision?.notes["current-work.md"]).toBe("Fix the parser; update docs.");
  expect(dependency?.sourceIds).toEqual([retained[0], revision?.sourceIds[0]]);
});

test("Pi an explicitly unchanged note carries the base note and dependency as coverage advances", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const base = await headRevision(f);
  await f.session.prompt("Keep going.");
  const pending = await observer.next();
  pending.reply(observerReply({ observations: [], workNote: { status: "unchanged" } }));
  await f.memory().work.idle();
  const revision = await headRevision(f);
  expect(revision?.id).not.toBe(base?.id);
  expect(revision?.notes["current-work.md"]).toBe("Fix the parser.");
  expect(revision?.noteDependencies["current-work.md"]).toEqual(
    base?.noteDependencies["current-work.md"],
  );
  expect(await reportLines(f)).toContain("Processing coverage: no gaps");
});

test("Pi an explicitly empty note commits the empty body, distinct from an absent note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Nothing to do.");
  const pending = await observer.next();
  pending.reply(observerReply({ observations: [], workNote: { status: "empty" } }));
  await f.memory().work.idle();
  const revision = await headRevision(f);
  expect(Object.hasOwn(revision?.notes ?? {}, "current-work.md")).toBe(true);
  expect(revision?.notes["current-work.md"]).toBe("");
  expect(await readFile(await viewPath(f, "current-work.md"), "utf8")).toBe("");
  expect(
    f.memory().runtime.memoryStorage(f.session.extensionRunner.createContext())?.canonical.workNote,
  ).toMatchObject({
    body: "",
  });
});

test("Pi invalid note output preserves the previous revision and leaves the batch unprocessed", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { retries: 0 } },
  });
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const previous = await headRevision(f);
  await f.session.prompt("More work.");
  const pending = await observer.next();
  pending.reply(
    observerReply({
      observations: [],
      workNote: { status: "updated", body: "x".repeat(1100 * 4), sources: ["S1"] },
    }),
  );
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({
    kind: "exhausted",
    failures: [{ kind: "rejected", rejection: { kind: "oversized-note" } }],
  });
  expect((await headRevision(f))?.id).toBe(previous?.id);
  expect(await reportLines(f)).toContain("Processing coverage: 2 gaps (2 failed)");
});

test("Pi checkpoint-derived claims keep the checkpoint citation and mark no unseen span processed", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { retries: 0 } },
  });
  observer.respond(() => fixtureMessage("not json"));
  await f.session.prompt("Unseen work before compaction.");
  await f.memory().work.idle();
  const kept = f.session.sessionManager.getLeafId();
  const compaction = f.session.sessionManager.appendCompaction(
    "Summary: the parser fix is paused.",
    kept,
    100,
  );
  const calls = observer.calls.length;
  observer.respond((call) => {
    expect(call.prompt).toContain("Native checkpoint [C1]");
    return observerReply({
      observations: [{ kind: "decision", text: "Parser fix paused.", sources: ["C1"] }],
      workNote: { status: "updated", body: "Paused: parser fix.", sources: ["C1", "S1"] },
    });
  });
  await f.session.prompt("Resume later.");
  await f.memory().work.idle();
  expect(observer.calls.length).toBe(calls + 1);
  const revision = await headRevision(f);
  expect(revision?.observations[0]?.citations).toEqual([
    { kind: "checkpoint", entryId: compaction },
  ]);
  expect(revision?.noteDependencies["current-work.md"]?.checkpointIds).toEqual([compaction]);
  const unseen = userEntryId(f, "Unseen work before compaction.");
  expect(revision?.sourceIds.some((reference) => reference.includes(unseen))).toBe(false);
  expect(await reportLines(f)).toContain("Processing coverage: 2 gaps (2 failed)");
});

test("Pi the committed note identifies its lineage, revision, and source boundary", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const revision = await headRevision(f);
  const ctx = f.session.extensionRunner.createContext();
  const canonical = f.memory().runtime.memoryStorage(ctx)?.canonical;
  const assistant = revision?.sourceIds[1] ?? "";
  const order = f.session.sessionManager
    .getBranch()
    .findIndex((entry) => assistant.includes(`:${entry.id}:`));
  expect(canonical).toMatchObject({
    revision: { sessionId: f.session.sessionManager.getSessionId(), revisionId: revision?.id },
    sourceBoundary: { reference: assistant, order },
    workNote: { body: "Fix the parser." },
  });
  expect(await reportLines(f)).toContain(
    `Current-work note: revision ${revision?.id ?? ""}; source boundary ${assistant} (branch entry ${String(order)}); 0 eligible sources not yet observed`,
  );
});

test("Pi a note edited during extraction survives and rejects the stale observer proposal", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  await f.session.prompt("Update the docs.");
  const pending = await observer.next();
  const view = await viewPath(f, "current-work.md");
  await writeFile(view, "My own note.\n");
  pending.reply(noteReply("Fix the parser; update docs.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "curation" });
  expect(await readFile(view, "utf8")).toBe("My own note.\n");
  await f.session.prompt("Continue.");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Previous current-work note: none.");
  later.reply(
    observerReply({
      observations: [{ kind: "request", text: "Continue.", sources: ["S1"] }],
      workNote: { status: "updated", body: "Generated replacement.", sources: ["S1"] },
    }),
  );
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(await readFile(view, "utf8")).toBe("My own note.\n");
  expect((await headRevision(f))?.observations).toMatchObject([{ text: "Continue." }]);
});

test("Pi a note deleted during extraction stays excluded and rejects the stale proposal", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  await f.session.prompt("Update the docs.");
  const pending = await observer.next();
  const view = await viewPath(f, "current-work.md");
  await rm(view);
  pending.reply(noteReply("Fix the parser; update docs.", pending.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toEqual({ kind: "conflict", reason: "curation" });
  await expect(readFile(view, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await f.session.prompt("Start the release.");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Previous current-work note: none.");
  later.reply(noteReply("Release in progress.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(await readFile(view, "utf8")).toBe("Release in progress.");
});

test("Pi deleting an edited note after an observation-only commit records the deletion, and only new evidence creates a new note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const view = await viewPath(f, "current-work.md");
  await writeFile(view, "My own note.\n");
  await f.reload();
  await f.session.prompt("Update the docs.");
  const excluded = await observer.next();
  excluded.reply(noteReply("Generated replacement.", excluded.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect((await headRevision(f))?.notes).not.toHaveProperty("current-work.md");
  expect(await readFile(view, "utf8")).toBe("My own note.\n");
  await rm(view);
  await f.reload();
  expect(await reportLines(f)).toContain(
    "Current-work note: none; current-work.md was deleted outside tiered memory; only evidence the deleted note did not consume can create a new note.",
  );
  const ctx = f.session.extensionRunner.createContext();
  const { runtime } = f.memory();
  const recreated = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Recreated from old evidence.\n" }),
    [await sourceReference(f, "Fix the parser.")],
  );
  expect(await runtime.commitProposal(ctx, recreated)).toMatchObject({
    kind: "conflict",
    reason: "curation",
  });
  await expect(readFile(view, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await f.session.prompt("Start the release.");
  const later = await observer.next();
  expect(later.call.prompt).toContain("Previous current-work note: none.");
  later.reply(noteReply("Release in progress.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(await readFile(view, "utf8")).toBe("Release in progress.");
  const cited = (await headRevision(f))?.noteDependencies["current-work.md"]?.sourceIds ?? [];
  const release = userEntryId(f, "Start the release.");
  expect(cited.length).toBeGreaterThan(0);
  expect(cited.some((reference) => reference.includes(release))).toBe(true);
  for (const earlier of ["Fix the parser.", "Update the docs."]) {
    const entryId = userEntryId(f, earlier);
    expect(cited.some((reference) => reference.includes(entryId))).toBe(false);
  }
  const branch = f.session.sessionManager.getBranch();
  const releaseIndex = branch.findIndex((entry) => entry.id === release);
  const newer = new Set(branch.slice(releaseIndex).map((entry) => entry.id));
  expect(cited.every((reference) => [...newer].some((id) => reference.includes(id)))).toBe(true);
});

test("Pi deleting an edited note after an observation-only commit without a reload lets new evidence commit a new note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await commitTurn(f, observer, "Fix the parser.", "Fix the parser.");
  const view = await viewPath(f, "current-work.md");
  await writeFile(view, "My own note.\n");
  await f.session.prompt("Update the docs.");
  await f.memory().runtime.freshness.settled();
  const excluded = await observer.next();
  excluded.reply(noteReply("Generated replacement.", excluded.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect((await headRevision(f))?.notes).not.toHaveProperty("current-work.md");
  await rm(view);
  await f.session.prompt("Start the release.");
  await f.memory().runtime.freshness.settled();
  const later = await observer.next();
  expect(later.call.prompt).toContain("Previous current-work note: none.");
  later.reply(noteReply("Release in progress.", later.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  expect(await readFile(view, "utf8")).toBe("Release in progress.");
  const cited = (await headRevision(f))?.noteDependencies["current-work.md"]?.sourceIds ?? [];
  const release = userEntryId(f, "Start the release.");
  expect(cited.some((reference) => reference.includes(release))).toBe(true);
  for (const earlier of ["Fix the parser.", "Update the docs."]) {
    const entryId = userEntryId(f, earlier);
    expect(cited.some((reference) => reference.includes(entryId))).toBe(false);
  }
});

test("Pi an updated note's committed dependency keeps the previous note's references that its request could not label", async ({
  createFixture,
}) => {
  const script: { answer?: (call: ObserverCall) => AssistantMessage | undefined } = {};
  const observer = new ScriptedObserver();
  observer.respond(
    (call) => script.answer?.(call) ?? fixtureMessage("", "error", "No observation yet."),
  );
  const f = await workerFixture(createFixture, observer, {
    personal: { limits: { retries: 0 } },
  });
  const steps = Array.from({ length: 33 }, (_, index) => `Step ${String(index)}.`);
  for (const step of steps) {
    // oxlint-disable-next-line no-await-in-loop -- Each prompt must finish before the next one starts.
    await f.session.prompt(step);
  }
  await f.reload();
  await f.memory().work.idle();
  const ctx = f.session.extensionRunner.createContext();
  const { runtime } = f.memory();
  const store = runtime.memoryStorage(ctx)?.session.store;
  if (store === undefined) {
    throw new Error("Missing open storage.");
  }
  const references = f.session.sessionManager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant")
        ? [encodeReference({ ...scopeOf(store), entryId: entry.id, span: 0 })]
        : [],
    );
  expect(references).toHaveLength(66);
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Every step so far." }),
    references,
  );
  expect(await runtime.commitProposal(ctx, proposal)).toMatchObject({ kind: "committed" });
  script.answer = (call) =>
    call.prompt.includes("Final step.") ? noteReply("Final step next.", call) : undefined;
  await f.session.prompt("Final step.");
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  const cited = (await headRevision(f))?.noteDependencies["current-work.md"]?.sourceIds ?? [];
  expect(cited).toEqual(expect.arrayContaining(references.slice(0, 2)));
  expect(cited.some((reference) => reference.includes(userEntryId(f, "Final step.")))).toBe(true);
  expect(cited.some((reference) => reference === references[2])).toBe(false);
});

function scopeOf(store: { projectId: string; sessionId: string }) {
  return { projectId: store.projectId, sessionId: store.sessionId };
}

function observed(call: ObserverCall): ReturnType<typeof observerReply> {
  return observerReply({
    observations: [{ kind: "constraint", text: "Port setting.", sources: ["S1"] }],
    workNote: { status: "updated", body: "Port setting.", sources: spanLabels(call) },
  });
}

test("Pi an edited processed entry becomes a changed gap and is re-observed with new identities", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Use port 3000.");
  const first = await observer.next();
  first.reply(observed(first.call));
  await f.memory().work.idle();
  const before = (await headRevision(f))?.observations[0]?.id;
  f.session.sessionManager.appendContextEdit(userEntryId(f, "Use port 3000."), {
    content: "Use port 8080.",
  });
  await f.command("on");
  const again = await observer.next();
  expect(again.call.prompt).toContain("Use port 8080.");
  expect(again.call.prompt).not.toContain("Use port 3000.");
  expect(await reportLines(f)).toContain(
    "Processing coverage: 2 gaps (2 changed since processing)",
  );
  again.reply(observed(again.call));
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
  const after = (await headRevision(f))?.observations[0]?.id;
  expect(after).toBeDefined();
  expect(after).not.toBe(before);
  expect(await reportLines(f)).toContain("Processing coverage: no gaps");
});

test("Pi worker status accumulates provider-reported observer usage and counts unreported attempts", async ({
  createFixture,
}) => {
  const clock = await controlledClock();
  const { f, observer } = await observing(createFixture, {
    services: { clock },
    personal: { limits: { jobTimeoutMs: 1000, retries: 1 } },
  });
  await f.session.prompt("Usage goal.");
  await observer.next();
  await advance(clock, 500);
  const retried = await observer.next();
  const reply = noteReply("Usage.", retried.call);
  reply.usage = {
    input: 120,
    output: 30,
    cacheRead: 10,
    cacheWrite: 5,
    totalTokens: 165,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  };
  retried.reply(reply);
  await f.memory().work.idle();
  expect(f.memory().work.status?.usage).toEqual({
    attempts: 2,
    reported: 1,
    input: 120,
    output: 30,
    cacheRead: 10,
    cacheWrite: 5,
    cost: 0.3,
  });
  expect(await reportLines(f)).toContain(
    "Observer usage (provider-reported): 1 of 2 attempts reported usage; input 120 tokens, output 30 tokens, cache read 10 tokens, cache write 5 tokens, cost 0.3",
  );
});
