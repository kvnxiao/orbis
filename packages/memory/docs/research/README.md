# Memory design research

Research date: 2026-10-04. This research explains the evidence and trade-offs behind
`@orbis/memory`. The [SPEC](../../SPEC.md) defines behavior; its
[supporting evidence](../../SPEC.md#supporting-evidence) section links each requirement to this
research and to outcomes that still need measurement.

## How to read a claim

- **Host fact:** behavior inspected in a named Pi version or exercised by a bounded probe.
- **Product decision:** an approved objective or scope choice, whose rationale research can explain.
- **Design inference:** an expected benefit or failure inferred from mechanisms or related systems.
- **Evaluation result:** an observed outcome under stated tasks, models, versions, and budgets.

A section or table identifies its evidence kind once. Preserve qualifications that change the
claim's scope; a source inspection does not become a measured continuation result.

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

The host corrections in this review were verified against installed Pi 0.99.1. The earlier research
recorded an archive comparison with published 1.0.1; that comparison was not repeated in this review
and is not runtime compatibility evidence. Recheck host facts against the targeted Pi release before
implementation.

Important comparison pins are:

| Project                     | Inspected source and release qualification                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi                          | [1.0.1 / a7229dd](https://github.com/earendil-works/pi/tree/a7229ddc21810d6245105978033b7df645ecc2f7), compared with installed 0.99.1.                                                                                                    |
| Amos observational memory   | [78a1efc](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e), manifest 0.1.0; no verified GitHub release.                                                                            |
| Elpapi observational memory | [886f7a6](https://github.com/elpapi42/pi-observational-memory/tree/886f7a6628d10ea420eb6ceecaee36691489b2fb), newer than released 3.1.4 despite the same manifest version.                                                                |
| Mastra memory               | [Stable 1.35.0](https://github.com/mastra-ai/mastra/tree/b21e46e19b469a25c8896bcee90afd58d6f1a890), separately compared with [HEAD](https://github.com/mastra-ai/mastra/tree/b2433eb8d90597295de0327c3756d7a2b83a65ff) at 1.36.0-alpha.2. |
| Blackhole                   | [be64de8](https://github.com/k0valik/pi-blackhole/tree/be64de823f27d8be4195dbe0734409017b05240f), npm 0.5.10.                                                                                                                             |
| Hermes                      | [d5e2d13](https://github.com/chandra447/pi-hermes-memory/tree/d5e2d1384b2f78d7a304f24383ad3aae1da5749e), manifest 0.9.10 with substantial Unreleased changes.                                                                             |

Additional pins appear in the system and ecosystem documents. Each comparison distinguishes
published releases, inspected source revisions, and mutable documentation.

## Verification boundary

The [conformance scenarios](../../SPEC.md#conformance-scenarios) define the required checks. An
early scripted native-baseline harness can verify host mechanics without model calls. Semantic
preservation, subsequent actions, provider-cache savings, and full-task cost need separate
measurements. No live-model evaluation of this package is reported here.
