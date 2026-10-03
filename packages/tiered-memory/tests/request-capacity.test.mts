import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Message } from "@earendil-works/pi-ai";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import type { ContextWithSystemEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import {
  evaluateCapacity,
  requestFootprint,
  requestLimits,
  stopForCapacity,
} from "../src/pi/request-capacity.ts";
import type { CapacityStop, RequestFootprint } from "../src/pi/request-capacity.ts";
import { presentationMessageType } from "../src/presentation/entries.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import { fixtureMessage, fixtureModel } from "./pi-fixture.mts";
import type { ActingRequest, Fixture, FixtureOptions } from "./pi-fixture.mts";
import { committedId, noteContent, sourceEntry, sourceReference, test } from "./store-fixture.mts";
import { noteReply, observerReply, ScriptedObserver, workerFixture } from "./worker-fixture.mts";

type LimitsContext = Parameters<typeof requestLimits>[0];

// Links bare entries into one branch, as Pi's projection walks parent ids from the leaf.
function chained(entries: readonly Record<string, unknown>[]): unknown[] {
  const ids = entries.map((entry, index) =>
    typeof entry.id === "string" ? entry.id : `entry-${String(index)}`,
  );
  return entries.map((entry, index) => ({
    timestamp: new Date(0).toISOString(),
    ...entry,
    id: ids[index],
    parentId: index === 0 ? null : ids[index - 1],
  }));
}

function limitsContext(
  model: Partial<NonNullable<LimitsContext["model"]>> | undefined,
  branch: Record<string, unknown>[] = [],
  registered?: { contextWindow: number; maxTokens: number },
): LimitsContext {
  const context = {
    model: model === undefined ? undefined : { ...fixtureModel, ...model },
    modelRegistry: {
      find: () => (registered === undefined ? undefined : { ...fixtureModel, ...registered }),
    },
    sessionManager: { getBranch: () => chained(branch) },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test supplies only the members requestLimits reads.
  return context as unknown as LimitsContext;
}

const physicalLimits = {
  kind: "known",
  source: "physical",
  modelId: "fixture/small",
  contextWindow: 1000,
  maxTokens: 100,
} as const;

function footprint(overrides: Partial<RequestFootprint>): RequestFootprint {
  return {
    systemTokens: 100,
    toolTokens: 0,
    transcriptTokens: 200,
    mandatoryTokens: 300,
    optionalTokens: 0,
    reserveTokens: 100,
    ...overrides,
  };
}

function response(stopReason: string, model: string) {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api: "fixture",
      provider: "tiered-fixture",
      model,
      stopReason,
    },
  };
}

function record(id: string, component: "work-note" | "index"): PresentationEntry {
  return {
    version: 1,
    kind: "component",
    id,
    lineage: { projectId: "a".repeat(64), sessionId: "s" },
    anchorId: "anchor",
    component,
    revision: { sessionId: "s", revisionId: "r" },
    sourceBoundary: { reference: `tm1:${"a".repeat(64)}:s:e:0`, order: 0, role: "user" },
    body: "b".repeat(400),
    bodyDigest: digest("b".repeat(400)),
  };
}

function custom(entry: PresentationEntry) {
  return {
    role: "custom",
    customType: presentationMessageType,
    content: "c".repeat(400),
    display: true,
    details: entry,
    timestamp: 0,
  };
}

test("requestLimits returns the dispatched model's limits for a physical selection", () => {
  expect(requestLimits(limitsContext({ contextWindow: 8000, maxTokens: 500 }))).toEqual({
    kind: "known",
    source: "physical",
    modelId: "tiered-fixture/fixture",
    contextWindow: 8000,
    maxTokens: 500,
  });
  expect(requestLimits(limitsContext(undefined))).toEqual({ kind: "none" });
});

test("requestLimits uses a virtual selection's declared limits before its first response", () => {
  expect(
    requestLimits(
      limitsContext({
        api: "pi-virtual",
        provider: "probe",
        id: "auto",
        contextWindow: 3000,
        maxTokens: 300,
      }),
    ),
  ).toEqual({
    kind: "known",
    source: "virtual-declared",
    modelId: "probe/auto",
    contextWindow: 3000,
    maxTokens: 300,
  });
});

test("requestLimits uses the latest successful response since the virtual selection for its limits", () => {
  expect(
    requestLimits(
      limitsContext(
        { api: "pi-virtual", provider: "probe", id: "auto", contextWindow: 3000, maxTokens: 300 },
        [{ type: "model_change" }, response("stop", "large"), response("error", "small")],
        { contextWindow: 64000, maxTokens: 4000 },
      ),
    ),
  ).toEqual({
    kind: "known",
    source: "virtual-response",
    modelId: "probe/auto",
    contextWindow: 64000,
    maxTokens: 4000,
  });
});

