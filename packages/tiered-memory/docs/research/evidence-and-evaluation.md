# Evidence, model quality, and dogfooding

Memory quality depends on extraction, retrieval, and the acting model's use of evidence. Portable
storage and deterministic lifecycle rules can limit operational failures; they cannot make weak and
strong models preserve or interpret every fact equally well.

Research dates: 2026-09-12 and 2026-09-21. Results below come from primary papers or identified
vendor evaluations. They have not been reproduced for Orbis. Recent preprints retain that status,
and reported hardware does not establish consumer-GPU performance.

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
- [Mem2ActBench](https://arxiv.org/html/2601.19935v1), a January 2026 preprint, tests
  memory-conditioned tool-call generation. Its main setup supplies the target tool; offline argument
  generation does not establish successful repository execution.
- [SWE-bench](https://www.swebench.com/) and controlled repository continuation fixtures test code
  outcomes. Exact-state, deletion, concurrency, and lifecycle cases need separate fixtures.

The required comparison is native Pi with the extension unloaded versus the selected design enabled
from the start of the session. Observations/topics alone can isolate the protected note's effect;
native Pi plus recall can isolate retrieval value. These are optional diagnostic variants, not
required production modes. Masking and structured task state remain separate experiments.

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

### Paired runs and meaningful compaction

Pair runs by initial repository state, task, historical instructions, steering schedule, acting
model, native compaction settings, tools, and environment. Keep session and memory stores isolated
between arms and repetitions. The extension starts with the same declared prior knowledge and pays
for constructing its notes. Prepared historical fixtures must replay observer work and count that
cost; an ideal note supplied for free is an oracle diagnostic, not the treatment. Record exact Pi,
extension, provider, model, serving, and quantization versions where available.

Compare manual and automatic compaction separately. For manual compaction, disable automatic
compaction in both configurations and compact at matched task milestones. For automatic compaction,
use the same native settings and work horizon while allowing each configuration's compaction count
and timing to differ. Record the discarded and retained source boundaries so a nominal compaction
that retained every relevant fact is visible. Do not force equal automatic compaction counts: the
count is an outcome.

Fixtures should require historical information that the final prompt and current checkout do not
already reveal. Variants with the same final prompt and checkout but different earlier instructions
can test this dependence. Exercise old active prohibitions, superseding corrections, paused work,
exact errors in long outputs, failed approaches, and verification state. Keep grader expectations
outside the acting agent's files and score requirements actually given to the agent. Use repository
checks and action traces; a model's proposed next step alone is not completed work.
[Agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

### Outcomes and accounting

| Axis                    | Report                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final correctness       | Required repository checks and task obligations satisfied; report partial completion separately and list critical constraint violations.                                                         |
| Continuity              | Omitted obligations, revived superseded instructions, false completion, first required repair, and whether recall recovered useful progress.                                                     |
| Total tokens and cost   | Acting, observer, consolidator, native-summary, fallback, retry, and repair usage, including failed runs and startup work; separate input, output, cache reads, and cache writes where reported. |
| Compactions             | Attempts and outcomes by manual, threshold, or overflow origin; distinguish native summaries, custom replacements, fallback, failures, and cancellation without counting one attempt twice.      |
| Time                    | End-to-end elapsed time, foreground waiting, and component durations; overlapping background work is not added again to wall time.                                                               |
| Rework and intervention | Repeated failed approaches, redundant reads or edits, repairs, additional turns, and user prompts needed to restore direction.                                                                   |

Attribute recalled text to the acting request that consumes it; a local read is not an additional
model bill. Reconcile host usage with auxiliary worker usage so persisted summaries or tool usage
are not counted twice. For seeded sessions, report the measured interval and subtract inherited
usage already outside it. Record known monetary cost with pricing assumptions; mark unavailable
usage or price as unknown, never zero. For local serving, token counts and elapsed time remain
useful even without a per-token price. Pi's host session statistics alone do not include every
independent worker call.
[Pi usage accounting](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

Show paired task results, failures, timeouts, and cancellations alongside aggregates. Report cost
and time across all attempts as well as successful ones. A cost-per-verified-success statistic uses
all attempt cost and is undefined when no run succeeds. Vary writer and reader separately before
attributing a combined change to either one. Randomize paired run order where practical and avoid
concurrent runs contending for the same local model server.

### Iteration and interpretation

Before scoring a run set, record fixture versions, score definitions, run limits, repetition counts,
stopping rules, and excluded-run policy. Sample size and resource budgets belong to the experiment
protocol. A pilot estimates variability and expense; it does not supply a universal completion
threshold. Tune on exploratory runs and disclose reused fixtures; reserve independent validation
when making broader improvement claims.

Report paired differences and variation across independent histories and repetitions. Checkpoints
within one history are correlated. For binary final success, count extension-only wins, native-only
wins, and ties; the paired rate difference divides wins minus losses by all pairs, including ties.
Any interval or test must respect that pairing and the repeated-history structure.
[Paired binary comparison](https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/mcnemar.htm).

The experimental deliverable is reproducible comparison data and an interpretation of the observed
trade-offs. Negative, mixed, or inconclusive results can direct the next change. Mechanical defects
still require correction, but the package has no fixed success-rate, savings, latency, or
superiority gate for MVP completeness. Improved usefulness is a hypothesis to evaluate over
successive versions.

Ordinary automated checks use local fixtures and scripted providers without network model calls.
Live-model dogfooding runs separately under explicit supervision. No numerical quality target,
consumer-GPU guarantee, or claim of indefinitely lossless memory is established by the available
evidence.
