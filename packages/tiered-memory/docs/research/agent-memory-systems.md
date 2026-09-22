# Agent memory systems and the tiered-memory MVP

Keep the selected architecture: a protected current-work note, source-linked observations, topic
consolidation, project learnings, and bounded read-only recall. Hindsight, Honcho, and Mem0 supply
useful extraction, retrieval, and correction mechanisms, but the inspected evidence does not justify
adding their service infrastructure or reasoning agents to this MVP. The useful changes are two
narrow contract clarifications and stronger cases within the existing verification work.

Research date: **2026-09-22**. This comparison uses official documentation and targeted source
inspection. No products were installed, benchmarks reproduced, or models called. Product behavior
below is documented or source-inspected, not runtime-verified. The [SPEC](../../SPEC.md) defines the
adopted clarifications; the comparisons and deferred mechanisms remain informative.

## Decision criteria and source boundaries

The primary outcome is effective continuation after repeated Pi compactions and user steering:
advance the intended work, preserve active constraints, apply corrections, and distinguish pending
work from completion. Retrieval accuracy supports this outcome but does not establish it. The
comparison therefore asks whether a mechanism improves that outcome without adding unnecessary
acting-agent work, auxiliary inference, or deployment requirements.

The MVP already excludes global personal memory, automatic cross-project transfer, structured task
tracking, and project-wide discovery of unknown prior sessions. It requires local operation with
configured local models, deterministic search without an embedding service, and Pi-owned compaction
triggers. These constraints govern which lessons transfer.