test("requestLimits uses the declared limits once a compaction summarized every response since the virtual selection", () => {
  const virtual = { api: "pi-virtual", provider: "probe", id: "auto", contextWindow: 3000 };
  expect(
    requestLimits(
      limitsContext(
        { ...virtual, maxTokens: 300 },
        [
          { type: "model_change" },
          response("stop", "large"),
          {
            id: "kept",
            type: "message",
            message: { role: "user", content: "Next.", timestamp: 0 },
          },
          { type: "compaction", summary: "Summary.", firstKeptEntryId: "kept", tokensBefore: 10 },
        ],
        { contextWindow: 64000, maxTokens: 4000 },
      ),
    ),
  ).toEqual({
    kind: "known",
    source: "virtual-declared",
    modelId: "probe/auto",
    contextWindow: 3000,
    maxTokens: 300,
  });
});

test("requestLimits uses the declared limits when the latest response's model is not registered", () => {
  expect(
    requestLimits(
      limitsContext(
        { api: "pi-virtual", provider: "probe", id: "auto", contextWindow: 3000, maxTokens: 300 },
        [{ type: "model_change" }, response("stop", "retired")],
      ),
    ),
  ).toEqual({
    kind: "known",
    source: "virtual-declared",
    modelId: "probe/auto",
    contextWindow: 3000,
    maxTokens: 300,
  });
});

test("requestLimits reports unknown limits for a virtual selection Pi cannot size", () => {
  expect(
    requestLimits(
      limitsContext({
        api: "pi-virtual",
        provider: "probe",
        id: "auto",
        contextWindow: 0,
        maxTokens: 0,
      }),
    ),
  ).toEqual({
    kind: "unknown",
    modelId: "probe/auto",
    reason: "the virtual model declares no limits",
  });
});

function systemMessage(prompt: string, tools: string[]) {
  return {
    role: "system" as const,
    content: prompt,
    toolsAdded: tools.map((name) => ({
      name,
      description: `${name} tool`,
      parameters: Type.Object({ path: Type.String() }),
    })),
    timestamp: 0,
  };
}

function eventOf(messages: unknown[]): ContextWithSystemEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Transcript messages built for the test.
  return { type: "context_with_system", messages } as unknown as ContextWithSystemEvent;
}

const promptContext = (prompt: string): Pick<ExtensionContext, "getSystemPrompt"> => ({
  getSystemPrompt: () => prompt,
});

test("requestFootprint uses the larger of the transcript system prompt and getSystemPrompt", () => {
  const event = eventOf([systemMessage("short", [])]);
  const none = { mandatory: new Set<string>(), optional: new Set<string>(), reduced: new Map() };
  expect(
    requestFootprint(event, promptContext("x".repeat(400)), none, physicalLimits).systemTokens,
  ).toBe(100);
  expect(
    requestFootprint(
      eventOf([systemMessage("y".repeat(800), [])]),
      promptContext("x"),
      none,
      physicalLimits,
    ).systemTokens,
  ).toBe(200);
});

test("requestFootprint counts the current tool declarations and the generation reserve", () => {
  const none = { mandatory: new Set<string>(), optional: new Set<string>(), reduced: new Map() };
  const one = requestFootprint(
    eventOf([systemMessage("p", ["read"])]),
    promptContext(""),
    none,
    physicalLimits,
  );
  const two = requestFootprint(
    eventOf([systemMessage("p", ["read"]), systemMessage("", ["write"])]),
    promptContext(""),
    none,
    physicalLimits,
  );
  expect(two.toolTokens).toBeGreaterThan(one.toolTokens);
  expect(one.reserveTokens).toBe(100);
});

test("requestFootprint caps the generation headroom of a large-output model at 16384 tokens", () => {
  const none = { mandatory: new Set<string>(), optional: new Set<string>(), reduced: new Map() };
  const large = { ...physicalLimits, contextWindow: 200000, maxTokens: 64000 };
  expect(
    requestFootprint(eventOf([systemMessage("p", [])]), promptContext(""), none, large)
      .reserveTokens,
  ).toBe(16384);
});

test("requestFootprint separates mandatory and optional presentation from the transcript", () => {
  const event = eventOf([
    systemMessage("", []),
    { role: "user", content: "u".repeat(400), timestamp: 0 },
    custom(record("note", "work-note")),
    custom(record("index", "index")),
  ]);
  const measured = requestFootprint(
    event,
    promptContext(""),
    { mandatory: new Set(["note"]), optional: new Set(["index"]), reduced: new Map() },
    physicalLimits,
  );
  expect(measured.transcriptTokens).toBe(100);
  expect(measured.mandatoryTokens).toBe(100);
  expect(measured.optionalTokens).toBe(100);
});

