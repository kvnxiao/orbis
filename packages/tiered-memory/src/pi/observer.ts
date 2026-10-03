import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import { sourceFingerprint } from "../domain/evidence.ts";
import { coverageOverlaps } from "../domain/intervals.ts";
import type { ProcessedCoverage, ProjectedSource, SourceInterval } from "../domain/intervals.ts";
import { modelCapacity } from "../domain/models.ts";
import { acceptObserverOutput, observerOutputSchema } from "../domain/observer.ts";
import type {
  ObserverAcceptance,
  ObserverInput,
  ObserverOutput,
  ObserverRequest,
} from "../domain/observer.ts";
import type { CommitResult, MemoryProposal, NoteDependency } from "../domain/proposal.ts";
import type { Limits } from "../domain/settings.ts";
import { estimateTextTokens } from "../domain/tokens.ts";
import { fromPromise } from "../storage/files.ts";
import { parseRecord } from "../storage/records.ts";
import type { StorageServices } from "../storage/services.ts";
import { messageSources, projectMessages } from "../storage/source-projection.ts";
import type { SourceRecord } from "../storage/sources.ts";
import { workNoteName } from "./canonical-memory.ts";
import type { MemoryStorage } from "./canonical-memory.ts";
import { describeError } from "./configuration.ts";
import { noteValidity } from "./note-validity.ts";
import { fitObserverRequest, observerContext } from "./observer-planning.ts";
import { captureFrame, proposalFrom } from "./proposals.ts";
import type { ProposalFrame } from "./proposals.ts";
import { attemptDeadline } from "./worker.ts";
import type { AttemptFailure, JobOutcome, ObserverJob } from "./worker.ts";

/**
 * Supply what one observer job reads and calls, bound to the storage scope that dispatched it.
 *
 * - `ctx` is the scope's context; the job reads `ctx.signal` nowhere, since a later turn's abort does
 *   not own background work.
 * - `storage` returns the scope's open storage, with its cached canonical memory, binding, and
 *   capture refusal, or `undefined` once storage of that scope is no longer open.
 * - `model` resolves the observer model at dispatch through `roleModel`, without substitution.
 * - `commit` commits through `MemoryRuntime.commitProposal` with `signal` as its host signal, which
 *   serializes with storage-session work; an abort before the head is durable returns `cancelled`
 *   with the abort's reason, and one after it does not stop the commit.
 * - `recordUsage` receives each dispatched attempt's provider-reported usage, or `undefined` when no
 *   response arrived.
 */
export interface ObserverPorts {
  ctx: Pick<ExtensionContext, "sessionManager" | "modelRegistry">;
  storage: () => MemoryStorage | undefined;
  model: () => Model<Api> | undefined;
  commit: (proposal: MemoryProposal, signal: AbortSignal) => Promise<CommitResult>;
  recordUsage: (usage: Usage | undefined) => void;
}

function spanChanged(
  span: SourceInterval["spans"][number],
  sources: ReadonlyMap<string, ProjectedSource>,
): boolean {
  const source = sources.get(span.entryId);
  if (
    source === undefined ||
    source.excluded !== undefined ||
    source.omitted ||
    source.order !== span.order ||
    source.effectiveText.length !== span.entryLength
  ) {
    return true;
  }
  const text =
    span.range === undefined
      ? source.effectiveText
      : source.effectiveText.slice(span.range.start, span.range.end);
  return text !== span.text;
}

type Attempted =
  | {
      kind: "accepted";
      acceptance: Extract<ObserverAcceptance, { kind: "accepted" }>;
      failures: readonly AttemptFailure[];
    }
  | { kind: "expired" }
  | Extract<JobOutcome, { kind: "exhausted" }>;

interface Dispatch {
  model: Model<Api>;
  request: ObserverRequest;
  outputTokens: number;
  evidenceFingerprint: string;
}

// One attempt's parsed output or failure; every response that arrives reports its usage first.
function attemptOnce(
  ports: Pick<ObserverPorts, "ctx" | "recordUsage">,
  dispatch: Dispatch,
  timeoutMs: number,
): Effect.Effect<ReturnType<typeof parseObserverResponse>> {
  const { model, request, outputTokens } = dispatch;
  return completeObserver(ports, model, request, { maxTokens: outputTokens, timeoutMs }).pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.map((message) => {
      ports.recordUsage(Option.isSome(message) ? message.value.usage : undefined);
      return Option.isNone(message)
        ? ({ kind: "failed", failure: { kind: "timeout", timeoutMs } } as const)
        : parseObserverResponse(message.value, outputTokens);
    }),
    Effect.catch((error) =>
      Effect.sync(() => {
        ports.recordUsage(undefined);
        return {
          kind: "failed",
          failure: { kind: "provider", message: describeError(error) },
        } as const;
      }),
    ),
  );
}

