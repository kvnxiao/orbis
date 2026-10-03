import type { AssistantMessage } from "@earendil-works/pi-ai";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import type { ObserverOutput } from "../src/domain/observer.ts";
import { fixtureMessage } from "./pi-fixture.mts";
import type { Fixture, FixtureOptions, ObserverCall, ObserverScript } from "./pi-fixture.mts";

/** Hold one observer completion until the test answers it. */
export interface PendingObserverCall {
  call: ObserverCall;
  reply: (message: AssistantMessage) => void;
  fail: (error: unknown) => void;
}

/**
 * Answer observer completions from the test: each call waits for `next()` and an explicit reply,
 * unless `respond` installed an immediate answer.
 */
export class ScriptedObserver {
  readonly calls: ObserverCall[] = [];
  private readonly arrived: PendingObserverCall[] = [];
  private readonly waiters: ((call: PendingObserverCall) => void)[] = [];
  private answer: ((call: ObserverCall) => AssistantMessage) | undefined;

  readonly script: ObserverScript = async (call) => {
    this.calls.push(call);
    if (this.answer !== undefined) {
      return this.answer(call);
    }
    const settled = Promise.withResolvers<AssistantMessage>();
    const pending: PendingObserverCall = {
      call,
      reply: settled.resolve,
      fail: settled.reject,
    };
    const waiter = this.waiters.shift();
    if (waiter === undefined) {
      this.arrived.push(pending);
    } else {
      waiter(pending);
    }
    return await settled.promise;
  };

  /** Answer every later call immediately with `answer`. */
  respond(answer: (call: ObserverCall) => AssistantMessage): void {
    this.answer = answer;
  }

  /** Resolve with the oldest unanswered call, waiting for one to arrive. */
  async next(): Promise<PendingObserverCall> {
    const ready = this.arrived.shift();
    if (ready !== undefined) {
      return ready;
    }
    const arrival = Promise.withResolvers<PendingObserverCall>();
    this.waiters.push(arrival.resolve);
    return await arrival.promise;
  }

  /** Count calls that arrived and still await an answer. */
  get unanswered(): number {
    return this.arrived.length;
  }
}

/** Render an observer response as the scripted model's JSON text. */
export function observerReply(output: ObserverOutput): AssistantMessage {
  return fixtureMessage(JSON.stringify(output));
}

/** Reply with no observations and an updated note citing every assigned span label. */
export function noteReply(body: string, call: ObserverCall): AssistantMessage {
  return observerReply({
    observations: [],
    workNote: { status: "updated", body, sources: spanLabels(call) },
  });
}

/** List the `S<n>` labels an observer prompt assigns, in order. */
export function spanLabels(call: ObserverCall): string[] {
  return [...call.prompt.matchAll(/^\[(S\d+)\] /gmu)].map((match) => match[1] ?? "");
}

/** Create a controlled Effect clock starting at `start` milliseconds. */
export async function controlledClock(start = Date.UTC(2026, 2, 1)): Promise<TestClock.TestClock> {
  const clock = await Effect.runPromise(Effect.scoped(TestClock.make()));
  await Effect.runPromise(clock.setTime(start));
  return clock;
}

/** Advance a controlled clock by `millis`, running the sleeps due by then. */
export async function advance(clock: TestClock.TestClock, millis: number): Promise<void> {
  await Effect.runPromise(clock.adjust(millis));
}

/**
 * Create a fixture whose extension loads with injected services and answers observer requests with
 * `observer`, then wait for its startup scheduling.
 */
export async function workerFixture(
  createFixture: (options?: FixtureOptions) => Promise<Fixture>,
  observer: ScriptedObserver,
  options: FixtureOptions = {},
): Promise<Fixture> {
  return await createFixture({ services: {}, ...options, observer: observer.script });
}

/** Prompt and wait until the extension's observer queue is idle. */
export async function promptAndObserve(f: Fixture, text: string): Promise<void> {
  await f.session.prompt(text);
  await f.memory().work.idle();
}
