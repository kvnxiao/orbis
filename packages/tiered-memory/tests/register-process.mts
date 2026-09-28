import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { DurableWrites, LockFilesystem, ProcessLiveness } from "../src/storage/services.ts";
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
const contention = { armed: false, announced: false, reads: new Map<string, number>() };
const live = LockFilesystem.live;
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    Layer.succeed(DurableWrites, DurableWrites.live),
    Layer.succeed(ProcessLiveness, ProcessLiveness.live),
    Layer.succeed(LockFilesystem, {
      ...live,
      readTicket: (path) =>
        live.readTicket(path).pipe(
          Effect.tap((text) =>
            Effect.sync(() => {
              if (!contention.armed || contention.announced || text === undefined) {
                return;
              }
              const reads = (contention.reads.get(path) ?? 0) + 1;
              contention.reads.set(path, reads);
              if (reads === 2) {
                contention.announced = true;
                stdout.write("waiting\n");
              }
            }),
          ),
        ),
    }),
  ),
);
const root = await runtime.runPromise(canonicalProjectRoot(input.cwd));
const store = await runtime.runPromise(MemoryStore.open(root, input.sessionId));
const registry = await runtime.runPromise(SourceRegistry.open(store));
stdout.write("ready\n");
await once(stdin, "data");
contention.armed = true;
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
