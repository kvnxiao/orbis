import { Socket } from "node:net";

import { expect, test } from "vitest";

import { parseSettings } from "../src/settings.ts";

test.for(
  [
    { enabled: "yes" },
    { observerModel: "no-provider" },
    { limits: { workerInputTokens: -1 } },
    { limits: { workerInputTokens: 1.5 } },
    { limits: { queuedJobs: 0 } },
    { limits: { workerOutputTokens: Number.POSITIVE_INFINITY } },
    { limits: { toString: 1 } },
    { unexpected: true },
  ].map((value) => ({ value })),
)("rejects malformed settings %#", ({ value }) => {
  expect(() => parseSettings(value, "fixture")).toThrow("fixture");
});

test("accepts provider model identifiers with nested model IDs and zero retries", () => {
  expect(
    parseSettings(
      { observerModel: "openrouter/anthropic/claude", limits: { retries: 0 } },
      "fixture",
    ),
  ).toEqual({ observerModel: "openrouter/anthropic/claude", limits: { retries: 0 } });
});

test("fixture blocks external fetch and socket connections before dispatch", async () => {
  await expect(fetch("https://example.com")).rejects.toThrow(
    "External network connections are disabled",
  );
  expect(() => new Socket().connect(443, "example.com")).toThrow(
    "External network connections are disabled",
  );
});