test("requestFootprint counts only a reduced rendering as mandatory and the rest of its message as optional", () => {
  const combined = { ...custom(record("reset", "work-note")), content: "r".repeat(1200) };
  const [, noteOnly] = eventOf([
    systemMessage("", []),
    { ...combined, content: "n".repeat(400) },
  ]).messages;
  if (noteOnly === undefined) {
    throw new Error("Missing note-only rendering.");
  }
  const measured = requestFootprint(
    eventOf([systemMessage("", []), combined]),
    promptContext(""),
    { mandatory: new Set(), optional: new Set(), reduced: new Map([["reset", noteOnly]]) },
    physicalLimits,
  );
  expect(measured.mandatoryTokens).toBe(100);
  expect(measured.optionalTokens).toBe(200);
  expect(measured.transcriptTokens).toBe(0);
});

test("evaluateCapacity yields optional memory before evaluating the mandatory note", () => {
  expect(evaluateCapacity(footprint({ optionalTokens: 400 }), physicalLimits, "a")).toEqual({
    kind: "without-optional",
  });
  expect(evaluateCapacity(footprint({ optionalTokens: 300 }), physicalLimits, "a")).toEqual({
    kind: "fits",
  });
});

test("evaluateCapacity stops when the complete note does not fit after optional memory yields", () => {
  expect(evaluateCapacity(footprint({ mandatoryTokens: 601 }), physicalLimits, "a")).toEqual({
    kind: "stop",
    stop: {
      cause: "context-window",
      modelId: "fixture/small",
      anchorId: "a",
      requiredTokens: 1001,
      availableTokens: 1000,
      headroomTokens: 100,
      estimate: false,
    },
  });
});

test("evaluateCapacity stops a presented note even when the conversation alone overflows", () => {
  expect(
    evaluateCapacity(
      footprint({ transcriptTokens: 900, mandatoryTokens: 50 }),
      physicalLimits,
      "a",
    ),
  ).toMatchObject({ kind: "stop", stop: { requiredTokens: 1150, availableTokens: 1000 } });
});

test("evaluateCapacity never stops a request without a presented note", () => {
  expect(
    evaluateCapacity(footprint({ mandatoryTokens: 0, transcriptTokens: 900 }), physicalLimits, "a"),
  ).toEqual({ kind: "fits" });
});

const stop: CapacityStop = {
  cause: "context-window",
  modelId: "fixture/small",
  anchorId: "a",
  requiredTokens: 2,
  availableTokens: 1,
  headroomTokens: 1,
  estimate: false,
};

test("stopForCapacity records the cause before calling abort and returns without waiting", () => {
  const order: string[] = [];
  const result = stopForCapacity(
    {
      signal: new AbortController().signal,
      abort: () => {
        order.push("abort");
      },
    },
    stop,
    () => {
      order.push("record");
    },
  );
  expect(result).toBe("stopped");
  expect(order).toEqual(["record", "abort"]);
});

test("stopForCapacity keeps an earlier cancellation and records no capacity cause", () => {
  const controller = new AbortController();
  controller.abort(new Error("user"));
  const order: string[] = [];
  const result = stopForCapacity(
    {
      signal: controller.signal,
      abort: () => {
        order.push("abort");
      },
    },
    stop,
    () => {
      order.push("record");
    },
  );
  expect(result).toBe("already-cancelled");
  expect(order).toEqual([]);
});

type CreateFixture = (options?: FixtureOptions) => Promise<Fixture>;

const smallModel = {
  ...fixtureModel,
  id: "small",
  name: "Small",
  contextWindow: 3000,
  maxTokens: 500,
};
const wideModel = {
  ...fixtureModel,
  id: "wide",
  name: "Wide",
  contextWindow: 40000,
  maxTokens: 1000,
};

async function noteFixture(
  createFixture: CreateFixture,
  body: string,
  options: FixtureOptions = {},
) {
  const f = await createFixture({
    services: {},
    models: [smallModel, wideModel],
    personal: { limits: { presentationTokens: 100000 } },
    ...options,
  });
  await f.session.prompt("Remember the setting.");
  await f.reload();
  const { runtime } = f.memory();
  const ctx = f.session.extensionRunner.createContext();
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": body }), [
    await sourceReference(f, "Remember the setting."),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
  return f;
}

function texts(request: ActingRequest | undefined): string[] {
  return (request?.messages ?? []).map((message: Message) =>
    typeof message.content === "string"
      ? message.content
      : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
  );
}

