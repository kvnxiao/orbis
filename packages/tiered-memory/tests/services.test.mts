import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { expect } from "vitest";

import { DurableWrites, ProcessLiveness } from "../src/storage/services.ts";
import { interruptedOnly } from "./storage-harness.mts";
import { test } from "./store-fixture.mts";

test("DurableWrites.live finishes a write whose caller is interrupted before the interrupted exit", async ({
  makeRoot,
}) => {
  const path = join(await makeRoot(), "nested", "record.json");
  const fiber = Effect.runFork(DurableWrites.live.write(path, "durable\n"));
  fiber.interruptUnsafe();
  expect(await interruptedOnly(fiber)).toBe(true);
  expect(await readFile(path, "utf8")).toBe("durable\n");
});

test("ProcessLiveness.live reports the current process as running and an exited process as not running", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const exited = once(child, "exit");
  const pid = child.pid;
  await exited;
  if (pid === undefined) {
    throw new Error("Missing child process id.");
  }
  expect(ProcessLiveness.live.isRunning(process.pid)).toBe(true);
  expect(ProcessLiveness.live.isRunning(pid)).toBe(false);
});
