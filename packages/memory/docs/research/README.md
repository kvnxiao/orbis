# Memory design research

This research explains the evidence and trade-offs behind `@orbis/memory`. The [SPEC](../../SPEC.md) defines behavior; its [supporting evidence](../../SPEC.md#supporting-evidence) section links each requirement to this research and to outcomes that still need measurement.

## Core reading path

Read a topic when its evidence affects implementation or evaluation. The core hypothesis remains unmeasured: whether prepared memory improves continuation enough to justify its auxiliary work.

| Document                                                                          | Question it answers                                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [Pi runtime feasibility](pi-runtime-feasibility.md)                               | Which public Pi 1.1.0 APIs expose request inputs, and where do scripted probes require conservative estimation or omission?      |
| [Virtual routing and alerts](virtual-routing-and-alerts.md)                       | What can Pi establish about possible routes, authorized observer dispatch, and unsolicited notices across host modes?            |
| [Structured memory updates](structured-memory-updates.md)                         | What do current editing systems and evaluations establish about structured updates and semantic loss?                            |
| [Snapshot growth and cost](growth-and-cost.md)                                    | How does full-state observation scale, what limits repeated overflow work, and what local continuation evidence is available?    |
| [Pi compaction](pi-compaction.md)                                                 | Which Pi 1.1.0 public contracts constrain custom compaction, source coverage, state recovery, and inference?                     |
| [Presentation, inventory, and authority](presentation-inventory-and-authority.md) | How can presentation calls, cumulative file inventory, and edited permission claims remain bounded and attributable?             |
| [Continuity and invariants](continuity-and-invariants.md)                         | Which preservation and recovery policies support effective continuation after Pi compaction?                                     |
| [Prompt caching and compaction](prompt-caching-and-compaction.md)                 | How do provider compaction and prompt caching affect checkpoint construction and the proposed memory design?                     |
| [Evidence and evaluation](evidence-and-evaluation.md)                             | How should construction loss, retrieval failures, action quality, and full-task cost be evaluated?                               |
| [Observational-memory packages](observational-memory.md)                          | How do the two Pi observational-memory implementations differ in storage, processing coverage, and compaction?                   |
| [Observational-memory comparison](observational-memory-comparison.md)             | What do the current observational-memory implementations establish about preparation, activation, and current-work preservation? |
| [Pi cache and compaction ecosystem](pi-cache-compaction-ecosystem.md)             | Which Pi memory, cache, and pruning mechanisms are relevant to the core, and where are their compatibility limits?               |

## Future-companion surveys

These surveys provide background for a concrete future consumer. They do not expand the core MVP.

| Document                                                | Question it answers                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Memory layers](memory-layers.md)                       | Which memory responsibilities belong in the continuation core and which require separate policies?   |
| [Agent memory systems](agent-memory-systems.md)         | Which broader storage and maintenance mechanisms should remain outside a continuation-memory core?   |
| [Modularity and knowledge](modularity-and-knowledge.md) | How can the core support future knowledge companions without defining speculative shared interfaces? |

## Sources and method

The investigation used primary source, published package archives, official documentation, and papers. External documentation, releases, default-branch source, and paper revisions were refreshed on 2026-10-11. Topic documents identify current release boundaries and retrieval dates. Pi remains fixed at the 1.1.0 host baseline. Source inspection, scripted probes, and live-model outcomes are distinct evidence.

The [host investigation](pi-compaction.md) identifies the Pi release source, inspection date, integration capabilities, and verification limits. Each comparison document identifies the revisions and release qualifications of the other projects it examines. Those comparisons describe mechanisms; they do not establish runtime compatibility with the core's Pi baseline. The [isolated Pi 1.1.0 probes](pi-runtime-feasibility.md#executed-probes-and-remaining-gaps) exercised selected host mechanics with scripted providers and blocked network access. They did not run a memory implementation or real models. The [local corpus audit](growth-and-cost.md#native-pi-evidence-and-cut-crossing-frequency) found no qualifying compaction histories for a retention or cut-crossing measurement. The [routing follow-up](virtual-routing-and-alerts.md), checked on 2026-10-12 UTC, distinguishes unsupported virtual routing from enforceable destination policies and verifies selected denial boundaries with scripted providers. Later Pi releases need their own compatibility checks.

