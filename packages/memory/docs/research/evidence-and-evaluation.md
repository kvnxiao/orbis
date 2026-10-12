---
date: 2026-10-12
questions:
  - How should construction loss, retrieval failures, action quality, and full-task cost be evaluated?
observed-in: [Pi 1.1.0, current comparison sources checked 2026-10-11]
recheck-when: Pi changes its compaction or source-access contracts, or the compared mechanisms are reconsidered.
---

# Evidence and evaluation

Evaluate memory construction, retrieval, and subsequent action separately, then compare complete tasks with native Pi. Published question-answering results and scripted conformance checks do not establish semantic parity or lower cost for the proposed core.

Sources checked: 2026-10-11. Pi applicability checked against [Pi 1.1.0](pi-compaction.md).

Memory quality depends on construction, retrieval, and the acting model's use of evidence. Published results describe their stated systems and settings. The later protocol is a proposal for a possible Orbis study. This research did not run an Orbis model-quality experiment.

**Observed in the cited source revisions and documentation dates:** Descriptions of inspected implementations and published findings below use the baselines identified alongside their sources. Recommendations and proposed Orbis implications are reasoning, not measured package outcomes.

## Current paper revisions

The arXiv current-version metadata and the linked publisher records were checked on 2026-10-11. Links resolve to current paper pages; the table records the revision available at that check. Publication dates and experiment settings remain properties of each study, not evidence of present-day product behavior. The current OpenReview page for ACE could not be fetched; its latest arXiv revision was verified.

