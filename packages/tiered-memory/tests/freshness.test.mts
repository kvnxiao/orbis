import { link, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BoundaryState, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import { confirmPresentations } from "../src/pi/presentation-log.ts";
import { presentationMessageType, readPresentationEntry } from "../src/presentation/entries.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import { curationSchema } from "../src/storage/curation.ts";
import type { CurationState } from "../src/storage/curation.ts";
import { readText, writeDurable } from "../src/storage/files.ts";
import { parseRecord } from "../src/storage/records.ts";
import type { ActingStep, Fixture, FixtureOptions } from "./pi-fixture.mts";
import {
  branchRecords,
  compactEverythingButTheLastTurn,
  contextOf,
  correctionBlocks,
  noteBlocks,
  notePath,
  presentedNote,
  statusLines,
  summaryRequests,
} from "./presentation-fixture.mts";
import type { TestServices } from "./storage-harness.mts";
import {
  committedId,
  forkOnDisk,
  noteContent,
  sourceEntry,
  sourceReference,
  storageOf,
  storeFor,
  test,
} from "./store-fixture.mts";
import { noteReply, observerReply, ScriptedObserver, workerFixture } from "./worker-fixture.mts";

async function durableCorrections(f: Fixture): Promise<PresentationEntry[]> {
  const corrections = f.session.sessionManager.getBranch().flatMap((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return [];
    }
    const read = readPresentationEntry(entry.details);
    return read.kind === "valid" && read.entry.kind === "correction"
      ? [{ id: entry.id, entry: read.entry }]
      : [];
  });
  const file = f.session.sessionManager.getSessionFile();
  const confirmed = await Effect.runPromise(
    confirmPresentations(
      file,
      corrections.map(({ id }) => id),
    ),
  );
  return corrections.filter(({ id }) => confirmed.has(id)).map(({ entry }) => entry);
}

function editDraft(f: Fixture, text: string, replacement: string) {
  return {
    type: "context_edit" as const,
    targetId: sourceEntry(f, text).id,
    replacement: { content: replacement },
  };
}

test.for(["turn_end", "agent_before_settle"] as const)(
  "Pi a context edit that a %s boundary draft makes to a note-cited source stops the note from the next request, with a durable evidence correction",
  async (hook, { createFixture }) => {
    let draft: (() => ReturnType<typeof editDraft>) | undefined;
    const append = (event: BoundaryState) => {
      const edit = draft?.();
      draft = undefined;
      return edit === undefined ? undefined : { entries: [...event.entries, edit] };
    };
    const { f } = await presentedNote(createFixture, {
      extensions: [
        (pi) => {
          if (hook === "turn_end") {
            pi.on("turn_end", append);
          } else {
            pi.on("agent_before_settle", append);
          }
        },
      ],
    });
    draft = () => editDraft(f, "Remember the blue setting.", "Remember the red setting.");
    await f.session.prompt("Third turn.");
    expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
    await f.session.prompt("Fourth turn.");
    const request = f.requests.at(-1);
    expect(noteBlocks(request)).toEqual([]);
    expect(correctionBlocks(request).join("\n")).toContain(
      "are no longer current because the evidence it relied on changed",
    );
    expect(await durableCorrections(f)).toMatchObject([
      { component: "work-note", cause: { kind: "evidence" } },
    ]);
  },
);

function probeTool(pi: ExtensionAPI, onExecute: () => Promise<void>): void {
  pi.registerTool({
    name: "probe_tool",
    label: "Probe tool",
    description: "Probe tool",
    parameters: Type.Object({}),
    async execute() {
      await onExecute();
      return { content: [{ type: "text", text: "tool ok" }], details: undefined };
    },
  });
}

const toolStep: ActingStep = { toolCalls: [{ name: "probe_tool", arguments: {} }] };

function branchLabels(f: Fixture): string[] {
  return f.session.sessionManager.getBranch().map((entry) => {
    if (entry.type === "custom_message") {
      const read = readPresentationEntry(entry.details);
      return read.kind === "valid" ? `presentation:${read.entry.kind}` : "presentation:damaged";
    }
    return entry.type === "message" ? entry.message.role : entry.type;
  });
}