const runAttempts = Effect.fnUntraced(function* (
  job: ObserverJob,
  ports: Pick<ObserverPorts, "ctx" | "recordUsage">,
  dispatch: Dispatch,
  limits: Limits,
): Effect.fn.Return<Attempted> {
  const attempts = limits.retries + 1;
  const failures: AttemptFailure[] = [];
  for (let index = 0; index < attempts; index++) {
    const now = yield* Clock.currentTimeMillis;
    const deadline = attemptDeadline(job, now, { index, attempts }, limits.jobTimeoutMs);
    if (deadline.kind === "expired") {
      return index === 0
        ? { kind: "expired" }
        : { kind: "exhausted", failures, deadline: true, commit: false };
    }
    const completed = yield* attemptOnce(ports, dispatch, deadline.timeoutMs);
    if (completed.kind === "failed") {
      failures.push(completed.failure);
      continue;
    }
    const acceptance = acceptObserverOutput(
      completed.output,
      {
        labels: dispatch.request.labels,
        interval: job.interval,
        evidenceFingerprint: dispatch.evidenceFingerprint,
      },
      limits.workNoteTokens,
    );
    if (acceptance.kind === "accepted") {
      return { kind: "accepted", acceptance, failures };
    }
    failures.push({ kind: "rejected", rejection: acceptance.rejection });
  }
  return { kind: "exhausted", failures, deadline: false, commit: false };
});

// Maps the note result to the proposal's note and its dependency; an edited note is never written.
function noteContent(
  acceptance: Extract<ObserverAcceptance, { kind: "accepted" }>,
  frame: ProposalFrame,
  evidence: readonly SourceRecord[],
  writable: boolean,
): { notes: Record<string, string>; dependencies: Record<string, NoteDependency> } {
  const { workNote } = acceptance;
  if (!writable || workNote.status === "unchanged") {
    return { notes: {}, dependencies: {} };
  }
  if (workNote.status === "empty") {
    const dependency = {
      sourceIds: frame.sourceIds,
      evidenceFingerprint: frame.evidenceFingerprint,
    };
    return { notes: { [workNoteName]: "" }, dependencies: { [workNoteName]: dependency } };
  }
  const { body, sourceIds, checkpointIds } = workNote;
  const dependency: NoteDependency = {
    sourceIds: [...sourceIds],
    evidenceFingerprint: sourceFingerprint(evidence, sourceIds),
    ...(checkpointIds.length === 0 ? {} : { checkpointIds: [...checkpointIds] }),
  };
  return { notes: { [workNoteName]: body }, dependencies: { [workNoteName]: dependency } };
}

function commitOutcome(result: CommitResult): JobOutcome {
  if (result.kind === "committed") {
    return { kind: "committed", revisionId: result.revisionId };
  }
  return result.kind === "conflict"
    ? { kind: "conflict", reason: result.reason }
    : { kind: "cancelled", reason: result.reason };
}

type Prepared =
  | Extract<JobOutcome, { kind: "stale" }>
  | {
      kind: "ready";
      dispatch: Dispatch;
      frame: ProposalFrame;
      evidence: readonly SourceRecord[];
      writable: boolean;
    };

interface Preparation {
  kind: "current";
  storage: MemoryStorage;
  branch: readonly SessionEntry[];
  sources: readonly ProjectedSource[];
  evidence: readonly SourceRecord[];
  processed: ProcessedCoverage;
}

function readyStorage(
  job: ObserverJob,
  storage: MemoryStorage | undefined,
):
  | { kind: "ready"; storage: MemoryStorage; processed: ProcessedCoverage }
  | Extract<JobOutcome, { kind: "stale" }> {
  if (
    storage === undefined ||
    storage.refusal !== undefined ||
    storage.canonical.coverage.state !== "available"
  ) {
    return { kind: "stale", reason: "unready" };
  }
  const processed = storage.canonical.coverage.processed;
  if (job.interval.spans.some((span) => coverageOverlaps(processed, span.reference))) {
    return { kind: "stale", reason: "covered" };
  }
  return { kind: "ready", storage, processed };
}

// Checks readiness, coverage, and span evidence against one storage read and one projection of one
// branch read, so a frame captured from the same reads binds the selection those checks saw.
function currentPreparation(
  job: ObserverJob,
  storage: MemoryStorage | undefined,
  branch: readonly SessionEntry[],
): Preparation | Extract<JobOutcome, { kind: "stale" }> {
  const ready = readyStorage(job, storage);
  if (ready.kind === "stale") {
    return ready;
  }
  const { session } = ready.storage;
  const messages = messageSources(branch);
  const sources = projectMessages(messages, session.store, session.sources.sources);
  const byEntry = new Map(sources.map((source) => [source.entryId, source]));
  if (job.interval.spans.some((span) => spanChanged(span, byEntry))) {
    return { kind: "stale", reason: "changed" };
  }
  const evidence = session.sources.recordsOf(messages);
  return { ...ready, kind: "current", branch, sources, evidence };
}

