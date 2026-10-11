# Memory design research

This research explains the evidence and trade-offs behind `@orbis/memory`. The [SPEC](../../SPEC.md)
defines behavior; its [supporting evidence](../../SPEC.md#supporting-evidence) section links each
requirement to this research and to outcomes that still need measurement.

## Core reading path

Read a topic when its evidence affects implementation or evaluation. The core hypothesis remains
unmeasured: whether prepared memory improves continuation enough to justify its auxiliary work.

| Document                                                              | Evidence to use                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Pi compaction](pi-compaction.md)                                     | Native inputs, custom checkpoints, cancellation, persistence, and host integration limits. |
| [Continuity and invariants](continuity-and-invariants.md)             | Native information categories, obligation preservation, capacity, and recovery trade-offs. |
| [Prompt caching and compaction](prompt-caching-and-compaction.md)     | Stable request construction and the limits of provider-cache claims.                       |
| [Evidence and evaluation](evidence-and-evaluation.md)                 | Construction, retrieval, and continuation failures; baselines and cost accounting.         |
| [Observational-memory packages](observational-memory.md)              | The two Pi projects, their released behavior, and relevant mechanisms.                     |
| [Observational-memory comparison](observational-memory-comparison.md) | Mastra's approach and the costs of additional maintenance stages.                          |
| [Pi cache and compaction ecosystem](pi-cache-compaction-ecosystem.md) | Concrete integration examples and post-MVP cache experiments.                              |

## Future-companion surveys

These surveys provide background for a concrete future consumer. They do not expand the core MVP.

| Document                                                | Future question                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| [Memory layers](memory-layers.md)                       | How do purpose, scope, representation, and maintenance differ?     |
| [Agent memory systems](agent-memory-systems.md)         | Which broader storage and maintenance mechanisms exist?            |
| [Modularity and knowledge](modularity-and-knowledge.md) | What policies would project knowledge or developer habits require? |

## Sources and method

The investigation used primary source, published package archives, official documentation, and
papers. Topic documents identify inspected revisions and publication status. Source inspection,
scripted probes, and live-model outcomes are distinct evidence.

The [host investigation](pi-compaction.md) identifies the Pi release source, inspection date,
integration capabilities, and verification limits. Each comparison document identifies the revisions
and release qualifications of the other projects it examines. Those comparisons describe mechanisms;
they do not establish runtime compatibility with the core's Pi baseline. No Pi runtime or live-model
experiment is reported for this baseline. Later Pi releases need their own compatibility checks.

## Verification boundary

The [conformance scenarios](../../SPEC.md#conformance-scenarios) define the required checks. An
early scripted native-baseline harness can verify host mechanics without model calls. Semantic
preservation, subsequent actions, provider-cache savings, and full-task cost need separate
measurements. No live-model evaluation of this package is reported here.
