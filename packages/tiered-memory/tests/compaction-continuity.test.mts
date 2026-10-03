import type { Message } from "@earendil-works/pi-ai";
import { expect } from "vitest";

import { presentationsIn } from "../src/pi/presentation-log.ts";
import type { JobOutcome } from "../src/pi/worker.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import { fixtureMessage } from "./pi-fixture.mts";
import type { ActingRequest, Fixture, FixtureOptions } from "./pi-fixture.mts";
import { sourceEntry, test } from "./store-fixture.mts";
import { noteReply, observerReply, ScriptedObserver, workerFixture } from "./worker-fixture.mts";

const malformed = fixtureMessage("not json");
const unchanged = observerReply({ observations: [], workNote: { status: "unchanged" } });

async function observing(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  options: FixtureOptions = {},
): Promise<{ f: Fixture; observer: ScriptedObserver }> {
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer, {
    personal: { limits: { retries: 0 } },
    ...options,
  });
  return { f, observer };
}

function lastOutcome(f: Fixture): JobOutcome | undefined {
  return f.memory().work.status?.last;
}

function textOf(message: Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function payloadTexts(request: ActingRequest | undefined): string[] {
  return (request?.messages ?? []).map((message) => textOf(message));
}

function noteBlocks(request: ActingRequest | undefined): string[] {
  return payloadTexts(request).filter((text) =>
    text.startsWith("[Tiered memory: current-work note,"),
  );
}

function branchRecords(f: Fixture): PresentationEntry[] {
  return presentationsIn(f.session.sessionManager.getBranch()).records.map(({ entry }) => entry);
}

async function statusLines(f: Fixture): Promise<string[]> {
  await f.command("status");
  return f.report().split("\n");
}

// Presents the committed note in an acting request, then commits that turn's coverage with an
// unchanged note, so no source after the note's boundary stays unprocessed.
async function presentAndCover(f: Fixture, observer: ScriptedObserver): Promise<void> {
  await f.session.prompt("Present the note.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
  (await observer.next()).reply(unchanged);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "committed" });
}

// Appends a native compaction that keeps `keptId` and everything after it.
function compactBefore(f: Fixture, keptId: string): string {
  return f.session.sessionManager.appendCompaction("Summary of earlier work.", keptId, 100);
}

// Keeps the turn that presented the note, so its presentation stays in acting context.
function compactBeforePresentation(f: Fixture): string {
  return compactBefore(f, sourceEntry(f, "Present the note.").id);
}

test("Pi a compaction that discards a failed interval before the note's boundary hides the note with a fallback correction", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("First goal.");
  (await observer.next()).reply(malformed);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "exhausted" });
  await f.session.prompt("Second goal.");
  const second = await observer.next();
  expect(second.call.prompt).not.toContain("First goal.");
  second.reply(noteReply("Second goal in progress.", second.call));
  await f.memory().work.idle();
  await presentAndCover(f, observer);
  const compaction = compactBeforePresentation(f);
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(
    payloadTexts(f.requests.at(-1)).some((text) => text.includes("Second goal in progress.")),
  ).toBe(false);
  expect(branchRecords(f).at(-1)).toMatchObject({
    kind: "correction",
    component: "work-note",
    cause: { kind: "fallback", compactionEntryId: compaction },
  });
});

test("Pi a compaction that discards a split entry with an unprocessed range hides the note", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture, {
    personal: { limits: { workerInputTokens: 3000, retries: 0 } },
  });
  const long = `Long evidence: ${"x".repeat(12000)}`;
  await f.session.prompt(long);
  const first = await observer.next();
  expect(first.call.prompt).toMatch(/; characters 0-\d+ of \d+/u);
  observer.respond(() => malformed);
  first.reply(noteReply("First range observed.", first.call));
  await f.memory().work.idle();
  await f.session.prompt("Present the note.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
  await f.memory().work.idle();
  const branch = f.session.sessionManager.getBranch();
  const longIndex = branch.findIndex((entry) => entry.id === sourceEntry(f, long).id);
  const response = branch
    .slice(longIndex + 1)
    .find((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (response === undefined) {
    throw new Error("Missing the long prompt's response.");
  }
  compactBefore(f, response.id);
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(branchRecords(f).at(-1)).toMatchObject({
    kind: "correction",
    cause: { kind: "fallback" },
  });
});

test("Pi a compaction whose discarded sources are all processed keeps the note presented without a correction", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  await presentAndCover(f, observer);
  compactBeforePresentation(f);
  await f.session.prompt("After compaction.");
  const blocks = noteBlocks(f.requests.at(-1));
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toContain("Use the blue setting.");
  expect(branchRecords(f).some((entry) => entry.kind === "correction")).toBe(false);
});

