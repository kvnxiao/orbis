# Provider compaction, prompt caching, and memory

Research date: 2026-10-03. Provider documentation was refreshed alongside Pi 1.0.1 source. This
comparison separates provider API contracts, Pi's integration, and proposed Orbis behavior. No
provider requests or cache measurements were run.

## Three different operations

| Operation                      | Result                                                     | What it does not establish                                              |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Compaction                     | A shorter representation replaces earlier request context. | The compressed representation preserves every useful fact.              |
| Prompt caching                 | Compatible repeated input reuses provider computation.     | History is compressed, searchable, or semantically preserved.           |
| Memory construction and recall | Selected state and evidence are retained for later use.    | All retained information is routinely visible or correctly interpreted. |

Preparing observations can avoid a foreground summary call when a checkpoint is ready. It adds
background work and does not automatically reduce total task cost. Replacing context can require new
cache computation even if the summary itself was prepared efficiently.

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
the ordered tools/system/messages prefix and explicit breakpoints. Five-minute and one-hour
lifetimes have different write costs. The lifetime begins with the request, not after generation.
Stable system/tool prefixes can remain reusable when the conversational prefix changes; replacing
history still requires computation for the new conversation prefix.

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

The settled checkpoint-only choice removes the old ordinary-request snapshot-capacity abort path. It
does not prove the best total cost. The [Pi ecosystem comparison](pi-cache-compaction-ecosystem.md)
separates source-reconstruction, payload capture, warming, and structural pruning from this memory
presentation choice.

## Candidate MVP stance

**Keep provider-payload replay and warming outside the core for now.** They introduce wire-format,
compatibility, accounting, and failure contracts beyond continuation state and evidence recall.
Reconsider them when measured task cost or foreground delay justifies a concrete integration.

**Keep native settings and the prepared boundary.** Optimizing memory is not evidence for changing
when the host compacts or how much source it retains. This is a settled constraint, not a finding
that one native setting is universally optimal.

**Compare total work, not cache percentages.** A higher hit rate can coexist with more extraction,
longer output, redundant work, or worse continuation. Measurements need the complete accounting and
action outcomes described in [evaluation](evidence-and-evaluation.md).

These stances preserve the current draft's separation of responsibilities. No provider compaction
endpoint, cache default, or optional package integration is approved by this research alone.
