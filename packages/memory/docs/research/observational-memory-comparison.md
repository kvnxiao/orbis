# Observational memory, activation, and current work

Research date: 2026-10-03. This comparison uses the two pinned Pi implementations described in
[observational memory](observational-memory.md) and Mastra's published memory package. It compares
mechanisms, not measured superiority or runtime compatibility with Orbis.

## Three different meanings of reflection

| Approach              | Transformation                                                                                 | Separate consequence                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Amos topics           | File older observations into subject notes and update a descriptive journey.                   | Mutable external history needs ownership and branch policies.               |
| Elpapi v3 reflections | Append conclusions with supporting observation references; later drop records from active use. | The active view can shrink while evidence remains in the ledger.            |
| Mastra reflection     | Condense the active observation log, including previously reflected content.                   | Repeated rewriting can lose detail; source recall is a separate capability. |

These are not interchangeable tiers. A package that needs bounded active context can choose among
several mechanisms; their shared name does not establish the same retention or correction behavior.

## Mastra baseline and release boundary

The checked stable release is `@mastra/memory` 1.35.0, published on 2026-10-01 from
[b21e46e](https://github.com/mastra-ai/mastra/tree/b21e46e19b469a25c8896bcee90afd58d6f1a890).
Current HEAD is
[b2433eb](https://github.com/mastra-ai/mastra/tree/b2433eb8d90597295de0327c3756d7a2b83a65ff),
2026-10-03, with manifest 1.36.0-alpha.2. Stable and HEAD behavior are separated below. Mastra is a
host-level context processor with storage integration, not a Pi extension.

### Prepare first, activate separately

Mastra can prepare observation buffers before older messages need replacement. It activates prepared
content under context pressure and can process synchronously when preparation is insufficient.
Default message/observation thresholds are approximately 30k/40k tokens; these are activation
thresholds, not strict maximum request sizes. Reflection condenses observations as a separate stage.
[Stable processor](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/observational-memory.ts).

Current development changes add provider-specific idle activation lifetimes and corrections to live
pending-token accounting. Activation rechecks whether it actually relieved pressure. These are HEAD
findings, not stable 1.35.0 features.
[HEAD processor](https://github.com/mastra-ai/mastra/blob/b2433eb8d90597295de0327c3756d7a2b83a65ff/packages/memory/src/processors/observational-memory/observational-memory.ts),
[activation lifetime](https://github.com/mastra-ai/mastra/blob/b2433eb8d90597295de0327c3756d7a2b83a65ff/packages/memory/src/processors/observational-memory/activation-ttl.ts).

This reinforces two different questions for Orbis: has evidence been prepared, and may the host's
specific discarded span be replaced now? A background worker completing does not answer both.

### One response can maintain current work, with an async qualification

Mastra's
[built-in extractors](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/built-in-extractors.ts)
can update observations and structured continuation metadata in one response. Current-task
extraction asks about primary work, pending/waiting work, and activity begun without approval.
Suggested responses are a different extractor. Keeping work state distinct from prescribing the
acting model's next sentence is useful for the core snapshot.

However, asynchronous buffering passes `skipContinuationHints: true`, and observer filtering omits
current-task and suggested-response extractors. The background observer call also receives no abort
signal there, although later persistence/extraction steps use the supplied signal. These files have
identical stable and HEAD blobs. It would be incorrect to claim that every background observation
refreshes current work or inherits the acting request's cancellation.
[Async buffer](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/observation-strategies/async-buffer.ts),
[observer runner](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/observer-runner.ts).

### Recall is separate from active observation scope

Source ranges connect observation groups to messages. Raw-message browsing does not require a vector
store; semantic search adds indexing requirements. Recall can page original observations and raw
message parts. Default retrieval scope can be resource-wide even when active observations are
thread-scoped. Guidance distinguishes a search miss from missing history and identifies reflection
as lossy.
[Recall tools](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/tools/om-tools.ts),
[observation paging](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/tools/om-observations.ts),
[guidance](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/constants.ts).

This supports bounded discovery plus exact retrieval without making vector search mandatory. It does
not supply Pi's branch policy: scope must be defined separately for source selection, active memory,
and each retrieval operation.

### Retries are not elapsed deadlines

Stable 1.35.0 supports per-stage retries and failure policy. Defaults are eight retries and abort on
exhaustion. Continuing after failure retains failed input for later processing; it does not permit
advancing the observed boundary or dropping uncovered source. Underlying model retries are disabled
in favor of this retry owner.

The default backoff totals 247 seconds before jitter and model time. This is finite retry
scheduling, not a total elapsed bound. Static in-process coordination maps do not establish
distributed locking.
[Retry implementation](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/retry.ts),
[coordination](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/buffering-coordinator.ts).

### Knowledge maintenance and risky transfer of prompt assumptions

Optional working-memory maintenance and the separate `subconscious` subsystem support broader
curation, pinned state, and reminders. This is evidence that compression, retrieval, and maintained
knowledge can use different policies. It does not establish that every subsystem was enabled in a
reported observational-memory benchmark.
[Knowledge subsystem](https://github.com/mastra-ai/mastra/tree/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/subconscious),
[working-memory extractor](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/working-memory-extractor.ts).

One current
[context instruction](https://github.com/mastra-ai/mastra/blob/b21e46e19b469a25c8896bcee90afd58d6f1a890/packages/memory/src/processors/observational-memory/constants.ts#L85)
tells the model to assume past planned actions happened unless contradicted. That policy should not
transfer to the core's distinction between attempted and verified work. This is a prompt-content
finding, not a measured rate of false completion.

## Comparison against the selected core direction

| Concern                 | Amos                                       | Elpapi development HEAD                         | Mastra stable                                    | Proposed Orbis direction                                              |
| ----------------------- | ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Preparation             | Background Pi workers                      | In-process role pipeline                        | Buffered observer with activation                | One observer response for snapshot and observations.                  |
| Current work            | Descriptive journey, no protected snapshot | No separate protected snapshot                  | Structured task extractor, omitted in async path | Explicit continuation snapshot; exact freshness contract open.        |
| Older detail            | External topics and historical ledger      | Retained observations/reflections, active drops | Reflected log with optional source paging        | Retain observations and original evidence; no required consolidation. |
| Coverage at replacement | Incomplete-span risks                      | Catch-up, gap retention, fallback               | Preparation and activation checks                | Preserve Pi's cut; incomplete-source policy remains open.             |
| Retrieval               | Ordinary detailed-file access              | Exact-ID recall                                 | Discovery and paging, optional semantic search   | Bounded source discovery and exact lookup; interface open.            |
| Scope                   | Mixed ledger and mutable session files     | Selected branch                                 | Thread/resource configuration                    | Selected session lineage; broader knowledge deferred.                 |
| Bounds                  | Chunk and role defaults                    | Context-relative selection and role limits      | Retry policy and thresholds                      | Finite input/output/work/recall limits; values open.                  |

The Orbis column records the agreed direction and unresolved details; it is not a statement that the
package is implemented or outperforms the comparators.

## Supported implications and unanswered questions

**Keep one-response current-work maintenance as a candidate implementation.** Mastra shows that the
output shape is practical, but its async exception shows why the update policy must be explicit.
There is no evidence here that the added snapshot is free in tokens or latency.

**Keep source discovery separate from exact-ID lookup.** A model cannot use an ID it never received.
The combination of search and source expansion addresses a different failure from returning a
well-attributed known record.

**Defer extra model roles unless they solve a measured problem.** Reflection and active-record
dropping are options for maintaining a bounded representation, not prerequisites for the selected
MVP. If archival growth or poor discovery later causes failures, evaluate a specific remedy.

**Keep capability and efficacy separate.** No controlled Pi coding comparison establishes an optimal
tier count or role pipeline. Vendor benchmark scores do not establish Orbis continuation quality.
Framework dependencies and storage integration also differ from a standalone Pi extension; adopting
an idea does not imply adopting that stack.
