# Memory responsibilities and scope

Research date: 2026-10-04. This document compares documented architectures and derives implications
for the proposed core. These implications do not amend the draft SPEC. Framework capabilities are
not evidence that a particular Orbis implementation improves continuation.

Semantic memory describes knowledge content; semantic search describes a retrieval mechanism. A
package can retain reusable knowledge in ordinary text without embeddings, and a vector index can
search episodic source without turning it into verified knowledge.

## Separate the design dimensions

A useful memory design answers several independent questions. Combining their answers into a single
list of tiers makes it difficult to identify which responsibilities can be removed from an MVP.

| Dimension    | Question                                      | Examples                                                                                         |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Purpose      | What does this information help the agent do? | Continue current work, recall an attempt, understand a project, apply a procedure.               |
| Scope        | Where may this information apply?             | Selected session lineage, repository, developer, organization.                                   |
| Persistence  | What survives which lifecycle events?         | A request, process restart, session fork, repository change, explicit deletion.                  |
| Access       | How does the acting model receive it?         | Checkpoint text, a compact index, search results, direct source lookup.                          |
| Construction | How is it produced?                           | Original event capture, observation, summarization, reflection, human authorship.                |
| Maintenance  | How can it change?                            | New evidence, explicit correction, supersession, curation, retirement.                           |
| Authority    | What may the agent infer from it?             | An attributed claim, an observed outcome, an explicit user instruction, an unverified inference. |

A source from an old session can remain durable evidence without becoming a general project rule. A
developer preference can apply across projects without belonging in every prompt. Reflection is a
processing mechanism; it does not by itself identify a storage tier or independently useful package.

[CoALA](https://arxiv.org/abs/2309.02427), published in TMLR 2024, provides a vocabulary for
working, episodic, semantic, and procedural memory alongside action selection. It does not prescribe
a tier count, database, or package decomposition. The
[2026 agent-memory survey](https://arxiv.org/abs/2512.13564) likewise separates forms, functions,
and update dynamics. These taxonomies organize questions; they do not validate a combined
architecture.

## What already exists in a Pi session

Pi's persisted history, authored context, and compacted acting context serve different purposes. The
[Pi investigation](pi-compaction.md) records the checked versions and public contracts.

| Existing capability               | Contribution                                                                   | What the proposed package adds                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Branching session transcript      | Original messages and tool activity, selected ancestry, resume and navigation. | Source discovery and bounded recall with explicit scope.                                          |
| Native compaction                 | A generated checkpoint plus retained recent conversation.                      | Prepared continuation state and observations when a custom checkpoint is eligible.                |
| Authored context files and skills | Instructions and procedures supplied through the host's loading mechanisms.    | Derived session evidence; learned content does not acquire instruction authority through storage. |
| Ordinary tools                    | Inspection of the current repository and environment.                          | Historical context about why a change was attempted, what happened, and what remains unresolved.  |

Memory cannot replace checking the current artifact when the relevant files or environment may have
changed. A remembered passing test is evidence of a prior result, not proof of the present checkout.

## Responsibilities in the core MVP

The following allocation reflects the agreed product direction. Its mechanisms and interfaces still
need design decisions.

| Responsibility     | Core contribution                                                                                   | Boundary                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Current intentions | A continuation snapshot of objectives, constraints, decisions, obligations, and verification state. | Preserve active work visibly at compaction; do not require the model to guess which absent obligation to search for. |
| Session experience | Source-linked observations about relevant events and findings.                                      | Observation is interpretation; preserve access to original evidence.                                                 |
| Historical access  | Search or direct recall of eligible evidence with bounded output.                                   | Discovery and exact lookup are different requirements.                                                               |
| Prompt reduction   | One custom checkpoint when the completed eligibility contract permits it.                           | Pi continues to own automatic triggers, the retained boundary, and retry policy.                                     |
| Broader knowledge  | Evidence that a future companion may assess.                                                        | The core does not infer that one session preference or one successful command applies across projects.               |

The distinction between current obligations and historical detail is functional. A constraint does
not become disposable because it is old. Conversely, a detailed account of a completed investigation
need not stay visible indefinitely when its outcome and source remain discoverable.

## Comparable architectural boundaries

[LangGraph](https://docs.langchain.com/oss/python/concepts/memory) separates thread state and
checkpoints from namespaced stores used across threads. It also distinguishes profiles from
collections and foreground updates from background processing. This supports separating scope and
update policy; it does not establish that Pi packages should share one storage service.

[LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) separates memory
processing from its LangGraph persistence integration and exposes prompt optimization as a different
capability. Deriving a useful lesson and changing operating instructions are therefore distinct
outputs even when both use a model.

[AgentCore Memory strategies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-strategies.html)
make longer-term extraction optional over recorded session events. Its
[organization documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-organization.html)
separates actor/session identity and namespaces from access control. This is a precedent for
optional knowledge processing, not a reason to adopt managed infrastructure for an in-process
extension.

The [system comparison](agent-memory-systems.md) examines the additional source, correction, and
retrieval policies that those broader products require.

## Boundaries that should remain explicit

**Session scope and future aggregation.** Selected-lineage recall must not silently search an
abandoned branch as though it were current. A future companion can deliberately aggregate evidence
from several sessions, but it needs its own selection and applicability policy. Making records
readable is different from automatically ingesting every session.

**Knowledge and procedure execution.** A note that a command worked can become evidence for a
procedure. It does not authorize executing the command in another project, publishing a skill, or
changing system instructions. Those are additional capabilities with different effects.

**Source time and processing time.** Observing an old failure today must not make it supersede a
newer successful result. Source order and available timestamps help distinguish when an event
occurred from when memory was constructed. Missing timestamps remain unknown rather than invented.

**Recall and repository indexing.** Recalling the history of an investigation is different from
indexing every repository file or external document. Existing tools can inspect current code. A
broader retrieval service would need a separate acquisition and update policy.

**Text and attachments.** Retaining an image reference, returning the image, and interpreting it are
three different capabilities. Neither native text serialization nor a text-only observer establishes
full preservation of visual constraints. The source-format and unsupported-input policies remain
open in the draft.

## Implications and reconsideration conditions

**Keep the core independently useful.** Observation, checkpoint creation, and evidence recall form a
complete continuation product. The research does not require a storage-only foundation package
before that product can exist.

**Keep broader knowledge optional.** Project retrospectives and developer habits require promotion,
correction, and applicability decisions beyond session continuation. The
[modularity analysis](modularity-and-knowledge.md) compares ways to expose evidence without deciding
the companion package count in advance.

**Do not infer architecture from terminology.** Embeddings, graphs, topics, and reflections are
mechanisms to assess against observed failure modes. They are not missing requirements merely
because another framework gives them names.

Select a mechanism when comparative evidence shows it better satisfies continuation or retrieval
requirements within the core's scope. A concrete companion can also establish a need for additional
evidence access. Popularity and a larger feature inventory are not comparative evidence.