| Paper                                                                                                                                                 | Latest arXiv revision checked |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [ACM: Agentic Context Management for Long Horizon Tasks](https://arxiv.org/abs/2607.23809)                                                            | v1                            |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)                                                                                             | v1                            |
| [Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models](https://arxiv.org/abs/2510.04618)                                 | v3                            |
| [ExpeL: LLM Agents Are Experiential Learners](https://arxiv.org/abs/2308.10144)                                                                       | v3                            |
| [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)                                                        | v2                            |
| [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813)                                         | v2                            |
| [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)                                          | v1                            |
| [Mem2ActBench: A Benchmark for Evaluating Long-Term Memory Utilization in Task-Oriented Autonomous Agents](https://arxiv.org/abs/2601.19935)          | v1                            |
| [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)                                                                         | v2                            |
| [MemoryBank: Enhancing Large Language Models with Long-Term Memory](https://arxiv.org/abs/2305.10250)                                                 | v3                            |
| [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/abs/2401.18059)                                             | v1                            |
| [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)                                                     | v4                            |
| [Reproducing LightMem: Naive RAG Is Just as Good for Memory Management](https://arxiv.org/abs/2607.29104)                                             | v1                            |
| [SimpleMem: Efficient Lifelong Memory for LLM Agents](https://arxiv.org/abs/2601.02553)                                                               | v3                            |
| [The Compaction Cliff in Long-Running AI Agent Memory](https://arxiv.org/abs/2608.22752)                                                              | v1                            |
| [The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management](https://arxiv.org/abs/2508.21433) | v3                            |
| [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291)                                                  | v2                            |
| [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)                                                     | v1                            |

## Read the evidence at the scope it establishes

A source inspection can establish which messages an implementation reads. A scripted provider can establish cancellation and state transitions. A recall benchmark can test answers about history. None alone proves that an agent continues a real repository task correctly after compaction.

The target outcome is effective continuation under the user's constraints. Token cost, latency, and memory size are measured consequences. Equal token budgets are not the definition of qualitative parity with native Pi.

## Retrieval, construction loss, and reader behavior

[LongMemEval](https://arxiv.org/html/2410.10813), published at ICLR 2025, separates extraction, multi-session synthesis, time, updates, and abstention. Its experiments distinguish indexing, retrieval, and reading. Original dialogue rounds outperform replacement with extracted facts overall, although facts help some categories; enriched retrieval keys can improve discovery without replacing the original material. The benchmark is conversational question answering, not repository continuation. Reader capacity and retrieval depth affect results, so it does not establish a universal recall budget. Section 5.2 reports degradation for Llama 3.1 8B as retrieved context grows, while GPT-4o improves over the tested larger contexts. Appendix E.4 also shows an inferred time range excluding relevant evidence. These findings motivate reader-specific output bounds and filtering diagnostics, not fixed thresholds for coding continuation.

[Reproducing LightMem](https://arxiv.org/html/2607.29104) is a July 2026 preprint. It evaluates 444 LongMemEval-S questions after excluding 56 questions about assistant messages, which its user-turn-only memory construction excludes, using one Qwen3-30B-A3B generator. Strong retrieval over raw turns often matches or exceeds constructed memory. Its oracle conditions supply annotated answer-bearing raw turns or their corresponding constructed memories directly, bypassing retrieval. The raw-source condition exceeds the constructed-memory condition, while compact memory helps in some tight answering budgets. This identifies construction loss separately from retrieval failure; it does not show that observation is always unnecessary or predict another model's coding performance.

[LoCoMo](https://aclanthology.org/2024.acl-long.747/), ACL 2024, uses human-verified generated conversation histories and includes question answering, event summarization, and multimodal tasks. It is useful for temporal and cross-session diagnostics. Persona dialogue differs from a coding history's failed attempts, pending edits, authorization, and verification obligations. Papers that change its subsets or scoring do not form a directly comparable leaderboard.

## Evidence closer to coding and action

| Source and publication status                                                                                                          | Relevant result or mechanism                                                                                                                                                                                               | Transfer limit                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [The Complexity Trap](https://arxiv.org/html/2508.21433), NeurIPS 2025 Deep Learning for Code workshop                                 | On SWE-agent/SWE-bench Verified, masking older tool-output bodies competes with model summarization at lower cost in several configurations. The Qwen3-Coder 480B results are 53.4% raw, 54.8% masking, and 53.8% summary. | These results do not establish a masking accuracy improvement. OpenHands transfer required tuning and used 50 tasks. The study does not demonstrate preservation of every old user obligation or justify changing Pi's settings. |
| [The Compaction Cliff](https://arxiv.org/html/2608.22752), CIKM 2026 association in [arXiv metadata](https://arxiv.org/abs/2608.22752) | Repeated compression of agent configuration artifacts loses constraints; classified retention protects selected constraints/procedures and reports unsafe capacity.                                                        | Classification misses and insufficient budget remain failure conditions. The publisher DOI was inaccessible in this review; conference status is from author metadata. The experiment is not a Pi checkpoint study.              |
| [Agentic Context Management](https://arxiv.org/html/2607.23809), July 2026 preprint                                                    | Compaction and archived-span querying are combined with policy training and harness control. Maintenance tools alone do not reliably produce useful timing.                                                                | Improvements cannot be attributed solely to a recall tool. Reasoning failures can end a run before context pressure becomes relevant.                                                                                            |
| [Mem2ActBench](https://arxiv.org/html/2601.19935), January 2026 preprint                                                               | Tests memory-dependent arguments on 400 tool-use tasks built from generated histories. Main evaluation supplies the target tool.                                                                                           | Scoring generated arguments is not executing repository workflows or choosing the tool freely. Human validation finds imperfect conflict handling and dependence.                                                                |

These studies motivate diagnostic baselines and targeted failure cases. They do not establish that a particular combination of observations, snapshot fields, or retention budgets is optimal for Orbis.

The [continuity analysis](continuity-and-invariants.md) separately examines coding-harness engineering reports and the difference between answering a continuation question and taking the next action.

## Broader mechanisms and their limits

| Research                                                                                                                                                                                         | Relevant idea                                                                     | What should not be inferred                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [MemGPT](https://arxiv.org/abs/2310.08560), v2 February 2024                                                                                                                                     | Manage movement between a limited context and external memory.                    | Current Letta API behavior or a Pi continuation guarantee.                                    |
| [Generative Agents](https://arxiv.org/abs/2304.03442), v2 August 2023                                                                                                                            | Observation, reflection, and planning in social simulation.                       | That the coding MVP needs a reflector.                                                        |
| [ReadAgent](https://proceedings.mlr.press/v235/lee24c.html), ICML 2024; [RAPTOR](https://arxiv.org/abs/2401.18059)                                                                               | Compact representations retain paths to fuller source material.                   | That retained sources are automatically discoverable or correctly used.                       |
| [MemoryBank](https://arxiv.org/abs/2305.10250)                                                                                                                                                   | Reinforcement and forgetting based on time/significance in companion systems.     | That old active coding constraints should expire by age or access frequency.                  |
| [A-Mem](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html), NeurIPS 2025                                                      | Linked notes and evolving metadata.                                               | A need for graph-like organization before measuring simple recall failures.                   |
| [TiMem](https://aclanthology.org/2026.findings-acl.1091/), Findings of ACL 2026                                                                                                                  | Temporal consolidation into broader persona representations.                      | That persona and repository knowledge have the same admission policy.                         |
| [LightMem](https://proceedings.iclr.cc/paper_files/paper/2026/hash/a05b72653ec5b473732129829ae04195-Abstract-Conference.html), ICLR 2026                                                         | Filtering, grouping, and deferred consolidation.                                  | A benefit independent of retriever, reader, or construction loss.                             |
| [Mem0](https://arxiv.org/abs/2504.19413); [Zep/Graphiti](https://arxiv.org/abs/2501.13956)                                                                                                       | Fact extraction/revision and temporal relationships, with vendor evaluations.     | Current OSS behavior, causal benefit from a graph alone, or a comparable cross-paper ranking. |
| [Reflexion](https://arxiv.org/abs/2303.11366), [Voyager](https://arxiv.org/abs/2305.16291), [ExpeL](https://arxiv.org/abs/2308.10144), [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) | Feedback, reusable procedures, and experience-based insights across varied tasks. | That plausible generated lessons are verified knowledge or belong in core continuation.       |
| [ACE](https://openreview.net/pdf?id=eC4ygDs02R), ICLR 2026 conference paper; [arXiv v3](https://arxiv.org/abs/2510.04618)                                                                        | Generate, reflect, and curate an evolving playbook through incremental updates.   | An isolated compaction effect or evidence of Pi checkpoint parity.                            |
| [SimpleMem](https://arxiv.org/abs/2601.02553), v3 January 2026 preprint                                                                                                                          | Structured compression, online synthesis, and intent-aware retrieval.             | Formal losslessness of exact identifiers, constraints, or tool outcomes.                      |

Publication status describes the artifact checked, not an endorsement of its claims. Where no venue is listed, this table does not claim peer review. A paper's terminology must not turn a model prompt into a deterministic guarantee.

## Proposed evaluation design

Carry the [illustrative 2.6–4.9× observer/native input ratio](growth-and-cost.md#illustrative-scale-not-a-benchmark) into the cost analysis for mean snapshots of 8,000–20,000 tokens. Measure the actual ratio and complete task spending separately, including cache billing, rejected work, retries, catch-up, presentation, native fallback, and acting requests. The illustration is a hypothesis to test, not an acceptance threshold or evidence of equal quality.

Record false retirements separately from whether their evidence is inspectable, whether a user or agent detects them, and whether correction occurs before the next consequential action. Test automatic degradation emission in each supported host mode with scripted fixtures. Treat unknown virtual-route capacity and unsupported observer authorization as explicit availability outcomes, not successful custom-compaction samples. Native retention measurements remain pending until qualifying histories with repeated compactions exist.

The [SPEC scenarios](../../SPEC.md#conformance) define required conformance evidence. A scripted native-baseline harness early in implementation can compare host mechanics without making a live quality comparison a prototype gate. A later, separately authorized live study can measure semantic parity, subsequent actions, and total cost. This section proposes diagnostic controls for that study, not additional MVP requirements.

### Separate three failure locations

1. **Construction:** compare source facts with accepted snapshot and observations; record omissions, false claims, incorrect scope, and lost correction order.
2. **Retrieval:** determine whether eligible evidence was discoverable, selected, attributed, and complete enough. Separate no match, unavailable source, a missed query, and failure to invoke recall.
3. **Use:** observe the acting model's next action with the selected context. Correct evidence followed by an incorrect edit is different from missing evidence.

A valid empty observer result differs from a failed worker. Tests should distinguish a valid add/replace/remove operation from a malformed or partial response, and omission from explicit removal. Larger retrieval output and a different observer model are variables to measure, not assumed repairs. Recall cannot compensate for a hidden active obligation that the agent has no reason to search for.

### Baseline and diagnostic arms

For a live comparison, run two conditions: native Pi with the extension unloaded, and Pi with the core enabled from session start. Match initial repository, history, acting model, tools, and native settings; count auxiliary work in the core arm. Optional diagnostic arms can provide source recall alone, a correct supplied continuation state, native Pi plus an experimental mechanism for preserving active obligations (a separate study would define that mechanism), or full recorded context when it fits. Label supplied state as an oracle, not deployable performance. These arms diagnose loss; native Pi plus obligations is not a required shipping stage. Run manual compaction at matched milestones separately from automatic compaction, where compaction frequency itself is an outcome.

### Histories that distinguish compliant behavior

Use finite histories where earlier obligations change the correct action despite an identical final request and checkout. Include old prohibitions, later corrections, paused work, failed verification, omitted identifiers, split turns, native fallback after a custom checkpoint, forks, and delayed observer results. Record whether tested facts actually left recent context. Check repository actions and acceptance results; a plausible answer about next steps is only supporting evidence.

### Evidence identity and recovery fixtures

Pi's prepared cut is the boundary between summarized and retained history; checkpoint state uses only evidence before that boundary. Compaction instructions can expand model-generated checkpoint presentation. Code repairs omitted required items and protected strings from the accepted text, which can increase its size further.

Model-free fixtures should distinguish:

- A valid empty observation result from partial or failed output.
- An omitted identifier discoverable in original evidence without a generated ID.
- Identical error text from separate source events and a repeated accepted operation.
- Source time from later processing time, including unresolved relative dates.
- State at Pi's prepared cut from a spanning observer batch, including a later correction or completion that must not appear earlier.
- An oversized or interrupted input portion from accepted coverage, and a reduced tool result from a fully processed one.
- A context edit after acceptance that makes a source uncovered without rolling back later state.
- Edited permission claims from independently supported permission, including weaker constraints and removed action prerequisites; ordinary factual corrections from verified completion.
- Instruction-induced presentation expansion from direct rendering, including repair that makes the result exceed capacity and requires fallback.
- Complete inventory from partial or omitted supplements as request capacity changes, while critical paths remain in snapshot context and source operations remain before the checkpoint cut.
- Recognized direct and recorded nested file invocations from successful effects, shell operations, printed call-like text, and invalid paths.
- A native checkpoint accepted as derived evidence from original-source coverage.
- Effective browse, search, and read after a source edit; access to the edited-out original only with a current personal opt-in and explicit request.
- Disabled operation that stops observation, custom checkpoints, and file supplements while recall remains available under the same source policy.

Keep answer keys outside acting-agent files and tools. A derived checkpoint cannot count repeated summary prose as independent corroboration. The [focused source analysis](presentation-inventory-and-authority.md) explains the host behavior behind the presentation, inventory, and authority fixtures. These checks establish the specified mechanics; they do not establish that the chosen inventory ordering maximizes information retention.

### Reporting and controls

For live work, declare fixture versions, histories, compaction points, models, serving settings, scoring, repetitions, exclusions, and finite limits before scoring. Report task correctness, constraint violations, lost obligations, false completion, recall repair, interventions, cost, and foreground delay. Include failed and inconclusive runs. Checkpoints within one history are correlated, so aggregate uncertainty across histories and runs.

Count each inference once. Separate background preparation, catch-up, fallback, retrieval, and acting usage; mark unavailable accounting unknown. Local source reads have no independent model bill but their returned text can increase acting input. Report end-to-end wall time as well as component durations because background work can overlap.

**Observed in Pi 1.1.0 source:** Assistant responses and executed tool results can have `durationMs`. Assistant timing also covers direct inference calls. Deferred responses and unavailable timings remain unknown. Tool timing excludes hooks, and nested tool durations can overlap. These fields help attribute work; they do not replace a timer around the complete foreground operation or establish model cost. Scripted providers return `AssistantMessageEventStream`, available through `createAssistantMessageEventStream()`, to match the public stream contract. [Assistant timing](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/utils/event-stream.ts), [tool timing](https://github.com/earendil-works/pi/blob/v1.1.0/packages/agent/src/agent-loop.ts), [stream types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/types.ts).

### Cache-specific evaluation

Request fixtures can inspect adapter-bound messages, tool definitions, cache markers, and routing options without model calls. Check consecutive requests after unchanged state, background updates, recall, reload, and custom/native transitions. Compare block boundaries as well as text.

A separately authorized provider study should distinguish warm, expired, and unavailable cache; record native and extension warming separately; and account for observer work, checkpoint generation, first continuation, and later turns. Matching text does not establish a reusable cache entry. Report task cost and action quality alongside provider read/write counters. The [cache analysis](prompt-caching-and-compaction.md) explains the provider differences.

## Mechanical checks and live evaluation

Scripted providers can verify source selection, prepared-cut alignment, structured operations, persistence, cancellation, limits, retry routing, recall permissions, and malformed output without model charges. They cannot establish that a real model extracts every relevant obligation or that a provider serves cache hits. Live evaluation needs separate authorization, finite budgets, and supervision. This research did not perform live Orbis runs.