async function selectModel(f: Fixture, id: string): Promise<void> {
  const model = f.session.modelRuntime.getModel(fixtureModel.provider, id);
  if (model === undefined) {
    throw new Error(`Missing model ${id}.`);
  }
  await f.session.setModel(model);
}

async function report(f: Fixture): Promise<string> {
  await f.command("status");
  return f.report();
}

const bigNote = `Large working state: ${"w".repeat(12000)}`;

test("Pi a smaller acting model dispatches zero provider calls when the note cannot fit", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote);
  await f.session.prompt("Present the note on the default model.");
  expect(texts(f.requests.at(-1)).join("\n")).toContain("Large working state");
  await selectModel(f, "small");
  const before = f.requests.length;
  await f.session.prompt("Continue on the small model.");
  expect(f.requests).toHaveLength(before);
  const aborted = f.session.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  expect(
    aborted?.type === "message" && aborted.message.role === "assistant"
      ? aborted.message.stopReason
      : "",
  ).toBe("error");
  const text = await report(f);
  expect(text).toContain(
    "Capacity stop: the current-work note does not fit the context window of tiered-fixture/small:",
  );
  expect(text).toMatch(
    /\d+ tokens required, including 500 of generation headroom, 3000 available/u,
  );
  expect(text).toContain(
    `The aborted response ${aborted?.id ?? ""} was stopped by tiered memory, not cancelled by the user.`,
  );
  expect(text).toContain(
    "Run /compact, or select a model with a larger context window, then retry.",
  );
});

test("Pi the capacity stop holds with native auto-compaction disabled and starts no retry", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote);
  await f.session.prompt("Present the note.");
  await selectModel(f, "small");
  const before = f.requests.length;
  const records = f.session.sessionManager.getBranch().length;
  await f.session.prompt("First stopped request.");
  await f.session.prompt("Second stopped request.");
  expect(f.settings.getCompactionEnabled()).toBe(false);
  expect(f.requests).toHaveLength(before);
  const added = f.session.sessionManager.getBranch().slice(records);
  expect(added.some((entry) => entry.type === "compaction")).toBe(false);
  expect(
    added.filter(
      (entry) => entry.type === "custom_message" && entry.customType === presentationMessageType,
    ),
  ).toEqual([]);
});

test("Pi optional index memory yields before the note in a request that cannot hold both", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, "Short working state.", { model: wideModel });
  const store = f.memory().runtime.memoryStorage(f.session.extensionRunner.createContext());
  const revision = store?.canonical.revision;
  if (revision === undefined) {
    throw new Error("Missing selected revision.");
  }
  f.memory().presentation.provideIndex(() => ({
    revision,
    sourceBoundary: {
      reference: store?.canonical.sourceBoundary?.reference ?? "",
      order: 0,
      role: "user",
    },
    body: `Index: ${"i".repeat(160000)}`,
  }));
  const before = f.requests.length;
  await f.session.prompt("Use the note without the index.");
  expect(f.requests).toHaveLength(before + 1);
  const payload = texts(f.requests.at(-1)).join("\n");
  expect(payload).toContain("Short working state.");
  expect(payload).not.toContain("Index: iii");
  expect(await report(f)).not.toContain("Capacity stop");
});

test("Pi requests routed to different physical limits are each checked against their model", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote);
  await selectModel(f, "wide");
  const before = f.requests.length;
  await f.session.prompt("Fits on the wide model.");
  expect(f.requests).toHaveLength(before + 1);
  await selectModel(f, "small");
  await f.session.prompt("Does not fit on the small model.");
  expect(f.requests).toHaveLength(before + 1);
  await selectModel(f, "wide");
  await f.session.prompt("Fits again.");
  expect(f.requests).toHaveLength(before + 2);
});

function virtualModel(declared: { contextWindow?: number; maxTokens?: number }) {
  return (pi: Parameters<NonNullable<FixtureOptions["extensions"]>[number]>[0]) => {
    pi.registerVirtualModel({
      provider: "probe",
      id: "auto",
      name: "Auto",
      ...declared,
      route: () => ({ model: smallModel, thinkingLevel: "off" }),
    });
  };
}

async function selectVirtual(f: Fixture): Promise<void> {
  const model = f.session.modelRuntime.getModel("probe", "auto");
  if (model === undefined) {
    throw new Error("Missing virtual model.");
  }
  await f.session.setModel(model);
}

test("Pi a virtual selection is checked against Pi's reported limits as an estimate", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote, {
    extensions: [virtualModel({ contextWindow: 3000, maxTokens: 500 })],
  });
  await selectVirtual(f);
  const before = f.requests.length;
  await f.session.prompt("Routed to the small model.");
  expect(f.requests).toHaveLength(before);
  const text = await report(f);
  expect(text).toContain(
    "Request capacity: 3000 tokens for probe/auto, from the virtual model's declared limits, estimated.",
  );
  expect(text).toMatch(
    /Capacity stop: the current-work note does not fit the context window of probe\/auto: \d+ estimated tokens required/u,
  );
});

