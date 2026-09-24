import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import type { DurableWriter } from "../src/storage/files.ts";
import { registrySchema, SourceRegistry } from "../src/storage/sources.ts";
import type { SourceSessionManager } from "../src/storage/sources.ts";
import type { Fixture } from "./pi-fixture.mts";
import {
  interruptingWriter,
  openStore,
  rejectionPaths,
  sourceEntry,
  test,
  zeroUsage,
} from "./store-fixture.mts";

async function registryFor(f: Fixture, write?: DurableWriter) {
  const store = await openStore(f.cwd, {
    sessionId: f.session.sessionManager.getSessionId(),
    ...(write === undefined ? {} : { write }),
  });
  return { store, registry: await SourceRegistry.open(store) };
}

const editableRegistrySchema = Type.Object({
  sources: Type.Array(Type.Record(Type.String(), Type.Unknown())),
});

function editableRegistry(text: string): Static<typeof editableRegistrySchema> {
  const value: unknown = JSON.parse(text);
  if (!Value.Check(editableRegistrySchema, value)) {
    throw new Error("The persisted registry has no source list.");
  }
  return value;
}

function managerWith(f: Fixture, branch: SessionEntry[]): SourceSessionManager {
  const manager = f.session.sessionManager;
  return {
    getSessionId: () => manager.getSessionId(),
    getSessionFile: () => manager.getSessionFile(),
    getHeader: () => manager.getHeader(),
    getBranch: () => branch,
  };
}

test("registration records original text without observations and round-trips recorded and supplied time", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Deploy happened 2026-09-20 at 10:00 New York time.");
  await f.session.prompt("It broke again yesterday.");
  await f.session.prompt("No time context here.");
  const recorded = Date.UTC(2020, 0, 2, 3, 4, 5);
  const branch = structuredClone(f.session.sessionManager.getBranch());
  for (const entry of branch) {
    if (entry.type === "message" && "timestamp" in entry.message) {
      entry.message.timestamp = recorded;
    }
  }
  const explicit = sourceEntry(f, "Deploy happened 2026-09-20 at 10:00 New York time.").id;
  const relative = sourceEntry(f, "It broke again yesterday.").id;
  const none = sourceEntry(f, "No time context here.").id;
  const { store, registry } = await registryFor(f);
  await registry.register(managerWith(f, branch), {
    [explicit]: { eventTime: "2026-09-20T10:00:00", timezone: "America/New_York" },
    [relative]: { eventTime: "yesterday" },
  });
  const reopened = (await SourceRegistry.open(store)).sources;
  const timeOf = (entryId: string) => reopened.find((source) => source.entryId === entryId)?.time;
  expect(timeOf(explicit)).toEqual({
    recordedAt: "2020-01-02T03:04:05.000Z",
    eventTime: "2026-09-20T10:00:00",
    timezone: "America/New_York",
  });
  expect(timeOf(relative)).toEqual({
    recordedAt: "2020-01-02T03:04:05.000Z",
    eventTime: "yesterday",
  });
  expect(timeOf(none)).toEqual({ recordedAt: "2020-01-02T03:04:05.000Z" });
});

test("an effective-context edit changes the effective digest and keeps the raw digest", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Original command is red.");
  const { registry } = await registryFor(f);
  const entry = sourceEntry(f, "Original command is red.");
  const before = (await registry.register(f.session.sessionManager)).find(
    (source) => source.entryId === entry.id,
  );
  f.session.sessionManager.appendContextEdit(entry.id, { content: "Corrected command is blue." });
  const after = (await registry.register(f.session.sessionManager)).find(
    (source) => source.entryId === entry.id,
  );
  expect(after?.rawDigest).toBe(before?.rawDigest);
  expect(after?.effectiveDigest).toBe(digest("Corrected command is blue."));
  expect(before?.effectiveDigest).toBe(digest("Original command is red."));
});

test("an explicit empty replacement stays distinct from omission", async ({ createFixture }) => {
  const f = await createFixture();
  await f.session.prompt("Replace me.");
  await f.session.prompt("Omit me.");
  const replaced = sourceEntry(f, "Replace me.").id;
  const omitted = sourceEntry(f, "Omit me.").id;
  f.session.sessionManager.appendContextEdit(replaced, { content: "" });
  f.session.sessionManager.appendContextEdit(omitted, null);
  const { registry } = await registryFor(f);
  const records = await registry.register(f.session.sessionManager);
  expect(records.find((source) => source.entryId === replaced)).toMatchObject({
    omitted: false,
    effectiveDigest: digest(""),
  });
  expect(records.find((source) => source.entryId === omitted)).toMatchObject({
    omitted: true,
    effectiveDigest: null,
  });
});

test("repeated identical attempts keep separate source identities", async ({ createFixture }) => {
  const f = await createFixture();
  await f.session.prompt("Error E42");
  await f.session.prompt("Error E42");
  const { registry } = await registryFor(f);
  const attempts = (await registry.register(f.session.sessionManager)).filter(
    (source) => source.role === "user" && source.rawDigest === digest("Error E42"),
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.reference).not.toBe(attempts[1]?.reference);
});