test.for(["edited", "deleted"] as const)(
  "Pi a note file %s during a long tool loop is withheld from the first request after the inspection that observes it, with its correction after the tool result",
  async (change, { createFixture }) => {
    const script: ActingStep[] = [];
    let executions = 0;
    let path = "";
    const { f } = await presentedNote(createFixture, {
      acting: () => script.shift(),
      extensions: [
        (pi) => {
          probeTool(pi, async () => {
            executions++;
            if (executions !== 2) {
              return;
            }
            await (change === "deleted" ? rm(path) : writeFile(path, "My own note.\n"));
          });
        },
      ],
    });
    path = await notePath(f);
    script.push(toolStep, toolStep, toolStep, { text: "Loop done." });
    const before = f.requests.length;
    await f.session.prompt("Run the loop.");
    const loop = f.requests.slice(before);
    expect(loop.map((request) => noteBlocks(request).length)).toEqual([1, 1, 0, 0]);
    expect(correctionBlocks(loop[2]).join("\n")).toContain(
      change === "deleted"
        ? "because its file was deleted outside tiered memory"
        : "because its file was edited outside tiered memory",
    );
    const labels = branchLabels(f);
    const correction = labels.indexOf("presentation:correction");
    expect(labels.slice(correction - 2, correction + 2)).toEqual([
      "assistant",
      "toolResult",
      "presentation:correction",
      "assistant",
    ]);
    const event =
      change === "deleted"
        ? { kind: "deleted" }
        : { kind: "edited", digest: digest("My own note.\n") };
    expect(await durableCorrections(f)).toMatchObject([{ cause: { kind: "curation", event } }]);
  },
);

test("Pi a durable head whose views a failed commit left unwritten is not curation: an edit after it leaves freshness unknown with the unfinished write as the reason until a refresh records the edit", async ({
  createFixture,
}) => {
  let failViews = false;
  let held: { entered: () => void; released: Promise<undefined> } | undefined;
  const options: FixtureOptions = {
    services: {
      async write(path, contents) {
        if (failViews && path.endsWith("current-work.md")) {
          throw new Error("Injected view write failure.");
        }
        await writeDurable(path, contents);
      },
      lock: {
        async publish(source, ticket) {
          const gate = held;
          held = undefined;
          gate?.entered();
          await gate?.released;
          await link(source, ticket);
        },
      },
    },
  };
  const { f } = await presentedNote(createFixture, options);
  await f.reload();
  const path = await notePath(f);
  failViews = true;
  const { runtime } = f.memory();
  const ctx = contextOf(f);
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Use the green setting." }),
    [await sourceReference(f, "Continue the work.")],
  );
  await expect(runtime.commitProposal(ctx, proposal)).rejects.toThrow(
    "Injected view write failure.",
  );
  expect(await readFile(path, "utf8")).toBe("Use the blue setting.");
  const head = storageOf(runtime).latestRevision;
  await writeFile(path, "Edited after the failed write.\n");
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  held = {
    entered: () => {
      entered.resolve(undefined);
    },
    released: released.promise,
  };
  await f.session.prompt("After the partial commit.");
  await entered.promise;
  expect(noteBlocks(f.requests.at(-1))).toEqual([]);
  expect(correctionBlocks(f.requests.at(-1)).join("\n")).toContain(
    "are no longer current because its freshness could not be verified",
  );
  expect(await durableCorrections(f)).toMatchObject([{ cause: { kind: "unverified" } }]);
  const lines = await statusLines(f);
  expect(lines).toContain(
    `Current-work note freshness: unknown because memory storage has not finished writing revision ${head ?? ""}; the note is not presented as current until an inspection verifies it.`,
  );
  expect(lines.some((line) => line.startsWith("Current-work note curation:"))).toBe(false);
  expect(lines.some((line) => line.includes("outside tiered memory"))).toBe(false);
  released.resolve(undefined);
  await f.memory().runtime.freshness.settled();
  expect(await statusLines(f)).toContain(
    "Current-work note freshness: not current because its file was edited outside tiered memory.",
  );
});