test("Pi a virtual selection with unknown limits is not stopped and status says so", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote, { extensions: [virtualModel({})] });
  await selectVirtual(f);
  const before = f.requests.length;
  await f.session.prompt("Limits are unknown.");
  expect(f.requests).toHaveLength(before + 1);
  const text = await report(f);
  expect(text).toContain(
    "Request capacity: unknown for probe/auto because the virtual model declares no limits; requests are not stopped for capacity.",
  );
  expect(text).not.toContain("Capacity stop");
});

test("Pi a request without a presented note is never stopped for capacity", async ({
  createFixture,
}) => {
  const f = await createFixture({ services: {}, models: [smallModel] });
  await f.session.prompt(`Long history without memory: ${"h".repeat(16000)}`);
  await selectModel(f, "small");
  const before = f.requests.length;
  await f.session.prompt("No memory yet.");
  expect(f.requests).toHaveLength(before + 1);
  expect(await report(f)).not.toContain("Capacity stop");
});

test("Pi conversation overflow with a presented note dispatches zero provider calls", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, "Short working state.");
  await f.session.prompt(`Long history: ${"h".repeat(16000)}`);
  await selectModel(f, "small");
  const before = f.requests.length;
  await f.session.prompt("Continue on the small model.");
  expect(f.requests).toHaveLength(before);
  expect(await report(f)).toContain(
    "Capacity stop: the current-work note does not fit the context window of tiered-fixture/small:",
  );
});

const largeOutputModel = {
  ...fixtureModel,
  id: "large-output",
  name: "Large output",
  contextWindow: 34000,
  maxTokens: 32000,
};

test("Pi a large-output model is not stopped while the request fits below the window minus 16384", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote, { models: [largeOutputModel] });
  await selectModel(f, "large-output");
  const before = f.requests.length;
  // Reserving the full 32000-token maxTokens beside the 3000-token note would exceed 34000.
  await f.session.prompt("A 3000-token note fits under 34000 - 16384 tokens.");
  expect(f.requests).toHaveLength(before + 1);
  expect(await report(f)).not.toContain("Capacity stop");
});

test("Pi a virtual selection uses the model of its latest routed response after the first", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote, {
    extensions: [virtualModel({ contextWindow: 100000, maxTokens: 500 })],
  });
  await selectVirtual(f);
  const before = f.requests.length;
  await f.session.prompt("Declared limits admit this request.");
  expect(f.requests).toHaveLength(before + 1);
  expect(f.requests.at(-1)?.model).toBe("tiered-fixture/small");
  await f.session.prompt("The routed small model's limits stop this one.");
  expect(f.requests).toHaveLength(before + 1);
  expect(await report(f)).toContain(
    "Request capacity: 3000 tokens for probe/auto, from the virtual model's latest response model, estimated.",
  );
});

const mediumModel = {
  ...fixtureModel,
  id: "medium",
  name: "Medium",
  contextWindow: 5000,
  maxTokens: 500,
};

async function commitOn(f: Fixture, body: string, sourceText: string): Promise<void> {
  await f.reload();
  const { runtime } = f.memory();
  const ctx = f.session.extensionRunner.createContext();
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": body }), [
    await sourceReference(f, sourceText),
  ]);
  committedId(await runtime.commitProposal(ctx, proposal));
}

test("Pi a superseded note copy yields before the capacity stop so the current note dispatches", async ({
  createFixture,
}) => {
  const f = await createFixture({
    services: {},
    models: [mediumModel],
    personal: { limits: { presentationTokens: 100000 } },
  });
  await f.session.prompt("Remember the setting.");
  await commitOn(f, `Note A: ${"a".repeat(8000)}`, "Remember the setting.");
  await f.session.prompt("Present note A.");
  await commitOn(f, `Note B: ${"b".repeat(8000)}`, "Present note A.");
  await selectModel(f, "medium");
  const before = f.requests.length;
  await f.session.prompt("Continue on the medium model.");
  expect(f.requests).toHaveLength(before + 1);
  const payload = texts(f.requests.at(-1)).join("\n");
  expect(payload).toContain("Note B: bbb");
  expect(payload).not.toContain("Note A: aaa");
  expect(await report(f)).not.toContain("Capacity stop");
});

function lastAssistant(f: Fixture) {
  return f.session.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
}