const prepareDispatch = Effect.fnUntraced(function* (
  job: ObserverJob,
  ports: ObserverPorts,
  limits: Limits,
): Effect.fn.Return<Prepared, unknown> {
  const manager = ports.ctx.sessionManager;
  const before = readyStorage(job, ports.storage());
  if (before.kind === "stale") {
    return before;
  }
  const model = ports.model();
  const capacity =
    model === undefined ? undefined : modelCapacity(`${model.provider}/${model.id}`, limits, model);
  if (model === undefined || capacity?.state !== "ready") {
    return { kind: "stale", reason: "model" };
  }
  yield* before.storage.session.sources.checkManager(manager);
  // A reconciliation or commit during that await can select a revision whose coverage already
  // includes the interval, so every check runs again before the frame binds the selection.
  const current = currentPreparation(job, ports.storage(), manager.getBranch());
  if (current.kind === "stale") {
    return current;
  }
  const { storage, branch, sources, evidence, processed } = current;
  const validity = noteValidity(storage, branch);
  if (validity.state === "unknown") {
    return { kind: "stale", reason: "freshness" };
  }
  const ids = job.interval.spans.map((span) => span.reference);
  const frame = captureFrame(storage.session, ports.ctx, storage.binding, ids, evidence);
  const context = observerContext(
    storage.canonical,
    validity,
    processed,
    { branch, sources },
    limits.checkpointTokens,
  );
  const input: ObserverInput = { interval: job.interval, ...context };
  const request = fitObserverRequest(input, capacity.inputTokens);
  if (request === undefined) {
    return { kind: "stale", reason: "oversize" };
  }
  return {
    kind: "ready",
    dispatch: {
      model,
      request,
      outputTokens: capacity.outputTokens,
      evidenceFingerprint: frame.evidenceFingerprint,
    },
    frame,
    evidence,
    writable: storage.canonical.curation[workNoteName]?.kind !== "edited",
  };
});

// Commits with a host signal that aborts at the job's total deadline; the commit returns the
// deadline's own reason as `cancelled` only when the abort arrived before its head was durable.
const commitBeforeDeadline = Effect.fnUntraced(function* (
  ports: Pick<ObserverPorts, "commit">,
  proposal: MemoryProposal,
  deadlineAt: number,
): Effect.fn.Return<CommitResult | { kind: "expired" }, unknown> {
  const controller = new AbortController();
  const expired = new Error("The observer job deadline passed before its commit published a head.");
  const remaining = deadlineAt - (yield* Clock.currentTimeMillis);
  if (remaining <= 0) {
    controller.abort(expired);
  }
  const timer = yield* Effect.forkChild(
    Effect.sleep(Duration.millis(Math.max(remaining, 0))).pipe(
      Effect.andThen(
        Effect.sync(() => {
          controller.abort(expired);
        }),
      ),
    ),
  );
  // The commit owns its own cancellation through `Execution.runJob`, so the job waits for its
  // result, including a genuine failure that races a cancellation, instead of abandoning it.
  const result = yield* Effect.uninterruptible(
    fromPromise(async () => await ports.commit(proposal, controller.signal)),
  ).pipe(Effect.ensuring(Fiber.interrupt(timer)));
  return result.kind === "cancelled" && result.reason === expired ? { kind: "expired" } : result;
});