test("Pi another process's commit to the same session is not curation and schedules a refresh", async ({
  createFixture,
}) => {
  const { f, revision } = await presentedNote(createFixture);
  const store = await storeFor(f);
  const foreign = committedId(
    await store.commit({
      sessionId: store.sessionId,
      projectId: store.projectId,
      anchorId: "foreign-anchor",
      sourceIds: ["foreign-source"],
      evidenceFingerprint: "e".repeat(64),
      dependencyFingerprint: "c".repeat(64),
      configurationRevision: 1,
      expectedRevision: revision,
      baseRevision: null,
      notes: { "current-work.md": "Written by another process." },
      noteDependencies: {},
      observations: [],
      consumedObservationIds: [],
      learnings: {},
      expectedLearnings: {},
      excludedInheritedNotes: [],
      curatedNotes: [],
    }),
  );
  expect(await readFile(await notePath(f), "utf8")).toBe("Written by another process.");
  await f.session.prompt("After the other process.");
  await f.memory().runtime.freshness.settled();
  const lines = await statusLines(f);
  expect(lines).toContain(`Latest durable revision: ${foreign}`);
  expect(lines.some((line) => line.includes("outside tiered memory"))).toBe(false);
  expect(branchRecords(f).some((entry) => entry.kind === "correction")).toBe(false);
  expect(noteBlocks(f.requests.at(-1)).join("\n")).toContain("Use the blue setting.");
});

async function curationRecord(f: Fixture): Promise<CurationState["notes"] | undefined> {
  const path = join((await storeFor(f)).sessionDir, "curation.json");
  const text = await Effect.runPromise(readText(path));
  return text === undefined ? undefined : parseRecord(curationSchema, text, path).notes;
}

test("Pi a detected edit whose bytes are restored before reconciliation still records the observed edit across reload", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const path = await notePath(f);
  await writeFile(path, "User edit.\n");
  await f.session.prompt("After the edit.");
  await f.memory().runtime.freshness.settled();
  await writeFile(path, "Use the blue setting.");
  await f.memory().runtime.refreshRoles(contextOf(f));
  await f.reload();
  expect(await curationRecord(f)).toMatchObject({
    "current-work.md": { kind: "edited", digest: digest("User edit.\n") },
  });
  await f.session.prompt("After the reload.");
  expect(noteBlocks(f.requests.at(-1))).toEqual([]);
  expect(await durableCorrections(f)).toMatchObject([
    { cause: { kind: "curation", event: { kind: "edited", digest: digest("User edit.\n") } } },
  ]);
});

test("Pi a detected edit whose recording failed is recorded from the durable correction when the next process starts, even with the bytes restored", async ({
  createFixture,
}) => {
  let blockCuration = true;
  const options: FixtureOptions = {
    services: {
      async write(path, contents) {
        if (blockCuration && path.endsWith("curation.json")) {
          throw new Error("Injected curation write failure.");
        }
        await writeDurable(path, contents);
      },
    },
  };
  const { f } = await presentedNote(createFixture, options);
  const path = await notePath(f);
  const ctx = contextOf(f);
  const blue = await sourceReference(f, "Remember the blue setting.");
  const stale = f
    .memory()
    .runtime.captureProposal(ctx, noteContent({ "current-work.md": "Captured earlier." }), [blue]);
  await writeFile(path, "User edit.\n");
  await f.session.prompt("After the edit.");
  await f.memory().runtime.freshness.settled();
  expect(await statusLines(f)).toContain(
    "Current-work note curation: the detected edit awaits recording; memory proposals are refused until it is recorded. Recording failed (Injected curation write failure.); the next inspection retries it.",
  );
  const { runtime } = f.memory();
  expect(() =>
    runtime.captureProposal(contextOf(f), noteContent({ "current-work.md": "New." }), [blue]),
  ).toThrow("A detected external change to the current-work note awaits recording.");
  expect(await curationRecord(f)).toBeUndefined();
  await writeFile(path, "Use the blue setting.");
  await expect(runtime.commitProposal(contextOf(f), stale)).resolves.toMatchObject({
    kind: "conflict",
    reason: "curation",
  });
  blockCuration = false;
  await f.reload();
  expect(await curationRecord(f)).toMatchObject({
    "current-work.md": { kind: "edited", digest: digest("User edit.\n") },
  });
  await f.session.prompt("After the restart.");
  expect(noteBlocks(f.requests.at(-1))).toEqual([]);
});

