# Observational-memory implementations

The compared systems automate memory construction, but they preserve different representations and
place different work on the acting agent, auxiliary models, and host. None of the inspected evidence
establishes reliable indefinite continuation or a controlled quality ranking across these systems.

Research date: 2026-09-12. The comparison uses primary documentation and source inspection, without
running the packages or calling models. The labels below distinguish repositories that share the
same repository name.

## Inspected versions

| Label in this comparison                         | Inspected source                                                                                                                       | Version boundary                                                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi-observational-memory`, topics implementation | [Commit `78a1efc`](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e), 2026-08-24 | Current inspected HEAD; package version 0.1.0.                                                                                                                                                       |
| `pi-observational-memory`, v3 implementation     | [Commit `9f1cf4e`](https://github.com/elpapi42/pi-observational-memory/tree/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0), 2026-09-11      | Manifest says 3.0.4, but HEAD contains changes after the [3.0.4 release tag](https://github.com/elpapi42/pi-observational-memory/releases/tag/3.0.4). The tag points to `e07d2b2`, dated 2026-08-11. |
| Mastra observational memory                      | [Commit `253b501`](https://github.com/mastra-ai/mastra/tree/253b5012970f0cc6eab01916279d20376f457fe2), 2026-09-12, plus current docs   | The source manifest is `@mastra/memory` 1.30.0-alpha.2. Docs identify core OM as available since 1.1.0; that does not establish stable availability for every current-source feature.                |

The v3 release-tag hook lacks the empty-memory fallback found on its current HEAD. Findings about
development source must not be attributed to the released version merely because both manifests show
the same version string.
[Release-tag hook](https://github.com/elpapi42/pi-observational-memory/blob/3.0.4/src/hooks/compaction-hook.ts),
[current hook](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/hooks/compaction-hook.ts).

## Representation and lifecycle

| Responsibility              | Topics implementation                                                                   | V3 implementation                                                                  | Mastra                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Observation                 | Timestamped event prose in the Pi session ledger                                        | Event prose with importance and original entry references                          | Dated prose extracted from messages and tool results                                         |
| Older memory                | Older observations are consolidated into detailed topic files and a descriptive journey | Reflections append durable conclusions supported by observation IDs                | Reflection condenses the active observation log, including earlier condensed material        |
| Removal from active context | A successful consolidation drains its selected observation batch                        | Drop tombstones remove selected observations from active memory                    | Activation replaces source messages or an earlier observation prefix with prepared content   |
| Source preservation         | Original Pi entries and historical observations remain                                  | Original entries, observations, reflections, and drops remain in the branch ledger | Optional recall reads stored original messages; storage retention remains a separate concern |
| Routine prompt              | Journey, topic map, and active observations                                             | Visible observations and eligible reflections from the selected fold               | Active observations, retained messages, and applicable metadata                              |
| Scope                       | Session-specific ledger and external note directory                                     | Session lineage; durable reflections are not cross-session project learnings       | Observation scope defaults to thread; shared resource scope is experimental                  |

Sources: [topics implementation inspection](observational-memory.md),
[v3 concepts](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/docs/concepts.md),
[v3 projection](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/session-ledger/projection.ts),
[Mastra documentation](https://mastra.ai/docs/memory/observational-memory),
[Mastra reflection activation](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/reflector-runner.ts).

“Reflection” differs between implementations. V3 adds a durable conclusion alongside the
observations that support it. Mastra rewrites a bounded active representation. The topics
implementation files older experience into separately retrievable documents. These are different
retention policies, not interchangeable names for an extra tier.

## V3 concepts and retention

V3 distinguishes full memory reconstructed from the branch ledger from visible memory included in
the latest checkpoint. An ordinary checkpoint preserves earlier visible reflection/drop state and
adds eligible observations. A full fold applies newer reflections and drops when observation-pool
pressure reaches the configured trigger.
[Projection](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/session-ledger/projection.ts).

The observer assigns importance, the reflector proposes conclusions with supporting observation IDs,
and the dropper selects observations whose removal appears safe. The dropper prompt favors active
constraints, unfinished work, corrections, exact errors, rationale, and outcomes. Age and redundancy
also influence its decision. A `critical` classification increases resistance to removal; it is not
a permanent pin enforced by code.
[Dropper instructions](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/agents/dropper/prompts.ts),
[selection](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/agents/dropper/agent.ts).

V3's coverage labels count reflection references to an observation: `none` means zero references,
`partial` means one, and `strong` means at least two. The count does not measure preserved meaning.
One precise reflection can retain more than several vague references. The labels also differ from
the Orbis SPEC's processing coverage, which records whether assigned source spans completed and
committed. Neither establishes semantic completeness.
[Coverage computation](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/agents/dropper/coverage.ts).

The current source runs a serial observer → reflector → dropper pipeline from `agent_start` and
`turn_end`. An observation can enable reflection in the same run. The dropper requires nonempty new
reflections and a pool above its target. Some concept documentation still describes separate lanes
and a fixed 60,000-token chunk. By default, current source caps chunks at 20% of the resolved memory
model's context, with a 256-token minimum and a 60,000-token fallback when the context window is
unavailable. Configuration can override that cap.
[Scheduler](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/hooks/consolidation-trigger.ts),
[configuration](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/config.ts).

The long-session limits are material:

- Reflections append without an update, retirement, or total-size cap. A correction can coexist with
  the earlier reflection, and eligible reflections appear after a full fold.
- The observation target is not a hard bound. When reflection produces nothing new or the dropper
  declines candidates, the pool can remain above target.
- Partial observer output can survive a trailing stream error. Oversized individual sources receive
  head/tail excerpts, while accepted output can advance the progress marker past the whole entry.
  Retained originals remain available, but the marker does not prove complete source processing.

These are source-derived limits, not measured failure rates.
[Observer](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/agents/observer/agent.ts),
[serialization](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/serialize.ts),
[projection](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/session-ledger/projection.ts).

## Mastra preparation and active work

Mastra prepares inactive observations before replacing their source messages. Reflection can also
prepare a condensed prefix before activation and preserve observations appended after that prefix.
Unavailable preparation can cause synchronous work when context pressure requires replacement. This
distinction between completed preparation and active context is useful for any host adapter.
[Observation documentation](https://mastra.ai/docs/memory/observational-memory),
[reflection runner](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/reflector-runner.ts).

Built-in current-task metadata describes primary work, pending tasks, waiting states, and unrelated
activity. The current-task and suggested-response extractors can emit inline in the existing
Observer/Reflector response. Custom schema-backed extractors can add a follow-up structured model
call and fallback retry. Optional `manageWorkingMemory` assigns working-memory updates to the
Observer instead of requiring acting-agent maintenance tools.
[Built-in extractors](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/built-in-extractors.ts),
[extractor modes](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/extractor.ts),
[API reference](https://mastra.ai/reference/memory/observational-memory).

The API reference recommends disabling suggested responses when the acting agent already owns its
workflow. Retaining current obligations does not require prescribing the agent's next sentence.

Current docs and alpha source disagree on continuation hints in buffered work. The inspected async
path passes `skipContinuationHints: true`, and the observer runner filters the built-in task and
response extractors. It is therefore incorrect to assume that every background observation refreshes
current-task metadata. A transferred design needs its own freshness rule for steering and
compaction.
[Async strategy](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/observation-strategies/async-buffer.ts),
[observer runner](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/observer-runner.ts).

Shared resource observation is documented as experimental and disables asynchronous buffering.
Recall scope is independent and defaults to resource even when observations are thread-scoped.
Sharing an active summary and permitting lookup of other conversations are separate policies.
[Scope configuration](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/observational-memory.ts).

The alpha source also includes a separate `subconscious` knowledge subsystem. Its presence does not
establish that the same subsystem was included in the published OM evaluation.
[Knowledge scope](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/subconscious/scope.ts).

## Recall and compaction

| Behavior                        | Topics implementation                                               | V3 implementation                                                                                                          | Mastra                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Discover old detail             | Topic map and ordinary file tools                                   | `recall(id)` follows an observation or reflection ID                                                                       | Optional message browsing, thread discovery, cursors, and pagination; semantic search adds vector dependencies |
| Recall strength                 | Topics provide subjects for selective loading                       | Returns supporting observations and original sources with missing-source diagnostics                                       | Separates exact source lookup from questions already answered by observations                                  |
| Recall limit                    | No dedicated bounded original-history search tool                   | No query search or cursor; full source text has no tool-level output cap                                                   | Lookup scope and source-retention policy must be configured separately                                         |
| Custom checkpoint               | Deterministic rendering, with possible observer waiting             | Deterministic rendering without worker waiting                                                                             | Context processor activation, rather than Pi's compaction hook                                                 |
| Empty or incomplete preparation | Enabled hook can return an empty checkpoint; no complete-span check | Current HEAD falls back on empty memory, but accepts a nonempty projection without complete discarded-span coverage        | Empty reflection over nonempty observations is rejected; missing buffers can cause synchronous processing      |
| Native Pi details               | Own cutoff policy and extra threshold                               | Preserves prepared cutoff, but ignores custom instructions and does not explicitly preserve earlier native checkpoint text | Pi lifecycle integration is outside the inspected Mastra contract                                              |

Sources:
[topics compaction inspection](observational-memory.md#incomplete-observation-at-compaction),
[v3 recall](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/tools/recall-observation.ts),
[v3 hook](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/hooks/compaction-hook.ts),
[Mastra recall reference](https://mastra.ai/reference/memory/observational-memory).

The v3 recall guidance is conditional: precision-sensitive questions should use the source. This
reduces routine ceremony, but an exact-ID interface cannot readily rediscover an uncited event whose
identifier is absent from visible memory. Mastra's guidance also distinguishes unindexed history
from a semantic-search miss. The Orbis query-plus-reference interface retains those lessons without
requiring semantic search.

## Cost, ownership, and quality

The topics implementation uses headless subprocess workers and defaults to four concurrent
observers. V3 uses serial in-process model roles but repeatedly supplies active observations and
reflections to its workers. V3 permits up to 16 turns per role and up to 32,000 output tokens per
turn, constrained by model capability. Its cadence defaults are 10,000 tokens for observation and
20,000 for reflection; its active observation target is 10,000. These are operational defaults, not
measured total cost or suitable budgets for every local model.
[Topics defaults](observational-memory.md#capture-and-consolidation),
[v3 configuration](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/config.ts),
[v3 output budgets](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/model-budget.ts).

Mastra's inspected defaults use 30,000 message tokens and 40,000 observation tokens, with earlier
buffering. Its retry wrapper permits eight retries with exponential backoff, roughly 247 seconds
before jitter and inference time. A threshold reflection path can wait five seconds for in-flight
work before proceeding to another path. These policies do not fit a general low-wait requirement
without an outer deadline and model-specific budgets.
[Constants](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/constants.ts),
[retry policy](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/retry.ts),
[reflection runner](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/reflector-runner.ts).

V3 defaults to the session model with one shared worker override; an unavailable override can fall
back to the session model. Its latest provider-dispatch fixes improve custom-provider support but do
not prove operation with every local provider. Orbis's explicit no-silent-substitution policy
remains a separate requirement.
[V3 worker dispatch](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/agents/worker-stream.ts).

Configured-model fallback is implemented in
[the v3 runtime](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/runtime.ts).

V3's branch ledger avoids external topic files that retain an abandoned future, but source
inspection did not establish complete extension-owned cancellation and stale-generation checks.
Mastra's inspected async observer omits the supplied abort signal, while process-local coordination
does not establish distributed serialization. Neither supplies the Orbis contract for user-edited
Markdown notes, deletion exclusions, or Pi tree navigation by implication.
[V3 runtime](https://github.com/elpapi42/pi-observational-memory/blob/9f1cf4e2eeecd5bd1c49b8017d818e7cd07b65a0/src/runtime.ts),
[Mastra async strategy](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/observation-strategies/async-buffer.ts),
[Mastra coordination](https://github.com/mastra-ai/mastra/blob/253b5012970f0cc6eab01916279d20376f457fe2/packages/memory/src/processors/observational-memory/buffering-coordinator.ts).

Mastra reports LongMemEval accuracy of 84.23% with GPT-4o and 94.87% with GPT-5-mini, both using
Gemini 2.5 Flash for observation and reflection. This demonstrates reader sensitivity under that
protocol, not isolated writer improvement. The vendor reports category-averaged scores from its
latest development run and acknowledges variation around an oracle comparison. These results do not
establish steering-heavy coding continuation or consumer-GPU performance.
[Vendor evaluation](https://mastra.ai/research/observational-memory).

The Pi repositories include operational tests and usage claims. The inspected material does not
provide a controlled comparison of repeated coding continuation across these implementations. Mocked
outputs and prompt assertions can verify mechanics without demonstrating semantic retention.

## Transfer to a continuity-first MVP

For an instruction such as “preserve the on-disk format; pause the authentication change while
diagnosing startup,” the implementations preserve different routes to the next decision:

- Topics record the events and later consolidate them into relevant notes. The acting agent must
  find still-applicable constraints when those observations leave the active pool.
- V3 can mark the constraint important, reflect it into a durable conclusion, and resist dropping
  the supporting observation. The model still decides whether the conclusion preserves the rule.
- Mastra can retain current-task metadata alongside observations. A transferred design must ensure
  that steering updates reach that metadata before the next dependent action.

The Orbis design should retain its source coverage, bounded recall, unified native compaction,
explicit fallback, revision, and curation requirements. Useful additional comparisons are
meaning-based preservation priorities, inline current-work extraction, and distinct preparation and
activation states. A reference count must not be presented as semantic coverage, and a past planned
date must not be treated as evidence that repository work completed.

The selected Orbis design adds a protected current-work note to observations and topics. Updating
the note in the existing observer response avoids a required separate model call or acting-agent
maintenance tool. The observer can still select the wrong information, and the note can become
stale. Added input/output tokens still cost time and compute. The design does not adopt a separate
dropper model, structured task transitions, or Mastra's additional knowledge subsystem. The
[continuity protocol](continuity-and-invariants.md) compares the selected design with the simpler
observations/topics baseline before attributing a quality improvement to the protected note.