/**
 * Run one observer job: revalidate its interval, capture a frame, run bounded attempts, then commit
 * one proposal with the accepted observations, the note result, and the interval as coverage.
 *
 * Steps, in order:
 *
 * 1. Return `stale` when storage is unready or its lineage coverage unavailable, the interval overlaps
 *    processed coverage, the observer model is unresolved or too small for the mandatory budgets,
 *    or the request no longer fits the observer input cap even without the checkpoint
 *    (`oversize`).
 * 2. Check the session manager, then repeat the readiness and coverage checks against one fresh
 *    storage read and check the spans against one projection of one branch read, which also
 *    supplies the evidence; return `stale` when the spans changed or left the branch, or with
 *    reason `freshness` while the current-work note's freshness is unknown; and capture the frame
 *    from that same read with the previous note from cached canonical memory only while observer
 *    planning may use it, before the first attempt; no later step rebinds the output to another
 *    selection or configuration.
 * 3. Run attempts within `attemptDeadline`, each with `maxRetries: 0`, so this layer owns retries, and
 *    with the attempt's abort signal forwarded through `fromPromise`. A total deadline that passed
 *    before the first attempt returns `stale` with reason `expired`; one that passes later exhausts
 *    the job.
 * 4. Map `updated` to the `current-work.md` body with its references as the note dependency, `empty`
 *    to the empty body, and `unchanged` to no written note, so the base note carries. An externally
 *    edited note is never written; a deleted one is, and the store's evidence rule decides.
 * 5. Commit once and wait for its result; a disable, replacement, or shutdown cancels the commit
 *    itself. A conflict or a cancellation is the job's outcome and is not retried. The total
 *    deadline also bounds the commit's wait for its storage-session turn and the project lock: when
 *    it passes before the head write starts, the commit is abandoned without a revision and the job
 *    is `exhausted` with `deadline` and `commit`. Once the head write starts, the commit finishes
 *    its writes and the job is `committed`.
 *
 * @throws The errors of `captureFrame` and `proposalFrom` that remain after the refusal check, and
 *   the original error of a failed commit.
 */
export const runObserverJob = Effect.fnUntraced(function* (
  job: ObserverJob,
  ports: ObserverPorts,
  limits: Limits,
): Effect.fn.Return<JobOutcome, unknown, StorageServices> {
  const prepared = yield* prepareDispatch(job, ports, limits);
  if (prepared.kind === "stale") {
    return prepared;
  }
  const { frame, evidence } = prepared;
  const attempted = yield* runAttempts(job, ports, prepared.dispatch, limits);
  if (attempted.kind === "expired") {
    return { kind: "stale", reason: "expired" };
  }
  if (attempted.kind === "exhausted") {
    return attempted;
  }
  const { acceptance } = attempted;
  const note = noteContent(acceptance, frame, evidence, prepared.writable);
  const proposal = proposalFrom(
    frame,
    {
      notes: note.notes,
      observations: acceptance.observations,
      consumedObservationIds: [],
      learnings: {},
      expectedLearnings: {},
    },
    note.dependencies,
  );
  const result = yield* commitBeforeDeadline(ports, proposal, job.enqueuedAt + limits.jobTimeoutMs);
  if (result.kind === "expired") {
    return { kind: "exhausted", failures: attempted.failures, deadline: true, commit: true };
  }
  return commitOutcome(result);
});

/**
 * Request one observer completion through `ctx.modelRegistry.complete` with request-time
 * authentication, no tools, and `maxRetries: 0`.
 *
 * Interruption aborts the request's signal; a non-cooperative provider's late result is discarded
 * by the caller's fiber, never committed.
 */
export function completeObserver(
  ports: Pick<ObserverPorts, "ctx">,
  model: Model<Api>,
  request: ObserverRequest,
  options: { maxTokens: number; timeoutMs: number },
): Effect.Effect<AssistantMessage, unknown> {
  return fromPromise(
    async (signal) =>
      await ports.ctx.modelRegistry.complete(
        model,
        {
          systemPrompt: request.systemPrompt,
          messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
        },
        { signal, maxTokens: options.maxTokens, timeoutMs: options.timeoutMs, maxRetries: 0 },
      ),
  );
}

/**
 * Parse an observer completion into its validated output, or name the attempt failure.
 *
 * A `stopReason` of `length` is `truncated` and of `error` or `aborted` is `provider`; another
 * reason than `stop` is `malformed`. Estimated output above `outputTokens` is `oversized`; text
 * that is not one JSON object matching `observerOutputSchema`, parsed through `parseRecord`, is
 * `malformed`.
 */
export function parseObserverResponse(
  message: AssistantMessage,
  outputTokens: number,
): { kind: "parsed"; output: ObserverOutput } | { kind: "failed"; failure: AttemptFailure } {
  const { stopReason } = message;
  if (stopReason === "length") {
    return { kind: "failed", failure: { kind: "truncated" } };
  }
  if (stopReason === "error" || stopReason === "aborted") {
    const text = message.errorMessage ?? `The observer response ended with ${stopReason}.`;
    return { kind: "failed", failure: { kind: "provider", message: text } };
  }
  if (stopReason !== "stop") {
    const detail = `The observer response ended with ${stopReason}.`;
    return { kind: "failed", failure: { kind: "malformed", detail } };
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  const tokens = estimateTextTokens(text);
  if (tokens > outputTokens) {
    return { kind: "failed", failure: { kind: "oversized", tokens, limit: outputTokens } };
  }
  try {
    return { kind: "parsed", output: parseRecord(observerOutputSchema, text, "observer response") };
  } catch (error) {
    return { kind: "failed", failure: { kind: "malformed", detail: describeError(error) } };
  }
}
