import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { liveStorage } from "../src/storage/services.ts";
import { SourceRegistry } from "../src/storage/sources.ts";
import { canonicalProjectRoot, MemoryStore } from "../src/storage/store.ts";

/** Describe the session a child registration process registers from. */
export interface RegisterProcessInput {
  cwd: string;
  sessionId: string;
  sessionFile: string | undefined;
  header: SessionHeader | null;
  branch: SessionEntry[];
}

const [inputPath] = process.argv.slice(2);
if (inputPath === undefined) {
  throw new Error("Missing registration input path.");
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The parent test writes this file from a live session.
const input = JSON.parse(await readFile(inputPath, "utf8")) as RegisterProcessInput;
const runtime = ManagedRuntime.make(liveStorage);
const root = await runtime.runPromise(canonicalProjectRoot(input.cwd));
const store = await runtime.runPromise(MemoryStore.open(root, input.sessionId));
const registry = await runtime.runPromise(SourceRegistry.open(store));
stdout.write("ready\n");
await once(stdin, "data");
await runtime.runPromise(
  registry.register({
    getSessionId: () => input.sessionId,
    getSessionFile: () => input.sessionFile,
    getHeader: () => input.header,
    getBranch: () => input.branch,
  }),
);
stdout.write("registered\n");
stdin.destroy();
await runtime.dispose();