test("Pi a compaction whose discarded sources cannot be projected withholds the note with an unverified-freshness correction and reports unknown freshness", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  await presentAndCover(f, observer);
  const malformedResult = {
    role: "toolResult" as const,
    toolCallId: "call-missing-name",
    toolName: "edit",
    isError: false,
    content: [{ type: "text" as const, text: "result" }],
    timestamp: Date.now(),
  };
  Reflect.deleteProperty(malformedResult, "toolName");
  f.session.sessionManager.appendMessage(malformedResult);
  const compaction = compactBeforePresentation(f);
  const before = branchRecords(f).length;
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(
    payloadTexts(f.requests.at(-1)).some((text) => text.includes("Use the blue setting.")),
  ).toBe(false);
  expect(branchRecords(f).slice(before)).toMatchObject([
    { kind: "correction", component: "work-note", cause: { kind: "unverified" } },
  ]);
  expect(
    payloadTexts(f.requests.at(-1)).some((text) =>
      text.includes("are no longer current because its freshness could not be verified"),
    ),
  ).toBe(true);
  expect(await statusLines(f)).toContain(
    `Current-work note freshness: unknown because the sources native compaction entry ${compaction} discarded could not be checked against processing coverage: Invalid tool result source metadata; the note is not presented as current until processing coverage can be checked; an inspection of its file does not clear this.`,
  );
});

test("Pi after native compaction discards a failed interval, the next observer request still receives the previous note beside the native checkpoint", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Remember the blue setting; never touch prod.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting. Constraint: never touch prod.", first.call));
  await f.memory().work.idle();
  await f.session.prompt("Present the note and do more work.");
  (await observer.next()).reply(malformed);
  await f.memory().work.idle();
  expect(lastOutcome(f)).toMatchObject({ kind: "exhausted" });
  const compaction = compactBefore(f, f.session.sessionManager.getLeafId() ?? "");
  await f.session.prompt("After compaction.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(branchRecords(f).at(-1)).toMatchObject({
    kind: "correction",
    cause: { kind: "fallback", compactionEntryId: compaction },
  });
  const next = await observer.next();
  expect(next.call.prompt).toContain(
    "Previous current-work note (continuity state, not evidence):\nUse the blue setting. Constraint: never touch prod.",
  );
  expect(next.call.prompt).toContain(`Native checkpoint [C1], entry ${compaction}:`);
  next.reply(unchanged);
  await f.memory().work.idle();
});

test("Pi a compaction that discards only an image-only message after fully processed text keeps the note current", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  await presentAndCover(f, observer);
  const manager = f.session.sessionManager;
  manager.appendMessage({
    role: "user",
    content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
    timestamp: Date.now(),
  });
  const kept = manager.appendMessage(fixtureMessage("Kept answer."));
  compactBefore(f, kept);
  observer.respond(() => unchanged);
  await f.session.prompt("After compaction.");
  const blocks = noteBlocks(f.requests.at(-1));
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toContain("Use the blue setting.");
  expect(branchRecords(f).some((entry) => entry.kind === "correction")).toBe(false);
  expect((await statusLines(f)).some((line) => line.includes("freshness: verified"))).toBe(true);
  await f.memory().work.idle();
});

test("Pi a native compaction made while memory is disabled keeps the older note from returning as current after re-enabling", async ({
  createFixture,
}) => {
  const { f, observer } = await observing(createFixture);
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  await presentAndCover(f, observer);
  await f.command("off");
  await f.session.prompt("Switch to the red setting while memory is off.");
  const compaction = compactBefore(f, f.session.sessionManager.getLeafId() ?? "");
  observer.respond(() => unchanged);
  await f.command("on");
  await f.session.prompt("After re-enabling.");
  expect(noteBlocks(f.requests.at(-1))).toHaveLength(0);
  expect(
    payloadTexts(f.requests.at(-1)).some((text) => text.includes("Use the blue setting.")),
  ).toBe(false);
  expect(await statusLines(f)).toContain(
    `Current-work note freshness: not current because native compaction entry ${compaction} replaced it.`,
  );
  await f.memory().work.idle();
});
