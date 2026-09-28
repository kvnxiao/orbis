import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { test as base, expect } from "vitest";

import { Execution } from "../src/pi/execution.ts";
import { recoverFailure } from "../src/storage/files.ts";
import { DurableWrites } from "../src/storage/services.ts";
import { openScope, testServices } from "./storage-harness.mts";
import type { TestServices } from "./storage-harness.mts";

const test = base.extend("createExecution", ({ onTestFinished }) => {
  const created: Execution[] = [];
  onTestFinished(async () => {
    await Promise.all(
      created.map(async (execution) => {
        await execution.shutdown(new Error("Test finished."));
      }),
    );
  });
  return (services: TestServices = {}): Execution => {
    const execution = new Execution(testServices(services));
    created.push(execution);
    return execution;
  };
});

async function drain(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn lets the previous turn's continuations run.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function waitFor(gate: Promise<unknown>): Effect.Effect<void> {
  return Effect.promise(async () => {
    await gate;
  });
}

function signal(entered: PromiseWithResolvers<undefined>): Effect.Effect<void> {
  return Effect.sync(() => {
    entered.resolve(undefined);
  });
}

const never = Effect.promise(async () => await new Promise<never>(() => undefined));

function enteredThenNever(entered: PromiseWithResolvers<undefined>): Effect.Effect<never> {
  return signal(entered).pipe(Effect.andThen(never));
}

function settled(promise: Promise<unknown>): { value: boolean } {
  const state = { value: false };
  promise.then(
    () => {
      state.value = true;
    },
    () => {
      state.value = true;
    },
  );
  return state;
}

test("overlapping replacements share one storage close and open the next scope after it", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const log: string[] = [];
  const first = execution.run(
    execution.runBranchStep(
      execution.openStorage(() =>
        Effect.uninterruptible(
          signal(entered).pipe(
            Effect.andThen(waitFor(gate.promise)),
            Effect.andThen(Effect.sync(() => log.push("first write settled"))),
          ),
        ),
      ),
    ),
  );
  await entered.promise;
  execution.replace(new Error("first replacement"));
  execution.replace(new Error("second replacement"));
  const second = execution.run(
    execution.runBranchStep(
      execution.openStorage(() => Effect.sync(() => log.push("next opened"))),
    ),
  );
  await drain();
  expect(log).toEqual([]);
  gate.resolve(undefined);
  await Promise.all([first, second]);
  expect(log).toEqual(["first write settled", "next opened"]);
});

test("shutdown completes while a settings load and a role check stay pending on unresolved promises", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const loading = Promise.withResolvers<undefined>();
  const checking = Promise.withResolvers<undefined>();
  execution.startSettingsLoad(enteredThenNever(loading));
  const roles = execution.run(execution.runRoleWork(enteredThenNever(checking)));
  await Promise.all([loading.promise, checking.promise]);
  await execution.shutdown(new Error("session ended"));
  await expect(roles).resolves.toBeUndefined();
});

test("shutdown waits for a job's uninterruptible durable write before it disposes the runtime", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const reason = new Error("session ended");
  const job = execution.runJob(storage, undefined, () =>
    Effect.uninterruptible(signal(entered).pipe(Effect.andThen(waitFor(gate.promise)))),
  );
  await entered.promise;
  const shutdown = execution.shutdown(reason);
  const stopped = settled(shutdown);
  await drain();
  expect(stopped.value).toBe(false);
  gate.resolve(undefined);
  await shutdown;
  expect(await job).toEqual({ kind: "cancelled", reason, outcome: undefined });
});

test("shutdown during a replacement interrupts its branch step, waits only for the old scope's close, and rejects a later replacement", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const first = execution.run(
    execution.runBranchStep(
      execution.openStorage(() =>
        Effect.uninterruptible(signal(entered).pipe(Effect.andThen(waitFor(gate.promise)))),
      ),
    ),
  );
  await entered.promise;
  execution.replace(new Error("replacement"));
  let replacementOpened = false;
  const replacement = execution.run(
    execution.runBranchStep(
      execution.openStorage(() =>
        Effect.sync(() => {
          replacementOpened = true;
        }),
      ),
    ),
  );
  const shutdown = execution.shutdown(new Error("session ended"));
  await expect(replacement).resolves.toBeUndefined();
  expect(() => {
    execution.replace(new Error("late replacement"));
  }).toThrow("shut down");
  const stopped = settled(shutdown);
  await drain();
  expect(stopped.value).toBe(false);
  gate.resolve(undefined);
  await Promise.all([shutdown, first]);
  expect(replacementOpened).toBe(false);
});

