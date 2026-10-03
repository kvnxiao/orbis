# Evidence and evaluation

Research date: 2026-10-03. Memory quality depends on construction, retrieval, and the acting model's
use of evidence. This document updates publication status and evaluation limits from the earlier
survey, then proposes an Orbis protocol. It reports no Orbis model-quality experiment.

## Read the evidence at the scope it establishes

A source inspection can establish which messages an implementation reads. A scripted provider can
establish cancellation and state transitions. A recall benchmark can test answers about history.
None alone proves that an agent continues a real repository task correctly after compaction.

The target outcome is effective continuation under the user's constraints. Token cost, latency, and
memory size are measured consequences. Equal token budgets are not the definition of qualitative
parity with native Pi.

## Retrieval, construction loss, and reader behavior

[LongMemEval](https://arxiv.org/html/2410.10813v2), published at ICLR 2025, separates extraction,
multi-session synthesis, time, updates, and abstention. Its experiments distinguish indexing,
retrieval, and reading. Original dialogue rounds outperform replacement with extracted facts
overall, although facts help some categories; enriched retrieval keys can improve discovery without
replacing the original material. The benchmark is conversational question answering, not repository
continuation. Reader capacity and retrieval depth affect results, so it does not establish a
universal recall budget.

[Reproducing LightMem](https://arxiv.org/html/2607.29104v1) is a July 2026 preprint. It evaluates
444 LongMemEval-S questions after excluding 56 assistant-memory cases, using one Qwen3-30B-A3B
generator. Strong retrieval over raw turns often matches or exceeds constructed memory. Its
raw-source oracle exceeds the constructed-memory oracle, while compact memory helps in some tight
answering budgets. This identifies construction loss separately from retrieval failure; it does not
show that observation is always unnecessary or predict another model's coding performance.

[LoCoMo](https://aclanthology.org/2024.acl-long.747/), ACL 2024, uses human-verified generated
conversation histories and includes question answering, event summarization, and multimodal tasks.
It is useful for temporal and cross-session diagnostics. Persona dialogue differs from a coding
history's failed attempts, pending edits, authorization, and verification obligations. Papers that
change its subsets or scoring do not form a directly comparable leaderboard.

## Evidence closer to coding and action

| Source and publication status                                                                                                            | Relevant result or mechanism                                                                                                                                                                                               | Transfer limit                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [The Complexity Trap](https://arxiv.org/html/2508.21433v3), NeurIPS 2025 Deep Learning for Code workshop                                 | On SWE-agent/SWE-bench Verified, masking older tool-output bodies competes with model summarization at lower cost in several configurations. The Qwen3-Coder 480B results are 53.4% raw, 54.8% masking, and 53.8% summary. | These results do not establish a masking accuracy improvement. OpenHands transfer required tuning and used 50 tasks. The study does not demonstrate preservation of every old user obligation or justify changing Pi's settings. |
| [The Compaction Cliff](https://arxiv.org/html/2608.22752v1), CIKM 2026 association in [arXiv metadata](https://arxiv.org/abs/2608.22752) | Repeated compression of agent configuration artifacts loses constraints; classified retention protects selected constraints/procedures and reports unsafe capacity.                                                        | Classification misses and insufficient budget remain failure conditions. The publisher DOI was inaccessible in this review; conference status is from author metadata. The experiment is not a Pi checkpoint study.              |
| [Agentic Context Management](https://arxiv.org/html/2607.23809v1), July 2026 preprint                                                    | Compaction and archived-span querying are combined with policy training and harness control. Maintenance tools alone do not reliably produce useful timing.                                                                | Improvements cannot be attributed solely to a recall tool. Reasoning failures can end a run before context pressure becomes relevant.                                                                                            |
| [Mem2ActBench](https://arxiv.org/html/2601.19935v1), January 2026 preprint                                                               | Tests memory-dependent arguments on 400 tool-use tasks built from generated histories. Main evaluation supplies the target tool.                                                                                           | Scoring generated arguments is not executing repository workflows or choosing the tool freely. Human validation finds imperfect conflict handling and dependence.                                                                |

These studies motivate diagnostic baselines and targeted failure cases. They do not establish that a
particular combination of observations, snapshot fields, or retention budgets is optimal for Orbis.

The [continuity analysis](continuity-and-invariants.md) separately examines coding-harness
engineering reports and the difference between answering a continuation question and taking the next
action.

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
| [ACE](https://openreview.net/pdf?id=eC4ygDs02R), ICLR 2026 conference paper; [arXiv v3](https://arxiv.org/abs/2510.04618)                                                                        | Generate, reflect, and curate an evolving playbook through incremental updates.   | An isolated compaction effect. The older preprint/workshop-only description is outdated.      |
| [SimpleMem](https://arxiv.org/abs/2601.02553), v3 January 2026 preprint                                                                                                                          | Structured compression, online synthesis, and intent-aware retrieval.             | Formal losslessness of exact identifiers, constraints, or tool outcomes.                      |

Publication status describes the artifact checked, not an endorsement of its claims. Where no venue
is listed, this table does not claim peer review. A paper's terminology must not turn a model prompt
into a deterministic guarantee.

## Proposed evaluation design

The following protocol is a research recommendation for the draft's evaluation work. It does not
select numerical acceptance thresholds, models, or a live-run budget.

### Separate three failure locations

1. **Construction:** compare relevant source facts with the prepared snapshot and observations.
   Record omissions, false statements, incorrect scope, and lost correction ordering.
2. **Retrieval:** issue declared queries or inspect actual recall calls. Record whether eligible
   evidence is discoverable, selected, attributed, and complete enough for the requested detail.
3. **Use:** give the acting model the selected context and observe the next action. Correct evidence
   followed by an incorrect edit is different from failing to retrieve the evidence.

Keep source unavailability distinct from a query returning no matches. A valid empty extraction is
different from a failed worker. These distinctions make the result useful for choosing the next
change rather than attributing every failure to memory size.

### Required baseline and diagnostic arms

| Arm                                                  | Purpose                                                                       | Control                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Native Pi, extension unloaded                        | Establish the host baseline.                                                  | Same initial repository, history, acting model, tools, and native settings. |
| Proposed core enabled from session start             | Measure end-to-end continuation with preparation and recall.                  | Separate session/storage state; count all auxiliary work.                   |
| Native Pi plus source recall, optional               | Isolate the benefit of historical access.                                     | Do not silently add the core snapshot to this arm.                          |
| Correct supplied continuation state, optional oracle | Identify remaining acting-model failures when necessary evidence is provided. | Label the oracle; do not report it as deployable treatment performance.     |
| Snapshot/observation diagnostic variants, optional   | Isolate a mechanism only after its semantics are defined.                     | Vary one policy at a time and declare the changed budget or exposure.       |

Manual compaction at matched milestones controls when evidence leaves recent context. Automatic runs
preserve the same native settings and treat different compaction counts as an outcome. They answer
different questions and should be reported separately.

### Histories that distinguish compliant behavior

Use finite histories with known task obligations and repository checks. Include cases where the
final request and checkout are identical but an earlier instruction requires a different action.
That makes dependence on historical context observable.

| History                                                       | Observable outcome                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Old active prohibition followed by unrelated work             | The agent respects the prohibition before the governed edit.                    |
| Later correction to a decision or preference                  | The current choice controls; old evidence remains historical.                   |
| Paused task revisited after several compactions               | The agent resumes the right obligation without claiming it was completed.       |
| Attempted edit or failed test followed by confident narration | Actual verification state survives; intent is not reported as success.          |
| Exact identifier omitted from observations                    | The agent discovers the original source and uses the correct value.             |
| Split turn, prior custom checkpoint, then native fallback     | Continuation has the needed context and preserves the host's prepared boundary. |
| Fork, tree navigation, and delayed observer result            | Abandoned state is not activated or committed as current.                       |
| Smaller writer or reader, and tight capacity                  | Attribute loss, retrieval, and reasoning failures separately.                   |

The category-level rubric in [continuity and invariants](continuity-and-invariants.md) supplies
checkpoint diagnostics. A good prose answer about next steps is supporting evidence; actual edits,
commands, and repository acceptance checks determine action outcomes.

### Reporting and controls

Declare fixture versions, source histories, compaction points, steering, writer and reader models,
serving configuration, scoring, repetitions, exclusions, and finite run limits before scoring. Vary
writer and reader independently before changing both together. Record local-model quantization when
it can affect results.

Report task correctness, partial completion, constraint violations, lost obligations, repeated work,
false completion, interventions, and whether recall repaired a failure. Count extraction, retry,
fallback, summarization, retrieval, failed work, and ordinary acting tokens. Report known cost,
elapsed time, and foreground waiting; label unavailable accounting rather than estimating it as
observed data.

Aggregate uncertainty across histories and runs. Several checkpoints within one history are
correlated observations, not independent trials. Include failed and inconclusive runs. Avoid
claiming superiority from one successful example, a larger compression ratio, or a vendor score.

## Mechanical checks and live evaluation

Scripted providers can verify source selection, persistence, cancellation, limits, retry routing,
and malformed output. They can also test deterministic file lists and refusal to accept a partial
checkpoint. They cannot establish that a real model extracts every relevant obligation.

Ordinary automated checks must remain model-free. Live evaluation needs a concrete, separately
authorized run plan with cost limits and supervision. This research performed no such runs, and it
does not turn the proposed protocol into evidence that the draft already meets native parity.
