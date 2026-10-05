# Effect v4 for Orbis reference implementations

Research date: 2026-09-26.

This research assesses Effect v4 for Pi extensions and other repository code. The
[Effect v4 reference implementations](https://github.com/kvnxiao/orbis/wiki/Effect-v4-reference-implementations)
wiki page records the adoption decision, [#51](https://github.com/kvnxiao/orbis/issues/51) tracks
adoption work, and the [current Effect policy](../../.agents/shared/effect-adoption.md) governs
implementation choices. The
[previous version](https://github.com/kvnxiao/orbis/blob/405932fbefac5e3955b4fcb03166022fcdeecc7a/docs/effect-ts-research.md)
of this document also has the per-package assessments that this version omits.

## Baseline and sources

| Component                  | Examined version or constraint                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Effect                     | `4.0.0-rc.117` in an isolated scratch installation                                          |
| Pi SDK                     | `@earendil-works/pi-coding-agent` `0.87.0`                                                  |
| Development runtime        | Node.js `26.9.0`, Windows x64                                                               |
| Declared extension minimum | Node.js `22.19.0`                                                                           |
| TypeScript                 | `7.0.2`, with the repository's strict source-only configuration                             |
| Package manager            | pnpm `12.5.1`                                                                               |
| Repository revision        | [`090a0c7`](https://github.com/kvnxiao/orbis/tree/090a0c7ff385ba990c05aa5d6904d95a18c01d57) |

API and compatibility conclusions apply to these versions, not to an unspecified future release.
Findings marked `Observed in` come from offline probes, measurements, or the pinned Effect source
under the stated conditions. Unmarked text is reasoning, a recommendation, or a claim from Effect's
documentation.

The [v4 installation guide](https://effect.website/docs/v4/getting-started/installation) identifies
v4 as a release candidate installed through `effect@rc`, with TypeScript 5.9+ and Node.js 22.18+
support. Those advertised minimums overlap Orbis's declared versions; they do not substitute for
loading a packaged extension on Orbis's minimum runtime. The release-candidate API and ecosystem
compatibility remain adoption considerations.

## Questions investigated

1. What does Effect v4 add beyond typed errors for Pi extension workflows?
2. How do its concurrency, timing, and interruption semantics interact with background work and
   durable storage?
3. Which constraints apply where Effect code meets Pi host contracts, schemas, and packaging?
4. What does Effect cost at load and run time, and what remains unmeasured?
5. Which alternative libraries address parts of the same problem?

## Effect v4 concepts

An `Effect<A, E, R>` describes an operation with a success value `A`, expected failures `E`, and
required services `R`. Constructing a deferred operation and executing it are separate actions.
Functions can assemble operations; callers can then supply dependencies and apply execution
policies. Re-running an operation can repeat its side effects. Laziness does not provide idempotency
or memoization. [Effect overview](https://effect.website/docs/v4/onboarding)

A **fiber** is Effect's handle for a running computation. A **scope** owns resources and their
finalizers, which perform cleanup when the scope closes. **Services** describe dependencies;
**Layers** construct and provide them, including dependencies with resource lifetimes. These
mechanisms let a package define how work ends as well as how it begins.
[Fibers](https://effect.website/docs/v4/concurrency/fibers),
[scopes](https://effect.website/docs/v4/resource-management/scope),
[Layers](https://effect.website/docs/v4/requirements-management/layers)

Effect's main advantage for extensions is a shared execution model for dependencies, failures, task
lifetimes, cleanup, concurrency, and timing. Workflow decomposition and stronger domain types are
baseline improvements available in plain TypeScript, so an assessment must not attribute their
benefits to Effect. Introducing a service needs a dependency or resource-lifetime boundary;
sequencing a fixed set of calls alone does not justify one.

### Value beyond typed errors

| Capability                                | Example extension use                                                 | Design benefit and limit                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured concurrency and scopes         | UI listeners, session-owned tasks, worker shutdown                    | Ownership and cleanup share one model. External calls still need correct adapters.                                                                  |
| Typed services and Layers                 | Storage, presentation, model execution, and test substitutes          | A workflow declares its dependencies; service construction can own resources. Passing narrow dependencies directly remains valid for small helpers. |
| Queues, semaphores, and bounded traversal | Background work backlog, shared inference capacity, independent reads | Capacity and waiting become explicit. The application chooses overflow and scheduling policy.                                                       |
| Schedules and timeouts                    | Retry budgets, worker duration, compaction waiting, terminal queries  | Reusable timing policies compose with failures and interruption. Safe repetition remains an application decision.                                   |
| TestClock                                 | Deadlines, backoff, and timed waiting                                 | Effect clock operations can advance under test control. External timers and arbitrary races are not automatically controlled.                       |
| Tracing, logging, and metrics             | Queue, model, lock, and commit timings                                | Nested operations can retain diagnostic context. Exporters and Pi-facing reports still need integration.                                            |

These mechanisms can work together in a queued background job: services supply dependencies, a
permit limits concurrency, a schedule retries eligible failures, and a scope releases resources when
the job ends. Tracing can record its timings. A result library can express and compose errors but
does not supply the same runtime facilities. Relevant v4 documentation covers
[queues](https://effect.website/docs/v4/concurrency/queue),
[semaphores](https://effect.website/docs/v4/concurrency/semaphore),
[schedules](https://effect.website/docs/v4/scheduling/using-schedules),
[TestClock](https://effect.website/docs/v4/testing/testclock), and
[tracing](https://effect.website/docs/v4/observability/tracing).

## Workflow composition and racing

`Effect.gen` permits sequential code with `yield*`, branches, and local values; pipelines are
another composition style. Prefer `Effect.gen` for sequential multi-step workflows and `.pipe()` for
attached policies such as timeouts, retries, and scoped service provision. Neither syntax fixes a
function that mixes too many responsibilities. Decompose a long generator into cohesive private
functions that return Effects when their contracts simplify the caller, including helpers with one
caller. [Generators](https://effect.website/docs/v4/getting-started/using-generators)

Keep reducers, parsing, layout, rendering, and other pure transformations as ordinary functions.
Loops and local mutation inside a parser or collection builder can remain clear and efficient.
Expose storage reads and writes through narrow services, and keep decisions over the stored data,
such as candidate classification or snapshot selection, in ordinary domain functions where that
improves clarity.

`Effect.raceFirst` selects the first completion, including failure; `Effect.race` selects the first
success. `Promise.race` settles with the first settled promise, including a rejection, so replacing
it with `Effect.race` changes semantics. Effect also interrupts losing fibers, so adapter cleanup is
part of the behavior under review.
[Concurrency and racing](https://effect.website/docs/v4/concurrency/basic-concurrency)

An interaction that waits for a UI or control event can adapt the event with `Effect.callback` or
`Deferred` and race it against other waits with `Effect.raceFirst`. `Scope`, `acquireRelease`, and
child or scoped fibers can own its listeners and concurrent waits, so cleanup matches the owning
session and interaction. When a new interaction replaces an old one, the old interaction's cleanup
must leave the replacement's work intact. The outcome must still distinguish withdrawal, user
cancellation, and completed input.

Do not add an automatic timeout to user input, such as a review or a question, merely because the
library offers one.

## Background work and timeouts

Background model work, such as a worker that observes new source spans and commits revisions, fits a
bounded `Queue` with a scoped worker and a model service. The worker can acquire inference capacity,
select sources, run the model, validate its proposal, and commit only if the source and revision
checks still pass. Budget and tracing policies apply to the relevant operations.

- A single queue consumer already serializes its jobs. Add a `Semaphore` only when several paths
  share inference capacity.
- Retry eligible failures with `Schedule` and retry operators. Bound attempts and elapsed time,
  classify which failures are safe to retry, and account for retries that the model SDK already
  performs.
- Place each timeout deliberately. A timeout around the whole workflow counts queue waiting and
  retries against the deadline. A timeout applied separately to each model attempt excludes queue
  waiting and starts again on each retry.
- When a foreground operation needs background results, bound the wait with a timeout and wait only
  for the relevant job's completion signal. Distinguish the caller's wait from the background work,
  which the worker owns independently.
- Read independent records with bounded `Effect.forEach` or `Effect.all`, and use `Stream` when
  incremental processing helps. Bound the output and preserve each result's provenance.
- When a session stops, is disabled, or is replaced, its owned fibers and finalizers end its work,
  and committed data stays. Interruption does not replace the explicit identity, session, and
  revision checks that reject stale results.

Tests can combine scripted service Layers, explicit completion signals, and TestClock where Effect
timers exist. They can then exercise exhausted retries, cancellation, partial writes, and a
foreground deadline while unrelated work is still queued.

## Durability and storage

Effect interruption can stop waiting for a Promise, but it cannot stop an external operation that
ignores cancellation.

**Observed in Effect 4.0.0-rc.117:** A controlled probe started a Promise that ignored cancellation,
interrupted its enclosing Effect, and observed resource cleanup before the Promise finished.
Interrupting a wrapper therefore does not prove that the wrapped work has stopped.

Passing an `AbortSignal` is necessary for cooperative APIs. An operation that does not observe
cancellation, such as a durable filesystem write, needs an explicit completion policy: it must
settle before the resources or locks it uses are released.

- An in-memory Effect semaphore does not replace a filesystem lock that coordinates independent
  processes.
- A package-local semaphore cannot coordinate other writers that use Pi's shared
  `withFileMutationQueue`. Keep using that queue for files that other writers mutate through it.

### Settle started writes

**Observed in the pinned
[Effect API source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.117/packages/effect/src/Effect.ts)
for `4.0.0-rc.117`:** `Effect.all` uses `mode: "result"`, not `mode: "either"`. That mode and
`Effect.result` collect typed failures but do not capture defects or interruption. `Effect.exit`
captures all three outcomes.

To finish every started write after one fails, use explicitly protected execution instead of a
default fail-fast traversal. A candidate is
`Effect.all(writes.map(Effect.exit), { concurrency: "unbounded" })` inside `Effect.uninterruptible`.
Each write produces an `Exit`, so a failed write does not stop settlement of its siblings.
`Effect.exit` does not stop external cancellation, so the batch still needs the uninterruptible
region. Inspect all exits and propagate the first failure in input order after the batch settles.
Run batches and publication steps in sequence; a failed batch must not start later phases.

Apply interruption protection from the commit-point write, such as a durable head, through
post-commit publication, starting after the final pre-commit cancellation check. This avoids an
interruption gap after commitment. Writes before commitment that do not observe cancellation also
need protection until they settle. Keep the lock until all started writes finish, and keep failure
interpretation inside the protected region. Validate this design against the package's commit and
recovery tests.

### Limits of Effect for durability

- Scopes and finalizers operate only while the runtime can execute cleanup. They do not provide
  crash recovery, filesystem atomicity, or exactly-once model calls.
- Queues are in memory, and ordinary schedules do not persist jobs through process downtime.
  [Queue](https://effect.website/docs/v4/concurrency/queue),
  [schedule lifetime](https://effect.website/docs/v4/scheduling/using-schedules)
- Effect does not infer domain or storage invariants. Persisted receipts, approval intent, durable
  heads, exact source coverage, exclusion rules, compare-before-commit checks, and recovery of
  derived views remain domain and storage logic.
- Do not automatically retry approval, handoff, or an ambiguously completed mutation.
- A synchronous Pi event producer does not acquire backpressure merely because a consumer uses a
  bounded queue. The adapter must define coalescing, rejection, or deferral when capacity is
  exhausted.

## Pi host integration

### Run at host boundaries

Pi keeps its public commands, tools, event handlers, contexts, and Promise-returning contracts.
Package workflows can return Effects internally. A `ManagedRuntime` supplies services and runs them
at the adapter boundary; the adapter interprets the `Exit` and its `Cause` and returns the host's
expected result in the package's public outcome shapes. Runtime ownership must distinguish extension
registration, session resources, and individual operations. Avoid running a separate Effect runtime
in every internal helper. An implementation design defines each runtime and scope owner, service
boundary, public adapter, cancellation path, and protected storage phase.
[ManagedRuntime integration](https://effect.website/docs/v4/runtime)

Construct Promise-based work inside `Effect.tryPromise` so each execution starts the intended
operation and can receive its cancellation signal. Map expected adapter failures to meaningful error
types without treating every programming defect as a recoverable condition. Callback adapters must
unregister listeners on completion or interruption. V4 uses `Effect.callback`, `Context.Service`,
and `Result`; v3 examples using different names need version-specific checking.
[Creating Effects](https://effect.website/docs/v4/getting-started/creating-effects)

When an exit contains interruption together with a real failure, the boundary must not suppress the
failure merely because an abort signal is also set. Preserve the distinction among user
cancellation, supersession, expected operational failure, and unexpected defects.

Keep error recognition structural across independently loaded extensions rather than relying on
class identity. For a `Data.TaggedError`, narrow an unknown value to a non-null object with a `_tag`
property before checking `error._tag === "MyTaggedError"`; validate any payload fields the handler
uses. Avoid `instanceof MyTaggedError` across host or package boundaries: independently loaded
copies of a class have different constructor identities. Preserve existing public error
discriminants when adapting internal Effect failures. Pi-facing error behavior still follows the
[failure-signaling rules](../../.agents/skills/pi-coding-agent-rules/references/pi-failure-signaling.md).

A command that only delegates to a Pi-owned operation, such as calling `ctx.shutdown()`, has no
package-owned process to coordinate. An Effect runtime there adds a second execution mechanism.

### Session lifetime

- Services receive the current context and must not retain an obsolete command context for later
  use.
- A runtime must not wait for its own shutdown while holding the operation needed to finish a
  handoff.
- Session replacement needs fresh resources for the new session, because a disposed runtime cannot
  be reused.

### Schemas, packaging, and public contracts

Orbis requires TypeBox for boundary validation through its package parse helper. Retain that
contract and Pi tool schemas. Effect services can call the existing parser and map its failure.
Adopting Effect Schema would be a separate design and tooling choice; maintaining two definitions of
the same boundary format would add inconsistency. Schema conversion alone does not prove Pi's
generic tool typing or loader compatibility.

Declare Effect as an ordinary runtime dependency of each importing package. Preserve source-only
exports, explicit relative `.ts` imports, external Pi dependencies, and the repository compiler
constraints. Pin and verify a selected v4 release before relying on its exact APIs. An exactly
pinned, verified v4 release candidate is sufficient for adoption; validate later upgrades against
the same maintained checks.

Keep public and persisted contracts plain. Do not expose Effect objects through public presenter
protocols or persist runtime objects; plain records reduce coupling between separately installed
packages. When public callbacks stay plain, including synchronous ones, an external presenter or
another package does not need to import Effect.

Evaluate subpath-only imports as the default convention, for example `effect/Effect`,
`effect/Layer`, `effect/Scope`, and `effect/Queue`. Verify every required subpath through TypeScript
7's NodeNext resolution and Node's ESM export maps, then load the packed extension through Pi. Use
published subpaths, with no dependency on Effect's internal files. Measure the complete module set,
as listed in [Measurements to report](#measurements-to-report), before adopting the convention.

### Host ownership

Pi continues to own provider credentials, model selection, trust decisions, session control, and its
agent loop. Effect can wrap authorized SDK calls; its AI or platform modules are not a reason to
replace these host responsibilities.

### Optional facilities

`Stream` can help incremental source traversal, and `Cache` can share overlapping expensive lookups.
Neither is required for every workflow. Cache keys must include the relevant identity or revision,
and caches must not suppress curation or freshness checks. `Ref` or `SubscriptionRef` may help
genuinely shared state; they do not replace domain state modeling or make arbitrary mutations safe.
Introducing HTTP, SQL, a distributed workflow engine, or a second agent framework would require an
actual package requirement. [Streams](https://effect.website/docs/v4/stream/introduction),
[Cache](https://effect.website/docs/v4/caching/cache)

## Library alternatives

These options address different parts of the problem. The comparison concerns their fit for Orbis
workflows and excludes introduction effort.

| Approach                                                                                      | What it provides                                                                                       | Assessment for Orbis                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Well-structured TypeScript with native promises                                               | Pure functions, discriminated unions, explicit dependency parameters, `AbortSignal`, and `try/finally` | A credible baseline and sufficient for small extensions. Larger workflows still need a consistent ownership and scheduling design.                                    |
| [neverthrow](https://github.com/supermacro/neverthrow)                                        | `Result`/`ResultAsync`, typed failure propagation, composition, and recovery                           | The strongest focused alternative when errors are the main concern. Pair it with explicit lifecycle and scheduling mechanisms for workflows that need them.           |
| [Remeda](https://remedajs.com/)                                                               | Typed functional collection utilities and pipelines                                                    | Useful for complex data transformations; it does not coordinate asynchronous resource lifetimes. Native array operations may already be clearer.                      |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern)                                         | Pattern matching and exhaustive handling of variants                                                   | Useful for state/outcome decisions. It complements domain modeling rather than providing a workflow runtime.                                                          |
| [RxJS](https://github.com/ReactiveX/rxjs/blob/master/apps/rxjs.dev/content/guide/overview.md) | Observable composition, event operators, subscriptions, and schedulers                                 | A candidate for event-heavy interfaces. For operation-oriented workflows, Effect's typed dependencies and resource model are the closer fit.                          |
| [XState](https://stately.ai/docs/xstate)                                                      | State machines, statecharts, and actors for explicit transitions and coordination                      | Worth considering when a package's state-transition complexity dominates. Effect addresses execution; a reducer or state machine still defines permitted transitions. |
| [fp-ts](https://github.com/gcanti/fp-ts)                                                      | Functional data types and abstractions such as task/error/environment composition                      | Its own project identifies Effect as its successor. It is not the preferred starting point for a new runtime design.                                                  |

XState and Effect could coexist, but two coordination systems need distinct ownership. A reducer
plus Effect is a simpler initial proposal unless statechart tooling solves a demonstrated problem.
Likewise, an Effect package does not automatically need neverthrow, Remeda, and ts-pattern as well;
add another dependency only for a remaining need.

The runtime tradeoff is real: maintainers must understand lazy execution, interruption, scopes, and
dependency provision. Service graphs can become oversized, broad error unions can hide useful
distinctions, and excessive wrapping can obscure a simple operation. These are properties of the
resulting design, independent of rewrite effort. Restrict the initial conventions to the mechanisms
the package actually needs and review their application. A small lifecycle can remain clear with
native promises and abort signals, so base the choice on the concrete design, not on ecosystem
consistency alone.

An Effect design should show visible business steps, explicit task and resource ownership, preserved
domain safeguards, and reproducible failure-path tests. Reconsider the scope of Effect if an
implementation adds indirection without removing coordination machinery or cannot preserve host
contracts.

## Interoperability probe

**Observed in Pi 0.87.0, Effect 4.0.0-rc.117, TypeScript 7.0.2, Node.js 26.9.0 on Windows x64,
offline:** An isolated fixture extension imported Effect and registered a TypeBox-defined Pi tool.
The tool used a `Context.Service`, a provided Layer, a managed runtime, a tagged failure, and a
scoped resource. Its modes returned a value, failed, or waited on a cancellable Node timer. The
installed Pi extension loader loaded the source through the actual loading path.

The local checks passed for:

- Source loading and tool registration through Pi `0.87.0`.
- A successful Promise-returning tool result and a tagged failure translated at the boundary.
- Forwarding a tool signal to the wrapped timer and running its scope finalizer once.
- Disposing the runtime with work pending through an invoked shutdown handler.
- Loading a fresh extension instance and running it after the previous instance was disposed.
- Type checking the fixture against `tsconfig.base.json`, including `erasableSyntaxOnly`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

The harness called registered tool and shutdown handlers directly and used the installed SDK's
internal loader as a test entry point. No model calls or live provider traffic were used. Production
code would continue importing public Pi APIs.

The fixtures for this probe and the cancellation probe, and the raw timings below, remain local
scratch evidence. This document records their inputs, method, outcomes, and limits; they are not a
shipped regression suite. An adoption PR should add package-owned tests that run from a fresh clone
and preserve the required boundary behavior.

## Measurements

### Measured results

**Observed in Effect 4.0.0-rc.117, Node.js 26.9.0 on Windows x64:** An exploratory benchmark
alternated case order over seven samples and reported medians. Import samples used fresh Node
processes with operating-system caches left intact; their timers excluded Node process startup. Heap
figures are retained heap deltas after explicit garbage collection, not peak memory or total process
RSS.

| Measurement                                                   | Median                                   |
| ------------------------------------------------------------- | ---------------------------------------- |
| Import the `effect` root and run a trivial synchronous effect | 245.91 ms; 13.66 MiB retained heap delta |
| Import `effect/Effect` and run the same operation             | 62.84 ms; 3.59 MiB retained heap delta   |
| Native map over 10,000 numbers                                | 0.0436 ms                                |
| One `Effect.sync` around the same native map                  | 0.0470 ms                                |
| One synchronous Effect per element through `Effect.forEach`   | 0.3268 ms                                |
| 32 concurrent cached local reads with `Promise.all`           | 0.9888 ms                                |
| The same reads with `Effect.forEach` and `tryPromise`         | 0.9970 ms                                |

For the array cases, the input was integers 0 through 9,999 and the operation added one to each
value. Each case had 30 warmup runs and 100 runs per sample; results were checked for equality and
their lengths consumed. For I/O, each case read the same small fixture source file 32 times as
UTF-8, with five warmups and 20 batches per sample. Both used unbounded concurrency within that
fixed batch. The Effect case passed an abort signal; the native case did not, so the comparison does
not isolate equal cancellation machinery. The import cases ran with `--expose-gc` and checked the
result of `runSync(succeed(42))`.

These measurements favor wrapping the complete collection operation in this workload: the absolute
difference from the native map was small, while an Effect per element took roughly 7.5 times the
native map's time. The I/O measurements were close in this workload. They do not establish
statistical equivalence, application throughput, or a universal overhead percentage.

The import comparison also loads different module sets. An application using Context, Layer, Scope,
and other modules will need more than `effect/Effect`. Neither figure is the startup cost of a
rewritten Pi package. Source-loaded packages do not gain bundler tree shaking; subpath imports are a
candidate to measure with the actual module set. Fresh-process import timings do not establish that
each command or reload repeats module evaluation; measure those host paths separately. Effect
documents both import forms in its
[import guide](https://effect.website/docs/v4/getting-started/importing-effect).

### Measurements to report

Report these measurements on the supported runtime for a package that adopts Effect:

- Cold Pi extension loading, first command, repeated command, reload, and session replacement.
- Root imports versus the proposed subpath-only convention, using every module the package needs.
- Retained and peak memory with many queued jobs, open interactions, and repeated cleanup.
- Cancellation latency for cooperative APIs and completion latency for protected writes.
- Event-loop delay during parsing, rendering, and filesystem work; large synchronous callbacks still
  block JavaScript execution, and fibers do not turn them into worker-thread computation.
- Throughput with bounded queues and concurrency, including failure and backoff cases.
- Type-check and editor responsiveness with realistic service graphs and error unions.

Use scripted providers and local fixtures for these measurements; model latency would hide small
execution costs and introduces variability.

### Applicability of the v3 myths discussion

The [v3 myths page](https://effect.website/docs/v3/additional-resources/myths) makes useful
architectural distinctions: ordinary arrays remain appropriate, generators are an optional way to
write workflows, the ecosystem need not be adopted in full, and Effect's core operations differ from
a stream-only model. V4 retains generator and pipeline composition with a separate Stream module.
These ideas support the boundaries proposed above.

Its performance rhetoric and gzipped bundle figures are not measurements of Orbis or v4. Do not
assume generators and native async functions have identical costs on every engine, or infer
source-loader memory from a bundled browser artifact. The local measurements are narrower evidence
and retain the limitations stated above.

## Gaps

- The interoperability probe and the measurements ran on Node.js 26.9.0, so compatibility with the
  declared minimum, Node.js 22.19.0, is not established. Establishing it requires offline tests and
  packed-package loading checks on Node.js 22.19.0 with supported Pi distributions.
- The interoperability probe did not run a full agent loop, exercise every host error rendering
  path, or verify a real `/reload` transition.
- This research does not establish full package conformance or a measured reduction in maintenance
  defects.
- Every item under [Measurements to report](#measurements-to-report) remains unmeasured.
- The cited effect.website v4 pages are unversioned; only the Effect API source link is pinned to
  `4.0.0-rc.117`.