const orders = [
  ["host abort", "disable"],
  ["disable", "host abort"],
  ["host abort", "shutdown"],
  ["shutdown", "host abort"],
] as const;

test.for(orders)(
  "a job cancelled by %s and then by %s reports the first reason",
  async ([first, second], { createExecution }) => {
    const execution = createExecution();
    const storage = await openScope(execution);
    const controller = new AbortController();
    const reasons = {
      "host abort": new Error("host abort"),
      disable: new Error("disable"),
      shutdown: new Error("shutdown"),
    };
    const cancel = {
      "host abort": () => {
        controller.abort(reasons["host abort"]);
      },
      disable: () => {
        execution.cancelActiveWork(reasons.disable);
      },
      shutdown: () => {
        void execution.shutdown(reasons.shutdown).catch(() => undefined);
      },
    };
    const entered = Promise.withResolvers<undefined>();
    const job = execution.runJob(storage, controller.signal, () => enteredThenNever(entered));
    await entered.promise;
    cancel[first]();
    cancel[second]();
    expect(await job).toEqual({ kind: "cancelled", reason: reasons[first], outcome: undefined });
  },
);

test("a pre-aborted host signal resolves cancelled with its reason and starts no job", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const controller = new AbortController();
  const reason = new Error("aborted before the call");
  controller.abort(reason);
  let started = false;
  expect(
    await execution.runJob(storage, controller.signal, () =>
      Effect.sync(() => {
        started = true;
      }),
    ),
  ).toEqual({ kind: "cancelled", reason, outcome: undefined });
  expect(started).toBe(false);
});

test("an interrupted job that recorded its outcome reports that outcome after its cleanup finished", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const entered = Promise.withResolvers<undefined>();
  const cleanup = Promise.withResolvers<undefined>();
  const reason = new Error("disabled");
  const job = execution.runJob<never, string>(storage, undefined, (record) =>
    Effect.sync(() => {
      record("durable");
    }).pipe(Effect.andThen(enteredThenNever(entered)), Effect.ensuring(waitFor(cleanup.promise))),
  );
  await entered.promise;
  execution.cancelActiveWork(reason);
  const ended = settled(job);
  await drain();
  expect(ended.value).toBe(false);
  cleanup.resolve(undefined);
  expect(await job).toEqual({ kind: "cancelled", reason, outcome: "durable" });
});

function failingWrite(failure: Error): {
  services: TestServices;
  entered: Promise<undefined>;
  release: () => void;
} {
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  return {
    services: {
      write: async () => {
        entered.resolve(undefined);
        await gate.promise;
        throw failure;
      },
    },
    entered: entered.promise,
    release: () => {
      gate.resolve(undefined);
    },
  };
}

const durableWrite = DurableWrites.use((writes) => writes.write("unused", "contents"));

test("a durable write failure that races a disable rejects the job with the original error", async ({
  createExecution,
}) => {
  const failure = Object.assign(new Error("ENOSPC: no space left on device, write"), {
    code: "ENOSPC",
  });
  const write = failingWrite(failure);
  const execution = createExecution(write.services);
  const storage = await openScope(execution);
  const job = execution.runJob(storage, undefined, () => durableWrite);
  await write.entered;
  execution.cancelActiveWork(new Error("disabled"));
  write.release();
  await expect(job).rejects.toBe(failure);
});

test("a storage-session durable write that fails while a replacement closes its scope rejects with the original error", async ({
  createExecution,
}) => {
  const failure = Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
  const write = failingWrite(failure);
  const execution = createExecution(write.services);
  const storage = await openScope(execution);
  const work = execution.runInStorage(
    storage,
    durableWrite.pipe(Effect.catchCause((cause) => recoverFailure(cause, () => undefined))),
  );
  await write.entered;
  execution.replace(new Error("session_tree replacement"));
  write.release();
  await expect(work).rejects.toBe(failure);
});

