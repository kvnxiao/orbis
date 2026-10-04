# Evidence for the draft SPEC

Research date: 2026-10-03. This map connects the current draft to inspected host behavior, related
systems, and research. It does not amend [the SPEC](../../SPEC.md) or claim that an implementation
has passed conformance checks. Selected product directions and research recommendations are
identified separately.

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

## Selected directions for the completed contract

The MVP follows Pi session retention and defers user curation of derived memory. It preserves
evidence identity, attribution, scope, verification state, and bounded internal reads. A public
companion API is deferred until a concrete consumer needs it. These choices constrain the remaining
storage and integration design; they do not select a persisted schema or complete the draft SPEC.

## Proposed changes to discuss

These are changes or additions recommended for the next design round. The current draft deliberately
leaves most of them open. This list is not authorization to resolve them silently. It does not
propose reversing the settled core direction.

| Affected requirement                                 | Proposed addition or clarification                                                                                                                                                        | Why it is better supported than the alternative                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`, `REQ-current-work-note`    | Allocate applicable decision rationale, blockers, exact continuation identifiers, and split-turn context explicitly.                                                                      | Native prompts request these categories; an observation index alone does not establish visibility.                                                                                 |
| `REQ-session-observations`, `REQ-unified-compaction` | Account for all eligible prepared source kinds and prior checkpoint material. Attempt bounded observer catch-up for gaps, recheck accepted state, then use native fallback if ineligible. | Catch-up reuses the observer and has direct implementation precedent. It still needs finite foreground work and accepted-coverage checks; quality and cost effects are unmeasured. |
| `REQ-source-recall`                                  | Provide discovery over recorded source independently of observation IDs, with bounded results and explicit unavailable-source outcomes.                                                   | Extraction can omit the very detail later needed. ID-only recall cannot discover an unknown or unextracted item.                                                                   |
| `REQ-unified-compaction`                             | State that native fallback preserves custom summary text as prior input but does not inherit custom file-operation details.                                                               | The two behaviors differ in inspected Pi source; treating the whole result as transparently preserved overstates the host contract.                                                |
| `REQ-unified-compaction`, `REQ-resource-budgets`     | Distinguish fallback attempt, native success/failure, and incoming retry intent. Use decline rather than cancellation for ordinary eligibility failure.                                   | Cancellation can suppress retry; throwing is not a reliable veto. Failure reporting must describe actual outcomes.                                                                 |
| `REQ-current-work-note`, `REQ-resource-budgets`      | Assess bounded snapshot condensation before capacity fallback; keep ordinary requests independent of snapshot fitting and preserve active obligations.                                    | Condensation addresses core continuation capacity. Both repair and native fallback use lossy inference; compare preservation and total work.                                       |
| `REQ-unified-compaction`                             | Separate visible chronological corrections from off-transcript invalidation. Do not cancel solely because a previous checkpoint has a superseded statement.                               | A later visible correction is valid native chronology. Invisible erasure is a different product promise and may conflict with retry preservation.                                  |
| `REQ-unified-compaction`                             | Compare instruction-aware checkpoint generation with complete host delegation; define the instruction semantics before selecting recovery.                                                | Native prefix-only summarization receives no manual instructions. Avoiding another implementation path does not establish that delegation meets the intended behavior.             |
| `REQ-modular-memory`                                 | Define the internal evidence-reading contract within the selected deferral of a public companion API.                                                                                     | Runtime notifications are not a durable request/response service. There is no demonstrated need for two public interfaces or a generic framework now.                              |
| `REQ-session-lineage`, `REQ-source-recall`           | Consider Pi session entries within the selected session-retention scope.                                                                                                                  | They fit session-bound retention and avoid a separate publication store. Record validation, source availability, and fork behavior still need design.                              |
| `REQ-session-continuity`, `REQ-resource-budgets`     | Separate construction, discovery, and acting-model use in evaluation; compare category preservation and executed continuation against native Pi.                                          | QA scores, compression ratios, and mock calls answer narrower questions.                                                                                                           |

The storage format remains open within the selected retention scope. Manual-instruction semantics
and their generation path also remain open. Cumulative file-information parity is a requirement
across custom/native transitions; the missing native metadata inheritance is an integration problem
to solve, not permission to weaken that requirement.

## Supported core direction

Keep `@orbis/memory` as an independently useful continuation core. Keep the combined observer
response, checkpoint-only snapshot, retained source-linked observations, selected lineage, and the
separation from broader knowledge maintenance. Keep native settings and the prepared cut. Do not
layer a native summary of already processed messages below the package's sections. Do not define
parity by token cost.

These positions are supported by a coherent responsibility split and available mechanisms. Their
quality advantage remains a hypothesis to evaluate, not a research result already established for
Orbis.

## Assumptions and findings that could invalidate a recommendation

| Assumption or unresolved condition                                                                                | Recommendation at risk                                       | Evidence needed                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Bounded catch-up can fill typical gaps without unacceptable foreground delay.                                     | Bounded observer catch-up before native fallback.            | Measure catch-up completion, total work, foreground waiting, fallback frequency, and continuation under representative histories. |
| The recovery integration preserves cumulative file information and implements the selected instruction semantics. | Native delegation within the recovery design.                | Define the instruction contract and file-information mechanism; use scripted transition fixtures and seek host support if needed. |
| Conversation corrections and host context edits are handled without promising invisible erasure.                  | Correction handling without blanket cancellation.            | Define context-edit and disable behavior; keep derived-record curation outside the MVP.                                           |
| Session lifetime is sufficient for the core's recall promise.                                                     | Session-entry persistence.                                   | Define ephemeral-session, deletion, fork, and unavailable-source results within Pi session retention.                             |
| Bounded source search makes omitted details practically discoverable.                                             | Source recall as the supplement to compressed observations.  | Retrieval fixtures followed by action-based evaluation with actual recall choices.                                                |
| The writer can maintain the chosen obligations within the finite budget often enough.                             | Complete snapshot with bounded repair and capacity fallback. | Repeated-compaction evaluation, including smaller writers and large sets of active obligations.                                   |
| A future companion can use the retained evidence without additional core metadata.                                | The sufficiency of the selected evidence requirements.       | Define the first consumer, test its evidence needs, and add a public contract then.                                               |
| Inspected host behavior remains applicable.                                                                       | All source-derived integration recommendations.              | Recheck the targeted Pi revision before implementation and exercise it through scripted providers.                                |

Public APIs can perform nested inference and resolve credentials, but do not expose one operation
cloning the native host's exact routing, headers, and stream wrapper. Pi stores custom summary text
and uses it as later summary input. This does not imply that every returned field or native file
metadata survives unchanged. The completed SPEC must state these integration limits explicitly.

## Evidence not produced by this research

No real models were called, no provider cache savings were measured, and no runtime implementation
of this package was tested. Narrow scripted probes establish specific Pi input/persistence
mechanics; they do not establish semantic quality or full SDK compatibility. The documentation
checks for this PR validate the artifacts, not the proposed memory behavior.
