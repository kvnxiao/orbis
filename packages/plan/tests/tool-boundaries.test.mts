import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { expect, test } from "vitest";

import extension from "../src/index.ts";
import { planningInstructions } from "../src/pi/instructions.ts";
import { toolResult } from "../src/pi/tool-result.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

async function fixture() {
  const f = await runtimeFixture();
  const registered = new Map<string, Pick<ToolDefinition, "execute" | "parameters">>();
  extension({
    ...f.api,
    registerTool(tool) {
      registered.set(tool.name, tool);
    },
  });
  return {
    ...f,
    tool(name: string) {
      const tool = registered.get(name);
      if (tool === undefined) {
        throw new Error(`Missing tool ${name}`);
      }
      return tool;
    },
  };
}

test.each([false, true])(
  "cancelled tools explain explicit resume without active planning instructions: %s",
  async (includeInstructions) => {
    const result = await toolResult(
      { outcome: "cancelled", planId: "saved-plan" },
      includeInstructions ? planningInstructions : undefined,
    );
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(text).not.toContain("Planning is active");
    expect(text).toContain("saved unfinished work remains resumable");
    expect(text).toContain("plan_open");
    expect(text).toContain("replace: false");
    expect(text).toContain("explicitly asks to resume");
    expect(result.details).toEqual({ outcome: "cancelled", planId: "saved-plan" });
  },
);

test("registered retirement values use a provider string enum", async ({ onTestFinished }) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const schema = f.tool("plan_round").parameters;
  expect(schema).toMatchObject({
    properties: {
      retire: {
        items: {
          properties: {
            status: { type: "string", enum: ["withdrawn", "deferred"] },
          },
        },
      },
    },
  });
  expect(
    Value.Check(schema, {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: [],
      retire: [{ id: "question", status: "unknown", reason: "Invalid" }],
    }),
  ).toBe(false);
});

test.for(["rpc", "json", "print"] as const)(
  "registered tools reject interactive work in %s mode",
  async (mode, { onTestFinished }) => {
    const f = await fixture();
    onTestFinished(f.dispose);
    await Promise.all(
      ["plan_open", "plan_round", "plan_review"].map(async (name) => {
        const result = await f
          .tool(name)
          .execute("unsupported", {}, undefined, undefined, { ...f.ctx, mode });
        expect(result.details).toMatchObject({ outcome: "unsupported-mode" });
      }),
    );
  },
);

test("cancelled replacement confirmation preserves the active objective", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const start = f.tool("plan_open");
  await start.execute("first", { objective: "First" }, undefined, undefined, f.ctx);
  const confirmation = Promise.withResolvers<boolean>();
  const opened = Promise.withResolvers<undefined>();
  const controller = new AbortController();
  let dialogSignal: AbortSignal | undefined;
  const pending = start.execute(
    "replacement",
    { objective: "Second", replace: true, requestId: "replace-second" },
    controller.signal,
    undefined,
    {
      ...f.ctx,
      ui: {
        ...f.ctx.ui,
        async confirm(_title, _message, options) {
          dialogSignal = options?.signal;
          opened.resolve(undefined);
          return await confirmation.promise;
        },
      },
    },
  );
  await opened.promise;
  controller.abort();
  confirmation.resolve(true);
  expect((await pending).details).toMatchObject({ outcome: "cancelled" });
  expect(dialogSignal?.aborted).toBe(true);
  const current = await start.execute("inspect", {}, undefined, undefined, f.ctx);
  expect(current.details).toMatchObject({ outcome: "active", plan: { objective: "First" } });
});

test.each(["plan_round", "plan_review"])("%s rejects a mismatched plan identity", async (name) => {
  const f = await fixture();
  try {
    await expect(
      f.tool(name).execute(
        "invalid",
        {
          planId: "missing",
          expectedRevision: 0,
          markdown: "# Plan",
          roundId: "round",
          questions: [],
        },
        undefined,
        undefined,
        f.ctx,
      ),
    ).rejects.toThrow(/plan/);
  } finally {
    await f.dispose();
  }
});

test("oversized tool results return a bounded preview and retrievable full JSON", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const objective = "é".repeat(60_000);
  const result = await f
    .tool("plan_open")
    .execute("large", { objective }, undefined, undefined, f.ctx);
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  const details = result.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !("resultPath" in details) ||
    typeof details.resultPath !== "string"
  ) {
    throw new Error("Missing full-result retrieval path");
  }
  const path = details.resultPath;
  onTestFinished(async () => {
    await rm(dirname(path), { recursive: true, force: true });
  });
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  expect(text.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
  expect(Buffer.byteLength(JSON.stringify(details))).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  expect(text).toContain(path);
  const saved: unknown = JSON.parse(await readFile(path, "utf8"));
  expect(saved).toMatchObject({ outcome: "started", plan: { objective } });
});

test("entry registration exposes plan_open and rejects replacement without a request identity", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  expect(() => f.tool("plan_start")).toThrow("Missing tool");
  await expect(
    f
      .tool("plan_open")
      .execute("missing-id", { objective: "Replace", replace: true }, undefined, undefined, f.ctx),
  ).rejects.toThrow("stable requestId");
  expect(Value.Check(f.tool("plan_open").parameters, { replace: true, requestId: " " })).toBe(
    false,
  );
  expect(Value.Check(f.tool("plan_open").parameters, { replace: true, requestId: 42 })).toBe(false);
});