test("Pi a capacity stop notifies a warning and persists the stop line before the aborted response", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote);
  await f.session.prompt("Present the note on the default model.");
  await selectModel(f, "small");
  const before = f.requests.length;
  await f.session.prompt("Continue on the small model.");
  expect(f.requests).toHaveLength(before);
  const warning = f.notifications.findLast((notification) => notification.type === "warning");
  expect(warning?.message).toMatch(
    /^Capacity stop: the current-work note does not fit the context window of tiered-fixture\/small: \d+ tokens required, including 500 of generation headroom, 3000 available\. The request was stopped before dispatch\. Run \/compact, or select a model with a larger context window, then retry\.$/u,
  );
  expect(f.report()).toBe(warning?.message);
  const branch = f.session.sessionManager.getBranch();
  const reportIndex = branch.findLastIndex(
    (entry) => entry.type === "custom" && entry.customType === "orbis-tiered-memory-report",
  );
  const aborted = lastAssistant(f);
  expect(reportIndex).toBeGreaterThan(-1);
  expect(branch.findIndex((entry) => entry.id === aborted?.id)).toBeGreaterThan(reportIndex);
});

test("Pi a note that exceeds a lowered presentation budget stops each request without a reset", async ({
  createFixture,
}) => {
  const f = await createFixture({
    services: {},
    personal: { limits: { workNoteTokens: 2048 } },
  });
  await f.session.prompt("Remember the setting.");
  await commitOn(f, `Large working state: ${"w".repeat(8000)}`, "Remember the setting.");
  await f.session.prompt("Present the note.");
  await writeFile(
    join(f.agentDir, "tiered-memory.json"),
    JSON.stringify({
      limits: { workNoteTokens: 256, indexTokens: 128, presentationTokens: 1152 },
    }),
  );
  await f.reload();
  const before = f.requests.length;
  const records = f.session.sessionManager.getBranch().length;
  await f.session.prompt("First stopped request.");
  await f.session.prompt("Second stopped request.");
  expect(f.requests).toHaveLength(before);
  const added = f.session.sessionManager.getBranch().slice(records);
  expect(
    added.filter(
      (entry) => entry.type === "custom_message" && entry.customType === presentationMessageType,
    ),
  ).toEqual([]);
  const stopLine = (await report(f)).split("\n").find((line) => line.startsWith("Capacity stop:"));
  expect(stopLine).toMatch(
    /^Capacity stop: the complete presentation baseline exceeds limits\.presentationTokens: (\d+) estimated tokens required, 1152 allowed\. The aborted response \S+ was stopped by tiered memory, not cancelled by the user\. Set limits\.presentationTokens to at least \1, then retry\. To restore the earlier limits\.workNoteTokens instead, also set limits\.presentationTokens to at least that limits\.workNoteTokens plus limits\.indexTokens plus 768\.$/u,
  );
  expect(
    f.notifications.filter(
      (notification) =>
        notification.type === "warning" && notification.message.startsWith("Capacity stop:"),
    ),
  ).toHaveLength(2);
});

test("Pi a capacity stop is not attributed to an aborted response on another branch", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, bigNote);
  await f.session.prompt("Present the note.");
  const fork = sourceEntry(f, "Present the note.").id;
  await selectModel(f, "small");
  await f.session.prompt("Stopped on the small model.");
  await f.session.navigateTree(fork, { summarize: false });
  f.session.sessionManager.appendMessage({
    role: "user",
    content: "Cancelled by the user.",
    timestamp: Date.now(),
  });
  f.session.sessionManager.appendMessage(fixtureMessage("", "aborted"));
  const aborted = lastAssistant(f);
  const text = await report(f);
  expect(text).toContain("Capacity stop:");
  expect(text).toContain("The request was stopped before dispatch.");
  expect(text).not.toContain(`The aborted response ${aborted?.id ?? ""}`);
});