## Design assessment and recommended path

The refreshed evidence supports an independent continuation core with maintained continuation state that protects active obligations, findings linked to source messages, bounded recall, and one extension responsible for replacement checkpoint text. The [current package comparisons](pi-cache-compaction-ecosystem.md) describe bounded background processing, explicit checkpoint modes, request replay, and requests sent to populate provider caches. The [broader systems](agent-memory-systems.md) show richer retrieval and knowledge maintenance. These capabilities do not establish that additional model roles, a shared database, or automatic project profiles improve this core.

The hardest part of the design is preparing the right state for Pi's boundary between summarized and retained history while edits, forks, delayed results from the auxiliary observer model, and uncertain appends can change what is applicable. Verify those mechanics with scripted providers before treating summary quality as the remaining problem. Then evaluate actual repository continuation against native Pi under repeated compaction, counting auxiliary calls, waiting, retries, and fallback. Runtime implementation and live-model evaluation require their separate authorizations.

Read-only snapshot inspection and accepted-retirement history make state changes auditable; they do not prevent false retirement or make the acting model search for a missing obligation. Unsupported virtual acting capacity can mean native fallback for an entire session. Observer destination checks are a separate integration requirement. Automatic notices expose degradation and continuing auxiliary work without per-update approval.

The [cost illustration](growth-and-cost.md#illustrative-scale-not-a-benchmark) puts observer input at approximately 2.6–4.9 times native summary input for mean snapshots of 8,000–20,000 tokens under its assumptions. Carry that range into evaluation as a cost hypothesis, not a measured bill or acceptance threshold.

The [evaluation protocol](evidence-and-evaluation.md) distinguishes construction, retrieval, and use failures. The recommended follow-up depends on which failure is observed:

| Observed problem                                    | Recommended response                                                                                                                                                                                              | Condition for a broader alternative                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An obligation or decision is lost                   | Inspect initial extraction, evidence-linked retirement, selection of state before the retained-history boundary, and restoration of omitted presentation items separately. Preserve the protected-state contract. | Revisit the representation only when those diagnostics show a persistent semantic failure; more model roles are not an automatic repair.                      |
| Recorded evidence is hard to retrieve               | Improve source discovery, attribution, and bounded expansion, then repeat continuation tasks.                                                                                                                     | Consider semantic retrieval or reranking when measured failures involve paraphrase or relationships that simpler discovery cannot resolve.                    |
| Snapshot presentation repeatedly exceeds capacity   | Supply the observer with a maintenance target and suppress presentation inference until fit can improve; preserve active obligations and continue bounded observation.                                            | Reconsider suspension after a cumulative spending limit or partial-state maintenance only when measured cost and recovery frequency justify the added policy. |
| The complete snapshot exceeds observer capacity     | Report suspension and the need for a permitted model or budget that fits complete input, or a user-selected branch with smaller valid state, as the contract requires.                                            | Revisit partial-state observation only when suspension is observed and a separate selection/maintenance policy can be evaluated.                              |
| Auxiliary work outweighs continuation benefit       | Measure scheduling, catch-up, presentation, native fallback, and subsequent acting requests separately.                                                                                                           | Explore cache replay or unchanged summary segments only for a measured cost or latency problem, preserving correction and lineage rules.                      |
| A concrete consumer needs knowledge across sessions | Specify its admission, scope, correction, retraction, and authorization policy separately.                                                                                                                        | Define a companion interface or shared service from that consumer's actual requirements.                                                                      |

## Verification boundary

The [conformance clause](../../SPEC.md#conformance) and scenarios beside each requirement define the required checks. An early scripted native-baseline harness can verify host mechanics without model calls. Semantic preservation, subsequent actions, provider-cache savings, and full-task cost need separate measurements. No live-model evaluation of this package is reported here.