test("Pi while memory is disabled an edited note is withheld and its correction is durable before manual compaction prepares", async ({
  createFixture,
}) => {
  const holder: { f?: Fixture } = {};
  const durableAtPreparation: number[] = [];
  const { f } = await presentedNote(createFixture, {
    extensions: [
      (pi) => {
        pi.on("session_before_compact", async () => {
          if (holder.f !== undefined) {
            durableAtPreparation.push((await durableCorrections(holder.f)).length);
          }
        });
      },
    ],
  });
  holder.f = f;
  const components = rawComponents(f);
  await f.command("off");
  await writeFile(await notePath(f), "Edited while disabled.\n");
  await f.session.prompt("Work while disabled.");
  expect(noteBlocks(f.requests.at(-1))).toEqual([]);
  expect(correctionBlocks(f.requests.at(-1))).toHaveLength(1);
  f.settings.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
  const start = f.requests.length;
  await f.session.compact();
  expect(durableAtPreparation).toEqual([1]);
  const summaries = f.requests.slice(start).filter((request) => request.summary);
  expect(summaries.length).toBeGreaterThan(0);
  expect(JSON.stringify(summaries.map((request) => request.messages))).toContain(
    "because its file was edited outside tiered memory",
  );
  expect(rawComponents(f)).toBe(components);
});

function rawComponents(f: Fixture): number {
  return f.session.sessionManager.getBranch().filter((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return false;
    }
    const read = readPresentationEntry(entry.details);
    return read.kind === "valid" && read.entry.kind === "component";
  }).length;
}

function readsWith(
  override: (path: string, read: () => Promise<string | undefined>) => Promise<string | undefined>,
): TestServices {
  return {
    async read(path) {
      return await override(path, async () => await Effect.runPromise(readText(path)));
    },
  };
}