test("requestLimits skips a response that a context edit omitted or replaced", () => {
  const routed = {
    large: { contextWindow: 64000, maxTokens: 4000 },
    medium: { contextWindow: 5000, maxTokens: 500 },
  };
  const ctx = (branch: Record<string, unknown>[]): LimitsContext => {
    const context = {
      model: {
        ...fixtureModel,
        api: "pi-virtual",
        provider: "probe",
        id: "auto",
        contextWindow: 3000,
        maxTokens: 300,
      },
      modelRegistry: {
        find: (_provider: string, id: string) =>
          id === "large" || id === "medium" ? { ...fixtureModel, ...routed[id] } : undefined,
      },
      sessionManager: { getBranch: () => chained(branch) },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test supplies only the members requestLimits reads.
    return context as unknown as LimitsContext;
  };
  const responses = [
    { type: "model_change" },
    { id: "r1", ...response("stop", "large") },
    { id: "r2", ...response("stop", "medium") },
  ];
  expect(
    requestLimits(ctx([...responses, { type: "context_edit", targetId: "r2", replacement: null }])),
  ).toMatchObject({
    source: "virtual-response",
    contextWindow: 64000,
  });
  expect(
    requestLimits(
      ctx([
        ...responses,
        { type: "context_edit", targetId: "r2", replacement: { content: "Replaced." } },
      ]),
    ),
  ).toMatchObject({ source: "virtual-response", contextWindow: 64000 });
  expect(
    requestLimits(
      ctx([
        ...responses,
        { type: "context_edit", targetId: "r1", replacement: null },
        { type: "context_edit", targetId: "r2", replacement: null },
      ]),
    ),
  ).toEqual({
    kind: "known",
    source: "virtual-declared",
    modelId: "probe/auto",
    contextWindow: 3000,
    maxTokens: 300,
  });
});

test("Pi a virtual selection's estimate skips routed responses that context edits omitted", async ({
  createFixture,
}) => {
  const routes = [wideModel, mediumModel, wideModel, mediumModel];
  let routed = 0;
  const f = await noteFixture(createFixture, "Short working state.", {
    models: [smallModel, wideModel, mediumModel],
    extensions: [
      (pi) => {
        pi.registerVirtualModel({
          provider: "probe",
          id: "auto",
          name: "Auto",
          contextWindow: 100000,
          maxTokens: 500,
          route: () => ({ model: routes[routed++] ?? wideModel, thinkingLevel: "off" }),
        });
      },
    ],
  });
  await selectVirtual(f);
  await f.session.prompt("Routed to the wide model.");
  await f.session.prompt("Routed to the medium model.");
  expect(f.requests.slice(-2).map((request) => request.model)).toEqual([
    "tiered-fixture/wide",
    "tiered-fixture/medium",
  ]);
  const manager = f.session.sessionManager;
  const latest = lastAssistant(f);
  if (latest === undefined) {
    throw new Error("Missing the medium model's response.");
  }
  manager.appendContextEdit(latest.id, null);
  await f.session.prompt("Estimated from the wide model.");
  expect(await report(f)).toContain(
    "Request capacity: 40000 tokens for probe/auto, from the virtual model's latest response model, estimated.",
  );
  const selectedAt = manager.getBranch().findLastIndex((entry) => entry.type === "model_change");
  for (const entry of manager.getBranch().slice(selectedAt + 1)) {
    if (entry.type === "message" && entry.message.role === "assistant" && entry.id !== latest.id) {
      manager.appendContextEdit(entry.id, null);
    }
  }
  await f.session.prompt("Estimated from the declared limits.");
  expect(await report(f)).toContain(
    "Request capacity: 100000 tokens for probe/auto, from the virtual model's declared limits, estimated.",
  );
});

test("Pi a reset carrying the note and an index dispatches with only its note when the index cannot fit", async ({
  createFixture,
}) => {
  const f = await noteFixture(createFixture, "Short working state.");
  const store = f.memory().runtime.memoryStorage(f.session.extensionRunner.createContext());
  const revision = store?.canonical.revision;
  const reference = store?.canonical.sourceBoundary?.reference;
  if (revision === undefined || reference === undefined) {
    throw new Error("Missing selected revision.");
  }
  let index = "Index 1";
  f.memory().presentation.provideIndex(() => ({
    revision,
    sourceBoundary: { reference, order: 0, role: "user" },
    body: `${index}: ${"i".repeat(160000)}`,
  }));
  await f.session.prompt("Present the first index.");
  index = "Index 2";
  await f.session.prompt("Present the second index.");
  expect(branchResets(f)).toEqual([]);
  index = "Index 3";
  const before = f.requests.length;
  await f.session.prompt("Reset with the third index.");
  expect(f.requests).toHaveLength(before + 1);
  const payload = texts(f.requests.at(-1)).join("\n");
  expect(payload).toContain("Short working state.");
  expect(payload).not.toContain("Index 3: iii");
  expect(payload).toContain("[Tiered memory: presentation reset]");
  expect(branchResets(f)).toEqual([["work-note", "index"]]);
  expect(await report(f)).not.toContain("Capacity stop");
});

function branchResets(f: Fixture): string[][] {
  return f.session.sessionManager.getBranch().flatMap((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return [];
    }
    const details: unknown = entry.details;
    const parsed = Type.Object({
      kind: Type.Literal("reset"),
      components: Type.Array(Type.Object({ component: Type.String() })),
    });
    return Value.Check(parsed, details)
      ? [details.components.map((component) => component.component)]
      : [];
  });
}

