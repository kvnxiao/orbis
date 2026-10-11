# Memory design research

This research explains the evidence and trade-offs behind `@orbis/memory`. The [SPEC](../../SPEC.md) defines behavior; its [supporting evidence](../../SPEC.md#supporting-evidence) section links each requirement to this research and to outcomes that still need measurement.

## Core reading path

Read a topic when its evidence affects implementation or evaluation. The core hypothesis remains unmeasured: whether prepared memory improves continuation enough to justify its auxiliary work.

| Document                                                                          | Question it answers                                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
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

The [host investigation](pi-compaction.md) identifies the Pi release source, inspection date, integration capabilities, and verification limits. Each comparison document identifies the revisions and release qualifications of the other projects it examines. Those comparisons describe mechanisms; they do not establish runtime compatibility with the core's Pi baseline. No Pi runtime or live-model experiment is reported for this baseline. Later Pi releases need their own compatibility checks.

## Design assessment and recommended path

The refreshed evidence supports an independent continuation core with a protected snapshot, source-linked observations, bounded recall, and one replacement-checkpoint owner. The [current package comparisons](pi-cache-compaction-ecosystem.md) show stronger worker controls and more request-reuse options. The [broader systems](agent-memory-systems.md) show richer retrieval and knowledge maintenance. These capabilities do not establish that additional model roles, a shared database, or automatic project profiles improve this core.

The hardest part of the design is preparing the right state for Pi's cut while edits, forks, delayed observer results, and uncertain appends can change what is applicable. Verify those mechanics with scripted providers before treating summary quality as the remaining problem. Then evaluate actual repository continuation against native Pi under repeated compaction, counting auxiliary calls, waiting, retries, and fallback. Runtime implementation and live-model evaluation require their separate authorizations.

The [evaluation protocol](evidence-and-evaluation.md) distinguishes construction, retrieval, and use failures. The recommended follow-up depends on which failure is observed:

| Observed problem                                    | Recommended response                                                                                                                                           | Condition for a broader alternative                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| An obligation or decision is lost                   | Inspect initial extraction, evidence-linked retirement, checkpoint-state selection, and presentation repair separately. Preserve the protected-state contract. | Revisit the representation only when those diagnostics show a persistent semantic failure; more model roles are not an automatic repair.   |
| Recorded evidence is hard to retrieve               | Improve source discovery, attribution, and bounded expansion, then repeat continuation tasks.                                                                  | Consider semantic retrieval or reranking when measured failures involve paraphrase or relationships that simpler discovery cannot resolve. |
| The complete snapshot exceeds observer capacity     | Report suspension and the need for an admissible model, budget, or lineage, as the contract requires.                                                          | Revisit partial-state observation only when suspension is observed and a separate selection/maintenance policy can be evaluated.           |
| Auxiliary work outweighs continuation benefit       | Measure scheduling, catch-up, presentation, native fallback, and subsequent acting requests separately.                                                        | Explore cache replay or unchanged summary segments only for a measured cost or latency problem, preserving correction and lineage rules.   |
| A concrete consumer needs knowledge across sessions | Specify its admission, scope, correction, retraction, and authorization policy separately.                                                                     | Define a companion interface or shared service from that consumer's actual requirements.                                                   |

## Verification boundary

The [conformance clause](../../SPEC.md#conformance) and scenarios beside each requirement define the required checks. An early scripted native-baseline harness can verify host mechanics without model calls. Semantic preservation, subsequent actions, provider-cache savings, and full-task cost need separate measurements. No live-model evaluation of this package is reported here.