test("shutdown interrupts a branch step that joins the settings load before the load, so no storage scope opens", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const loading = Promise.withResolvers<undefined>();
  const load = execution.startSettingsLoad(enteredThenNever(loading));
  let opened = false;
  const step = execution.run(
    execution.runBranchStep(
      Effect.exit(Fiber.join(load)).pipe(
        Effect.andThen(
          execution.openStorage(() => {
            opened = true;
            return Effect.void;
          }),
        ),
      ),
    ),
  );
  await loading.promise;
  await execution.shutdown(new Error("session ended"));
  await step;
  expect(opened).toBe(false);
});

test("after shutdown, replacements and jobs reject while runs and storage work resolve without starting", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  await execution.shutdown(new Error("session ended"));
  let ran = false;
  const mark = Effect.sync(() => {
    ran = true;
  });
  expect(() => {
    execution.replace(new Error("late"));
  }).toThrow("shut down");
  await expect(execution.runJob(storage, undefined, () => mark)).rejects.toThrow("unavailable");
  await execution.run(mark);
  await execution.runInStorage(storage, mark);
  expect(ran).toBe(false);
});

test("work admitted to a closed storage scope runs no synchronous prefix", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  execution.replace(new Error("replacement"));
  let ran = false;
  await execution.runInStorage(
    storage,
    Effect.sync(() => {
      ran = true;
    }),
  );
  expect(ran).toBe(false);
});

test("storage-session work in one scope starts only after the running work ends", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const log: string[] = [];
  const first = execution.runInStorage(
    storage,
    signal(entered).pipe(
      Effect.andThen(waitFor(gate.promise)),
      Effect.andThen(Effect.sync(() => log.push("first"))),
    ),
  );
  await entered.promise;
  const second = execution.runInStorage(
    storage,
    Effect.sync(() => log.push("second")),
  );
  await drain();
  expect(log).toEqual([]);
  gate.resolve(undefined);
  await Promise.all([first, second]);
  expect(log).toEqual(["first", "second"]);
});

test("failed storage-session work lets the next work in its scope run", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const failure = new Error("refresh failed");
  await expect(execution.runInStorage(storage, Effect.fail(failure))).rejects.toBe(failure);
  let ran = false;
  await execution.runInStorage(
    storage,
    Effect.sync(() => {
      ran = true;
    }),
  );
  expect(ran).toBe(true);
});

test("a superseded branch step and a superseded role check resolve their callers without failing", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const stepping = Promise.withResolvers<undefined>();
  const checking = Promise.withResolvers<undefined>();
  const staleStep = execution.run(execution.runBranchStep(enteredThenNever(stepping)));
  const staleRoles = execution.run(execution.runRoleWork(enteredThenNever(checking)));
  await Promise.all([stepping.promise, checking.promise]);
  const log: string[] = [];
  await execution.run(execution.runBranchStep(Effect.sync(() => log.push("step"))));
  await execution.run(execution.runRoleWork(Effect.sync(() => log.push("roles"))));
  await expect(staleStep).resolves.toBeUndefined();
  await expect(staleRoles).resolves.toBeUndefined();
  expect(log).toEqual(["step", "roles"]);
});

test("a failed storage startup fails the step that opened storage", async ({ createExecution }) => {
  const execution = createExecution();
  const failure = new Error("startup defect");
  await expect(
    execution.run(execution.runBranchStep(execution.openStorage(() => Effect.fail(failure)))),
  ).rejects.toBe(failure);
});

test("repeated shutdown calls share one teardown and the first reason", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const entered = Promise.withResolvers<undefined>();
  const job = execution.runJob(storage, undefined, () => enteredThenNever(entered));
  await entered.promise;
  const reason = new Error("first shutdown");
  const first = execution.shutdown(reason);
  const second = execution.shutdown(new Error("second shutdown"));
  await Promise.all([first, second]);
  expect(await job).toEqual({ kind: "cancelled", reason, outcome: undefined });
});