| System    | Inspected source                                                                                                            | Version boundary                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hindsight | [Commit `12f2d54`](https://github.com/vectorize-io/hindsight/commit/12f2d54f643baddacb98cd547c89b1a50c5c3dcc), September 22 | Current main at inspection. [v0.10.1](https://github.com/vectorize-io/hindsight/releases/tag/v0.10.1) was released September 21; main and website findings do not establish release parity.                                                  |
| Honcho    | [Commit `323f7e7`](https://github.com/plastic-labs/honcho/commit/323f7e79923ffef968669fe4069d8cebed3ec8c3), September 22    | Source and v3 API documentation. The community Pi plugin was documented but its implementation was not inspected.                                                                                                                            |
| Mem0      | [Commit `c7ee362`](https://github.com/mem0ai/mem0/commit/c7ee362aff94a369af70f13f2b4f853f6793ff4c), September 11            | Pinned manifests declare Python package version 2.0.20 and TypeScript package version 3.1.8. Current main declares Python package version 2.1.0; the pinned source is not current HEAD. Managed features are distinguished from open source. |
| Letta     | [Current SDK memory documentation](https://docs.letta.com/agent-sdk/memory)                                                 | Documentation-only comparison of MemFS, its Git-backed memory filesystem; older block/archive APIs have different semantics.                                                                                                                 |

Mem0's version declarations are in its pinned
[Python](https://github.com/mem0ai/mem0/blob/c7ee362aff94a369af70f13f2b4f853f6793ff4c/pyproject.toml)
and
[TypeScript](https://github.com/mem0ai/mem0/blob/c7ee362aff94a369af70f13f2b4f853f6793ff4c/mem0-ts/package.json)
manifests and its mutable
[current Python manifest](https://github.com/mem0ai/mem0/blob/main/pyproject.toml). Unpinned
documentation describes the product on the research date. Adoption counts were not used to rank
quality. The existing [observational-memory comparison](observational-memory-comparison.md) covers
Mastra and the Pi-specific alternatives; this report supplements that work.

## Comparison

| System    | Relevant mechanism                                                                                                                                              | Lesson for this package                                                                                                                      | Cost or scope that does not transfer                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hindsight | Extract facts, consolidate evidence into observations, retrieve through semantic, lexical, graph, and temporal paths, and synthesize answers through `reflect`. | Preserve evidence and chronology independently of summaries. Ensure an extraction miss does not prevent raw-source discovery.                | Database service, embeddings, reranking, graph traversal, and query-time synthesis add infrastructure and work beyond deterministic recall.       |
| Honcho    | Store messages by workspace, peer, and session; build peer representations; provide summaries, retrieval, and a Dialectic answering agent.                      | Distinguish recorded claims from inferences, scope from authorization, and queued work from committed usable memory.                         | Persistent peer profiles and reasoning across sessions serve a broader identity model than a selected Pi lineage and repository.                  |
| Mem0      | Current extraction adds facts; retrieval combines semantic matching with optional keyword/entity signals. Managed Dream adds reconciliation and synthesis.      | Separate source identity from text similarity, retain temporal context, and distinguish current from superseded knowledge.                   | Embeddings, entity retrieval, and managed reconciliation are not prerequisites for local continuation.                                            |
| Letta     | Keep `system/` memory routinely visible and other files discoverable through a file tree; support background consolidation.                                     | Routine context and retained detail can have different access policies. This supports the existing work-note/index split as a design option. | Agent-owned Git synchronization, system-prompt authority, and background subagents differ from Orbis's controlled writer and evidence-only notes. |

Sources: Hindsight [retrieval](https://hindsight.vectorize.io/developer/retrieval) and
[reflection](https://hindsight.vectorize.io/developer/reflect); Honcho
[architecture](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/docs/v3/documentation/core-concepts/architecture.mdx)
and [chat](https://honcho.dev/docs/v3/documentation/features/chat); Mem0
[migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3) and
[platform comparison](https://docs.mem0.ai/platform/platform-vs-oss); Letta
[memory](https://docs.letta.com/agent-sdk/memory).

### Hindsight: retained evidence must also be discoverable

Hindsight calls consolidated beliefs “observations”; these correspond more closely to Orbis's
consolidated notes than its initial session observations. The inspected consolidator validates
source membership, while its prompts distinguish updates from historical events. Valid source IDs do
not establish that a generated statement accurately represents its sources.
[Consolidator](https://github.com/vectorize-io/hindsight/blob/12f2d54f643baddacb98cd547c89b1a50c5c3dcc/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py),
[consolidation prompts](https://github.com/vectorize-io/hindsight/blob/12f2d54f643baddacb98cd547c89b1a50c5c3dcc/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py).

Its retention documentation names a useful failure boundary: a stored document that produces zero
facts is unavailable to `recall` and `reflect`; reprocessing is the documented recovery. For Orbis,
original-source search should remain available when the observer omits a command, error, or useful
detail. Otherwise source retention does not provide the intended recovery path.
[Zero-fact documents](https://hindsight.vectorize.io/developer/retain#when-a-mission-excludes-everything-in-a-document).

Hindsight distinguishes event time, statement time, and processing time. Orbis can preserve
available time context without adopting temporal search. Processing an old log today must not make
its claim more current than a later correction.
[Temporal prompt fields](https://github.com/vectorize-io/hindsight/blob/12f2d54f643baddacb98cd547c89b1a50c5c3dcc/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py#L59).

The coding integration derives its default bank name from the main worktree's directory basename and
shares that bank across linked worktrees. Inference from this routing: unrelated repositories with
the same basename can select the same default bank. Orbis's scope contract requires unrelated roots
to remain separate; a same-basename fixture would verify that requirement.
[Bank selection](https://github.com/vectorize-io/hindsight/blob/12f2d54f643baddacb98cd547c89b1a50c5c3dcc/hindsight-integrations/coding-agents/src/core/bank.ts#L176).

### Honcho: attribution, readiness, and deletion have separate meanings

Honcho's inspected extractor requests statements attributed to the target peer. Its output contains
explicit observations and initializes deductions empty, although broader reasoning documentation
describes additional reasoning categories. Neither the label “explicit” nor a reasoning category
proves a premise true. Orbis already requires distinctions among user assertions, actual actions,
observed results, and inferences.
[Extraction prompt](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/src/deriver/prompts.py),
[representation source](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/src/utils/representation.py),
[reasoning documentation](https://honcho.dev/docs/v3/documentation/core-concepts/reasoning).

Honcho explicitly warns against using an empty processing queue as a synchronization condition.
Orbis already requires committed coverage of the particular span compaction will discard, along with
bounded waiting and native fallback. Its coverage protocol should remain independent of queue length
or a successful submission response.
[Queue status](https://honcho.dev/docs/v3/documentation/features/advanced/queue-status).

Honcho's session-deletion documentation says cross-session derived conclusions can survive deleting
a contributing session. Scope removal has separate code to retract dependent conclusions. The
transferable lesson is to state what each deletion affects. Orbis requires deleting a note to remove
it from current indexes and prevent recreation from consumed evidence. Original transcripts and
retained historical snapshots remain accessible under the recall policy. This does not require a
dependency graph or secure erasure.
[Deletion contract](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/docs/v3/documentation/features/advanced/deleting-data.mdx),
[scope removal](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/src/deriver/scope_backfill.py).

Honcho's evidence response records sources read by its answering agent, not proof that the answer
relied on those sources correctly. Orbis's continuation contract requires evaluating the agent's
actions to establish whether it used the evidence correctly.
[Evidence semantics](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/docs/v3/documentation/features/advanced/evidence.mdx).

### Mem0: compare the current product, open source, and older research separately

The current migration guide describes add-only extraction rather than the older automatic
`ADD`/`UPDATE`/`DELETE`/`NONE` decision pipeline. Explicit mutation APIs still exist. External graph
store integration was removed from the open-source core; the managed platform has a different graph
and reconciliation feature set. The 2025 paper cannot stand in for the current implementation.
[Migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3),
[open-source and managed features](https://docs.mem0.ai/platform/platform-vs-oss).

The inspected Python extraction path supplies a bounded set of retrieved memories as deduplication
context and checks generated text hashes against that set and the current batch. This does not
establish global semantic deduplication or identify a retried source batch. Two attempts can produce
the same error text while remaining distinct events. Orbis already specifies source intervals and
retry idempotence; retain that distinction when testing consolidation.
[Extraction implementation](https://github.com/mem0ai/mem0/blob/c7ee362aff94a369af70f13f2b4f853f6793ff4c/mem0/memory/main.py).

Mem0's extraction prompt distinguishes conversation time from extraction time when resolving
relative dates. This constraint would apply when Orbis workers resume later. It does not require
adding time-range queries, date parsers, or temporal reranking to Orbis.
[Extraction prompt](https://github.com/mem0ai/mem0/blob/c7ee362aff94a369af70f13f2b4f853f6793ff4c/mem0/configs/prompts.py).

Managed Dream documents merging and supersession, with explicit retrieval options for older records.
It is unavailable in open source. Orbis already defines current indexes, unresolved conflicts,
historical recall, and preservation of human curation; a separate reconciliation service would
duplicate responsibilities without demonstrated benefit.
[Dream](https://docs.mem0.ai/platform/features/dream).

## What the SPEC already requires

| Lesson                                                        | Existing requirements                                                          | Recommendation                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Preserve source evidence and identify derived claims.         | `REQ-memory-storage`, `REQ-session-observations`, `REQ-source-recall`          | Keep source links and recorded excerpts. Do not add another proof or citation model.          |
| Protect operative work separately from historical detail.     | `REQ-current-work-note`, `REQ-topic-consolidation`                             | Keep the protected note and conditional recall; evaluate their benefit.                       |
| Commit usable state before claiming readiness.                | `REQ-checkpoint-eligibility`, `REQ-session-lineage`, `REQ-compaction-fallback` | Keep span coverage, revision checks, cancellation, and bounded native fallback.               |
| Correct current knowledge without silently rewriting history. | `REQ-project-learnings`, `REQ-user-curation`, `REQ-recall-guidance`            | Exercise corrections through every affected current representation.                           |
| Scope storage and lookup deliberately.                        | `REQ-memory-scopes`, `REQ-session-lineage`, `REQ-source-recall`                | Keep host-derived roots and lineage; test identical directory names in unrelated roots.       |
| Account for memory work separately from acting-agent work.    | `REQ-resource-budgets`, `REQ-status-reporting`, `REQ-session-continuity`       | Include extraction, consolidation, retries, fallback, and waiting in the existing comparison. |

## Contract clarifications

The SPEC includes these clarifications under existing requirement IDs. Neither adds a service, model
call, memory tier, or model-facing tool. The descriptions below summarize their purpose; the SPEC
defines their required behavior and conformance scenarios.

**1. Raw-source discoverability — `REQ-source-recall`.** Original recorded text remains searchable
when extraction misses the matching detail. Scope, effective-context, and curation exclusions still
apply.

Verify with an exact error or command present only in an original source. Supply a valid empty
extraction, then search without knowing the source reference. Repeat with a nonempty observation
that omits the identifier. The result must include the recorded excerpt and stable reference under
the ordinary bounds. Unrelated project roots remain excluded. Deleted or superseded note revisions
must not appear as current knowledge; explicit historical lookup may still expose retained original
evidence and revisions with their status.

**2. Source-time grounding — `REQ-session-observations` and `REQ-topic-consolidation`.** Delayed
processing preserves the evidence's available time context. Relative dates remain uncertain when the
source does not supply an unambiguous interpretation. Processing time alone does not establish
supersession.

Verify prompt inputs and preserved source metadata with fixtures. In the existing supervised quality
evaluation, process a statement about “yesterday” after a delay and encounter an older dated log
after a current setting has been confirmed. Score whether the resulting note and next action use the
correct evidence. Scripted output alone cannot establish semantic accuracy.

## Strengthen existing checks without expanding behavior

| Case                                                                                                                                                                                             | Expected outcome                                                                                                                          | Existing requirements                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Observed output supports a reusable test procedure recorded in an observation, topic, and project learning; later evidence establishes that the procedure reports success despite skipped tests. | Current notes and indexes stop presenting the procedure as verified. Historical recall distinguishes the earlier evidence and correction. | `REQ-session-observations`, `REQ-topic-consolidation`, `REQ-project-learnings`, `REQ-current-work-note` |
| Two distinct attempts produce identical errors; separately, one committed batch is retried.                                                                                                      | Preserve each attempt's provenance; do not append duplicate observations for the retry.                                                   | `REQ-session-observations`, `REQ-topic-consolidation`                                                   |
| Unrelated roots share a directory basename.                                                                                                                                                      | Neither root can discover the other's session records or learnings.                                                                       | `REQ-memory-scopes`, `REQ-source-recall`                                                                |
| Recall finds the wrong attempt, misses a paraphrase, or returns evidence the agent misuses.                                                                                                      | Report the retrieval or evidence-use failure in continuation results. Do not infer successful work from a returned match.                 | `REQ-source-recall`, `REQ-session-continuity`                                                           |

These cases fit the existing storage, observer, recall, consolidation, integration, and evaluation
work in [initiative #12](https://github.com/kvnxiao/orbis/issues/12). The issue bodies define the
implementation tasks and acceptance checks. The raw-search case is especially relevant to
[#22](https://github.com/kvnxiao/orbis/issues/22); semantic outcomes belong in
[#26](https://github.com/kvnxiao/orbis/issues/26).

## What to defer and when to reconsider

| Mechanism                                                               | MVP decision                                                 | Evidence that would justify reconsideration                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Embeddings, hybrid ranking, and rerankers                               | Keep deterministic local search.                             | Repeated paraphrase or alias misses materially prevent continuation after improving observation wording and lexical matching. |
| Entity graphs and temporal query engines                                | Keep source links, ordering, and applicability.              | Important tasks repeatedly require relationships or time queries that bounded source recall cannot recover economically.      |
| Reflection or Dialectic answering agent                                 | Let the acting agent reason over returned excerpts.          | Controlled runs show a separate recall-reasoning pass improves final actions enough to cover its latency and token cost.      |
| Global profiles, cross-project learning, automatic history ingestion    | Keep selected-lineage and repository scope.                  | The user adopts a broader product goal and its ownership, curation, and authorization rules.                                  |
| Decay, autonomous skill generation, additional memory maintenance tools | Keep current curation and automatic worker responsibilities. | Measured failures identify a specific missing behavior that existing bounded consolidation cannot address.                    |
| Third-party service backend or provider abstraction                     | Keep package-local persistence and Pi integration.           | A concrete deployment requirement and measured integration benefit justify maintaining an additional backend.                 |

Self-hosting does not make these systems equivalent to an in-process extension. Hindsight supports
embedded PostgreSQL as well as server deployment. Honcho's supplied stack includes API and worker
processes, PostgreSQL/pgvector, and Redis. Mem0's open-source defaults use model and embedding
providers; managed features have separate availability. Local deployment performance was not tested.
[Hindsight storage](https://hindsight.vectorize.io/developer/storage),
[Honcho deployment](https://github.com/plastic-labs/honcho/blob/323f7e79923ffef968669fe4069d8cebed3ec8c3/docker-compose.yml.example),
[Mem0 overview](https://docs.mem0.ai/open-source/overview).

Existing Pi integrations make the products relevant comparators but do not establish the required
compaction behavior. Hindsight's inspected adapter injects before agent start and retains after
agent end without registering a compaction handler there. Honcho documents a community integration;
Mem0 documents a managed integration with automatic capture, recall, and mutation tools. None of
these inspected artifacts establishes Orbis's complete protected-note, selected-lineage, and
checkpoint contract.
[Hindsight adapter](https://github.com/vectorize-io/hindsight/blob/12f2d54f643baddacb98cd547c89b1a50c5c3dcc/hindsight-integrations/coding-agents/src/harness/pi-extension.ts),
[Honcho Pi guide](https://honcho.dev/docs/v3/guides/community/pi-honcho-memory),
[Mem0 Pi guide](https://docs.mem0.ai/integrations/pi-agent).

## Evaluation limits

The classic [LongMemEval benchmark](https://github.com/xiaowu0162/LongMemEval) tests extraction,
updates, temporal reasoning, abstention, and reasoning over conversational histories. Its final
questions provide useful diagnostics; they do not execute repository work after Pi compaction.

Hindsight's [December 2025 arXiv preprint](https://arxiv.org/abs/2512.12818v1), Honcho's
[vendor benchmark report](https://plasticlabs.ai/blog/research/Benchmarking-Honcho), and Mem0's
[2025 arXiv paper](https://arxiv.org/abs/2504.19413) use different systems and evaluation
configurations. Honcho's report also changes LoCoMo's original token-F1 scoring to an LLM judge.
Mem0's [current README](https://github.com/mem0ai/mem0) explicitly attributes its headline results
to managed-platform optimizations and does not promise identical open-source results. These sources
do not supply a controlled ranking for Orbis's use case.

Keep the existing matched comparison against native Pi, including actual actions after old evidence
leaves recent context, complete task-cost accounting, failures, and uncertainty. Use retrieval
diagnostics to locate failures rather than adopting a vendor score as an MVP acceptance threshold.
The remaining uncertainty is empirical: whether the selected design improves continuation enough to
justify its extraction, storage, and prompt costs in the evaluated tasks and models.
