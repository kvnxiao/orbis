# Evidence for the draft SPEC

Research date: 2026-10-03. This map connects the current draft to inspected host behavior, related
systems, and research. It does not amend [the SPEC](../../SPEC.md), approve open decisions, or claim
that an implementation has passed conformance checks.

## How to read a claim

A **host fact** describes inspected Pi behavior. A **product decision** is an approved objective or
scope choice; research can explain its trade-offs but cannot prove that the user should want it. A
**design inference** proposes how mechanisms might serve that objective. An **unverified outcome**
requires implementation or empirical evaluation.

Do not turn one kind of evidence into another. In particular, a public hook proves an integration
point exists, not that an observer preserves every relevant fact. An author's benchmark does not
establish Orbis quality. A field in a proposed schema does not prove correct extraction.

## Purpose and architecture claims

| Draft statement                                                             | Evidence kind and support                                                                                                                            | What remains unverified                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Effective continuation is the primary objective.                            | Product decision. [Continuity](continuity-and-invariants.md) explains the information/action distinction.                                            | The package has no runtime quality result.                                           |
| The core should work without knowledge companions.                          | Product decision with architectural precedent in [memory layers](memory-layers.md) and [system comparisons](agent-memory-systems.md).                | Actual standalone usability and the eventual consumer interface.                     |
| Pi owns session history and compaction.                                     | Host fact: [Pi audit](pi-compaction.md), backed by pinned session and compaction source.                                                             | Compatibility of a future implementation with the tested host versions.              |
| One observer response maintains snapshot and observations.                  | Product decision; [Mastra comparison](observational-memory-comparison.md) shows related combined extraction while identifying important differences. | Extraction accuracy, commit behavior, source limits, and budget sufficiency.         |
| Topic consolidation, a journey, and project learnings are outside this MVP. | Product scope decision. [Modularity](modularity-and-knowledge.md) identifies their additional admission and maintenance policies.                    | Whether later evaluations expose a specific continuation need for another mechanism. |
| The package supports selected session lineage.                              | Product decision enabled by public ancestry/projection reads. [Pi audit](pi-compaction.md).                                                          | Fork, navigation, corruption, and delayed-result behavior under the chosen format.   |
| Snapshot presentation is checkpoint-only.                                   | Product decision; the custom summary mechanism supports it. [Continuity](continuity-and-invariants.md#5-choose-when-the-snapshot-appears).           | Effect on continuation between checkpoints, total cost, and cache use.               |

## Requirement-by-requirement support

| Requirement                | What the research supports                                                                                                                                                                                                                         | Remaining contract or proof obligation                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`   | Native categories, incremental summary use, split-turn behavior, and file extraction are directly inspectable. The [parity table](continuity-and-invariants.md#category-level-parity) allocates candidate content.                                 | Explicit category allocation; source and action rubrics; custom/native transition limits; measured semantic parity.                                                                   |
| `REQ-session-observations` | Public nested inference and custom persistence exist. [Observational projects](observational-memory.md) demonstrate different preparation and commit choices. Processing coverage and semantic preservation are demonstrably separate concepts.    | Eligible source domain; valid empty output; accepted coverage; atomic association of snapshot and observations; stale-result and cancellation rules.                                  |
| `REQ-current-work-note`    | The active-obligation rationale remains coherent. Ordinary note injection is not needed to return a custom checkpoint. [Continuity](continuity-and-invariants.md) separates current state from historical evidence.                                | Rationale, blockers, exact identifiers, freshness, capacity, and preservation through repeated updates. A prompt cannot guarantee these.                                              |
| `REQ-source-recall`        | Stored Pi entries survive compaction and public reads can retrieve them. [Retrieval evidence](evidence-and-evaluation.md) distinguishes construction loss from retrieval failure.                                                                  | Search independent of extracted IDs; attribution; permitted source types; scope; pagination/truncation; unavailable evidence; source lifetime.                                        |
| `REQ-session-lineage`      | Pi provides selected ancestry and canonical projection; a branch summary is an intentional import onto that ancestry. [Pi audit](pi-compaction.md#persistence-and-selected-lineage).                                                               | Do not substitute all-entry scans. Define source identity across forks, reconstruction, navigation, and pending work.                                                                 |
| `REQ-unified-compaction`   | Complete custom results, decline, and cancellation exist; custom summary text becomes later `previousSummary`. [Pi audit](pi-compaction.md).                                                                                                       | Preserve the prepared cut; avoid treating cancellation as retry-preserving; define incomplete coverage, instructed compaction, prior file metadata, correction, and fallback reports. |
| `REQ-modular-memory`       | Session evidence can be consumed without giving a companion ownership of compaction. [Modularity](modularity-and-knowledge.md) compares runtime and durable interfaces.                                                                            | Concrete consumer needs, dependency direction, public versioning, unavailable-core behavior, and broader-claim correction. No generic framework is established as necessary.          |
| `REQ-resource-budgets`     | Signals, request limits, and usage reporting provide mechanisms. Other systems expose the costs of retries, background preparation, and multiple stores. [Caching](prompt-caching-and-compaction.md) and [evaluation](evidence-and-evaluation.md). | Numerical bounds, elapsed deadlines, concurrency, cancellation, accounting gaps, capacity recovery, and separately authorized live-run limits.                                        |

## Proposed changes to discuss

These are changes or additions recommended for the next design round. The current draft deliberately
leaves most of them open. This list is not authorization to resolve them silently. It does not
propose reversing the settled core direction.

| Affected requirement                                 | Proposed addition or clarification                                                                                                                                              | Why it is better supported than the alternative                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`, `REQ-current-work-note`    | Allocate applicable decision rationale, blockers, exact continuation identifiers, and split-turn context explicitly.                                                            | Native prompts request these categories; an observation index alone does not establish visibility.                                                    |
| `REQ-session-observations`, `REQ-unified-compaction` | Account for all eligible prepared source kinds and prior checkpoint material; accept coverage only for completed, validated processing. Initially use native fallback for gaps. | Worker scheduling or cursor advance can hide unprocessed evidence. Foreground catch-up adds mechanisms whose benefit remains unmeasured.              |
| `REQ-source-recall`                                  | Provide discovery over recorded source independently of observation IDs, with bounded results and explicit unavailable-source outcomes.                                         | Extraction can omit the very detail later needed. ID-only recall cannot discover an unknown or unextracted item.                                      |
| `REQ-unified-compaction`                             | State that native fallback preserves custom summary text as prior input but does not inherit custom file-operation details.                                                     | The two behaviors differ in inspected Pi source; treating the whole result as transparently preserved overstates the host contract.                   |
| `REQ-unified-compaction`, `REQ-resource-budgets`     | Distinguish fallback attempt, native success/failure, and incoming retry intent. Use decline rather than cancellation for ordinary eligibility failure.                         | Cancellation can suppress retry; throwing is not a reliable veto. Failure reporting must describe actual outcomes.                                    |
| `REQ-current-work-note`, `REQ-resource-budgets`      | Use compaction-time capacity fallback without the former ordinary-request abort; do not drop active obligations through priority truncation.                                    | Checkpoint-only presentation removes ordinary full-note injection, while finite capacity still needs an explicit failure path.                        |
| `REQ-unified-compaction`                             | Separate visible chronological corrections from off-transcript invalidation. Do not import blanket stale-note cancellation.                                                     | A later visible correction is valid native chronology. Invisible erasure is a different product promise and may conflict with retry preservation.     |
| `REQ-unified-compaction`                             | Delegate instructed compaction initially, while documenting native split-prefix instruction limits.                                                                             | This avoids silently ignoring instructions in a custom result; stronger semantics require an explicit package or host change.                         |
| `REQ-modular-memory`                                 | Preserve evidence identity and bounded internal reads; select a public integration when a concrete companion needs it.                                                          | Runtime notifications are not a durable request/response service. There is no demonstrated need for two public interfaces or a generic framework now. |
| `REQ-session-lineage`, `REQ-source-recall`           | Consider Pi session entries if editable external memory and independent retention are deferred.                                                                                 | They fit session-bound retention if that lifetime is selected and remove a separate publication store; curation and retention must be settled first.  |
| `REQ-session-continuity`, `REQ-resource-budgets`     | Separate construction, discovery, and acting-model use in evaluation; compare category preservation and executed continuation against native Pi.                                | QA scores, compression ratios, and mock calls answer narrower questions.                                                                              |

The storage recommendation is conditional. The manual-instruction recommendation deliberately
preserves native semantics, including its limitation. The file-list finding may require a decision
about a stronger host guarantee. Those dependencies should remain explicit in the brainstorm.

## Recommendations that remain unchanged

Keep `@orbis/memory` as an independently useful continuation core. Keep the combined observer
response, checkpoint-only snapshot, retained source-linked observations, selected lineage, and the
separation from broader knowledge maintenance. Keep native settings and the prepared cut. Do not
layer a native summary of already processed messages below the package's sections. Do not define
parity by token cost.

These positions are supported by a coherent responsibility split and available mechanisms. Their
quality advantage remains a hypothesis to evaluate, not a research result already established for
Orbis.

## Assumptions and findings that could invalidate a recommendation

| Assumption or unresolved condition                                                               | Recommendation at risk                                                    | Evidence needed                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Background preparation reaches enough compactions in time.                                       | Fallback-first handling of coverage gaps.                                 | Observe fallback frequency and foreground latency under representative histories.                                                 |
| Native fallback is acceptable with its actual split-instruction and custom-file metadata limits. | Delegation as the initial recovery/manual-instruction policy.             | Product decision on required semantics; scripted transition fixtures; host change if stronger deterministic behavior is required. |
| Curation does not require invisible retraction from previous checkpoints.                        | Removing blanket stale-note cancellation without another correction path. | Explicit curation/disable contract and context-edit cases.                                                                        |
| Session lifetime is sufficient for the core's recall promise.                                    | Session-entry persistence.                                                | Decide ephemeral-session, deletion, fork, and independent-retention behavior.                                                     |
| Bounded source search makes omitted details practically discoverable.                            | Source recall as the supplement to compressed observations.               | Retrieval fixtures followed by action-based evaluation with actual recall choices.                                                |
| The writer can maintain the chosen obligations within the finite budget often enough.            | Complete snapshot with capacity fallback.                                 | Repeated-compaction evaluation, including smaller writers and large sets of active obligations.                                   |
| Companions do not need a public integration in the first release.                                | Defer public runtime/reader interfaces.                                   | Define the first consumer and test its concrete evidence needs.                                                                   |
| Inspected host behavior remains applicable.                                                      | All source-derived integration recommendations.                           | Recheck the targeted Pi revision before implementation and exercise it through scripted providers.                                |

The original inference-access assumption is only partly true: public APIs can perform nested
inference and resolve credentials, but do not expose one operation cloning the native host's exact
routing, headers, and stream wrapper. The original persistence assumption is true for custom summary
text, not every returned field or later native file metadata. Neither should remain an unqualified
premise in the completed SPEC.

## Evidence not produced by this research

No real models were called, no provider cache savings were measured, and no runtime implementation
of this package was tested. Narrow earlier scripted probes establish specific Pi input/persistence
mechanics; they do not establish semantic quality or full SDK compatibility. The documentation
checks for this PR validate the artifacts, not the proposed memory behavior.
