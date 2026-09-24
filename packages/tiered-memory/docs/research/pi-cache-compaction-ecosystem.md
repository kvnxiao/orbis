# Pi packages for caching and compaction

Research date: 2026-09-24. This bounded survey compares Pi-native memory and context packages with
direct caching extensions. GitHub search and the Pi package catalog supplied candidates; primary
source and tests supplied the mechanism findings. It is not an exhaustive ranking. No third-party
package was installed or executed, and no provider measurements were reproduced.

The [provider and harness comparison](prompt-caching-and-compaction.md) explains prefix matching,
session continuity, and the selected MVP scope. Caching between ordinary turns, caching a summary
request, and warming the replacement context are separate operations with separate costs.

## Selection and adoption signals

GitHub counts were queried on the research date. The catalog download figure is a retrieved
snapshot, not a live install count. These signals establish visibility, not correctness, active
users, semantic retention, or cache savings. The three memory packages have more GitHub stars than
the dedicated caching repositories in this sample; catalog downloads use a different measure.

| Package                                                                                     | Inspected version | Adoption signal                               | Relevant responsibility                                                      |
| ------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| [pi-observational-memory](https://github.com/elpapi42/pi-observational-memory)              | 3.1.4             | 650 GitHub stars                              | Background extraction and deterministic checkpoint rendering                 |
| [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory)                          | v0.9.9            | 458 GitHub stars                              | Durable memory, retrieval, and a pre-compaction save                         |
| [pi-blackhole](https://github.com/k0valik/pi-blackhole)                                     | v0.5.8            | 197 GitHub stars                              | Structural compaction, observational memory, and optional immutable segments |
| [pi-prefix-cache-compaction](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction) | 0.3.0             | 16 GitHub stars                               | Captured-request summarization and optional warming                          |
| [cprune](https://github.com/amutix/cprune)                                                  | 0.4.7             | 3 GitHub stars                                | Tool-output pruning and preservation of previously sent message forms        |
| [pi-cache-compact](https://github.com/lennartschoch/pi-cache-compact)                       | 0.1.0             | 0 GitHub stars                                | Summarization over a reconstructed discarded prefix                          |
| [pi-oc-prompt-cache](https://pi.dev/packages/%40touchtechclub/pi-oc-prompt-cache)           | 0.1.0             | Catalog snapshot: 127 downloads/month, 5/week | Frozen system prompt and appended change messages                            |

## Larger memory packages

### pi-observational-memory

At revision `e891667d10fba3c70dd137fa55823ac1440f6f0d`, the observer, reflector, and dropper perform
background memory work. The compaction hook renders the branch-local ledger through Pi's prepared
boundary without another model call. An empty projection delegates to native Pi. The hook uses
already committed work and does not wait for background workers.
[Compaction hook](https://github.com/elpapi42/pi-observational-memory/blob/e891667d10fba3c70dd137fa55823ac1440f6f0d/src/hooks/compaction-hook.ts),
[mechanism documentation](https://github.com/elpapi42/pi-observational-memory/blob/e891667d10fba3c70dd137fa55823ac1440f6f0d/docs/how-it-works.md).

This supports the feasibility of avoiding summary inference when memory is ready. It does not
establish complete source coverage or continuity quality. The inspected tests check projection and
fallback behavior, not live cache hits. Tiered-memory still needs its own coverage and current-work
freshness checks before discarding source evidence.
[Hook tests](https://github.com/elpapi42/pi-observational-memory/blob/e891667d10fba3c70dd137fa55823ac1440f6f0d/tests/compaction-hook.test.ts).

### pi-hermes-memory

At revision `71ce9f0cf2985a52219b4fba0d3ebdd7c2f598df`, the default policy-only mode supplies
memory-search guidance and optional standing instructions, while detailed memory is retrieved when
needed. Full memory-file injection is an opt-in legacy mode. Its pre-compaction hook performs a
bounded save and returns no replacement checkpoint; native Pi still summarizes the conversation. A
failed save can warn while compaction proceeds.
[Entry point](https://github.com/chandra447/pi-hermes-memory/blob/71ce9f0cf2985a52219b4fba0d3ebdd7c2f598df/src/index.ts),
[save handler](https://github.com/chandra447/pi-hermes-memory/blob/71ce9f0cf2985a52219b4fba0d3ebdd7c2f598df/src/handlers/session-flush.ts).

Hermes keeps detailed memory outside routine context while making it searchable. Stable guidance
could preserve a prefix while unchanged, but this is an inference from provider semantics. Hermes
does not supply evidence that refreshing a protected current-work note through appended revisions is
correct or cheaper. A pre-compaction save also adds work whose cost belongs in a comparison.
[Package behavior](https://github.com/chandra447/pi-hermes-memory/blob/71ce9f0cf2985a52219b4fba0d3ebdd7c2f598df/README.md).

### pi-blackhole

At revision `25d7c1a5894bf50fd8f61e801cfa0aba2900989a`, Blackhole combines structural compaction
derived from pi-vcc with observational memory under one compaction owner. Its optional append mode
retains each earlier compacted segment as a separate immutable message. Later compactions append a
new segment. A rebase replaces the accumulated segments with a smaller representation when pressure
and savings conditions justify it; an explicit compaction command can also start a new chain. Rebase
changes the previously reusable prefix.
[Append-mode contract](https://github.com/k0valik/pi-blackhole/blob/25d7c1a5894bf50fd8f61e801cfa0aba2900989a/docs/APPEND_COMPACTION.md).

The projection order is earlier messages, immutable segments, one current observational-memory and
recall message, then the retained recent conversation. Changes to that current memory message can
invalidate reuse of the recent conversation after it. The stable prefix extends through the
unchanged segments, not necessarily through the retained tail. Invalid branch, coverage, or fallback
matching uses the persisted full summary instead.
[Projection source](https://github.com/k0valik/pi-blackhole/blob/25d7c1a5894bf50fd8f61e801cfa0aba2900989a/src/core/compaction-chain.ts),
[context hook](https://github.com/k0valik/pi-blackhole/blob/25d7c1a5894bf50fd8f61e801cfa0aba2900989a/src/hooks/compaction-context.ts).

Fixture tests compare projected request bytes across repeated compactions. They support mechanical
prefix stability under those fixtures, not provider hits or task-level savings. Between rebases, the
segment chain avoids rewriting earlier compacted segments. It remains distinct from appending a new
work-note revision between compactions, and both designs need a bound on accumulated content.
[Append fixtures](https://github.com/k0valik/pi-blackhole/blob/25d7c1a5894bf50fd8f61e801cfa0aba2900989a/tests/append-before-compact.test.ts).

## Direct caching and pruning packages

### pi-prefix-cache-compaction

Revision `f75a1e70b094859a49b0c646514cb8aef738647c` captures the acting payload at
`before_provider_request`. It clones that full request and appends a summary instruction while
checking that existing prompt fields and messages remain unchanged. A later request handler can
still change what reaches the provider; the captured snapshot is not final wire evidence. Unlike
pi-cache-compact's reconstructed discarded span, the request includes the recent tail too. Its
summary can therefore duplicate information Pi retains verbatim.
[Request builder](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/f75a1e70b094859a49b0c646514cb8aef738647c/src/core.ts),
[extension](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/f75a1e70b094859a49b0c646514cb8aef738647c/src/index.ts).

It targets local prefix-caching servers through Anthropic Messages or OpenAI Completions protocols.
Hosted Anthropic is excluded by default, and OpenAI Responses is unsupported. It skips unsuitable
captures and overflow compaction. Optional post-compaction warming sends a one-token request over
the rebuilt context. Warming establishes the replacement prefix early; it does not eliminate the
work of processing that prefix.
[Supported scope](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/f75a1e70b094859a49b0c646514cb8aef738647c/README.md).

The warmup handler ignores returned usage and is awaited before Pi finishes reporting compaction, so
it can add unreported inference cost and foreground waiting. The custom summary path also does not
use `/compact` instructions. These source findings prevent treating this package as a drop-in
implementation of tiered-memory's contract. Its fake-server tests cover request construction; README
server timings and cache counts are author-reported measurements not reproduced here.
[Warmup and hook](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/f75a1e70b094859a49b0c646514cb8aef738647c/src/index.ts),
[tests](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/f75a1e70b094859a49b0c646514cb8aef738647c/test/core.test.ts).

### cprune

Revision `7e8694f7c2fddd1896ac3c087b17b2ee99153b68` distinguishes prompt-time pruning from changes
to new tool results before persistence. In full mode on providers it classifies as prefix caches, it
preserves the previously sent pruned message forms while their original source hashes match. It
prunes the new tail. A history mismatch stops prefix preservation at that point; a shorter history
resets the stored forms. The preserved forms are held in memory across requests.
[Prefix selection](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L1859).

Its status reads provider usage for cache statistics and labels token-cost savings as estimates.
That distinction is useful for tiered-memory: expected prefix equality and observed billing are
different evidence. The provider-name heuristics that classify some gateways as content caches are
package assumptions, not verified provider contracts in this survey. Persist-time pruning also has
different source-preservation consequences from retaining original evidence for recall.
[Classification and accounting](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts),
[pruning boundaries](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/README.md).

### pi-oc-prompt-cache

The inspected source is the published 0.1.0 npm archive, with git revision
`54ca3dd330f739fb15470e223fb24ae67d825427` in its publication metadata. It freezes the system
prompt, persists that baseline, and appends custom messages containing changes. Compaction resets
the in-memory baseline for the next turn. It predates Pi's native structured-prompt update support.
The catalog's cache-hit percentages are author claims, not measurements established here.
[Published source archive](https://registry.npmjs.org/@touchtechclub/pi-oc-prompt-cache/-/pi-oc-prompt-cache-0.1.0.tgz),
[package catalog](https://pi.dev/packages/%40touchtechclub/pi-oc-prompt-cache).

Its persisted-baseline lookup scans all session entries, and its compaction reset is initially only
in memory. Those choices need branch and restart checks before reuse. Changes are delivered as
custom messages, which Pi converts to user-role messages; an XML-like label does not grant system
authority. A frozen baseline must not prevent an effective policy correction. This source is an
example of the baseline/update pattern, not an implementation to adopt without reconciling Pi's
current prompt and authority model.
[Pi message conversion](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/messages.ts),
[published implementation](https://registry.npmjs.org/@touchtechclub/pi-oc-prompt-cache/-/pi-oc-prompt-cache-0.1.0.tgz).

## Capabilities already in Pi 0.87.0

Pi 0.86 introduced transcript-backed system/tool updates and cost-aware cache warming; both are
present in the target 0.87.0 baseline. Structured prompt-section changes can become later system
messages on supporting models. Unsupported models receive a reconstructed leading prompt, which can
change cache reuse. Returning a forced system-prompt string bypasses the normal structured update
path for the provider request. [Pi 0.86 release](https://pi.dev/changelog/releases/0.86.0),
[prompt preparation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts),
[extension guidance](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md).

Native cache warming uses known cache lifetimes and expected savings to decide whether to send a
small refresh request. The default streaming mode covers active work; idle warming is optional.
Refresh usage appears in session accounting. This is distinct from immediately warming a newly
compacted prompt. A tiered-memory evaluation must record the native warming configuration and count
refresh usage without adding it twice through host totals.
[Pi settings](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/settings.md).

## Implications for tiered-memory

The survey supports keeping route 2A scoped to the memory extension. Public Pi hooks already support
several summary optimizations, so route B does not inherently require a Pi core patch. Those
extensions still introduce ownership, request-fidelity, accounting, and provider-support questions
that do not need to become MVP dependencies. Route B remains deferred.

The inspected implementations show ways to preserve extension-controlled prefixes, but do not
establish that repeated full work-note revisions are cheaper or semantically safer than bounded
snapshots. Blackhole's segments, cprune's preserved message forms, and Pi's structured updates limit
earlier rewrites in different ways, each with a reset or invalidation condition. Testing changes at
the provider dispatch boundary remains a proposed evaluation check.

Candidate requirements and evaluation checks are:

- Preserve the content, ordering, and insertion positions of unchanged memory; avoid rewriting
  earlier context solely to restate the same revision.
- Apply corrections, invalidation, branch selection, and user authority even when reuse decreases.
  Verify cancellation and resumption around any persisted update.
- Bound historical memory additions and specify when they can be replaced. Distinguish a bound on
  the latest note from the total context occupied by earlier revisions or segments.
- Measure summary generation, first continuation, steady continuation, workers, fallback, and cache
  warming separately, then compare total cost and foreground waiting over the same task horizon.
- Verify prefix stability with scripted requests, and reserve real cache-hit and continuation claims
  for separately authorized provider measurements.

These checks do not themselves amend approved requirements. The selected MVP uses complete appended
revisions through an internal strategy module and resets memory presentation when accumulated
revisions exceed their budget. B and C remain post-MVP comparison candidates.
