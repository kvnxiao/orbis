# Provider compaction, prompt caching, and memory

Research date: 2026-10-04. This analysis compares provider documentation with Pi 1.0.1 source. It
separates provider API contracts, Pi's integration, and proposed Orbis behavior. No provider
requests or cache measurements were run.

## Three different operations

| Operation                      | Result                                                     | What it does not establish                                              |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Compaction                     | A shorter representation replaces earlier request context. | The compressed representation preserves every useful fact.              |
| Prompt caching                 | Compatible repeated input reuses provider computation.     | History is compressed, searchable, or semantically preserved.           |
| Memory construction and recall | Selected state and evidence are retained for later use.    | All retained information is routinely visible or correctly interpreted. |

Preparing observations can avoid a foreground summary call when a checkpoint is ready. It adds
background work and does not automatically reduce total task cost. Replacing context can require new
cache computation even if the summary itself was prepared efficiently.

## Why compaction-related caching matters

A long acting conversation can have a large reusable prefix. A separate summary request that changes
its early instructions or message structure may process that history again. This work occurs near
context pressure, when the input can be largest. The cost is especially visible when local prefill
is slow or hosted uncached input is expensive relative to cache reads.

That summary-generation cost is distinct from continuing with a shorter history:

| Request                        | Simplified prefix                                                            | Reuse opportunity                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Before compaction              | Stable instructions/tools, old conversation, recent turns.                   | Previously established conversation prefix.                                                    |
| Summary with compatible layout | Same instructions/tools and source prefix, followed by summary instructions. | Eligible cached source prefix, if request settings also match.                                 |
| First continuation             | Stable instructions/tools, new checkpoint, retained turns.                   | Eligible unchanged content before replacement; the changed conversation needs new computation. |
| Later continuation             | Same checkpoint and retained turns, then appended activity.                  | Newly established compacted prefix while it remains compatible and available.                  |

