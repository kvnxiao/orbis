# Prompt caching and compaction

Research date: 2026-09-24. Pi baseline: **0.87.0**. This document compares provider prompt caches,
published Claude Code behavior, public Codex source, and Pi integration constraints. The MVP scope
and append-complete-revisions representation are selected, with internal strategy modules and a
bounded reset of memory presentation. This research document does not amend the package contract. No
live provider calls, cache-hit measurements, or continuation evaluations were run.

## What caching preserves

Prompt caching reuses model computation for an unchanged prompt prefix. It does not retrieve
semantically equivalent text or preserve the cached computation of a suffix after earlier tokens
change. Tool declarations, system instructions, conversation content, and some model settings
contribute to the provider's rendered prefix.

Compaction has two distinct costs: generating the replacement and using it in later requests. A
summary request can reuse the original prefix if its model and request layout match and the cache
entry is still available. Replacing old conversation with a summary changes the next acting request
from the replacement point onward. Unchanged earlier instructions may remain reusable; subsequent
turns can cache the new summary and growing conversation. These implications follow from the prefix
semantics documented by [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) and
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Keeping recent messages verbatim preserves their information and tool relationships. It does not
preserve their old cache position when the preceding history changes. Likewise, a stable cache key
cannot make a changed prefix match.

### Session continuity and cache reuse

Pi compaction appends a checkpoint to the existing session and rebuilds the model context from its
summary and retained messages. It does not create a new conversation session or erase the original
session entries. A separate routing identifier for a summarization request is not a new user
session.
[Pi compaction lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/compaction.md).

Cache matching applies to each request, not to an entire session as an all-or-nothing discount. An
unchanged instruction/tool prefix may remain reusable after compaction. The changed summary and
following conversation need new computation where no matching entry exists. Later requests that
repeat the compacted context can reuse its cache entries while eligible. Old entries may remain in
the provider cache, but they do not match the changed portion of the new request.

| Request                                           | Simplified input                                                               | Reuse opportunity                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Before compaction                                 | Stable instructions/tools, old conversation, recent messages                   | Existing conversation prefix                           |
| Summary generation with a matching request layout | Stable instructions/tools, original source prefix, summary instruction         | Available cached source prefix                         |
| First continuation after compaction               | Stable instructions/tools, new summary, retained messages                      | Unchanged prefix before the replacement                |
| Later continuation                                | Same instructions/tools, same summary and retained messages, appended activity | New compacted prefix established by preceding requests |

The table describes prefix structure, not guaranteed hits or provider-specific write boundaries. It
does not prescribe which summarization mechanism tiered-memory uses.

## Provider differences

### Anthropic

Anthropic caches the ordered tools, system, and message prefix through a cache breakpoint. Writes
occur only at breakpoints. Reads search at most 20 block positions per breakpoint and can find only
entries written by earlier requests. Automatic caching advances a breakpoint as messages accumulate.
Explicit breakpoints can make earlier sections reusable even when later content changes. Minimum
lengths and invalidating settings depend on the model.

The default five-minute cache write costs 1.25 times ordinary input; a one-hour write costs twice
ordinary input. Reads have a model-specific discount. Hits refresh the expiry without a new write
charge. Response usage distinguishes cache creation and cache reads from ordinary input. Exact rates
and limits belong to the selected model and provider configuration, not a portable memory
requirement. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Anthropic's on-demand compaction API returns a signed summary for later requests and reports the
summarization work in usage. Its keep-recent-turns variant retains an exact recent tail after the
compacted portion. These APIs describe provider capabilities; they are separate from Pi's native
summarizer and the package's deterministic renderer.
[On-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand),
[retaining recent turns](https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns).

### OpenAI

