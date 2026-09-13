# Evidence, model quality, and dogfooding

Memory quality depends on extraction, retrieval, and the acting model's use of evidence. Portable
storage and deterministic lifecycle rules can limit operational failures; they cannot make weak and
strong models preserve or interpret every fact equally well.

Research date: 2026-09-12. Results below come from primary papers or identified vendor evaluations.
They have not been reproduced for Orbis. Recent preprints retain that status, and reported hardware
does not establish consumer-GPU performance.

## Coding-task context reduction

_The Complexity Trap_ studies SWE-agent on 500 SWE-bench Verified tasks. Its Qwen3-Coder 480B
configuration reports:

| Policy                        | Solve rate | Mean task cost |
| ----------------------------- | ---------: | -------------: |
| Raw history                   |      53.4% |          $1.29 |
| Mask older tool-result bodies |      54.8% |          $0.61 |
| LLM summarization             |      53.8% |          $0.64 |

The masking-versus-raw solve-rate interval spans −1.6 to +4.4 percentage points and does not
establish an accuracy improvement. The study supports testing cost savings. Transfer to OpenHands
needed window tuning and used a smaller probe. Its reported 32B and 480B deployments used H200
accelerators; they do not demonstrate consumer-GPU usability. This is a NeurIPS 2025 Deep Learning
for Code workshop paper, not a Pi evaluation.
[Paper, sections 3–5 and appendix C](https://arxiv.org/html/2508.21433v3).

Masking avoids a summary-model call for the masked content but retains growing action text and can
cause repeated tool reads. It remains a useful comparison with native compaction and observation
checkpoints; it does not need to become an additional required MVP subsystem.

## Extraction, retrieval, and reader quality

[LongMemEval](https://arxiv.org/html/2410.10813v2), published at ICLR 2025, tests extraction,
cross-session synthesis, temporal reasoning, updates, and abstention. Its experiments favor access
to original turns and fact-enriched retrieval keys over replacing source sessions with summaries or
extracted facts alone. Extracted facts sometimes help multi-session questions, but the result does
not justify discarding original evidence.

Reader behavior changes the useful recall budget. In the paper's experiments, Llama 3.1 8B degrades
as retrieved context grows beyond roughly 3,000 tokens, while GPT-4o improves beyond 20,000 tokens.
Smaller-model temporal filters can exclude the correct evidence. Correct retrieval still sometimes
produces an incorrect answer. These are model- and task-specific findings, not default token limits
for every model. [Sections 5.2–5.4 and appendices E.4–E.5](https://arxiv.org/html/2410.10813v2).

[LightMem](https://proceedings.iclr.cc/paper_files/paper/2026/hash/a05b72653ec5b473732129829ae04195-Abstract-Conference.html),
published at ICLR 2026, separates input filtering, topic grouping, and deferred consolidation. An
[independent reproduction](https://arxiv.org/html/2607.29104v1), a July 2026 preprint, uses a
Qwen3-30B-A3B reader on a 444-question LongMemEval-S subset. Changing the retriever over a fixed
constructed store changes accuracy from 58.1% to 75.5%. Its oracle raw-turn result exceeds its
constructed-memory result, and constructed memory is more useful under some tight context budgets.
Memory-construction cost and information omitted during construction remain material.

[Mastra's observational-memory evaluation](https://mastra.ai/research/observational-memory) reports
substantially different LongMemEval scores across model configurations. It motivates measurement of
both the memory writer and the reader. The published comparison does not isolate every writer change
from every reader change, and conversational QA does not establish coding continuation quality.

The design implication is recoverability: retain original sources, use bounded excerpts, distinguish
search failure from absent evidence, and permit independent memory-model selection. A stronger
future model can re-extract selected source spans; changing a model should not automatically replay
an entire archive or incur an unbounded new bill.

## Repeated compaction and agent initiative

_The Compaction Cliff_, an August 2026 preprint, reports 53% rule retention after one compaction and
10% after five for a tested Sonnet 4.6 configuration under repeated 50%-budget compression. The
result concerns its tested protocol. Typed retention remains conditional on extracting the relevant
rule and allocating enough budget to retain it. Deterministic rendering cannot restore a rule that
was never recorded. [Paper](https://arxiv.org/html/2608.22752v1).

_ACM_, a July 2026 preprint, examines agent-accessible context operations and archived spans.
Frontier models in its experiments do not reliably invoke proactive context tools without harness
control; a tested 4B model also fails through reasoning limits before context exhaustion. Adding
tools alone does not ensure useful maintenance or competent continuation.
[Paper](https://arxiv.org/html/2607.23809v1).

Automatic observation scheduling addresses the maintenance-invocation problem. Conditional recall
still depends on the acting model recognizing a gap. The initial prompt should name concrete recall
triggers: an absent earlier decision, an exact historical detail needed for the next action, a
conflict in notes, or a relevant project topic in the index. A required lookup after every turn or
compaction would add ceremony without evidence that the extra calls pay for themselves.

## Broader research map

These mechanisms informed the comparison. Their distinct workloads, training procedures, judges, and
budgets prevent a combined leaderboard or a claim that a particular tier count wins.

| Research                                                                                                                                                                                                                                                                     | Contribution                                                             | Limit for a Pi extension                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [CoALA](https://arxiv.org/abs/2309.02427), TMLR 2024; [MemGPT](https://arxiv.org/abs/2310.08560); [Generative Agents](https://arxiv.org/abs/2304.03442)                                                                                                                      | Separate working context, experience, knowledge, procedures, and recall  | Taxonomy and social simulation do not establish coding-task retention policy.                                 |
| [ReadAgent](https://proceedings.mlr.press/v235/lee24c.html), ICML 2024; [RAPTOR](https://arxiv.org/abs/2401.18059), ICLR 2024                                                                                                                                                | Compact representations retain access to source passages                 | Lookup selection and the reader can fail even when the source remains available.                              |
| [MemoryBank](https://arxiv.org/abs/2305.10250); [A-Mem](https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html), NeurIPS 2025; [TiMem](https://aclanthology.org/2026.findings-acl.1091/), Findings of ACL 2026 | Decay, linked notes, temporal organization, and evolving abstractions    | Age is not a sufficient reason to drop a live coding constraint; persona tasks need different validity rules. |
| [Mem0](https://arxiv.org/html/2504.19413v1); [Zep/Graphiti](https://arxiv.org/html/2501.13956v1)                                                                                                                                                                             | Fact extraction, revision, and temporal validity                         | Vendor comparisons use different protocols. A graph is not isolated as the cause of improvement.              |
| [Reflexion](https://arxiv.org/abs/2303.11366); [Voyager](https://arxiv.org/abs/2305.16291); [ExpeL](https://arxiv.org/abs/2308.10144); [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)                                                                             | Feedback, reusable skills, and successful procedures support later tasks | A generated reflection needs execution evidence before it becomes a reliable procedure.                       |
| [Agentic Context Engineering](https://arxiv.org/abs/2510.04618), 2025 preprint and ICLR 2026 workshop paper                                                                                                                                                                  | Incremental playbook updates reduce repeated whole-document rewriting    | Adaptation and feedback are additional mechanisms, not isolated compaction benefits.                          |
| [SimpleMem](https://arxiv.org/abs/2601.02553v3), January 2026 preprint                                                                                                                                                                                                       | Compact facts, synthesis, and retrieval planning                         | A claim of semantic preservation does not guarantee exact commands or constraints survive.                    |
| [Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564), survey preprint                                                                                                                                                                                          | Catalogues memory forms, functions, and update dynamics                  | A survey identifies candidates; it does not experimentally validate a combined architecture.                  |

Full context remains an essential baseline when the history fits. Mem0's LoCoMo comparison and Zep's
LongMemEval comparison do not establish that full context always wins or always loses. Model,
dataset subset, judge, retrieval budget, and construction costs must accompany a score.
[Mem0 evaluation](https://arxiv.org/html/2504.19413v1),
[Zep evaluation](https://arxiv.org/html/2501.13956v1).

## Evaluation design

The primary outcome is correct continuation of repository work after compaction and steering. A
remembered sentence is useful only if the agent applies it before the action it constrains.
Conversational benchmarks remain supporting diagnostics:

- [LoCoMo](https://aclanthology.org/2024.acl-long.747/) exercises conversational and temporal
  recall; its small set of independent conversations and protocol variants limit generalization.
- [LongMemEval](https://arxiv.org/html/2410.10813v2) adds updates, abstention, and cross-session
  synthesis; explicit memory questions differ from implicit coding decisions.
- [Mem2ActBench](https://arxiv.org/abs/2601.19935), a January 2026 preprint, tests memory use in
  tool actions; synthetic tools do not establish repository correctness.
- [SWE-bench](https://www.swebench.com/) and controlled repository continuation fixtures test code
  outcomes. Exact-state, deletion, concurrency, and lifecycle cases need separate fixtures.

Compare the selected observations/topics design with its protected current-work note against native
Pi and observations/topics alone. A native-Pi-plus-recall variant isolates retrieval value. Compare
observation masking separately when cost measurements justify it. Hold other settings constant when
measuring the protected note's effect. Structured task state is a separate proposal, not the
required next stage.

| Scenario                                                        | Evidence to inspect                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Many compactions and steering rounds                            | The latest objective, old still-active prohibitions, superseded decisions, and paused work guide the next action correctly. |
| Long output with a needed error near the end                    | Recall returns the recorded error and identifies any source truncation.                                                     |
| Return to an old failed approach                                | The agent recalls the attempt and its result before repeating it.                                                           |
| New session in the same project                                 | Relevant learnings transfer; session-private details and unrelated project notes do not.                                    |
| Branch, fork, resume, and Git/worktree change                   | Memory scope and applicability remain explicit; abandoned proposals do not become current instructions.                     |
| Worker failure, timeout, malformed output, and missing coverage | Native fallback occurs when needed, with an explicit report and preserved source records.                                   |
| Cancelled compaction or late worker completion                  | Cancellation remains cancellation; stale work does not commit to the new state.                                             |
| User edits or deletes a note during consolidation               | The change survives; old source observations do not silently recreate the deleted note.                                     |
| Cheap local writer or reader                                    | Measure omissions, irrelevant retrieval, incorrect evidence use, resource pressure, and total latency independently.        |

When comparing memory policies, hold the acting model, repository revision, tools, task budget, and
environment fixed. Vary writer and reader separately before comparing combined configurations. Score
repository acceptance checks and actions taken during continuation, including violations that a
later repair might conceal.

Count acting, observer, consolidator, fallback, retrieval, retry, and cached-token usage. Include
any embedding or additional classifier cost in experimental variants. Report total task time and
foreground pauses separately. Correlated checkpoints from the same task are not independent trials;
report variation across tasks and repeated runs.

Ordinary automated checks use local fixtures and scripted providers without network model calls.
Live-model dogfooding runs separately under explicit supervision. No numerical quality target,
consumer-GPU guarantee, or claim of indefinitely lossless memory is established by the available
evidence.