test.for(["minimum", "restored"] as const)(
  "Pi the advertised %s presentation-budget recovery produces valid settings under which the note dispatches",
  async (recovery, { createFixture }) => {
    const lowered = { workNoteTokens: 256, indexTokens: 128, presentationTokens: 1152 };
    const f = await createFixture({
      services: {},
      personal: { limits: { workNoteTokens: 2048 } },
    });
    await f.session.prompt("Remember the setting.");
    await commitOn(f, `Large working state: ${"w".repeat(8000)}`, "Remember the setting.");
    await writeFile(join(f.agentDir, "tiered-memory.json"), JSON.stringify({ limits: lowered }));
    await f.reload();
    await f.session.prompt("Stopped request.");
    const line = (await report(f)).split("\n").find((text) => text.startsWith("Capacity stop:"));
    const minimum = Number(
      /Set limits\.presentationTokens to at least (\d+),/u.exec(line ?? "")?.[1],
    );
    expect(minimum).toBeGreaterThan(lowered.presentationTokens);
    const applied =
      recovery === "minimum"
        ? { ...lowered, presentationTokens: minimum }
        : { ...lowered, workNoteTokens: 2048, presentationTokens: 2048 + 128 + 768 };
    await writeFile(join(f.agentDir, "tiered-memory.json"), JSON.stringify({ limits: applied }));
    await f.reload();
    expect(f.memory().runtime.snapshot).toMatchObject({
      error: undefined,
      configuration: { settings: { limits: applied } },
    });
    const before = f.requests.length;
    await f.session.prompt("Dispatched after recovery.");
    expect(f.requests).toHaveLength(before + 1);
    expect(texts(f.requests.at(-1)).join("\n")).toContain("Large working state: www");
  },
);

test("Pi only the newest boundary record of an unchanged note is mandatory, so a window that holds the note once older boundary records yield dispatches without a stop", async ({
  createFixture,
}) => {
  const tight = {
    ...fixtureModel,
    id: "tight",
    name: "Tight",
    contextWindow: 100000,
    maxTokens: 500,
  };
  const observer = new ScriptedObserver();
  const seen: ContextWithSystemEvent["messages"][] = [];
  const f = await workerFixture(createFixture, observer, {
    models: [tight],
    personal: { limits: { presentationTokens: 100000 } },
    extensions: [
      (pi) => {
        pi.on("context_with_system", (event) => {
          seen.push([...event.messages]);
        });
      },
    ],
  });
  await f.session.prompt("Remember the setting.");
  const first = await observer.next();
  first.reply(noteReply(`Working state: ${"w".repeat(4000)}`, first.call));
  await f.memory().work.idle();
  observer.respond(() => observerReply({ observations: [], workNote: { status: "unchanged" } }));
  for (const step of ["Advance 1.", "Advance 2.", "Advance 3.", "Advance 4.", "Advance 5."]) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn's commit advances the next boundary.
    await f.session.prompt(step);
    // oxlint-disable-next-line no-await-in-loop -- The next request presents this commit's boundary.
    await f.memory().work.idle();
  }
  await f.session.prompt("Present the newest boundary.");
  await f.memory().work.idle();
  const boundaries = branchKinds(f).filter((kind) => kind === "boundary");
  expect(boundaries.length).toBeGreaterThanOrEqual(4);
  const messages = seen.at(-1) ?? [];
  const boundaryTokens = messages.flatMap((message) =>
    message.role === "custom" && JSON.stringify(message.details).includes('"kind":"boundary"')
      ? [estimateTokens(message)]
      : [],
  );
  const older = boundaryTokens.slice(0, -1).reduce((total, tokens) => total + tokens, 0);
  const total = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
  const model = f.session.modelRuntime.getModel(fixtureModel.provider, "tight");
  if (model === undefined) {
    throw new Error("Missing tight model.");
  }
  model.contextWindow = total + tight.maxTokens - Math.floor(older / 2);
  await f.session.setModel(model);
  const before = f.requests.length;
  await f.session.prompt("Continue on the tight model.");
  expect(f.requests).toHaveLength(before + 1);
  expect(texts(f.requests.at(-1)).join("\n")).toContain("Working state: www");
  expect(await report(f)).not.toContain("Capacity stop");
  expect(await report(f)).toContain(
    `Request capacity: ${String(model.contextWindow)} tokens for tiered-fixture/tight, from the selected model.`,
  );
});

function branchKinds(f: Fixture): string[] {
  return f.session.sessionManager.getBranch().flatMap((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== presentationMessageType) {
      return [];
    }
    const details: unknown = entry.details;
    return Value.Check(Type.Object({ kind: Type.String() }), details) ? [details.kind] : [];
  });
}