test.for([
  [
    "unreadable",
    "the note file could not be inspected: EACCES: permission denied, open current-work.md",
  ],
  ["changing", "the note file or its memory head changed while it was read"],
] as const)(
  "Pi a note file that is %s leaves freshness unknown, withholds the note with an unverified correction, records no curation, and a later inspection presents it again",
  async ([mode, reason], { createFixture }) => {
    let failing = false;
    let reads = 0;
    const services = readsWith(async (path, read) => {
      if (!failing || !path.endsWith("current-work.md")) {
        return await read();
      }
      if (mode === "unreadable") {
        throw new Error("EACCES: permission denied, open current-work.md");
      }
      reads++;
      return `Version ${String(reads)}.\n`;
    });
    const { f } = await presentedNote(createFixture, { services });
    failing = true;
    await f.session.prompt("While freshness is unknown.");
    const request = f.requests.at(-1);
    expect(noteBlocks(request)).toEqual([]);
    expect(correctionBlocks(request).join("\n")).toContain(
      "are no longer current because its freshness could not be verified",
    );
    const lines = await statusLines(f);
    expect(lines).toContain(
      `Current-work note freshness: unknown because ${reason}; the note is not presented as current until an inspection verifies it.`,
    );
    expect(lines.some((line) => line.startsWith("Capacity stop"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Current-work note curation:"))).toBe(false);
    expect(await curationRecord(f)).toBeUndefined();
    failing = false;
    await f.session.prompt("After freshness is verified.");
    expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
    expect(
      (await statusLines(f)).some((line) =>
        /^Current-work note freshness: verified at \d{4}-\d\d-\d\dT[\d:.]+Z by the latest completed inspection\.$/u.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(branchRecords(f).map((entry) => entry.kind)).toEqual([
      "component",
      "correction",
      "component",
    ]);
  },
);

test.for(["navigation", "reload"] as const)(
  "Pi an inspection in flight during %s is discarded",
  async (change, { createFixture }) => {
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    let hold = false;
    const services = readsWith(async (path, read) => {
      if (!hold || !path.endsWith("current-work.md")) {
        return await read();
      }
      hold = false;
      entered.resolve(undefined);
      await gate.promise;
      return "Edited during the check.\n";
    });
    const { f } = await presentedNote(createFixture, { services });
    await f.reload();
    const old = f.memory();
    hold = true;
    const inspection = old.runtime.freshness.inspect(contextOf(f), "input");
    await entered.promise;
    if (change === "navigation") {
      const target = sourceEntry(f, "Continue the work.").parentId ?? "";
      await f.session.navigateTree(target, { summarize: false });
    } else {
      await f.reload();
    }
    gate.resolve(undefined);
    await inspection;
    await f.memory().runtime.freshness.settled();
    const lines = await statusLines(f);
    expect(lines.some((line) => line.includes("outside tiered memory"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Current-work note curation:"))).toBe(false);
    expect(await curationRecord(f)).toBeUndefined();
  },
);

test("Pi a commit landing after a request's snapshot reaches only the next request and never counts as presented earlier", async ({
  createFixture,
}) => {
  let commit: (() => Promise<void>) | undefined;
  const held = Promise.withResolvers<undefined>();
  let holdNext = false;
  const { f } = await presentedNote(createFixture, {
    acting: () => {
      if (!holdNext) {
        return undefined;
      }
      holdNext = false;
      return { text: "Held response.", wait: held.promise };
    },
    extensions: [
      (pi) => {
        pi.on("context_with_system", async () => {
          const pending = commit;
          commit = undefined;
          await pending?.();
        });
      },
    ],
  });
  await f.reload();
  const red = await sourceReference(f, "Continue the work.");
  commit = async () => {
    const { runtime } = f.memory();
    const ctx = contextOf(f);
    const proposal = runtime.captureProposal(
      ctx,
      noteContent({ "current-work.md": "Use the red setting." }),
      [red],
    );
    await runtime.commitProposal(ctx, proposal);
  };
  holdNext = true;
  const run = f.session.prompt("Snapshot then commit.");
  await expect.poll(() => f.requests.at(-1)?.summary === false && commit === undefined).toBe(true);
  expect(noteBlocks(f.requests.at(-1)).join("\n")).toContain("Use the blue setting.");
  expect(noteBlocks(f.requests.at(-1)).join("\n")).not.toContain("Use the red setting.");
  held.resolve(undefined);
  await run;
  expect(
    branchRecords(f).flatMap((entry) => (entry.kind === "component" ? [entry.body] : [])),
  ).toEqual(["Use the blue setting."]);
  await f.session.prompt("Next request.");
  expect(noteBlocks(f.requests.at(-1)).at(-1)).toContain("Use the red setting.");
});

test("Pi a run an extension triggers inspects the note file at its first turn_start", async ({
  createFixture,
}) => {
  let api: ExtensionAPI | undefined;
  const { f } = await presentedNote(createFixture, {
    extensions: [
      (pi) => {
        api = pi;
      },
    ],
  });
  await writeFile(await notePath(f), "Edited before the triggered run.\n");
  const before = f.requests.length;
  api?.sendMessage(
    { customType: "probe-trigger", content: "Continue from the trigger.", display: true },
    { triggerTurn: true },
  );
  await expect.poll(() => f.requests.length).toBe(before + 1);
  await f.session.waitForIdle();
  const request = f.requests.at(-1);
  expect(noteBlocks(request)).toEqual([]);
  expect(correctionBlocks(request).join("\n")).toContain(
    "because its file was edited outside tiered memory",
  );
});

test("Pi a fork child never reads its ancestor's live note file as its own note", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const child = await forkOnDisk(
    f,
    async (options) => await createFixture({ ...options, services: {} }),
  );
  await writeFile(await notePath(f), "The parent edited its note.\n");
  await child.session.prompt("Continue in the fork.");
  expect(noteBlocks(child.requests.at(-1))).toHaveLength(1);
  const lines = await statusLines(child);
  expect(lines.some((line) => line.startsWith("Current-work note curation:"))).toBe(false);
  expect(lines.some((line) => line.includes("outside tiered memory"))).toBe(false);
});

test("Pi unknown freshness defers observer planning with its reason, and a later verified note reaches the observer as continuity state", async ({
  createFixture,
}) => {
  let failing = false;
  const services = readsWith(async (path, read) => {
    if (failing && path.endsWith("current-work.md")) {
      throw new Error("EACCES: permission denied, open current-work.md");
    }
    return await read();
  });
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer, { services });
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  failing = true;
  await f.session.prompt("While freshness is unknown.");
  await f.memory().work.idle();
  expect(observer.calls).toHaveLength(1);
  expect(await statusLines(f)).toContain(
    "Observer planning: deferred because the current-work note's freshness is unknown: the note file could not be inspected: EACCES: permission denied, open current-work.md. Check that current-work.md is readable, then run /reload.",
  );
  failing = false;
  await f.session.prompt("After freshness is verified.");
  const later = await observer.next();
  expect(later.call.prompt).toContain(
    "Previous current-work note (continuity state, not evidence):\nUse the blue setting.",
  );
  later.reply(noteReply("Use the blue setting.", later.call));
  await f.memory().work.idle();
});

function deferred(line: string): boolean {
  return line.startsWith("Observer planning: deferred");
}

async function curationOf(fixture: Fixture): Promise<CurationState> {
  const file = join((await storeFor(fixture)).sessionDir, "curation.json");
  return parseRecord(curationSchema, await readFile(file, "utf8"), file);
}

test("Pi a planning deferral clears once another cause stops observer planning", async ({
  createFixture,
}) => {
  const services = readsWith(async (path, read) => {
    if (path.endsWith("current-work.md")) {
      throw new Error("EACCES: permission denied, open current-work.md");
    }
    return await read();
  });
  const observer = new ScriptedObserver();
  const f = await workerFixture(createFixture, observer, { services });
  await f.session.prompt("Remember the blue setting.");
  const first = await observer.next();
  first.reply(noteReply("Use the blue setting.", first.call));
  await f.memory().work.idle();
  await f.session.prompt("While freshness is unknown.");
  expect((await statusLines(f)).some(deferred)).toBe(true);
  await f.command("off");
  await f.session.prompt("While memory is off.");
  expect((await statusLines(f)).some(deferred)).toBe(false);
});

test.for(["edited", "deleted"] as const)(
  "Pi a note %s while its observer job runs and replies unchanged is withheld from the next request with a durable curation correction that the next compaction includes",
  async (change, { createFixture }) => {
    const observer = new ScriptedObserver();
    const f = await workerFixture(createFixture, observer);
    await f.session.prompt("Fix the parser.");
    const first = await observer.next();
    first.reply(noteReply("Parser fix in progress.", first.call));
    await f.memory().work.idle();
    await f.session.prompt("Update the docs.");
    expect(noteBlocks(f.requests.at(-1))).toHaveLength(1);
    const pending = await observer.next();
    const path = await notePath(f);
    if (change === "edited") {
      await writeFile(path, "My own note.\n");
    } else {
      await rm(path);
    }
    observer.respond(() => observerReply({ observations: [], workNote: { status: "unchanged" } }));
    pending.reply(observerReply({ observations: [], workNote: { status: "unchanged" } }));
    await f.memory().work.idle();
    await f.session.prompt("Continue.");
    await f.memory().work.idle();
    expect(noteBlocks(f.requests.at(-1))).toEqual([]);
    const event =
      change === "edited"
        ? { kind: "edited", digest: digest("My own note.\n") }
        : { kind: "deleted" };
    expect(await durableCorrections(f)).toMatchObject([
      { component: "work-note", cause: { kind: "curation", event } },
    ]);
    compactEverythingButTheLastTurn(f);
    await f.session.compact();
    const summarized = JSON.stringify(summaryRequests(f).map((request) => request.messages));
    expect(summarized.indexOf("Parser fix in progress.")).toBeGreaterThan(-1);
    expect(summarized.indexOf("[Tiered memory: correction]")).toBeGreaterThan(
      summarized.indexOf("Parser fix in progress."),
    );
  },
);

test.for(["enabled", "disabled"] as const)(
  "Pi with memory %s and storage that fails to open, an edited note's earlier presentation is withheld with a durable unverified correction and status reports the unknown freshness",
  async (activation, { createFixture }) => {
    const { f } = await presentedNote(createFixture);
    if (activation === "disabled") {
      await f.command("off");
    }
    const store = await storeFor(f);
    await writeFile(join(store.sessionDir, "current", "current-work.md"), "Edited by hand.\n");
    await writeFile(join(store.sessionDir, "sources.json"), "damaged");
    await f.reload();
    const components = branchRecords(f).filter((entry) => entry.kind === "component").length;
    await f.session.prompt("After reload with damaged storage.");
    expect(noteBlocks(f.requests.at(-1))).toEqual([]);
    expect(await durableCorrections(f)).toMatchObject([
      { component: "work-note", cause: { kind: "unverified" } },
    ]);
    expect(branchRecords(f).filter((entry) => entry.kind === "component")).toHaveLength(components);
    const lines = await statusLines(f);
    expect(lines).toContain("Memory storage: unavailable");
    expect(lines).toContain(
      "Current-work note freshness: unknown because memory storage is not open; the note is not presented as current until memory storage opens. Resolve the storage error, then run /reload.",
    );
  },
);

test("Pi a fork child does not replay its ancestor's curation correction and presents the note the ancestor regenerated", async ({
  createFixture,
}) => {
  const { f } = await presentedNote(createFixture);
  const path = await notePath(f);
  await writeFile(path, "User edit.\n");
  await f.session.prompt("After the edit.");
  await f.memory().runtime.freshness.settled();
  await rm(path);
  await f.session.prompt("Start the release.");
  await f.memory().runtime.freshness.settled();
  await f.reload();
  const ctx = contextOf(f);
  const { runtime } = f.memory();
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Release in progress." }),
    [await sourceReference(f, "Start the release.")],
  );
  committedId(await runtime.commitProposal(ctx, proposal));
  await f.session.prompt("Continue in the parent.");
  expect(noteBlocks(f.requests.at(-1)).join("\n")).toContain("Release in progress.");
  expect((await curationOf(f)).notes["current-work.md"]?.kind).toBe("deleted");
  const child = await forkOnDisk(
    f,
    async (options) => await createFixture({ ...options, services: {} }),
  );
  await child.session.prompt("Continue in the fork.");
  expect(noteBlocks(child.requests.at(-1)).join("\n")).toContain("Release in progress.");
  expect((await curationOf(child)).notes["current-work.md"]?.kind).toBe("deleted");
});

test("Pi an inspection whose head reads straddle this process's materialization marker changes no freshness and sends no correction", async ({
  createFixture,
}) => {
  let armWrite = false;
  let headReads = 0;
  const markerSeen = Promise.withResolvers<undefined>();
  const markerRelease = Promise.withResolvers<undefined>();
  const markerDone = Promise.withResolvers<undefined>();
  const { f } = await presentedNote(createFixture, {
    services: {
      async write(path, contents) {
        if (armWrite && path.endsWith("head.json") && contents.includes('"materialized":true')) {
          armWrite = false;
          markerSeen.resolve(undefined);
          await markerRelease.promise;
          await writeDurable(path, contents);
          markerDone.resolve(undefined);
          return;
        }
        await writeDurable(path, contents);
      },
      async read(path) {
        if (headReads > 0 && path.endsWith("head.json")) {
          headReads++;
          if (headReads === 3) {
            markerRelease.resolve(undefined);
            await markerDone.promise;
          }
        }
        return await Effect.runPromise(readText(path));
      },
    },
  });
  const ctx = contextOf(f);
  const { runtime, presentation } = f.memory();
  await runtime.freshness.inspect(ctx, "input");
  const before = runtime.openStorage?.freshness.observation;
  expect(before?.state).toBe("verified");
  armWrite = true;
  const proposal = runtime.captureProposal(
    ctx,
    noteContent({ "current-work.md": "Use the blue setting, still." }),
    [await sourceReference(f, "Remember the blue setting.")],
  );
  const committing = runtime.commitProposal(ctx, proposal);
  await markerSeen.promise;
  headReads = 1;
  await runtime.freshness.inspect(ctx, "input");
  expect(headReads).toBe(3);
  expect(runtime.openStorage?.freshness.observation).toEqual(before);
  presentation.sendCorrections(ctx);
  expect(branchRecords(f).some((entry) => entry.kind === "correction")).toBe(false);
  committedId(await committing);
});

test("Pi an inspection that completes unknown while a reconciliation runs keeps freshness unknown after that reconciliation", async ({
  createFixture,
}) => {
  let failReads = false;
  let hold: { entered: () => void; released: Promise<undefined> } | undefined;
  const { f } = await presentedNote(createFixture, {
    services: {
      ...readsWith(async (path, read) => {
        if (failReads && path.endsWith("current-work.md")) {
          throw new Error("EACCES: permission denied, open current-work.md");
        }
        return await read();
      }),
      lock: {
        async removeTicket(path) {
          const gate = hold;
          hold = undefined;
          gate?.entered();
          await gate?.released;
          await rm(path, { force: true });
        },
      },
    },
  });
  const ctx = contextOf(f);
  const { runtime } = f.memory();
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  hold = {
    entered: () => {
      entered.resolve(undefined);
    },
    released: released.promise,
  };
  const reconciling = runtime.refreshRoles(ctx);
  await entered.promise;
  failReads = true;
  await runtime.freshness.inspect(ctx, "input");
  expect(runtime.openStorage?.freshness.observation?.state).toBe("unknown");
  released.resolve(undefined);
  await reconciling;
  expect(storageOf(runtime).reconciliation).toBe("current");
  expect(runtime.openStorage?.freshness.observation).toMatchObject({
    state: "unknown",
    reason: "the note file could not be inspected: EACCES: permission denied, open current-work.md",
  });
});
