---
date: 2026-10-12
questions:
  - What evidence supports model-proposed memory additions, replacements, and removals against stable identities?
  - Does complete active-state input establish reliable review, and what happens as memory grows?
  - Does current Mem0 add-only extraction justify changing a single-observer continuation design?
observed-in:
  - Mem0 current OSS source and official algorithm documentation retrieved 2026-10-11
  - LangMem current source and API documentation retrieved 2026-10-11
  - Letta current memory documentation retrieved 2026-10-11
  - Mastra current source and documentation retrieved 2026-10-11
  - LongMemEval ICLR 2025 paper and July 2026 LightMem reproduction preprint
recheck-when: A compared system changes its write policy, operation-level evaluations become available, or full-state observation exceeds practical input or cost limits.
---

# Structured memory updates and their semantic limits

Retain one observer that proposes explicit additions, replacements, and removals, with code validating and accepting the complete response as one logical operation. This is a defensible control over state transitions, not established semantic reliability. Complete active-state input prevents retrieval from excluding an existing item before review; it does not prove that the model correctly considers every item. Current systems demonstrate workable structured editing and alternative retention policies, while published evidence documents construction loss and destructive-update concerns. The evidence does not establish that adding a reflector or replacing current-state maintenance with append-only facts improves coding continuation.

## Decision and scope

A continuation snapshot records the obligations and maintained context that apply to the next action. Stable identities let an operation address a particular stored item without requiring another model to interpret editing instructions. An append-only historical store instead preserves multiple claims and resolves their applicability during reading. These serve different purposes. The decision is whether to retain explicit current-state maintenance, simplify it to accumulating facts, or introduce additional model roles.

This review inspected primary documentation, public source, and research papers. Source findings are not runtime verification. Current default-branch links are identified by retrieval date; installed distributions were not tested. No live-model calls or benchmark reproductions were performed.

## Mem0 changed automatic reconciliation, not every mutation API

**Observed in Mem0 documentation retrieved 2026-10-11:** The OSS migration guide describes single-pass ADD-only extraction and says `add()` now returns ADD events rather than inferred UPDATE and DELETE events. Changed facts accumulate alongside earlier facts. Its algorithm-generation terminology differs from package version numbering. The guide also reports performance improvements while changing retrieval and other features, so these are not an isolated comparison of write policies. [OSS migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3).