function appendToolTurn(f: Fixture, firstArgument: string): string {
  const manager = f.session.sessionManager;
  manager.appendMessage({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call-one",
        name: "write",
        arguments: { path: "first", content: firstArgument },
      },
      {
        type: "toolCall",
        id: "call-two",
        name: "edit",
        arguments: { path: "second", oldText: "before", newText: "after" },
      },
    ],
    api: "tiered-fixture-api",
    provider: "tiered-fixture",
    model: "fixture",
    stopReason: "toolUse",
    timestamp: Date.now(),
    usage: zeroUsage,
  });
  const assistant = manager.getLeafId();
  if (assistant === null) {
    throw new Error("Missing assistant entry.");
  }
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "call-two",
    toolName: "edit",
    isError: true,
    content: [{ type: "text", text: "permission denied" }],
    timestamp: Date.now(),
  });
  return assistant;
}

test("ordered tool calls and linked error results are part of source identity", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const assistant = appendToolTurn(f, "keep exact argument");
  const { registry } = await registryFor(f);
  const records = await registry.register(f.session.sessionManager);
  expect(records.find((source) => source.entryId === assistant)?.rawDigest).toBe(
    digest(
      'Tool call: {"id":"call-one","name":"write","arguments":{"path":"first","content":"keep exact argument"}}\nTool call: {"id":"call-two","name":"edit","arguments":{"path":"second","oldText":"before","newText":"after"}}',
    ),
  );
  expect(records.find((source) => source.role === "toolResult")?.rawDigest).toBe(
    digest(
      'Tool result: {"toolCallId":"call-two","toolName":"edit","isError":true}\npermission denied',
    ),
  );
  f.session.sessionManager.appendContextEdit(assistant, {
    content: [
      {
        type: "toolCall",
        id: "call-one",
        name: "write",
        arguments: { path: "first", content: "corrected" },
      },
    ],
  });
  const edited = (await registry.register(f.session.sessionManager)).find(
    (source) => source.entryId === assistant,
  );
  expect(edited?.rawDigest).toBe(records.find((source) => source.entryId === assistant)?.rawDigest);
  expect(edited?.effectiveDigest).toBe(
    digest(
      'Tool call: {"id":"call-one","name":"write","arguments":{"path":"first","content":"corrected"}}',
    ),
  );
});

test("an unknown recording time stays absent without an invented timezone", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Time is unknown.");
  const branch = structuredClone(f.session.sessionManager.getBranch());
  for (const entry of branch) {
    if (entry.type === "message") {
      entry.timestamp = "unknown";
      if ("timestamp" in entry.message) {
        entry.message.timestamp = Number.NaN;
      }
    }
  }
  const { registry } = await registryFor(f);
  const records = await registry.register(managerWith(f, branch));
  expect(records.find((source) => source.role === "user")?.time).toEqual({});
});

test("malformed tool-call metadata is rejected before the registry file changes", async ({
  createFixture,
}) => {
  const f = await createFixture();
  appendToolTurn(f, "argument");
  const { store, registry } = await registryFor(f);
  await registry.register(f.session.sessionManager);
  const path = join(store.sessionDir, "sources.json");
  const original = await readFile(path, "utf8");
  const branch = structuredClone(f.session.sessionManager.getBranch());
  const assistant = branch.find(
    (entry) =>
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      entry.message.stopReason === "toolUse",
  );
  if (assistant?.type !== "message" || assistant.message.role !== "assistant") {
    throw new Error("Missing assistant entry.");
  }
  const call = assistant.message.content.find((block) => block.type === "toolCall");
  if (call === undefined) {
    throw new Error("Missing tool call.");
  }
  Reflect.deleteProperty(call, "name");
  await expect(registry.register(managerWith(f, branch))).rejects.toThrow(
    "Invalid tool call source metadata.",
  );
  expect(await readFile(path, "utf8")).toBe(original);
});

test("registration rejects a session manager for another session or project root", async ({
  createFixture,
  makeRoot,
}) => {
  const f = await createFixture();
  const { registry } = await registryFor(f);
  const manager = f.session.sessionManager;
  await expect(
    registry.register({
      ...managerWith(f, manager.getBranch()),
      getSessionId: () => "other-session",
    }),
  ).rejects.toThrow("Source session identity differs");
  const header = manager.getHeader();
  if (header === null) {
    throw new Error("Missing session header.");
  }
  const foreign = { ...header, cwd: await makeRoot() };
  await expect(
    registry.register({ ...managerWith(f, manager.getBranch()), getHeader: () => foreign }),
  ).rejects.toThrow("different project root");
});