test("a disable cancels jobs and role work and leaves the branch step, storage work, and scope running", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const storage = await openScope(execution);
  const stepGate = Promise.withResolvers<undefined>();
  const workGate = Promise.withResolvers<undefined>();
  const jobEntered = Promise.withResolvers<undefined>();
  const rolesEntered = Promise.withResolvers<undefined>();
  const log: string[] = [];
  const step = execution.run(
    execution.runBranchStep(
      waitFor(stepGate.promise).pipe(Effect.andThen(Effect.sync(() => log.push("step")))),
    ),
  );
  const work = execution.runInStorage(
    storage,
    waitFor(workGate.promise).pipe(Effect.andThen(Effect.sync(() => log.push("storage work")))),
  );
  const roles = execution.run(execution.runRoleWork(enteredThenNever(rolesEntered)));
  const reason = new Error("disabled");
  const job = execution.runJob(storage, undefined, () => enteredThenNever(jobEntered));
  await Promise.all([jobEntered.promise, rolesEntered.promise]);
  execution.cancelActiveWork(reason);
  await expect(roles).resolves.toBeUndefined();
  expect(await job).toEqual({ kind: "cancelled", reason, outcome: undefined });
  stepGate.resolve(undefined);
  workGate.resolve(undefined);
  await Promise.all([step, work]);
  expect(log.toSorted()).toEqual(["step", "storage work"]);
  expect(await execution.runJob(storage, undefined, () => Effect.succeed("later"))).toEqual({
    kind: "completed",
    value: "later",
    outcome: undefined,
  });
});

const hostReasonKinds = [
  "no reason",
  "a DOMException",
  "a custom Error",
  "a string",
  "a plain object",
] as const;

type HostReason = (typeof hostReasonKinds)[number];

const hostReasons: Record<HostReason, () => unknown> = {
  "no reason": () => undefined,
  "a DOMException": () => new DOMException("The host timed out.", "TimeoutError"),
  "a custom Error": () => new Error("tool call cancelled"),
  "a string": () => "tool call cancelled",
  "a plain object": () => ({ kind: "host-cancel" }),
};

function abortWith(controller: AbortController, kind: HostReason): unknown {
  const reason = hostReasons[kind]();
  if (reason === undefined) {
    controller.abort();
  } else {
    controller.abort(reason);
  }
  return controller.signal.reason;
}

function cancelledReason(result: { kind: string; reason?: unknown }): unknown {
  expect(result.kind).toBe("cancelled");
  return result.reason;
}

test.for(hostReasonKinds)(
  "a host signal aborted with %s before or during a job reports cancelled with that exact reason",
  async (kind, { createExecution }) => {
    const execution = createExecution();
    const storage = await openScope(execution);
    const before = new AbortController();
    const early = abortWith(before, kind);
    expect(cancelledReason(await execution.runJob(storage, before.signal, () => never))).toBe(
      early,
    );
    const during = new AbortController();
    const entered = Promise.withResolvers<undefined>();
    const job = execution.runJob(storage, during.signal, () => enteredThenNever(entered));
    await entered.promise;
    const late = abortWith(during, kind);
    expect(cancelledReason(await job)).toBe(late);
  },
);

const competitors = ["disable", "replacement", "shutdown"] as const;

test.for(
  hostReasonKinds.flatMap((kind) =>
    competitors.flatMap((competitor) => [
      [kind, competitor, "host first"] as const,
      [kind, competitor, "host second"] as const,
    ]),
  ),
)(
  "a host abort with %s racing a %s reports the first reason (%s)",
  async ([kind, competitor, order], { createExecution }) => {
    const execution = createExecution();
    const storage = await openScope(execution);
    const controller = new AbortController();
    const entered = Promise.withResolvers<undefined>();
    const job = execution.runJob(storage, controller.signal, () => enteredThenNever(entered));
    await entered.promise;
    const competing = new Error(competitor);
    const compete = (): void => {
      if (competitor === "disable") {
        execution.cancelActiveWork(competing);
      } else if (competitor === "replacement") {
        execution.replace(competing);
      } else {
        void execution.shutdown(competing).catch(() => undefined);
      }
    };
    let host: unknown;
    if (order === "host first") {
      host = abortWith(controller, kind);
      compete();
    } else {
      compete();
      host = abortWith(controller, kind);
    }
    expect(cancelledReason(await job)).toBe(order === "host first" ? host : competing);
  },
);

test("work that shutdown's interruptions resume observes that shutdown started", async ({
  createExecution,
}) => {
  const execution = createExecution();
  const checking = Promise.withResolvers<undefined>();
  let observed: boolean | undefined;
  const waiting = execution.run(
    execution.runRoleWork(enteredThenNever(checking)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          observed = execution.stopped;
        }),
      ),
    ),
  );
  await checking.promise;
  await execution.shutdown(new Error("session ended"));
  await waiting;
  expect(observed).toBe(true);
});
