# Effect v4 for Orbis reference implementations

The research recommends Effect for the asynchronous workflows in `plan` and `tiered-memory`. Its
main advantage is a shared execution model for dependencies, failures, task lifetimes, cleanup,
concurrency, and timing. Pure domain transformations and rendering should remain ordinary
TypeScript. A smaller use in `theme-preview` warrants evaluation after design approval; `exit`
should keep its direct Pi integration.

This document delivers the investigation in [#48](https://github.com/kvnxiao/orbis/issues/48). The
investigation changes neither package contracts nor runtime dependencies. The assessment compares
candidate designs on maintainability, correctness, and runtime performance. Rewrite time, cost, and
effort are excluded from the decision.

## Motivation and assessment criteria

The research began with a preference for code that describes a process through its business
operations and dependencies. In some Orbis workflows, reading that process currently requires
following storage calls, conditional collection assembly, mutable state, UI decisions, and
cancellation bookkeeping together. Familiarity with Java/Kotlin reactive programming prompted the
question of whether TypeScript could express these workflows more clearly through Effect.

The assessment asks whether Effect improves that code after a well-designed rewrite. A shorter
function is useful when it exposes meaningful operations; moving every statement behind a helper or
replacing every loop with operators does not establish a better design. Local mutation inside a
parser or collection builder can remain clear and efficient.

The relevant comparison is with well-structured plain TypeScript, not with the current code left
unchanged. An adoption should make ownership, dependencies, failure handling, and cancellation
easier to inspect while preserving the approved behavior. Measured startup, memory, and interaction
costs must also be acceptable for a source-loaded Pi extension.

## Examined baseline and evidence

The package implementation baseline is
[`090a0c7`](https://github.com/kvnxiao/orbis/tree/090a0c7ff385ba990c05aa5d6904d95a18c01d57). Package
availability below describes that revision. API and compatibility conclusions use these specific
versions rather than an unspecified future release.

| Component                  | Examined version or constraint                                  |
| -------------------------- | --------------------------------------------------------------- |
| Effect                     | `4.0.0-rc.117` in an isolated scratch installation              |
| Pi SDK                     | `@earendil-works/pi-coding-agent` `0.87.0`                      |
| Development runtime        | Node.js `26.9.0`, Windows x64                                   |
| Declared extension minimum | Node.js `22.19.0`                                               |
| TypeScript                 | `7.0.2`, with the repository's strict source-only configuration |
| Package manager            | pnpm `12.5.1`                                                   |

The [v4 installation guide](https://effect.website/docs/v4/getting-started/installation) identifies
v4 as a release candidate installed through `effect@rc`, with TypeScript 5.9+ and Node.js 22.18+
support. Those advertised minimums overlap Orbis's declared versions; they do not substitute for
loading a packaged extension on Orbis's minimum runtime. The release-candidate API and ecosystem
compatibility remain adoption considerations even when rewrite effort is excluded.

Evidence has three levels: repository inspection establishes current code and specified behavior;
offline probes establish the limited interoperability and timings reported here; proposed package
designs are recommendations. This investigation does not establish full package conformance or a
measured reduction in maintenance defects.

| Package                                              | Available implementation                                                                                                                                                                | Recommendation                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`plan`](../packages/plan/SPEC.md)                   | A substantial reference implementation, including planning state, presentation, artifacts, and handoff                                                                                  | Use Effect for asynchronous workflow orchestration and resource ownership.                   |
| [`tiered-memory`](../packages/tiered-memory/SPEC.md) | Activation, configuration, role resolution, reports, storage, source registration, and curation protection; observer, consolidation, recall, and custom compaction delivery remain open | Use Effect for existing lifecycles and the specified processing workflows.                   |
| [`theme-preview`](../packages/theme-preview/SPEC.md) | Specification and interaction design; no runtime implementation. [#13](https://github.com/kvnxiao/orbis/issues/13) records pending full design approval                                 | Evaluate scopes, query timeouts, and refresh coordination when implementation is authorized. |
| [`exit`](../packages/exit/SPEC.md)                   | A small command that delegates shutdown to Pi                                                                                                                                           | Keep the direct implementation; it does not own a workflow that needs Effect.                |

The [extension template](../templates/extension/SPEC.md) scaffolds new packages; it is not another
approved package specification. The recommendation does not make Effect mandatory for every new
extension.

## What Effect changes

An `Effect<A, E, R>` describes an operation with a success value `A`, expected failures `E`, and
required services `R`. Constructing a deferred operation and executing it are separate actions.
Functions can assemble operations; callers can then supply dependencies and apply execution
policies. Re-running an operation can repeat its side effects. Laziness does not provide idempotency
or memoization. [Effect overview](https://effect.website/docs/v4/onboarding)

`Effect.gen` permits sequential code with `yield*`, branches, and local values. Pipelines are
another composition style. The choice can follow readability: a workflow with dependent steps often
reads well as a generator, while a transformation or attached policy can read well as a pipeline.
Neither syntax fixes a function that mixes too many responsibilities.
[Generators](https://effect.website/docs/v4/getting-started/using-generators)

A **fiber** is Effect's handle for a running computation. A **scope** owns resources and their
finalizers, which perform cleanup when the scope closes. **Services** describe dependencies;
**Layers** construct and provide them, including dependencies with resource lifetimes. These
mechanisms let a package define how work ends as well as how it begins.
[Fibers](https://effect.website/docs/v4/concurrency/fibers),
[scopes](https://effect.website/docs/v4/resource-management/scope),
[Layers](https://effect.website/docs/v4/requirements-management/layers)

### Value beyond typed errors

| Capability                                | Orbis use                                                    | Design benefit and limit                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured concurrency and scopes         | Presenter listeners, session-owned tasks, worker shutdown    | Ownership and cleanup share one model. External calls still need correct adapters.                                                                  |
| Typed services and Layers                 | Storage, presentation, model execution, and test substitutes | A workflow declares its dependencies; service construction can own resources. Passing narrow dependencies directly remains valid for small helpers. |
| Queues, semaphores, and bounded traversal | Memory backlog, shared inference capacity, independent reads | Capacity and waiting become explicit. The application chooses overflow and scheduling policy.                                                       |
| Schedules and timeouts                    | Retry budgets, worker duration, compaction waiting           | Reusable timing policies compose with failures and interruption. Safe repetition remains an application decision.                                   |
| TestClock                                 | Deadlines, backoff, and timed waiting                        | Effect clock operations can advance under test control. External timers and arbitrary races are not automatically controlled.                       |
| Tracing, logging, and metrics             | Queue, model, lock, and commit timings                       | Nested operations can retain diagnostic context. Exporters and Pi-facing reports still need integration.                                            |

These mechanisms can work together in a queued memory job: services supply dependencies, a permit
limits concurrency, a schedule retries eligible failures, and a scope releases resources when the
job ends. Tracing can record its timings. A result library can express and compose errors but does
not supply the same runtime facilities. Relevant v4 documentation covers
[queues](https://effect.website/docs/v4/concurrency/queue),
[semaphores](https://effect.website/docs/v4/concurrency/semaphore),
[schedules](https://effect.website/docs/v4/scheduling/using-schedules),
[TestClock](https://effect.website/docs/v4/testing/testclock), and
[tracing](https://effect.website/docs/v4/observability/tracing).

## Code structure is a separate responsibility

The repository's [code-design guidance](../AGENTS.md#code-design) sets language-independent
expectations for visible operation order, narrow dependencies, cohesive responsibilities, and
ownership of mutable state and resources. The TypeScript skill requires reading its architecture and
organization references before adding or extending a workflow.

The
[organization rules](../.agents/skills/pi-coding-agent-rules/references/typescript-code-organization.md)
explicitly permit a private helper with one caller when its contract removes details from the
caller's reasoning. They distinguish that decomposition from shared abstractions, trivial
forwarding, and helpers that exchange progress through mutable state. Review examines the workflow
and its helpers together; line counts alone do not establish a clear design.

The
[architecture rules](../.agents/skills/pi-coding-agent-rules/references/typescript-architecture.md)
permit loops and local collection mutation inside pure transformations. They require domain
decisions to remain understandable independently of I/O while preserving transaction scope and
revalidation before writes. The
[domain rules](../.agents/skills/pi-coding-agent-rules/references/typescript-domain-boundaries.md)
distinguish required variant payloads from independent optional data, retained history, and value
relationships that need runtime checks.

Inspection found concentrated responsibilities in `PlanningRuntime.interact` in
[`plan/src/pi/runtime.ts`](../packages/plan/src/pi/runtime.ts), and correlated optional fields
validated through separate checks in
[`plan/src/domain/state.ts`](../packages/plan/src/domain/state.ts). The return shape in
[`saveApproval`](../packages/plan/src/storage/approval.ts) also merits review for correlations
between outcome and error data. These observations identify places for design review; they do not
establish why earlier reviews accepted the code.

There are counterexamples: tiered-memory models storage lifecycle states as a discriminated union,
plan has pure state transformations, and document analysis uses local mutation for indexing and
normalization. A rewrite should preserve useful designs. The plan size-limit exemption remains in
[`oxlint.config.ts`](../oxlint.config.ts). Existing issues
[#37](https://github.com/kvnxiao/orbis/issues/37) and
[#41](https://github.com/kvnxiao/orbis/issues/41) track size limits and boundary parsing.

The guidance clarifies the expected design; package inspection must establish whether an
implementation applies it. These expectations apply equally to native TypeScript and Effect code.
Workflow decomposition and stronger domain types are baseline improvements, so the evaluation must
not attribute their benefits to Effect. The Effect recommendation rests on its execution facilities
for dependencies, failures, lifetimes, concurrency, and timing. Introducing a service needs a
dependency or resource lifetime boundary; sequencing a fixed set of calls alone does not justify
one.

## Proposed package use

### Plan

Plan's strongest fit is the interaction lifecycle. Its
[presentation contract](../packages/plan/SPEC.md#req-public-presentation-boundary--public-presentation-boundary)
requires cleanup on completion, replacement, withdrawal, and teardown, with distinct fallback and
cancellation outcomes. The
[interaction scenarios](../packages/plan/docs/tui-interactions.md#terminal-and-integration-scenarios)
also require old cleanup to leave replacement work intact.

| Workflow                                     | Proposed Effect functionality                                          | Behavior that remains explicit                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Prepare and run an interaction               | `Effect.gen`, narrow services, scoped execution                        | Select current state, recover artifacts when permitted, and choose the presenter.               |
| Own presenter listeners and concurrent waits | `Scope`, `acquireRelease`, child/scoped fibers                         | Match cleanup to the owning session and interaction; preserve unfinished drafts.                |
| Await a presenter or control event           | `Effect.callback` or `Deferred`, `Effect.raceFirst`                    | Distinguish withdrawal, fallback, user cancellation, and completed input.                       |
| Accept a result                              | Typed outcomes and failures                                            | Check identity and displayed revision before applying a pure domain transition.                 |
| Save approval                                | Interruption control around the required persistence sequence          | Bind approval to exact reviewed bytes and preserve recovery state on partial failure.           |
| Report failures and complete a Pi callback   | `Exit`/`Cause` interpretation at the adapter                           | Preserve the package's public outcome shapes and remediation rules.                             |
| Test replacement and timing                  | Test Layers, explicit completion signals, TestClock where timers exist | Verify stale callbacks, draft persistence failures, and ordering from the interaction contract. |

`Effect.raceFirst` selects the first completion, including failure; `Effect.race` selects the first
success. Replacing the current `Promise.race` with `Effect.race` would change semantics. Effect also
interrupts losing fibers, so adapter cleanup is part of the behavior being reviewed.
[Concurrency and racing](https://effect.website/docs/v4/concurrency/basic-concurrency)

The workflow should remain readable as: capture identity, prepare presentation, await input,
validate the result, apply a transition, persist, and perform any permitted handoff. State reducers,
Markdown analysis, annotation mapping, layout, and rendering can remain ordinary functions. Neither
user review nor question input needs an automatic timeout merely because the library offers one.

Preserve the synchronous draft-update callback and structural error contract in
[`presentation.ts`](../packages/plan/src/presentation.ts). An external presenter does not need to
import Effect. Preserve Pi's shared `withFileMutationQueue` for native settings in
[`config.ts`](../packages/plan/src/storage/config.ts); a package-local semaphore cannot coordinate
other writers that use the host queue.

[`handoff.ts`](../packages/plan/src/pi/handoff.ts) uses command-context session controls and the
fresh destination context when dispatching implementation. A rewritten runtime must not wait for its
own shutdown while holding the operation needed to finish the handoff. Session replacement must also
create usable resources for the new session; a disposed runtime cannot simply be reused.

### Tiered memory

The implemented [`MemoryRuntime`](../packages/tiered-memory/src/pi/runtime.ts) manually registers
job controllers and invalidates pending results on stop or replacement. Scopes and fibers could own
that work while explicit session, lineage, and revision checks continue to govern commits. Storage
reads and writes can be exposed through narrow Effect services; candidate classification and
snapshot decisions in [`store.ts`](../packages/tiered-memory/src/storage/store.ts) can be separated
into ordinary domain functions where that improves clarity.

The strongest prospective fit is the specified processing work. The
[resource contract](../packages/tiered-memory/SPEC.md#resource-budgets--req-resource-budgets)
requires serial automatic inference by default, bounded queues, retries, job duration, and
compaction waiting. Those are concrete requirements for Effect's execution facilities.

| Specified workflow                                        | Proposed functionality                                                            | Required application policy                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Observe new source spans and update the current-work note | Bounded `Queue`, scoped worker, model service                                     | Preserve source boundaries, reserve note capacity, and leave deferred sources on disk.                            |
| Consolidate topics and project learnings                  | A serial worker; `Semaphore` if several paths share inference capacity            | A single queue consumer may already provide serialization; add a semaphore only for shared capacity across paths. |
| Retry eligible processing failures                        | `Schedule` and retry operators                                                    | Bound attempts and elapsed time, classify safe retries, and account for SDK retries.                              |
| Prepare compaction                                        | Timeout operators and a specific job's completion signal                          | Wait only for relevant coverage; distinguish the caller's wait from independently owned background work.          |
| Recall sources and read independent records               | Bounded `Effect.forEach`/`Effect.all`; `Stream` when incremental processing helps | Bound output and preserve provenance, authority, and visibility rules.                                            |
| Stop, disable, or replace a session                       | Owned fibers and resource finalizers                                              | Reject stale results and retain committed data; cancellation must not initiate native compaction fallback.        |
| Report processing status                                  | Spans, structured logging, and metrics                                            | Keep known provider usage separate from estimates; persist reports required by the SPEC.                          |
| Exercise budgets and failures                             | TestClock and scripted service Layers                                             | Test exhausted retries, cancellation, partial writes, and a foreground deadline with unrelated work still queued. |

An observer could acquire the inference slot, select sources, run the model, validate its proposal,
and commit only if the source and revision checks still pass. Budget and tracing policies would
apply to the relevant operations. A timeout around the whole workflow counts queue waiting and
retries against the deadline. A timeout applied separately to each model attempt excludes queue
waiting and starts again on each retry.

The storage protocol is a separate correctness concern:

- [`lock.ts`](../packages/tiered-memory/src/storage/lock.ts) coordinates independent processes using
  filesystem operations. An in-memory Effect semaphore does not replace that protocol.
- [`writeCommit`](../packages/tiered-memory/src/storage/commit.ts) checks cancellation until the
  head is written. After commitment, started view writes finish before releasing the project lock,
  including when another write fails. Preserve this with explicitly protected execution and
  completion of started writes, rather than a default fail-fast traversal.
- [`writeDurable`](../packages/tiered-memory/src/storage/files.ts) performs filesystem durability
  operations without observing cancellation. A wrapper must wait for such writes before releasing
  resources they still use.
- Curation exclusions, exact source coverage, compare-before-commit checks, and recovery of
  materialized views remain domain/storage logic. Effect does not infer those invariants.

The open delivery work under [#12](https://github.com/kvnxiao/orbis/issues/12), including
[#21](https://github.com/kvnxiao/orbis/issues/21),
[#22](https://github.com/kvnxiao/orbis/issues/22),
[#23](https://github.com/kvnxiao/orbis/issues/23), and
[#24](https://github.com/kvnxiao/orbis/issues/24), provides a place to apply the recommendation
after implementation plans are revised. This research does not mark those features implemented.

### Theme preview

Theme preview has a narrower prospective use, pending full design approval. The
[view-lifetime requirements](../packages/theme-preview/SPEC.md#updates-and-view-lifetime) require
bounded terminal queries, coherent refreshes, stale-result rejection, and repeatable cleanup. A view
scope can own listeners and query work; timeout operators can bound background queries; fibers can
coordinate replacement queries; TestClock can exercise deadlines. A serial operation can protect
saves within one view.

Color conversion, contrast calculations, fixture generation, coverage derivation, and rendering
should remain ordinary functions. Rendering must remain free of I/O and mutation. Closing the view
must use Pi's completion callback without aborting the agent. A small lifecycle implementation may
remain clear with native promises and signals, so this package's recommendation is conditional on
its concrete design rather than ecosystem consistency alone.

### Exit

[`exit/src/index.ts`](../packages/exit/src/index.ts) registers one command and calls
`ctx.shutdown()`. Pi owns graceful shutdown. Introducing an Effect runtime would add a second
execution mechanism without a package-owned process to coordinate. Keep this package native.

## Pi integration and adoption constraints

### Run at host boundaries

Pi keeps its public commands, tools, event handlers, contexts, and Promise-returning contracts.
Package workflows can return Effects internally. A `ManagedRuntime` supplies services and runs them
at the adapter boundary; the adapter interprets completion and returns the host's expected result.
Runtime ownership must distinguish extension registration, session resources, and individual
operations. Avoid running a separate Effect runtime in every internal helper.
[ManagedRuntime integration](https://effect.website/docs/v4/runtime)

Construct Promise-based work inside `Effect.tryPromise` so each execution starts the intended
operation and can receive its cancellation signal. Map expected adapter failures to meaningful error
types without treating every programming defect as a recoverable condition. Callback adapters must
unregister listeners on completion or interruption. V4 uses `Effect.callback`, `Context.Service`,
and `Result`; v3 examples using different names need version-specific checking.
[Creating Effects](https://effect.website/docs/v4/getting-started/creating-effects)

When an exit contains interruption together with a real failure, the boundary must not suppress the
failure merely because an abort signal is also set. Preserve the distinction among user
cancellation, supersession, expected operational failure, and unexpected defects. Keep error
recognition structural across independently loaded extensions rather than relying on class identity.
Pi-facing error behavior still follows the
[failure-signaling rules](../.agents/skills/pi-coding-agent-rules/references/pi-failure-signaling.md).

### Cancellation and durability

Effect interruption can stop waiting for a Promise, but cannot stop an external operation that
ignores cancellation. The offline probe confirmed that a scope finalizer can run before such a
Promise finishes. Passing an `AbortSignal` is necessary for cooperative APIs; uninterruptible
operations require an explicit completion policy before dependent resources are released.

Scopes and finalizers operate while the runtime can execute cleanup. They do not provide crash
recovery, filesystem atomicity, or exactly-once model calls. Queues are in memory, and ordinary
schedules do not persist jobs through process downtime.
[Queue](https://effect.website/docs/v4/concurrency/queue),
[schedule lifetime](https://effect.website/docs/v4/scheduling/using-schedules)

Retain persisted receipts, approval intent, durable heads, source coverage, and recovery logic. Do
not automatically retry approval, handoff, or an ambiguously completed mutation. A synchronous Pi
event producer also does not acquire backpressure merely because a consumer uses a bounded queue;
the adapter must define coalescing, rejection, or deferral when capacity is exhausted.

### Schemas, packaging, and host ownership

Orbis requires TypeBox for boundary validation through its package parse helper. Retain that
contract and Pi tool schemas. Effect services can call the existing parser and map its failure.
Adopting Effect Schema would be a separate design/tooling choice; maintaining two definitions of the
same boundary format would add inconsistency. Schema conversion alone does not prove Pi's generic
tool typing or loader compatibility.

Each importing package would declare Effect as an ordinary runtime dependency. Preserve source-only
exports, explicit relative `.ts` imports, external Pi dependencies, and the repository compiler
constraints. Pin and verify a selected v4 release before relying on its exact APIs. Avoid exposing
Effect objects through public presenter protocols or persisting runtime objects; plain records
reduce coupling between separately installed packages. These are proposed adoption boundaries, not
changes made by this document.

Pi continues to own provider credentials, model selection, trust decisions, session control, and its
agent loop. Effect can wrap authorized SDK calls; its AI or platform modules are not a reason to
replace these host responsibilities. Services should receive the appropriate current context and
must not retain an obsolete command context for later use.

### Optional facilities

`Stream` can help incremental source traversal, and `Cache` can share overlapping expensive lookups.
Neither is required for every workflow. Cache keys must include the relevant identity or revision,
and caches must not suppress curation or freshness checks. `Ref` or `SubscriptionRef` may help
genuinely shared state; they do not replace domain state modeling or make arbitrary mutations safe.
Introducing HTTP, SQL, a distributed workflow engine, or a second agent framework would require an
actual package requirement. [Streams](https://effect.website/docs/v4/stream/introduction),
[Cache](https://effect.website/docs/v4/caching/cache)

## Alternatives

These options address different parts of the problem. The comparison concerns their fit for Orbis
workflows and excludes introduction effort.

| Approach                                                                                      | What it provides                                                                                       | Assessment for Orbis                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Well-structured TypeScript with native promises                                               | Pure functions, discriminated unions, explicit dependency parameters, `AbortSignal`, and `try/finally` | A credible baseline and sufficient for small extensions. Larger workflows still need a consistent ownership and scheduling design.                             |
| [neverthrow](https://github.com/supermacro/neverthrow)                                        | `Result`/`ResultAsync`, typed failure propagation, composition, and recovery                           | The strongest focused alternative when errors are the main concern. Pair it with explicit lifecycle and scheduling mechanisms for these packages.              |
| [Remeda](https://remedajs.com/)                                                               | Typed functional collection utilities and pipelines                                                    | Useful for complex data transformations; it does not coordinate asynchronous resource lifetimes. Native array operations may already be clearer.               |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern)                                         | Pattern matching and exhaustive handling of variants                                                   | Useful for state/outcome decisions. It complements domain modeling rather than providing a workflow runtime.                                                   |
| [RxJS](https://github.com/ReactiveX/rxjs/blob/master/apps/rxjs.dev/content/guide/overview.md) | Observable composition, event operators, subscriptions, and schedulers                                 | A candidate for event-heavy interfaces. For these operation-oriented workflows, Effect's typed dependencies and resource model are the closer fit.             |
| [XState](https://stately.ai/docs/xstate)                                                      | State machines, statecharts, and actors for explicit transitions and coordination                      | Worth considering if plan's state-transition complexity dominates. Effect addresses execution; a reducer or state machine still defines permitted transitions. |
| [fp-ts](https://github.com/gcanti/fp-ts)                                                      | Functional data types and abstractions such as task/error/environment composition                      | Its own project identifies Effect as its successor. It is not the preferred starting point for this new runtime design.                                        |
| Effect used throughout every function                                                         | One ecosystem for data and execution                                                                   | Uniform syntax alone does not justify wrapping rendering, arithmetic, and trivial commands.                                                                    |
| Effect for substantial workflows, ordinary TypeScript for pure code                           | Shared execution semantics with direct domain operations                                               | Recommended for plan and tiered-memory, with narrower evaluation elsewhere.                                                                                    |

XState and Effect could coexist, but two coordination systems need distinct ownership. A reducer
plus Effect is a simpler initial proposal unless statechart tooling solves a demonstrated problem.
Likewise, an Effect package does not automatically need neverthrow, Remeda, and ts-pattern as well;
add another dependency only for a remaining need.

The runtime tradeoff is real: maintainers must understand lazy execution, interruption, scopes, and
dependency provision. Service graphs can become oversized, broad error unions can hide useful
distinctions, and excessive wrapping can obscure a simple operation. These are properties of the
resulting design, independent of rewrite effort. Restrict the initial conventions to the mechanisms
the package actually needs and review their application.

## Interoperability probe

An isolated fixture extension imported Effect and registered a TypeBox-defined Pi tool. The tool
used a `Context.Service`, a provided Layer, a managed runtime, a tagged failure, and a scoped
resource. Its modes returned a value, failed, or waited on a cancellable Node timer. The installed
Pi extension loader loaded the source through the actual loading path.

The local checks passed for:

- Source loading and tool registration through Pi `0.87.0`.
- A successful Promise-returning tool result and a tagged failure translated at the boundary.
- Forwarding a tool signal to the wrapped timer and running its scope finalizer once.
- Disposing the runtime with work pending through an invoked shutdown handler.
- Loading a fresh extension instance and running it after the previous instance was disposed.
- Type checking the fixture against `tsconfig.base.json`, including `erasableSyntaxOnly`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

The harness called registered tool and shutdown handlers directly and used the installed SDK's
internal loader as a test entry point. It did not run a full agent loop, exercise every host error
rendering path, or verify a real `/reload` transition. No model calls or live provider traffic were
used. Production code would continue importing public Pi APIs.

A separate controlled probe started a Promise that ignored cancellation, interrupted its enclosing
Effect, and observed resource cleanup before allowing the Promise to finish. This is the evidence
for the storage warning above. It also prevents treating interruption of a wrapper as proof that the
wrapped work has stopped.

The fixtures and raw timings remain local scratch evidence. This document records their inputs,
method, outcomes, and limits; they are not a shipped regression suite. An adoption PR should add
package-owned tests that run from a fresh clone and preserve the required boundary behavior.

## Performance

### Measured results

An earlier exploratory benchmark used the versions in the baseline table. It alternated case order
over seven samples and reported medians. Import samples used fresh Node processes with
operating-system caches left intact; their timers excluded Node process startup. Heap figures are
retained heap deltas after explicit garbage collection, not peak memory or total process RSS.

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
candidate to measure with the actual module set. Effect documents both import forms in its
[import guide](https://effect.website/docs/v4/getting-started/importing-effect).

### What remains to measure

Before adopting the dependency in a package, compare equivalent workflows on the supported runtime:

- Cold Pi extension loading, first command, repeated command, reload, and session replacement.
- Retained and peak memory with many queued jobs, open interactions, and repeated cleanup.
- Cancellation latency for cooperative APIs and completion latency for protected writes.
- Event-loop delay during parsing, rendering, and filesystem work; large synchronous callbacks still
  block JavaScript execution, and fibers do not turn them into worker-thread computation.
- Throughput with bounded queues and concurrency, including failure and backoff cases.
- Type-check and editor responsiveness with realistic service graphs and error unions.

Use existing plan benchmarks in
[`performance.bench.mts`](../packages/plan/tests/performance.bench.mts) where their operations match
the rewrite. Use scripted providers and local fixtures for comparisons; model latency would hide
small execution costs and introduces variability. Native and Effect cases should provide the same
cleanup, cancellation, concurrency, and reporting guarantees. Agree on absolute latency and memory
budgets before declaring the rewrite a performance success.

### Applicability of the v3 myths discussion

The [v3 myths page](https://effect.website/docs/v3/additional-resources/myths) makes useful
architectural distinctions: ordinary arrays remain appropriate, generators are an optional way to
write workflows, the ecosystem need not be adopted in full, and Effect's core operations differ from
a stream-only model. V4 retains generator and pipeline composition with a separate Stream module.
These ideas support the proposed boundaries.

Its performance rhetoric and gzipped bundle figures are not measurements of Orbis or v4. Do not
assume generators and native async functions have identical costs on every engine, or infer
source-loader memory from a bundled browser artifact. The local measurements are narrower evidence
and retain the limitations stated above.

## Recommended next steps

1. **Accept a package-specific direction.** Choose Effect for plan and tiered-memory workflow
   execution, ordinary TypeScript for pure domain code and rendering, conditional lifecycle use for
   theme-preview, and direct Pi integration for exit. Treat the recommendation as a design choice
   for reference implementations, not a requirement for independent SPEC implementers.
2. **Apply the current coding guidance.** Review workflows and their helpers together for meaningful
   decomposition, valid state modeling, narrow dependencies, and visible resource ownership.
   Preserve transaction boundaries and stale-result checks during extraction. Use these standards
   for both native TypeScript and Effect designs so the comparison isolates Effect's contribution.
3. **Write concrete implementation designs.** Define each runtime and scope owner, service boundary,
   public adapter, cancellation path, and protected storage phase. Keep existing contracts unless an
   explicit behavior change is approved. Reconcile related open issue plans instead of creating a
   parallel plan for the same functionality.
4. **Establish compatibility with a representative workflow in each package.** For plan, include
   presenter withdrawal, stale results, approval recovery, and fresh-session handoff. For memory,
   include disable/shutdown, interrupted writes, lock release ordering, and revision conflicts. A
   bounded validation slice tests the architecture; it does not limit the eventual rewrite for
   reasons of time or effort.
5. **Promote evidence into maintained checks.** Add offline package tests, run equivalent before and
   after benchmarks, load packed packages on Node.js 22.19.0 and supported Pi distributions, and
   verify host-facing failures. Standalone compatibility should be tested only where claimed. The
   probe has not established these release conditions.
6. **Proceed with the broader rewrite when the design passes those checks.** Use queues, schedules,
   TestClock, and observability as the specified memory workflows are implemented. Review the chosen
   v4 release and any necessary lint/schema conventions explicitly. Keep package-specific
   abstractions local until multiple packages actually share behavior.

The acceptance criteria are visible business steps, explicit task and resource ownership, preserved
domain safeguards, reproducible failure-path tests, and acceptable measured runtime costs.
Reconsider the scope of Effect if an implementation adds indirection without removing coordination
machinery, cannot preserve host contracts, or exceeds agreed performance budgets. The approved
memory workflows and plan's existing interaction requirements provide concrete cases for evaluating
this direction without relying on speculative ecosystem features.