test("sources returns copies that callers cannot use to change the registry", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Original text.");
  const { store, registry } = await registryFor(f);
  const [registered] = await registry.register(f.session.sessionManager);
  if (registered === undefined) {
    throw new Error("Missing source record.");
  }
  registered.time.timezone = "Mars/Phobos";
  const exposed = registry.sources[0];
  if (exposed !== undefined) {
    exposed.time.eventTime = "never";
  }
  expect(Object.keys(registry.sources[0]?.time ?? {})).toEqual(["recordedAt"]);
  expect((await SourceRegistry.open(store)).sources[0]?.time.timezone).toBeUndefined();
});

test("records of entries off the active branch are retained after navigation", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("First branch source.");
  await f.session.prompt("Later branch source.");
  const { store, registry } = await registryFor(f);
  await registry.register(f.session.sessionManager);
  f.session.sessionManager.branch(sourceEntry(f, "First branch source.").id);
  const records = await registry.register(f.session.sessionManager);
  expect(records.filter((source) => source.role === "user")).toHaveLength(1);
  const retained = (await SourceRegistry.open(store)).sources.filter(
    (source) => source.role === "user",
  );
  expect(retained).toHaveLength(2);
});

test("registration writes sources.json once per call", async ({ createFixture }) => {
  const f = await createFixture();
  await f.session.prompt("One source.");
  const recorder = interruptingWriter(() => false);
  const { registry } = await registryFor(f, recorder.write);
  recorder.writes.length = 0;
  await registry.register(f.session.sessionManager);
  expect(recorder.writes.filter((path) => path.endsWith("sources.json"))).toHaveLength(1);
});

test("current source projection detects context edits without writing sources.json", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Original instruction.");
  const recorder = interruptingWriter(() => false);
  const { registry } = await registryFor(f, recorder.write);
  const [registered] = await registry.register(f.session.sessionManager);
  if (registered === undefined) {
    throw new Error("Missing registered source.");
  }
  recorder.writes.length = 0;
  f.session.sessionManager.appendContextEdit(sourceEntry(f, "Original instruction.").id, {
    content: "Replacement instruction.",
  });
  const current = await registry.current(f.session.sessionManager);
  expect(current.find((source) => source.entryId === registered.entryId)?.effectiveDigest).not.toBe(
    registered.effectiveDigest,
  );
  expect(recorder.writes.filter((path) => path.endsWith("sources.json"))).toHaveLength(0);
});

const registry = {
  version: 1,
  projectId: "a".repeat(64),
  sessionId: "session-1",
  sources: [],
};

test("sources.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(registrySchema, { ...registry, version: 2 })).toContain("/version");
});

test("sources.json missing its sources is rejected at /sources", () => {
  const { sources: _removed, ...rest } = registry;
  expect(rejectionPaths(registrySchema, rest)).toContain("/sources");
});

test("sources.json with a wrong-typed source order is rejected at /sources/0/order", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Recorded original.");
  const { store, registry: sources } = await registryFor(f);
  await sources.register(f.session.sessionManager);
  const damaged = editableRegistry(await readFile(join(store.sessionDir, "sources.json"), "utf8"));
  const [first] = damaged.sources;
  if (first === undefined) {
    throw new Error("Missing persisted source.");
  }
  first.order = "first";
  expect(rejectionPaths(registrySchema, damaged)).toContain("/sources/0/order");
});

test("sources.json missing a source's rawDigest is rejected at /sources/0/rawDigest", async ({
  createFixture,
}) => {
  const f = await createFixture();
  await f.session.prompt("Recorded original.");
  const { store, registry: sources } = await registryFor(f);
  await sources.register(f.session.sessionManager);
  const damaged = editableRegistry(await readFile(join(store.sessionDir, "sources.json"), "utf8"));
  const [first] = damaged.sources;
  if (first === undefined) {
    throw new Error("Missing persisted source.");
  }
  delete first.rawDigest;
  expect(rejectionPaths(registrySchema, damaged)).toContain("/sources/0/rawDigest");
});

test.for([
  {
    field: "reference",
    value: `tm1:${"0".repeat(64)}:other:entry:0`,
    path: "/sources/0/reference",
  },
  { field: "role", value: "system", path: "/sources/0/role" },
  { field: "entryId", value: "../../foreign", path: "/sources/0/entryId" },
])(
  "a damaged source $field is rejected at its path without changing the registry bytes",
  async ({ field, value, path }, { createFixture }) => {
    const f = await createFixture();
    await f.session.prompt("Recorded original.");
    const { store, registry: sources } = await registryFor(f);
    await sources.register(f.session.sessionManager);
    const file = join(store.sessionDir, "sources.json");
    const damaged = editableRegistry(await readFile(file, "utf8"));
    const [first] = damaged.sources;
    if (first === undefined) {
      throw new Error("Missing persisted source.");
    }
    first[field] = value;
    const bytes = `${JSON.stringify(damaged)}\n`;
    await writeFile(file, bytes);
    await expect(SourceRegistry.open(store)).rejects.toThrow(`Invalid record at ${file}: ${path}`);
    expect(await readFile(file, "utf8")).toBe(bytes);
  },
);
