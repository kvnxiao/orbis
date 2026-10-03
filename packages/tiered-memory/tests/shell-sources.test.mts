import type {
  ContextEditEntry,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";

import { evidenceMatches, sourceFingerprint } from "../src/domain/evidence.ts";
import { planIntervals, renderSpanBlock } from "../src/domain/intervals.ts";
import { encodeReference } from "../src/domain/references.ts";
import { projectSources } from "../src/storage/source-projection.ts";
import type { Fixture } from "./pi-fixture.mts";
import { openRegistry, openStore, storeFor, test } from "./store-fixture.mts";
import { noteReply, ScriptedObserver, workerFixture } from "./worker-fixture.mts";

const scope = { projectId: "a".repeat(64), sessionId: "session-1" };

type BashExecution = Extract<SessionMessageEntry["message"], { role: "bashExecution" }>;
const recordedAt = "2026-03-01T09:30:00.000Z";

type Draft =
  | Omit<SessionMessageEntry, "parentId" | "timestamp">
  | Omit<ContextEditEntry, "parentId" | "timestamp">;

function chain(drafts: readonly Draft[]): SessionEntry[] {
  return drafts.map((draft, index) => {
    const parentId = index === 0 ? null : (drafts[index - 1]?.id ?? null);
    return { ...draft, parentId, timestamp: recordedAt };
  });
}

function shell(
  id: string,
  fields: Partial<Omit<BashExecution, "role" | "timestamp">>,
): Omit<SessionMessageEntry, "parentId" | "timestamp"> {
  const message: BashExecution = {
    role: "bashExecution",
    command: "ls",
    output: "",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: Date.parse(recordedAt),
    ...fields,
  };
  return { type: "message", id, message };
}

function user(id: string, text: string): Omit<SessionMessageEntry, "parentId" | "timestamp"> {
  return {
    type: "message",
    id,
    message: { role: "user", content: [{ type: "text", text }], timestamp: Date.parse(recordedAt) },
  };
}

function omission(id: string, targetId: string): Omit<ContextEditEntry, "parentId" | "timestamp"> {
  return { type: "context_edit", id, targetId, replacement: null };
}

const shellBranch = chain([
  user("u1", "Run the checks."),
  shell("b1", { command: "ls", output: "a.txt\nb.txt" }),
  shell("b2", { command: "sleep 9", exitCode: undefined, cancelled: true }),
  shell("b3", { command: "cat secret", output: "hidden", excludeFromContext: true }),
  shell("b4", {
    command: "make test",
    output: "partial",
    exitCode: 2,
    truncated: true,
    fullOutputPath: "/tmp/full.log",
  }),
  shell("b5", { command: "rm -rf build", output: "removed" }),
  omission("edit", "b5"),
]);

test("projectSources attributes model-visible shell commands to the user with every recorded field and excludes a !! command", () => {
  const sources = projectSources(shellBranch, scope, []);
  expect(
    sources.map(({ entryId, role, effectiveText, omitted }) => ({
      entryId,
      role,
      effectiveText,
      omitted,
    })),
  ).toEqual([
    { entryId: "u1", role: "user", effectiveText: "Run the checks.", omitted: false },
    {
      entryId: "b1",
      role: "bashExecution",
      effectiveText:
        'User shell command: {"command":"ls","exitCode":0,"cancelled":false,"truncated":false}\nOutput:\na.txt\nb.txt',
      omitted: false,
    },
    {
      entryId: "b2",
      role: "bashExecution",
      effectiveText:
        'User shell command: {"command":"sleep 9","exitCode":null,"cancelled":true,"truncated":false}\nOutput: none',
      omitted: false,
    },
    {
      entryId: "b4",
      role: "bashExecution",
      effectiveText:
        'User shell command: {"command":"make test","exitCode":2,"cancelled":false,"truncated":true}\nOutput:\npartial\nFull output path (a reference; its contents were not read): /tmp/full.log',
      omitted: false,
    },
    { entryId: "b5", role: "bashExecution", effectiveText: "", omitted: true },
  ]);
});

test("projectSources rejects a shell record whose consumed fields are malformed", () => {
  const branch = chain([shell("b1", {})]);
  const [entry] = branch;
  if (entry?.type === "message") {
    Reflect.set(entry.message, "exitCode", "zero");
  }
  expect(() => projectSources(branch, scope, [])).toThrow("Invalid shell command source metadata.");
});

test("the observer prompt labels a shell command as the user's, distinct from a tool result", () => {
  const [, b1] = projectSources(shellBranch, scope, []);
  const [interval] = planIntervals(
    b1 === undefined ? [] : [b1],
    { entries: new Set(), ranges: new Map() },
    new Set(),
    {
      budgetTokens: 1000,
      maxIntervals: 1,
    },
  );
  const span = interval?.spans[0];
  expect(span === undefined ? "" : renderSpanBlock("S1", span)).toBe(
    `[S1] user shell command entry b1, order 1; recorded ${recordedAt}; event time unknown; timezone unknown\nUser shell command: {"command":"ls","exitCode":0,"cancelled":false,"truncated":false}\nOutput:\na.txt\nb.txt`,
  );
});

test("an oversized shell output splits into UTF-16 ranges that cover its whole text", () => {
  const output = `${"x".repeat(900)}😀${"y".repeat(900)}`;
  const [source] = projectSources(chain([shell("b1", { output })]), scope, []);
  const intervals = planIntervals(
    source === undefined ? [] : [source],
    { entries: new Set(), ranges: new Map() },
    new Set(),
    {
      budgetTokens: 200,
      maxIntervals: 50,
    },
  );
  const spans = intervals.flatMap((interval) => interval.spans);
  expect(spans.length).toBeGreaterThan(1);
  expect(spans.map((span) => span.text).join("")).toBe(source?.effectiveText);
  expect(spans[0]?.range?.start).toBe(0);
  expect(spans.at(-1)?.range?.end).toBe(source?.effectiveText.length);
  for (const span of spans) {
    expect(span.text.charCodeAt(0) >= 0xdc00 && span.text.charCodeAt(0) <= 0xdfff).toBe(false);
  }
});

test("a shell record's evidence fingerprint changes when a context edit omits it, so a proposal citing it no longer matches", async ({
  makeRoot,
}) => {
  const store = await openStore(await makeRoot());
  const registry = await openRegistry(store);
  const branch = chain([user("u1", "Run the checks."), shell("b1", { output: "a.txt" })]);
  const before = registry.registry.recordsOn(branch);
  const reference = encodeReference({
    projectId: store.projectId,
    sessionId: store.sessionId,
    entryId: "b1",
    span: 0,
  });
  const dependency = {
    sourceIds: [reference],
    evidenceFingerprint: sourceFingerprint(before, [reference]),
  };
  expect(evidenceMatches(before, dependency, store.projectId)).toBe(true);
  const omitted = chain([
    user("u1", "Run the checks."),
    shell("b1", { output: "a.txt" }),
    omission("edit", "b1"),
  ]);
  expect(evidenceMatches(registry.registry.recordsOn(omitted), dependency, store.projectId)).toBe(
    false,
  );
  const changedStatus = chain([
    user("u1", "Run the checks."),
    shell("b1", { output: "a.txt", exitCode: 1 }),
  ]);
  expect(
    evidenceMatches(registry.registry.recordsOn(changedStatus), dependency, store.projectId),
  ).toBe(false);
});

function shellEntryId(f: Fixture, command: string): string {
  const entry = f.session.sessionManager
    .getBranch()
    .find(
      (candidate) =>
        candidate.type === "message" &&
        candidate.message.role === "bashExecution" &&
        candidate.message.command === command,
    );
  if (entry === undefined) {
    throw new Error(`Missing shell record: ${command}`);
  }
  return entry.id;
}

test("Pi model-visible shell commands reach the observer as user shell evidence and the committed coverage, and a !! command does not", async ({
  createFixture,
}) => {
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer);
  f.session.recordBashResult("ls", {
    output: "a.txt\n",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });
  f.session.recordBashResult("sleep 9", {
    output: "",
    exitCode: undefined,
    cancelled: true,
    truncated: false,
  });
  f.session.recordBashResult(
    "cat secret",
    { output: "hidden", exitCode: 0, cancelled: false, truncated: false },
    { excludeFromContext: true },
  );
  await f.session.prompt("Summarize the commands.");
  const pending = await observer.next();
  expect(pending.call.prompt).toContain("user shell command entry");
  expect(pending.call.prompt).toContain(
    'User shell command: {"command":"ls","exitCode":0,"cancelled":false,"truncated":false}\nOutput:\na.txt\n',
  );
  expect(pending.call.prompt).toContain(
    'User shell command: {"command":"sleep 9","exitCode":null,"cancelled":true,"truncated":false}\nOutput: none',
  );
  expect(pending.call.prompt).not.toContain("cat secret");
  expect(pending.call.prompt).not.toContain("hidden");
  pending.reply(noteReply("Commands summarized.", pending.call));
  await f.memory().work.idle();
  const store = await storeFor(f);
  const head = await store.currentHead();
  const revision = head === null ? undefined : await store.readRevision(head);
  const visible = ["ls", "sleep 9"].map((command) => shellEntryId(f, command));
  for (const entryId of visible) {
    expect(revision?.sourceIds.some((reference) => reference.includes(`:${entryId}:`))).toBe(true);
    expect(
      revision?.noteDependencies["current-work.md"]?.sourceIds.some((reference) =>
        reference.includes(`:${entryId}:`),
      ),
    ).toBe(true);
  }
  const excluded = shellEntryId(f, "cat secret");
  expect(revision?.sourceIds.some((reference) => reference.includes(`:${excluded}:`))).toBe(false);
  expect(() => f.session.sessionManager.appendContextEdit(visible[0] ?? "", null)).toThrow(
    "does not contribute editable model content",
  );
});
