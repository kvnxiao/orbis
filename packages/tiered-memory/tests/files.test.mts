import { mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { expect } from "vitest";

import { fromPromise, readText, writeDurable } from "../src/storage/files.ts";
import type { DurableWriteIo } from "../src/storage/files.ts";
import { interruptedOnly } from "./storage-harness.mts";
import { test } from "./store-fixture.mts";

function recordingIo(calls: string[], fail: { step?: string; error?: Error } = {}): DurableWriteIo {
  const failAt = (step: string): void => {
    calls.push(step);
    if (fail.step === step && fail.error !== undefined) {
      throw fail.error;
    }
  };
  return {
    async mkdir(path, options) {
      failAt("mkdir");
      return await mkdir(path, options);
    },
    async open(path, flags) {
      failAt(`open ${flags}`);
      const handle = await open(path, flags);
      return {
        async writeFile(data) {
          failAt("write");
          await handle.writeFile(data);
        },
        async sync() {
          failAt(`sync ${flags}`);
          await handle.sync();
        },
        async close() {
          calls.push(`close ${flags}`);
          await handle.close();
        },
      };
    },
    async rename(from, to) {
      failAt("rename");
      await rename(from, to);
    },
  };
}

test("writeDurable replaces the file with the new bytes and creates missing parents", async ({
  makeRoot,
}) => {
  const directory = join(await makeRoot(), "a", "b");
  const path = join(directory, "record.json");
  await writeDurable(path, "one");
  await writeDurable(path, "two");
  expect(await readFile(path, "utf8")).toBe("two");
  expect(await readdir(directory)).toEqual(["record.json"]);
});

test("writeDurable opens the temporary file with wx, fsyncs it, renames it, then fsyncs the directory", async ({
  makeRoot,
}) => {
  const calls: string[] = [];
  await writeDurable(join(await makeRoot(), "record.json"), "one", recordingIo(calls));
  const directorySync = process.platform === "win32" ? [] : ["open r", "sync r", "close r"];
  expect(calls).toEqual([
    "mkdir",
    "open wx",
    "write",
    "sync wx",
    "close wx",
    "rename",
    ...directorySync,
  ]);
});

test("writeDurable leaves the previous bytes when rename fails and rethrows that error", async ({
  makeRoot,
}) => {
  const path = join(await makeRoot(), "record.json");
  await writeFile(path, "previous");
  const failure = Object.assign(new Error("cross-device rename"), { code: "EXDEV" });
  await expect(
    writeDurable(path, "next", recordingIo([], { step: "rename", error: failure })),
  ).rejects.toBe(failure);
  expect(await readFile(path, "utf8")).toBe("previous");
});

test("writeDurable leaves the previous bytes when the temporary fsync fails", async ({
  makeRoot,
}) => {
  const path = join(await makeRoot(), "record.json");
  await writeFile(path, "previous");
  const failure = Object.assign(new Error("device error"), { code: "EIO" });
  await expect(
    writeDurable(path, "next", recordingIo([], { step: "sync wx", error: failure })),
  ).rejects.toBe(failure);
  expect(await readFile(path, "utf8")).toBe("previous");
});

test("an interrupted readText ends interrupted without a failure from its aborted read", async ({
  makeRoot,
}) => {
  const path = join(await makeRoot(), "record.json");
  await writeFile(path, "x".repeat(1_000_000));
  const fiber = Effect.runFork(readText(path));
  fiber.interruptUnsafe();
  expect(await interruptedOnly(fiber)).toBe(true);
});

test("an interrupted Promise operation whose promise rejects with AbortError reports no failure", async () => {
  const rejected = Promise.withResolvers<unknown>();
  const fiber = Effect.runFork(
    fromPromise(
      async (signal) =>
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new DOMException("The operation was aborted.", "AbortError");
            rejected.resolve(error);
            reject(error);
          });
        }),
    ),
  );
  fiber.interruptUnsafe();
  expect(await interruptedOnly(fiber)).toBe(true);
  expect(await rejected.promise).toBeInstanceOf(DOMException);
});
