import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import extension from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.mts";

async function fixture() {
  const f = await runtimeFixture();
  const registered = new Map<string, Pick<ToolDefinition, "execute">>();
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

test("cancelled replacement confirmation preserves the active objective", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(f.dispose);
  const start = f.tool("plan_start");
  await start.execute("first", { objective: "First" }, undefined, undefined, f.ctx);
  const confirmation = Promise.withResolvers<boolean>();
  const opened = Promise.withResolvers<undefined>();
  const controller = new AbortController();
  let dialogSignal: AbortSignal | undefined;
  const pending = start.execute(
    "replacement",
    { objective: "Second", replace: true },
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
    .tool("plan_start")
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