Retaining recent messages verbatim preserves their information and tool relationships, but moving
them after a new checkpoint changes their prefix position. A stable routing key cannot repair that
change. Compaction does not create a permanently uncached session: later turns can reuse the new
prefix. Warming moves initial processing earlier and can reduce visible waiting; it still incurs
work. A smaller context can also outweigh the one-time cache disruption over subsequent turns.
[OpenAI caching guidance](https://developers.openai.com/api/docs/guides/prompt-caching),
[Anthropic caching guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

For a prepared-memory design, checkpoint rendering can avoid the usual foreground summary call. That
does not eliminate observer inference, bounded catch-up, instructed presentation, capacity repair,
or native fallback. Their frequency and complete task cost determine whether further cache
optimization is worthwhile. No numerical break-even point is established by this research.

## Harness request construction

| Path                        | Inspected or documented construction                                                                                                                          | Qualification                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Claude Code compaction fork | Preserves parent system context, tools, and conversation, then appends summary instructions.                                                                  | Anthropic's engineering account, not independent tracing of every current request.                                     |
| Pi 1.0.1 native summary     | Dedicated summarization instructions and a transcript flattened into one user message.                                                                        | Does not preserve the acting request's rendered prefix.                                                                |
| Codex local compaction      | History copy plus user compaction prompt and current base instructions; remaining prompt fields default to empty top-level tools and disabled parallel calls. | Copied messages alone do not establish a complete prefix match; history can also contain incremental tool definitions. |
| Codex remote v2             | Current base instructions and acting-path tool policy, parallel calls enabled, and a compaction trigger.                                                      | Can trim tool history and clears the output schema; compaction effort selection differs.                               |

The Codex findings use public source HEAD `b8dceb0d4f29e49e73daa08f57fcf5181186f354`, dated
2026-10-04. Relevant files differ from released `rust-v0.160.0`; these are not release claims.
Remote v2 can supply tool definitions through history and then leave top-level tools empty. Its
cache accounting records measurement fields, not a demonstrated hit rate or the private service's
summarization algorithm.

Sources:
[Claude Code account](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/#compacting-without-breaking-the-cache),
[Pi summary construction](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts),
[Codex local builder](https://github.com/openai/codex/blob/b8dceb0d4f29e49e73daa08f57fcf5181186f354/codex-rs/core/src/compact.rs),
[prompt defaults](https://github.com/openai/codex/blob/b8dceb0d4f29e49e73daa08f57fcf5181186f354/codex-rs/core/src/client_common.rs),
[remote builder](https://github.com/openai/codex/blob/b8dceb0d4f29e49e73daa08f57fcf5181186f354/codex-rs/core/src/compact_remote_v2_attempt.rs),
[remote stream/accounting](https://github.com/openai/codex/blob/b8dceb0d4f29e49e73daa08f57fcf5181186f354/codex-rs/core/src/compact_remote_v2.rs).

## OpenAI compaction

Current official
[OpenAI compaction documentation](https://developers.openai.com/api/docs/guides/compaction)
describes threshold-triggered compaction within Responses and the standalone `/responses/compact`
endpoint. Both use opaque encrypted compaction state. Standalone output can include retained items
as well as the compaction item; its returned window is passed onward intact. Input still needs to
fit the model's context. Input-array continuation, standalone output, and `previous_response_id`
chaining have distinct rules.

These are provider-specific request representations. They are not Pi's readable checkpoint string, a
session observation ledger, or a source archive. A package cannot treat the encrypted item as
ordinary summary text while assuming the provider's continuation guarantees remain intact.

## Anthropic compaction

Anthropic currently documents two distinct entry mechanisms.

| Mechanism                                                                                          | Documented protocol                                                                                                                              | Implication                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| [On-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand) | `compact-2026-09-04` beta with `compaction: {type: "summarize"}`; signed compaction block; valid conversation boundary and input within context. | Preserve the returned block and follow its continuation protocol. Do not combine it with threshold compaction in the same request. |
| [Threshold compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) | Separate `compact-2026-01-12` API; supports instructions and pausing after compaction.                                                           | Additional compaction work appears in `usage.iterations`; top-level input/output counts exclude those iterations.                  |

The
[keep-recent-turns pattern](https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns)
sends an older prefix for compaction and places retained turns after the result. The
[background pattern](https://platform.claude.com/docs/en/build-with-claude/compaction-background)
records the submitted prefix, allows append-only growth, and replaces only that prefix after
completion. On failure it retains the original history.

Those examples support explicit prefix identity and stale-result handling. They do not establish
that Pi already exposes provider blocks, or that an Orbis observer can replace any source that
arrived after its input snapshot.

## Pi 1.0.1 does not expose these as native checkpoint mechanisms

The published provider runtime and declarations did not expose provider `compaction` content or
`context_management` request support in the inspected paths. Pi's normalized assistant content is
text, thinking, and tool calls. OpenAI compaction items have no preservation path in that content
model; Anthropic's stop-reason mapping does not recognize compaction, and ordinary usage
normalization does not account for compaction iterations.

Sources:
[Anthropic adapter](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/anthropic-messages.ts),
[OpenAI Responses adapter](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/openai-responses.ts),
[Responses normalization](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/openai-responses-shared.ts).

This is source evidence of an integration gap, not a live compatibility experiment. Injecting a
provider field into a request would not establish correct response handling, replay, persistence,
billing, or recovery. Provider compaction should remain a separately assessed capability unless a
complete integration contract is selected.

## Cache contracts are provider and model specific

[OpenAI's current caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching)
distinguishes newer explicit/implicit controls from older retention behavior. Matching depends on
the rendered prefix and configuration. Tools, instructions, reasoning settings, and compaction
settings can affect reuse. Reads, writes, and uncached input have different accounting. An older
description of automatic caching is not a universal description of every current model or transport.

[Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) follows
the ordered tools/system/messages prefix. It supports explicit breakpoints and top-level automatic
`cache_control`. Writes occur at designated breakpoints; lookup searches up to 20 block positions
for previously written entries, not arbitrary unchanged text. Five-minute and one-hour lifetimes
have different write costs. Lifetimes begin at request start, reads refresh them, and longer-lived
breakpoints precede shorter-lived ones when mixed.

The
[compaction guidance](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold#prompt-caching)
recommends a separate system-prompt breakpoint. Without an eligible prior entry, unchanged system
text can still need recaching after history replacement. Current documentation also permits
`max_tokens: 0` prewarming under stated restrictions and normal cache-write charges. Neither stable
text nor warming makes checkpoint replacement free.

OpenAI's guidance likewise makes message/block boundaries relevant. Extending the final message is
not necessarily equivalent to appending another message at an eligible cache boundary. Cache modes
and controls depend on the actual model and transport; use observed adapter payloads rather than one
universal rule about automatic caching.

This research does not select cache settings or promise a hit rate. It records the current contract
shape because it changes the interpretation of package measurements and default behavior.

### Native summarization versus acting requests

Pi's native summary helper uses `cacheRetention: "none"` and a fresh routing session ID unless one
is supplied. For Anthropic, the adapter omits cache-control markers. On newer compatible OpenAI
models, Pi selects explicit mode without write breakpoints. Omitting Pi cache controls in an older
mode does not prove that a provider performs no automatic caching.

Direct OpenAI Responses, ChatGPT sign-in, and the separate Codex adapter have different accepted
fields. The host SDK's cache warmer concerns acting-session requests, not a native summary using a
separate routing ID.

Sources:
[summary helper](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts),
[SDK](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/sdk.ts),
[cache warmer](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/cache-warmer.ts),
[Codex transport](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/openai-codex-responses.ts).

Pi 1.0.1 also adds compatible Anthropic inline tool additions/redefinitions, preserving a stable
request-level tool list where supported. Therefore, a blanket claim that every tool change
invalidates the entire tool prefix is outdated. This feature does not make checkpoint replacement
free.
[Release source](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/anthropic-messages.ts).

### Observer requests have their own cache opportunities

Stable observer instructions and output schemas can precede changing continuation state and new
source batches. This permits reuse of the worker's static prefix without reproducing the acting
conversation. If every request starts its changing section with a rewritten snapshot, reuse after
that point may be limited. A rolling worker history or an acting-prefix fork is an alternative, with
additional state, input size, and model/configuration constraints.

Pi's public model registry exposes cache retention and an optional session routing identity. These
are controls and hints, not cache handles. Direct observer calls do not automatically reproduce the
SDK's acting-context projections, header/retry wrappers, or cache warming. Matching the acting model
or session ID alone does not establish shared-prefix reuse.
[Registry](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/model-registry.ts),
[request options](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/types.ts),
[SDK orchestration](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/sdk.ts).

### Stable checkpoint presentation

**Observed in Pi 1.0.1:** Pi renders a persisted summary as a user message under a fixed wrapper
before retained history. Entry IDs and token estimates are not interpolated into that text.
[Message conversion](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/messages.ts).

The [request stability contract](../../SPEC.md#request-stability--req-request-stability) selects
stable request construction. The [file inventory](../../SPEC.md#file-inventory--req-file-inventory)
is fixed at the checkpoint boundary; later activity stays in recent history. Deterministic rendering
can avoid package-induced prefix churn under unchanged selection and configuration. It cannot
guarantee provider hits, and an actual correction or lineage change may alter the prefix. Request
fixtures establish construction stability; only provider measurements can establish cache reuse.

Pi also supports structured system/tool updates as transcript changes in compatible paths. A forced
system-prompt string replaces the leading prompt for that run. Native warming is an independent
variable with its own eligibility, settings, usage, and latency.
[Extension events](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/extensions.md#events),
[native warming settings](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/settings.md#models-and-thinking).

## Separate preparation, compaction, and continuation costs

A useful comparison observes the whole task, including work done before a checkpoint and after it.

| Phase               | Work to count                                                     | Common misleading shortcut                                             |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Observation         | Input history, prior memory, generated state, retries, failures.  | Counting only the final acting request.                                |
| Checkpoint creation | Catch-up, custom rendering, native fallback, helper inference.    | Calling deterministic rendering a zero-cost memory system.             |
| First continuation  | New checkpoint input, retained tail, cache writes, retrieval.     | Assuming a cached summary request means a cached continuation request. |
| Later continuation  | Repeated checkpoint use, source recall, changed context, expiry.  | Reporting only the first request after compaction.                     |
| Recovery            | Cancelled work, timeouts, failed summaries, retries, user repair. | Excluding unsuccessful runs from cost.                                 |

Pi normalizes cache usage differently by provider. Its OpenAI adapter separates cached and write
input from aggregate input; Anthropic accounting distinguishes reads and write lifetimes. Raw
provider counts and normalized usage must not be added together as independent work.
[OpenAI normalization](https://github.com/earendil-works/pi/blob/v1.0.1/packages/ai/src/api/openai-responses-shared.ts).

## Prompt representation options

These options concern presentation, not whether observations or sources are retained.

| Representation                               | Behavior                                                              | Trade-off for the core                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Checkpoint-only snapshot, selected direction | A new snapshot appears when Pi compacts.                              | Avoids routine full-snapshot updates; current conversation supplies changes between checkpoints.           |
| Append full changed snapshots                | Persist complete revisions during ordinary conversation.              | Easy to inspect individually, but repeats state and needs supersession/capacity handling.                  |
| Baseline plus changes                        | Append deltas and periodically establish a new baseline.              | Can preserve a prefix while adding ordering, deletion, and replay rules.                                   |
| Replace current snapshot                     | Transform the current request to show only the latest snapshot.       | Bounds visible history of memory, while changing the request prefix and requiring lifetime rules.          |
| Immutable compaction segments                | Preserve older summary segments and append later ones until rebasing. | A separate context-growth policy, demonstrated by some packages, with cumulative pressure and scope rules. |

Checkpoint-only presentation does not require ordinary requests to fit a routinely injected
snapshot. Its effect on total cost remains unmeasured. The
[Pi ecosystem comparison](pi-cache-compaction-ecosystem.md) separates source-reconstruction, payload
capture, warming, and structural pruning from this memory presentation choice.

Presentation experiments should render the same accepted canonical state under the same validity
rules before their costs are compared. Accumulated full revisions or segments need their own growth
bound. Request-local filtering does not establish durable correction or alter already prepared
summary input; the [host analysis](pi-compaction.md#original-records-and-effective-context) explains
those limits. Source retention, active presentation, and cache reuse remain separate properties.

## Selected MVP policy and post-MVP experiments

The [request stability contract](../../SPEC.md#request-stability--req-request-stability) selects
stable construction. The [implementation choices](../../SPEC.md#implementation-defined-choices)
defer provider-specific acting-prefix reuse, request replay or warming, and immutable checkpoint
segments. These alternatives warrant measurement only if full-task cost or foreground latency
identifies a problem. Replay must preserve payload, credentials, headers, routing, cancellation, and
budget accounting. Immutable segments need correction, lineage, growth, and rebase rules. The
[ecosystem comparison](pi-cache-compaction-ecosystem.md) records source precedents, not measured
benefits for Orbis.

Compare total work and continuation quality, not cache-hit percentages alone. A higher hit rate can
coexist with greater extraction cost, redundant work, or worse actions. The
[evaluation protocol](evidence-and-evaluation.md) separates those outcomes.
