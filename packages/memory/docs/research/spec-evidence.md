# SPEC evidence map

Research date: 2026-10-04. This map connects the [approved contract](../../SPEC.md) to supporting
research. Follow the requirement links for behavior and the topic links for evidence and trade-offs.

## How to read a claim

- **Host fact:** behavior inspected in a named Pi version or exercised by a bounded probe.
- **Product decision:** an approved objective or scope choice, whose rationale research can explain.
- **Design inference:** an expected benefit or failure inferred from mechanisms or related systems.
- **Evaluation result:** an observed outcome under stated tasks, models, versions, and budgets.

A section or table identifies its evidence kind once. Preserve qualifications that change the
claim's scope; a source inspection does not become a measured continuation result.

## Requirement evidence

| Requirement                                                                             | Supporting evidence                                                                                                                                                                                                              | Measurement still needed                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Session continuity](../../SPEC.md#session-continuity--req-session-continuity)          | **Host fact:** [native information categories](pi-compaction.md#native-checkpoint-information). **Design inference:** [continuation analysis](continuity-and-invariants.md).                                                     | Required information and correct subsequent actions across repeated compactions.                               |
| [Session observations](../../SPEC.md#session-observations--req-session-observations)    | **Host fact:** [Pi source scope](pi-compaction.md#actual-source-coverage). **Design inference:** [observational-memory comparison](observational-memory-comparison.md).                                                          | Extraction loss, valid empty acceptance, stale work, and logical commit recovery.                              |
| [Continuation snapshot](../../SPEC.md#continuation-snapshot--req-continuation-snapshot) | **Design inference:** [structured updates and capacity](continuity-and-invariants.md).                                                                                                                                           | Correct retirement, retention of needed decisions and context, and input saturation under growing active sets. |
| [Source recall](../../SPEC.md#source-recall--req-source-recall)                         | **Host fact:** [original and effective records](pi-compaction.md#original-records-and-effective-context). **Design inference:** [retrieval and use](evidence-and-evaluation.md).                                                 | Discovery of details omitted by extraction, attribution, and actual recall use.                                |
| [Session lineage](../../SPEC.md#session-lineage--req-session-lineage)                   | **Host fact:** [persistence and ancestry](pi-compaction.md#persistence-and-selected-lineage).                                                                                                                                    | Resume, forks, context edits, corruption, and uncertain appends through real host fixtures.                    |
| [Unified compaction](../../SPEC.md#unified-compaction--req-unified-compaction)          | **Host fact:** [Pi integration audit](pi-compaction.md). **Design inference:** [recovery trade-offs](continuity-and-invariants.md).                                                                                              | Prepared-cut preservation, instruction failure, external checkpoints, and repeated custom/native transitions.  |
| [File inventory](../../SPEC.md#file-inventory--req-file-inventory)                      | **Host fact:** [native inheritance limit](pi-compaction.md#file-operation-history-is-an-exception). **Design inference:** [bounded supplement](continuity-and-invariants.md#3-define-whole-checkpoint-fallback-and-its-reports). | Cumulative inventory across custom and native checkpoints, including incomplete-source reports.                |
| [Memory activation](../../SPEC.md#memory-activation--req-memory-activation)             | **Host fact:** [session persistence and lineage](pi-compaction.md#persistence-and-selected-lineage). **Product decision:** [independent core and deferred companions](modularity-and-knowledge.md).                              | Disabled observation and file supplement with policy-consistent recall; fork and resume inheritance.           |
| [Resource budgets](../../SPEC.md#resource-budgets--req-resource-budgets)                | **Design inference:** [evaluation controls](evidence-and-evaluation.md).                                                                                                                                                         | Foreground delay, bounded work, fallback frequency, observer overhead, and complete task cost.                 |
| [Request stability](../../SPEC.md#request-stability--req-request-stability)             | **Host fact:** [request and cache mechanics](prompt-caching-and-compaction.md).                                                                                                                                                  | Stable constructed requests across unchanged state and measured provider cache behavior separately.            |

## Reconsideration conditions

These are evaluation questions, not additional MVP features:

- Does catch-up recover enough checkpoints to justify foreground waiting and auxiliary cost?
- Does full active-set reconciliation catch superseded work before input capacity becomes limiting?
- Does the fallback file supplement preserve useful context at reasonable integration cost?
- Can acting models discover and use omitted details through bounded literal recall?
- Does the prepared snapshot improve continuation relative to native Pi on representative tasks?

Use the [evaluation design](evidence-and-evaluation.md) to distinguish construction loss, retrieval
failure, and incorrect use. Recheck host assumptions against the targeted Pi release before
implementation. A future companion's requirements can motivate a later API without blocking the
core's current scope.

## Evidence not produced

This research reports no live-model evaluation of `@orbis/memory`, native semantic-parity result, or
provider-cache saving. Scripted probes and documentation checks establish their stated mechanical
properties; full runtime conformance remains unverified because the package has no implementation.