OpenAI's current guide distinguishes GPT-5.6 and later from earlier models. The newer family
supports explicit breakpoints and charges separately priced cache writes; older families have
different retention, routing, and pricing behavior. Cache controls must therefore be selected by
actual provider/model capability. The guide explicitly warns that compaction can reduce reuse and
recommends comparing total input cost.
[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Responses supports server-managed compaction and a separate compact endpoint. The returned compacted
window can contain an opaque encrypted compaction item and retained items. Clients continue with the
returned representation. The compact endpoint reports its own usage, including cached input where
available. Neither a session identifier nor a compaction item proves a cache hit.
[Compaction](https://developers.openai.com/api/docs/guides/compaction),
[compact endpoint](https://developers.openai.com/api/reference/java/resources/responses/methods/compact).

## Harness behavior

### Claude Code

Anthropic describes a compaction fork that preserves the parent's system context, tools, and
conversation, then appends the summarization instruction as a user message. This layout lets the
summary request reuse the existing prefix. The continuation replaces old history with the summary.
The same engineering account describes stable early instructions and tool declarations, with
changing information appended in messages.
[Claude Code prompt-caching engineering account](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/).

This is Anthropic's published account, not inspection of every current Claude Code request. Claude
Code's user guidance also distinguishes compaction, which replaces the conversation, from rewinding
a tail, which can preserve an earlier conversation prefix.
[Session cost guidance](https://claude.com/blog/maximizing-the-value-of-your-claude-code-sessions).

### Codex

Codex CLI has public source; its implementation can be inspected separately from the private model
service. Local compaction appends a summary request to a history copy, calls the model, and installs
replacement history. Its prompt uses default empty tools and disables parallel tool calls, unlike
the ordinary acting prompt. Copying messages therefore does not establish reuse of the acting
request's complete rendered prefix.
[Local compaction source](https://github.com/openai/codex/blob/e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1/codex-rs/core/src/compact.rs),
[prompt defaults](https://github.com/openai/codex/blob/e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1/codex-rs/core/src/client_common.rs),
[acting prompt](https://github.com/openai/codex/blob/e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1/codex-rs/core/src/session/turn.rs).

Remote compaction v2 uses the current tool specifications and base instructions, enables parallel
tool calls, and appends a compaction trigger. It records the compaction pass's cached and
cache-write usage before installing replacement history. This permits prefix reuse when the
remaining request state matches; actual reuse still needs measurement.
[Remote request](https://github.com/openai/codex/blob/e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1/codex-rs/core/src/compact_remote_v2_attempt.rs),
[remote usage and replacement](https://github.com/openai/codex/blob/e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1/codex-rs/core/src/compact_remote_v2.rs).

The Codex source is pinned to `e0ef5a1a0f6421601baaa679fb37eddaa4e9c8c1`. Public client code does
not establish the private summarizer's algorithm or observed cache savings.

### pi-cache-compact

The inspected package is `pi-cache-compact` **0.1.0**, revision
`a905ed86c3844f1759a9f194dbe4c84d279ac8ca`. It targets the latency of summarizing long conversations
on local servers with prefix caching. It uses Pi's public `session_before_compact` hook and does not
patch Pi core. Pi still selects when to compact and which recent messages remain.
[Package manifest](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/package.json),
[package description](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/README.md).

The extension reconstructs the session projection before Pi's prepared retained boundary, converts
those messages for the model, and appends a user request for a handoff summary. It supplies the
leading projected system message when present; otherwise it obtains the current system prompt and
reconstructs active tool declarations. Unlike the published Claude Code description, the normal path
sends only the older prefix being discarded, excluding the recent tail. Its request builder
preserves message structure instead of serializing the source into a single transcript string.
[Request builder](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/src/build.ts).

The summary request defaults to the active model, short cache retention, and `toolChoice: "none"`,
with tools still declared. It forwards the compaction cancellation signal and session identifier. On
accepted output it returns Pi's prepared boundary and token count, plus summary usage. Request
errors, empty or truncated output, aborted responses, and tool-call output cause it to decline
replacement. Pi can then apply its native lifecycle. A configurable summary model changes which
model processes the input; reuse of the acting model's cache cannot be assumed across that change.
[Extension handler](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/src/extension.ts).

The end-to-end test launches Pi against a mock OpenAI-compatible server. It compares recorded
request bodies and checks that the summary's source messages form a prefix of an earlier acting
request, with matching system content and tool declarations. It also checks the persisted compaction
entry. This establishes request shape for its fixture, not an actual cache hit, cached billing, or
measured latency improvement. The package and its tests were inspected, not executed in this
research.
[End-to-end fixture](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/test/e2e.test.ts).

There are limits to transferring this behavior to hosted providers. Anthropic documents that a
change in tool choice invalidates message caching. An earlier truncated prefix also needs an
eligible cache entry at a usable breakpoint; textual prefix equality alone does not establish one.
Different thinking settings or a changed model can prevent reuse as well.
[Anthropic cache invalidation and lookup rules](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

The extension does not capture the final acting payload or replay `context` and
`context_with_system` transformations when reconstructing its source. It does not compare that
reconstruction with the previous provider request or reject a summary merely because another
extension changed the acting context. An otherwise accepted response can therefore be committed even
when its request missed the cache or differed from the acting context. This matters for
tiered-memory's request-time note and curation handling.
[Context reconstruction and acceptance](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/src/extension.ts).

The package explicitly acknowledges that the first continuation after compaction has a changed
summary prefix. It reduces the extra source processing needed to produce the summary; it does not
make the replacement conversation identical to the original cached conversation.
[Post-compaction caveat](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/README.md#caveats).

| Mechanism                                | Input used to generate a checkpoint                                                           | Consequence for this design                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Published Claude Code compaction fork    | Existing conversation and request configuration, with a summary instruction appended          | Preserve the source request's cache opportunity during summarization                                                  |
| pi-cache-compact                         | Reconstructed discarded prefix and request configuration, with a summary instruction appended | A complementary summary optimization is possible through current Pi hooks, subject to integration and provider limits |
| Approved tiered-memory custom checkpoint | Committed observations and notes rendered by extension code                                   | Eligible rendering needs no summary inference; worker inference and later acting requests still incur cost            |

The [Pi ecosystem comparison](pi-cache-compaction-ecosystem.md) examines additional packages,
adoption signals, prefix preservation between turns, and post-compaction warming.

## Pi integration constraints

Pi 0.87.0 exposes `context` before acting-model dispatch and `context_with_system` for the full
transcript. The session projection puts the latest compaction summary before the retained
conversation. Persistent custom messages can participate in conversation history; custom data
entries remain outside the model context. The context-edit API does not allow editing a persisted
compaction entry.
[Extension API](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts),
[session projection](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts).

The public message and custom-entry append APIs return no persistence acknowledgment. During
streaming, a custom message can remain queued until the turn ends. The `context` runner reports
handler errors and continues, so throwing in that hook does not stop dispatch; conversion and
authentication can also yield after the context snapshot. These source findings require a scripted
ordering and failure-path check before relying on queued presentation for freshness, stable
placement, or durable native-compaction input. A temporary request projection does not establish
session persistence, and an older confirmed note cannot substitute for the newest valid state.
[Message delivery](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts),
[context runner](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/runner.ts),
[dispatch ordering](https://github.com/earendil-works/pi/blob/v0.87.0/packages/agent-core/src/agent-loop.ts).

The host also supports structured system/tool updates that append transcript messages on compatible
models, plus cost-aware cache warming. The
[ecosystem comparison](pi-cache-compaction-ecosystem.md#capabilities-already-in-pi-0870) describes
those existing capabilities and their limits. Memory layout should use the supported host behavior
without assuming every provider preserves a mid-conversation system update in place.

Pi's native summarizer serializes conversation into a summarization request and sets
`cacheRetention: "none"`. The acting-request context hook does not turn this into Claude Code's
prefix-preserving summary fork. The effect of that option on provider-side automatic caching depends
on the adapter; it is not proof that every provider disables all caching. A package that delegates
fallback to this host cannot promise reuse of the acting conversation cache for the fallback call.
[Native compaction](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/compaction.ts).

The Anthropic adapter supplies cache controls for system, tools, and a recent eligible message. The
OpenAI Responses adapter supplies cache-key and retention settings. Provider-neutral code must use
supported public options and report unavailable controls or accounting. The inspected adapters do
not establish support for every newer API feature in the provider documentation.
[Anthropic adapter](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/api/anthropic-messages.ts),
[OpenAI Responses adapter](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/api/openai-responses.ts).

## Design implications

Preserving acting-request prefixes between compactions could reduce cache writes. Under the approved
design, a custom checkpoint would render committed memory without an additional ordinary
summarization call. Observer and consolidator calls would use separate prompts and could use
different models, so reuse of the acting agent's cache remains unproven.

The selected MVP representation appends a complete revision of each changed current-work note or
bounded index while leaving earlier memory messages at their original conversation positions.
Unchanged content needs no additional copy. A work-note revision is smaller than the complete
compaction checkpoint, which also carries selected observations, indexes, and prior continuity.
Appending a new work note does not mean appending another full compaction checkpoint.

Updates identify their revisions and source boundaries, explicitly supersede earlier representations
of the same memory, and preserve newer user instructions. A later compaction combines current state
into a new bounded checkpoint. Historical update messages consume context until compaction or a
separately defined request-assembly reset; their cost and capacity effect need measurement. The
request-capacity stop, native retained boundary, and native compaction settings remain constraints.
When accumulated revisions exceed their prompt budget, the selected policy resets package-owned
memory presentation to current state and then resumes appending. This reset accepts a changed
prefix; it is not a new session or a Pi compaction.

The design retains two post-MVP comparison candidates: appending changes to a baseline, and
replacing one current snapshot. Separating canonical memory from its prompt representation lets
these candidates reuse extraction, persistence, recall, and validity rules. The following labels
refer only to prompt representation, not to the separate current-work architectures compared in the
package specification.

| Representation               | Prompt update                                                                                   | Evaluation status                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A: append complete revisions | Append the complete changed work note or bounded index; identify prior revisions as superseded. | Selected MVP representation; efficacy remains unmeasured. |
| B: append changes            | Keep a baseline and append changes that the acting model must combine with it.                  | Post-MVP implementation and comparison candidate.         |
| C: replace current snapshot  | Replace the prior request-time memory block with the latest complete state.                     | Post-MVP implementation and comparison candidate.         |

None of the inspected packages establishes that A is the cheapest or most reliable representation
for current-work notes. Blackhole's append mode preserves summaries of successive historical spans,
not complete revisions of the same work note. The prompt-cache extension's baseline updates concern
system prompts and sometimes use full text. Observational Memory replaces a checkpoint at
compaction. These are partial comparisons with different lifetimes and state ownership; see the
[ecosystem comparison](pi-cache-compaction-ecosystem.md).

User edits, deletions, invalidation, effective context edits, and branch changes must produce
correct current state even when they reduce cache reuse. Cache stability must not delay a known
correction. The renderer must preserve correction and exclusion state for native compaction as well
as acting requests. A baseline-plus-changes representation cannot make stale or deleted memory
valid.

For workers, stable role instructions and output schemas can precede the changing note, source
batch, and revision metadata. This preserves an opportunity for reuse within each role without
expanding every job to the full acting history. A rolling worker conversation or acting-prefix fork
would add input, state, and model constraints; its net benefit requires a separate comparison.

## Selected MVP scope and deferred alternative

The MVP selects route 2A: optimize tiered-memory's acting-context layout and bounded memory-worker
requests through Pi's public APIs, and account for cache usage where available. Preserve Pi's
compaction triggers, prepared retained boundary, and native fallback. Append complete revisions for
the MVP and keep prompt representation replaceable through internal strategy modules for post-MVP
comparisons. Reset accumulated memory presentation within its budget; B and C are not additional MVP
runtime modes.

Route B, optimizing the fallback summarization request or extending provider integration, is
deferred to post-MVP work or a future complementary package. This scope keeps the initial package
focused on memory preservation and makes any additional integration depend on measured cost and
compatibility needs. A separate package may use existing public hooks where sufficient; an upstream
Pi change is needed only for capabilities those hooks do not expose. The existence of a public-hook
implementation does not establish compatibility with tiered-memory.

A future integration must assign one compaction coordinator and preserve coverage, cancellation,
source authority, and the retained boundary. Two independent extensions replacing the same
checkpoint do not establish a fallback chain. Reconsider the deferred work when measurements show
material fallback cost or latency and an explicit integration can preserve those guarantees.

## Selected representation boundary

The architecture keeps one memory coordinator responsible for committed state, lineage, curation,
source authority, resource limits, and Pi lifecycle integration. A replaceable representation
component receives the selected valid memory, prior presentation state, and available prompt budget.
It proposes the memory messages and presentation-state changes; the coordinator validates and
applies them. Canonical memory remains independent of rendered text and representation-specific
bookkeeping. A future strategy must not reconstruct authoritative state solely from its own prompt
messages or bypass the shared validity checks.

The MVP boundary is an internal module with one implementation. A future extraction could provide
strategy libraries called by the coordinator. Independently loaded extensions that each own context
and compaction hooks would need additional coordination of authority, persistence, and fallback. An
internal boundary does not require a public plugin registry or a stable third-party strategy API
before the second implementation exists. Extract libraries when actual reuse warrants an
independently maintained boundary.

At the accumulated-revision limit, reset only the package-owned work-note and index presentation to
current complete state, accepting the resulting prefix change, then resume appending. Keep original
records, retained conversation, and required prior checkpoint continuity. The existing capacity stop
still applies when the complete current note cannot fit after optional memory is removed. Do not
silently truncate the note or start another native compaction loop. Pausing solely to preserve old
revision prefixes was rejected because it interrupts work that can continue with a bounded current
representation. Switching a live session between A, B, and C would need a separate transition
design; isolated benchmark runs can select one strategy for their entire lifetime.

Pi's public context hooks can filter or replace package-owned custom messages without rewriting the
original session records. However, the native compaction preparation reads Pi's session projection,
and automatic pressure can be checked before acting-context transformation. An ephemeral reset does
not remove those messages from native summarization input or guarantee a later native trigger.
Persisted supersession and invalidation remain necessary. This is source-based feasibility, not
runtime verification of a reset policy.
[Context hook contract](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts),
[compaction preparation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/compaction.ts),
[host lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

## Published size controls

The public Claude Code guidance describes compaction and user-supplied preservation instructions,
but the inspected guidance does not state a fixed summary budget or measured typical summary size.
Codex exposes an automatic-compaction trigger threshold, while OpenAI's compaction API describes
opaque compacted state and retained items without a universal output-size target. Trigger
thresholds, generation allowances, rendered checkpoint size, and total post-compaction context are
different quantities.
[Claude Code context management](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up),
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

Anthropic's on-demand API example uses `max_tokens=4096` for the summarization call, including
thinking. It is not a fixed summary target or evidence of Claude Code's internal budget. Pi 0.87.0
sets the main summary call's `maxTokens` to the smaller of the model output limit and 80% of the
configured reserve: 13,107 with the default 16,384-token reserve. A split-turn summary and file
metadata can add content to the final checkpoint; recent retained conversation has a separate
20,000-token default target. These controls do not establish observed summary sizes or suitable
defaults for tiered-memory.
[Anthropic on-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand),
[Pi summary generation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/compaction.ts),
[Pi settings](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/compaction.md#settings).

## Cost and verification

Cache-hit percentage alone cannot establish savings. Cached input still costs money, and compaction
can trade a rewrite plus auxiliary output for fewer input tokens on later turns. Compare the entire
work horizon, including acting calls, observers, consolidation, fallback, retries, repair, and
post-compaction cache writes. Preserve continuation quality as the primary outcome.

For disjoint token categories, compute input cost as ordinary input times its rate, plus cache reads
times their rate, plus cache writes times their rate; add output and other billed work. Normalize
provider usage first: a provider may report cached tokens inside total input or as separate
categories. Missing usage or pricing remains unknown.

Proposed fixture checks compare consecutive provider-bound requests, including a no-change turn, a
note update, an index update, recall, curation, disable/resume, branch navigation, and compaction.
They verify stable extension-controlled prefixes and correct supersession. Scripted providers cannot
prove real cache hits. Separately authorized measurements should include warm and expired caches,
frequent tool turns, short and long horizons, and matching versus different worker models. Record
the first request after compaction separately from steady continuation, and avoid accidentally
warming one comparison arm with another.

Post-MVP A/B/C comparisons should separate replay of identical committed memory revisions from
end-to-end continuation. Replay isolates representation size, prefix stability, and budget handling;
it does not measure how changed prompts affect later actions or memory extraction. End-to-end runs
measure those effects under matched initial tasks, models, native settings, retrieval policy, and
declared budgets. Record the selected representation and its parameters, reset events, acting input,
provider cache reads and writes where available, auxiliary work, compaction outcomes, and task
results. A larger cached prompt can cost more than a smaller prompt with fewer hits. The existing
MVP comparison against native Pi remains distinct from this later three-way experiment.

Remaining gaps are live cache behavior, newer provider-feature support through the installed Pi
adapters, the cost of accumulated revision updates, and the model's ability to apply supersession
correctly. No numerical savings or cache-hit target is established.