**Observed in Mem0 Python default-branch source retrieved 2026-10-11:** The inferred vector-memory path retrieves ten nearby memories plus ten recent messages, then requests one JSON extraction response. It does not review the entire store. `infer=False` bypasses extraction and stores non-system messages. Explicit `update(memory_id, ...)` and `delete(memory_id)` remain. Provider errors raise `LLMError`; parse failures can log and return empty results while saving messages. Individual insertion fallback can return a successfully inserted subset; history writes are separate and can fail after vector insertion. This path is not an atomic acceptance model for snapshot, observations, and source coverage. A separate procedural-memory branch also exists, so ADD-only describes the ordinary inferred fact path. [Current implementation](https://raw.githubusercontent.com/mem0ai/mem0/main/mem0/memory/main.py).

Mem0 supplies direct public motivation. Its April 16 algorithm article, updated September 28, says the previous reconciliation stage sometimes overwrote useful details or deleted information useful later; it also identifies latency as a reason for one-pass extraction. These are author-reported failure observations without an operation-level error distribution or isolated write-policy ablation. The article explicitly states that its reported benchmark scores describe the managed platform with proprietary optimizations. [Algorithm article](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm).

**Observed in current official Mem0 guidance:** The vendor distinguishes recency ranking from deciding which contradictory claim applies. Its staleness guide states that soft ranking does not reliably resolve an old, highly relevant but incorrect fact and recommends explicit timestamp-aware resolution in the application. This qualifies the migration guide's broad statement that retrieval surfaces current information. It does not establish an equivalent temporal feature in OSS. [Staleness guidance](https://mem0.ai/library/context-engineering/memory-decay-for-long-running-agents-how-recency-aware-ranking-fixes-retrieval-staleness).

Preserving historical evidence permits later audit and correction, but does not protect the next checkpoint from false retirement. Once an obligation leaves active state, the acting model may have no reason to search for it. Mem0's reported destructive-reconciliation failures therefore remain relevant to Orbis even when its underlying session evidence survives. Read-only snapshot inspection and visible retirement evidence can expose the change to a reviewer; they do not establish its correctness or replace a missing obligation automatically.

## Comparable editing systems

| System and observed surface                                  | Mutation and input policy                                                                                        | What the evidence establishes                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| LangMem current API and source                               | Structured insert/update/delete; deletions disabled by default in the manager; caller supplies existing memories | A direct implementation precedent for stable identities and omission preserving state; no measured semantic guarantee                |
| Letta current legacy SDK documentation                       | Self-editing memory blocks with identities, labels, configurable size, and optional read-only status             | Persistent, bounded writable context and a deterministic restriction on mutation; not correctness of an allowed edit                 |
| Letta current MemFS documentation                            | Git-versioned memory files, root files in the prompt, deeper files read on demand                                | Version history and selective loading; no full-active-obligation review guarantee                                                    |
| Mastra current observational memory documentation and source | Observation accumulation followed by model rewriting of the observation log or buffered prefix                   | A different capacity policy with another lossy model stage; no isolated demonstration that a reflector improves obligation retention |
| Mem0 current ordinary OSS extraction                         | Add-only facts, nearby-memory retrieval, explicit mutation APIs retained                                         | Preservation of earlier extracted records during addition; applicability must still be resolved                                      |

**Observed in LangMem documentation retrieved 2026-10-11:** `create_memory_manager` enables inserts and updates by default and disables deletes. Callers may select insertion-only behavior. The separate management tool supports create, update, and delete using an ID and resulting content. These are supplied APIs; their examples are demonstrations, not quality evaluations. [Manager API](https://langchain-ai.github.io/langmem/reference/memory/), [management tool API](https://langchain-ai.github.io/langmem/reference/tools/).

**Observed in LangMem default-branch source retrieved 2026-10-11:** The manager passes the complete caller-provided existing set to its extractor, defaults to one extraction step, and retains existing items omitted from generated changes. Its store manager first selects a limited search result set, maps stable identities, and later issues individual puts and deletes through concurrent calls. That layer does not wrap them in one transaction. Optional query generation, further steps, and maintenance phases can add calls. Full supplied input is therefore distinct from reviewing the whole persistent store. [Extraction and persistence source](https://raw.githubusercontent.com/langchain-ai/langmem/main/src/langmem/knowledge/extraction.py).

**Observed in Letta documentation retrieved 2026-10-11:** The legacy SDK describes editable blocks whose values enter the agent context, stable block IDs, configurable limits, and read-only blocks that agents cannot update. Current MemFS documentation describes a different file representation: root Markdown files enter the prompt, indexed deeper content loads on demand, and edits are committed to Git. These are separate product surfaces. Their availability does not demonstrate that a model chooses correct edits or that a successful commit preserves every active instruction. [Legacy memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks), [current MemFS](https://docs.letta.com/concepts/memfs).

**Observed in Mastra documentation and source retrieved 2026-10-11:** Reflection rewrites earlier observations, including previous reflections. The reflector checks empty or degenerate output and compression size, can retry with stronger compression, and suppresses some repeated unproductive attempts. Those checks establish output and capacity handling rather than preservation of meaning. The public launch evaluation reports question-answering scores for complete configurations; it does not isolate the causal benefit of a separate reflector or measure mistaken obligation retirement. [Observational memory documentation](https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/memory/observational-memory.mdx), [reflector implementation](https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/reflector-runner.ts), [launch evaluation](https://mastra.ai/blog/observational-memory).

## Measurements that challenge semantic guarantees

**Observed in LongMemEval, published at ICLR 2025:** The authors report that replacing dialogue rounds with summaries or facts harms overall question-answering performance, although fact decomposition helps multi-session reasoning. In a separate 97-question shortened-history test of then-current consumer assistants, they identify overwritten information and unrecorded indirect facts as failure patterns. Even perfect retrieval does not ensure correct use. This establishes plausible construction and reading failures; it neither measures current products nor estimates an error rate for an atomic stable-ID update protocol. [LongMemEval paper](https://arxiv.org/html/2410.10813).

**Observed in Reproducing LightMem, July 2026 preprint:** On 444 LongMemEval-S questions, excluding 56 assistant-message questions, the authors use one Qwen3-30B-A3B generator. Giving annotated raw evidence directly produces 89.0% accuracy versus 77.7% for corresponding constructed memories. This helps separate construction loss from retrieval failure; the memory-oracle condition supplies constructed memories associated with annotated evidence directly, bypassing retrieval. It is not a strict upper bound because that mapping can omit useful context. Construction costs and tight answering budgets introduce tradeoffs. These are conversational QA results for LightMem, not measured failure rates for individual add/replace/remove operations or coding continuation. [Reproduction paper](https://arxiv.org/html/2607.29104).

The studies cannot be combined with vendor leaderboards into a ranking: models, subsets, retrieval budgets, scoring, and products differ. Their common implication is narrower: valid, compact, retrievable memory can still omit relevant meaning.

## What complete-state review and atomic acceptance can promise

The following are engineering inferences from the specified transition design, not measured model outcomes:

- Complete active-state input makes every retained item available to the observer. It cannot establish attention to each item, accurate conflict resolution, or correct inference of cancellation and completion.
- Stable identities and basis validation prevent updates to absent or stale targets. They do not prevent selection of the wrong valid target or an unsupported change that has valid-shaped citations.
- Omission preserving state prevents silent retirement through a missing output item. It does not prevent an explicit but mistaken retirement or a mistaken no-change result.
- One validated logical operation prevents partial acceptance of snapshot edits, observations, and processing coverage. It does not establish disk durability or semantic completeness.
- Retained source evidence permits later inspection and correction. It does not guarantee that the acting model recognizes a missing obligation and retrieves the evidence.

A precise semantic-limit statement is: “The observer receives the complete accepted snapshot and is instructed to consider every active obligation. Validation establishes operation structure, target membership, source identity, and state-basis consistency; it does not establish that the model identified all relevant information or correctly interpreted a proposed change. Accepted coverage records processed source, not exhaustive semantic preservation.”

This wording preserves an enforceable input requirement without claiming that code can certify internal model review. Requirement-level intent may still require evidence-linked retirement, but valid references alone cannot certify entailment or authorization.

## Memory growth, caching, and error costs

With job count J and snapshot size S_j at job j, complete-state observation supplies approximately the sum of S_j snapshot tokens, plus evidence, instructions, and protocol overhead. This is an accounting derivation, not a measured bill. If snapshots grow linearly and observation frequency stays fixed, cumulative snapshot input grows quadratically with J. Delta output reduces emitted update text; it does not remove repeated snapshot input. A shrinking checkpoint presentation does not shrink the observer's canonical snapshot.

**Observed in Claude prompt-caching documentation retrieved 2026-10-11:** Caching reuses exact prompt prefixes, including tools, system text, and messages up to a usable cache boundary. Lifetimes and minimum sizes constrain reuse. Changes before a boundary can invalidate the following prefix, and caching does not reduce output generation. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Consequently, stable item identities alone do not make changing snapshots cacheable. Stable ordering and placing invariant instructions first can preserve some prefix reuse, but edits near the beginning of snapshot text reduce reuse of later text. Different observer and actor prompts do not automatically share the same cached prefix. Cache counters and complete request layouts must be measured. Cached input still occupies context capacity.

Invalid or partial responses can consume input and output tokens while producing no accepted state. A retry repeats work. Catch-up, observer processing of evidence not yet represented at the compaction boundary, adds inference before compaction. A second reviewer or reflector adds another call and may add its own retries; the sources do not establish that this cost purchases a reduction in semantic errors for the target task. Record rejected outputs, valid empty results, applied operations, and uncertain persistence separately. Otherwise, a low accepted-update count can conceal failed paid work.

If the full snapshot exceeds the observer budget, suspension with a capacity report is an explicit availability limit. Silent truncation or unmeasured model pruning would weaken complete-state input. A larger permitted input budget, model change, or separately designed partition policy is a distinct decision. Ordinary evidence-supported removal can manage growth while the state fits, but its semantic success is unproven.

## Recommendation and evidence gaps

Retain the single observer, stable identities, explicit resulting content, omission-preserves-state rule, complete snapshot input, and logical all-or-nothing acceptance. Preserve historical evidence independently of the active view and expose accepted retirements with their prior text and supporting evidence under the source-access policy. This provides an audit surface without another model or per-retirement approval. Keep retirement logs out of routine checkpoints; evaluate whether users or agents detect false retirement through inspection, without counting availability as detection. State semantic uncertainty directly and keep capacity exhaustion visible. Do not add a role solely because another product has one, or adopt add-only facts solely because Mem0 reported destructive reconciliation failures.

The missing evidence is a controlled test of actual continuation after repeated updates. A separately authorized study should compare the same histories and acting model under Pi's native compaction summaries and the proposed core, then diagnose full-state versus selected-state input and any additional maintenance role. Measure missed additions, wrong-target changes, false retirement, false completion, duplicate accumulation, unresolved contradiction, and downstream constraint violations. Vary active-state size, repeated corrections, weakly related obligations, edited evidence, and source attribution. Count all observation, retry, catch-up, presentation, and acting costs, including failed calls. Scripted tests can establish state mechanics before that study; they cannot establish semantic reliability.

## Sources

All external sources linked above were retrieved on 2026-10-11. Mem0's algorithm article supplies dated author claims and explicitly qualifies its platform measurements; current code supplies path-specific mechanics. LangMem and Mastra default-branch source establishes inspected implementation behavior without release-artifact or runtime verification. Letta pages document separate current and legacy interfaces. LongMemEval is an ICLR 2025 paper; the LightMem reproduction is a July 2026 preprint. Provider documentation establishes cache conditions, not observed cache hits. These sources inform design choices and do not add requirements.
