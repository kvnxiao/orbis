# Memory responsibilities and layers

Observational memory is a construction and maintenance method that can span several memory
responsibilities. An observation pool is one representation produced by that method. The surveyed
primary sources do not establish a universal industry-standard tier model.

Research date: 2026-09-12. Framework documentation describes concepts and capabilities at that date;
the Pi sources in this survey are pinned to 0.85.1. The [integration research](pi-compaction.md)
covers the current 0.87.0 target. These comparisons do not establish runtime compatibility or
comparative memory quality.

## Independent dimensions

| Dimension   | Question                              | Categories used in practice                                                       |
| ----------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Purpose     | What does the information contribute? | Working state, experience, facts, procedures, and active intentions.              |
| Scope       | Whose work may use it?                | Turn, session lineage, project, user, and organization.                           |
| Persistence | How long is it retained?              | Transient context, persisted records, retained archive, and intentional deletion. |
| Access      | How does it enter the next request?   | Routinely included state, a selected index, and retrieved detail.                 |
| Mechanism   | How is it produced or revised?        | Observation, consolidation, correction, retrieval, and compaction.                |

“Hot” and “cold” describe access or placement, not whether the contents are episodic or semantic. A
historical decision can remain session-specific for months. A durable project procedure can enter
the prompt briefly when relevant. Semantic memory means knowledge about facts; it does not require
embedding-based semantic search. [CoALA](https://arxiv.org/html/2309.02427v3#S4.SS1),
[LangGraph memory concepts](https://docs.langchain.com/oss/python/concepts/memory).

## Current primary examples

| System                                                                                        | Documented model                                                                                                                 | Interpretation                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LangGraph](https://docs.langchain.com/oss/python/concepts/memory)                            | Thread state and checkpoints coexist with cross-thread stores and namespaces. Contents may be semantic, episodic, or procedural. | Scope, content, and foreground/background write timing are separate choices.                                                                        |
| [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)                  | Fact or experience extraction and consolidation coexist with separate prompt-optimization capabilities.                          | A reusable lesson and a modified operating instruction are different outputs.                                                                       |
| [AgentCore Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html) | Session events provide short-term history; configured strategies extract longer-lived records into namespaces.                   | Extraction connects representations instead of defining a single content category.                                                                  |
| [Claude Code](https://code.claude.com/docs/en/memory)                                         | Authored instructions coexist with learned notes, a bounded index, and topic files loaded on demand.                             | Markdown format does not imply shared ownership or instruction authority.                                                                           |
| [Letta](https://docs.letta.com/agent-sdk/memory)                                              | Current MemFS distinguishes routinely included `system/` files from other indexed files and supports background updates.         | Prompt inclusion and update timing are independent of subject matter. Current SDK semantics differ from older block/archive APIs.                   |
| [Mastra](https://mastra.ai/docs/memory/observational-memory)                                  | Recent messages become observations; reflection condenses the observation log; optional recall reads source messages.            | Observational memory spans representations, while thread/resource scope is another dimension. Reflection need not be a separately retained archive. |

The common pattern is bounded working context plus persisted information selected for later use. The
sources differ on representation, admission, scope, retrieval, and write ownership. Their
terminology does not require an extension to implement a separate database for each cognitive term.

## What Pi supplies and what the extension adds

Pi stores a branching session transcript, resumes selected history, retains recent messages during
compaction, and supports manual and automatic compaction. Pi also loads authored context files and
skills. The extension adds automatic memory construction, selection, correction, and historical
lookup policy around those capabilities.
[Pi overview and context files](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md),
[skills](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md),
[compaction](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/compaction.md).

| Responsibility                            | Existing host or repository contribution                                 | Initial extension contribution                                        | Remaining boundary                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Working context                           | Current instructions, recent conversation, tool results, and host prompt | Prepared checkpoint and bounded index                                 | The acting model still must apply the relevant information before acting.                                               |
| Episodic memory: what happened            | Original session transcript and lineage                                  | Source-linked observations, topics, journey, and recall               | Extraction can omit a useful event; retrieval can select the wrong event.                                               |
| Semantic memory: what is known            | Repository files and authored context remain readable                    | Evidence-bearing project learnings with applicability and corrections | Stored facts can become stale after repository changes.                                                                 |
| Procedural knowledge: how to do something | Skills, code, prompt templates, and authored instructions                | Verified procedures stored as retrievable project knowledge           | A learned recipe does not automatically become an executable skill or instruction.                                      |
| Active intentions: what remains to do     | Current requests and retained conversation                               | A protected current-work note updated alongside observations          | Reserved visibility reduces dependence on rediscovering old obligations; extraction and freshness remain quality risks. |
| Detailed archive                          | Persistent session entries and available artifacts                       | Bounded source search and direct lookup                               | Preserved evidence is useful only when found and interpreted correctly.                                                 |
| Scope, authority, and correction          | Session tree, lifecycle, and host instruction hierarchy                  | Revision checks, curation rules, and scoped memory selection          | These govern every representation; they are not an additional cognitive tier.                                           |

The extension's conceptual path is:

```text
recorded experience
  -> observer updates current work and appends observations
  -> consolidator files older observations into notes or justified learnings
  -> current-work note, selected checkpoint, and index
  -> recalled evidence when needed
  -> continuation action
```

Observation is therefore part of a broader memory system. It does not replace working context,
source storage, retrieval, knowledge validity, or the acting model's reasoning.

## Selected preservation and remaining boundaries

**Protected current work.** The selected design reserves context for a current-work note. An old
active prohibition can remain relevant despite newer routine activity. Current Mastra includes task
metadata and optional observer-managed working memory, but its mechanisms and version-specific paths
need explicit freshness checks before transfer.
[Observational-memory documentation](https://mastra.ai/docs/memory/observational-memory).

**Structured task transitions.** A task-state system is outside the initial design. Exact task
identities, dependencies, and transition validation become relevant when prose memory repeatedly
loses work state. A task graph is not automatically necessary for one continuing session.

**Global personal and organizational learning.** Automatic extraction remains repository-scoped.
Cross-project memory introduces additional ownership and correction rules and is not required for
continuation within one selected project. Pi's authored global instructions remain available.

**Automatic procedural modification.** The extension stores a verified recipe as knowledge. It does
not generate skills, rewrite system instructions, optimize prompts, or update model weights.
Learning which procedure worked and changing an agent's operating policy are different actions.

**Embeddings, graphs, and classifiers.** These are implementation mechanisms rather than missing
memory purposes. Failed retrieval or continuity measurements can justify evaluating them; a tier
checklist cannot.

**General knowledge indexing.** The extension does not replace repository inspection or a general
document-retrieval service. Agent experience and external reference knowledge can overlap in content
while requiring different acquisition and update policies.
[AgentCore memory and retrieval](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-ltm-rag.html).

**Multimodal evidence.** Text-only observation does not capture every visual constraint in a
screenshot or other attachment. A package must distinguish retaining an attachment reference,
returning its recorded content, and interpreting it with a capable model. The initial SPEC does not
establish full multimodal observation quality. Broader support requires explicit source-format,
budget, model-capability, and recall behavior before making a compatibility claim.

The [continuity evaluation](continuity-and-invariants.md) tests whether these allocations support
the next correct action. A stored record, a complete taxonomy, or a larger number of tiers does not
by itself establish useful continuation.
