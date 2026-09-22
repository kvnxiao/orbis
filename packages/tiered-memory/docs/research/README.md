# Tiered memory for Pi

A memory extension can prepare observations ahead of compaction, retain original evidence for
recall, and separate session history from reusable project knowledge. Published research and source
inspection support these mechanisms as candidates; neither establishes an optimal tier count or a
measured improvement for Orbis.

Effective continuation is the primary objective: the agent should retain the intended work and
applicable constraints across compaction and steering. Simplicity, acting-agent ceremony, total
token cost, and foreground waiting are secondary. The selected design combines observations and
topics with a protected current-work note. Its benefit remains unmeasured. The comparison defines
the candidate approaches before assessing their trade-offs.

Research dates: 2026-09-12, 2026-09-21, and 2026-09-22. The Pi baseline is **0.87.0**. External
source inspection and published results are distinguished below from design recommendations. No
Orbis memory implementation or live-model evaluation exists in this research. Comparative evaluation
records correctness, continuity, total usage and cost, compaction counts, elapsed time, and
intervention. Those results guide iteration; the experimental package has no fixed numerical
improvement gate.

## Reading map

[Effective session continuity](continuity-and-invariants.md) defines the primary outcome and
separates mechanical invariants from empirical model quality. [Memory layers](memory-layers.md)
compares current framework concepts and explains which responsibilities Pi and this extension own.
[The implementation comparison](observational-memory-comparison.md) examines the topics and v3
implementations of `pi-observational-memory` alongside Mastra, including version boundaries and
continuity trade-offs.

[Agent memory systems](agent-memory-systems.md) compares Hindsight, Honcho, Mem0, and Letta against
the selected MVP. It maps the contract's source-search and source-time rules to supporting evidence,
verification cases, and mechanisms to defer.

| Document                                              | Questions answered                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Pi compaction](pi-compaction.md)                     | How do manual and automatic compaction work? Which public APIs can replace checkpoint content, and what must an extension preserve?         |
| [Observational memory](observational-memory.md)       | What does `pi-observational-memory` actually record, when does it consolidate, and what explains its simplicity and its failure boundaries? |
| [Evidence and evaluation](evidence-and-evaluation.md) | Which findings transfer to coding sessions, where does model quality matter, and how should dogfooding compare alternatives?                |

These documents contain the research synthesis and direct external references. Research is
informative; the package SPEC defines behavior.

## Memory responsibilities

Memory purpose and memory lifetime are separate dimensions. A session-local record can remain on
disk for months without becoming a reusable lesson. A project lesson can be durable while entering
the prompt only when relevant.

| Responsibility             | Example                                                                    | Read and update policy                                                                           |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Working context            | The current request, recent tool results, and freshly recalled evidence    | Read on the current turn; preserve a recent complete conversational tail.                        |
| Session observations       | A failed test, a design decision, a correction, or a paused investigation  | Extract from new source spans; retain chronology and source references.                          |
| Session topics and journey | Detailed notes about an investigation and a short account of progress      | Consolidate older observations; expose a bounded index and retrieve detailed bodies when needed. |
| Project learnings          | A verified repository test procedure or a recurring environment constraint | Reuse across sessions in the same project; retain applicability and supporting evidence.         |
| Original evidence          | Recorded messages, tool results, and source artifacts                      | Retrieve exact recorded details; distinguish missing evidence from a failed search.              |

The distinction follows the working, episodic, semantic, and procedural responsibilities described
by [CoALA](https://arxiv.org/abs/2309.02427) and the external-memory model in
[MemGPT](https://arxiv.org/abs/2310.08560). Those taxonomies do not prescribe a database or a fixed
number of storage tiers.

For this package, session memory belongs to the selected Pi session lineage. Project learnings
belong to the local repository and may be shared through Git. Global persistence across every
project is a different policy and is outside the initial design. A repository fact can become stale
after a branch switch, worktree change, dependency update, or user correction.

## Architecture alternatives

The alternatives differ in what receives special preservation treatment. Each can use observations,
topics, and original-history retrieval.

| Approach                                                                 | Additional mechanism                                                                                                                          | Useful scenario                                                                                                                     | Cost or failure boundary                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A: observations/topics with a protected current-work note — selected** | The observer also updates a bounded note for the objective, active constraints, paused work, and continuation point in its existing response. | After many steering rounds, an old prohibition still governs the next repository edit.                                              | Reserved context and explicit freshness add cost; extraction can still miss a constraint.                                         |
| **B: observations and topics — optional comparison baseline**            | Automatic observation extraction, topic consolidation, and a bounded checkpoint                                                               | A long debugging session accumulates attempts and discoveries; the model recalls exact details when work returns to an older issue. | An extractor can omit a live commitment, and an index does not guarantee that the acting model recalls it.                        |
| **C: structured task state**                                             | Explicit task identities, dependencies, statuses, and state transitions                                                                       | Several interdependent tasks require exact resumption and completion accounting.                                                    | Schema design, transition validation, and model maintenance calls add ceremony; an incorrect state transition can misdirect work. |

Both A and B keep maintenance outside the acting agent's workflow. The extension schedules
extraction; the acting agent uses one read-only recall tool only when the current context lacks
relevant evidence. Topic bodies and historical observations remain outside the routine prompt. The
initial design does not require a task-state tool or a separate learning-review model.

The selected approach gives current work separate retention priority while retaining B as an
optional evaluation baseline. Sharing an observation response avoids a required extra model call,
but does not establish negligible token or latency cost. Approach C would require evidence that
explicit task transitions solve an observed problem at an acceptable maintenance cost.

## Improvements to the reference approach

The [`pi-observational-memory` inspection](observational-memory.md) separates its implemented
behavior from these recommendations:

- Before replacing a native summary, require committed processing coverage of the discarded source
  span. When coverage or checkpoint validation fails, use native compaction and report the reason
  explicitly. Processing coverage does not prove semantic completeness.
- Retain original source references and historical observations after consolidation. A compact
  representation is an index into evidence, not a substitute for all evidence.
- Keep session-topic snapshots consistent with the selected Pi branch. After a session, lineage,
  settings, or source revision change, reject late worker results.
- Separate project learnings from session-private records. Use repository-local files with optional
  Git sharing and preserve manual corrections and deletions.
- Use bounded in-process model calls and a controlled writer. Models propose observations and note
  changes; extension code validates and commits them.
- Default to the session model, allow independent observer and consolidator overrides, and avoid
  silent provider substitution. Serial inference is a useful starting point for a local GPU.
- Make recall conditional. A compact index and explicit invocation guidance let the acting agent
  skip retrieval when visible evidence is sufficient.

When observations are ready and no additional transformation is needed, deterministic checkpoint
rendering saves a foreground summarization call. Extraction, consolidation, waiting for unfinished
work, custom compaction instructions, and fallback still consume time or model tokens.

## Other implementation patterns

These sources describe different products and scopes. Source or documentation inspection does not
establish runtime compatibility with Pi or a ranking of memory quality.

| System                                                                                                                                                       | Relevant mechanism                                                                         | Boundary for this design                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pi-observational-memory`](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e)                          | Session observations, topic files, journey, and deterministic checkpoint rendering         | Session scope, whole-span coverage, manual edits, and branch snapshots need explicit policies.                                                                                                |
| [A separate `pi-observational-memory` project](https://github.com/elpapi42/pi-observational-memory)                                                          | In-process observation and reflection, ledger-based drops, and source recall               | This is a distinct project with the same repository name. Its empty-projection fallback must not be attributed to the reference implementation inspected here.                                |
| [Mastra observational memory](https://mastra.ai/docs/memory/observational-memory)                                                                            | Buffered Observer and Reflector operations prepare compressed context                      | Preparation and activation differ; source scope, fallback, and auxiliary cost still matter. Its [vendor evaluation](https://mastra.ai/research/observational-memory) is not a Pi coding test. |
| [Hermes](https://github.com/NousResearch/hermes-agent/tree/c6f87deb2c38d75518c793790f1cc9afa37f0695)                                                         | Bounded `MEMORY.md` and `USER.md`, a frozen prompt snapshot, and SQLite FTS session lookup | Curated essentials and detailed history can coexist; profile scope is not automatically repository scope.                                                                                     |
| [Claude Code memory](https://code.claude.com/docs/en/memory)                                                                                                 | A bounded auto-memory index and topic files loaded on demand                               | Machine-local auto memory and Git-shared project instructions have different ownership. Learned claims must not acquire instruction authority merely by being stored.                         |
| [Claude-Mem](https://github.com/thedotmack/claude-mem)                                                                                                       | A separate plugin captures observations and searches history                               | It is not Claude Code's native auto-memory implementation. Additional workers and services have independent costs.                                                                            |
| [Letta memory](https://docs.letta.com/agent-sdk/memory)                                                                                                      | Current MemFS uses versioned files; earlier APIs use memory blocks and archival stores     | API generations differ. Git synchronization does not itself resolve concurrent semantic edits.                                                                                                |
| [OpenClaw memory](https://docs.openclaw.ai/concepts/memory)                                                                                                  | A pre-compaction memory flush and persistent notes                                         | A requested flush does not establish complete or correct extraction.                                                                                                                          |
| [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/memory) and [LangMem](https://langchain-ai.github.io/langmem/)                            | Thread checkpoints and namespaced stores separate session state from durable knowledge     | Framework capabilities leave write timing, promotion, validity, and retrieval policy to the application.                                                                                      |
| [Hindsight](https://github.com/vectorize-io/hindsight), [Mem0](https://arxiv.org/html/2504.19413v1), and [Zep/Graphiti](https://arxiv.org/html/2501.13956v1) | Retention, recall, revision, temporal validity, and reflection                             | Service dependencies and benchmark protocols need separate evaluation; graphs are not an established requirement.                                                                             |

Mutable documentation links record the surveyed product pattern as of the research date. The
detailed `pi-observational-memory` and Pi findings use pinned sources. Later product changes require
renewed inspection.

## Claims and limits

| Claim                                                             | Supported interpretation                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Compaction destroys the session history.                          | Pi omits old entries from the prompt and retains them in the session file. Retrieval needs an interface.                                    |
| Deterministic rendering prevents memory loss.                     | Rendering avoids another generative rewrite; it cannot restore a fact omitted during extraction.                                            |
| A session ledger makes every note branch-correct.                 | Ledger replay can select the active lineage; external note revisions and late writes need separate controls.                                |
| Masking improves coding accuracy and guarantees large Pi savings. | A coding study supports a cost comparison, but its solve-rate confidence interval includes no improvement and Pi savings remain unmeasured. |
| More tiers or full context always improve memory.                 | Budget, retriever, reader, and task change the result. Neither is a universal ranking.                                                      |
| Raw recall returns truth.                                         | Recall returns recorded evidence, which may be incomplete, obsolete, mistaken, or hostile.                                                  |
| Model-agnostic memory makes every model equally capable.          | Portable interfaces and bounded work preserve usability; extraction, selection, and reasoning still depend on model quality.                |
| Git makes deleted notes recoverable.                              | Recovery requires an earlier commit or another retained copy. Ignored, never-committed content has no Git recovery guarantee.               |
| Managed-file guards prevent all agent mutations.                  | Direct tool guards prevent ordinary writes and edits; arbitrary shell execution remains outside a complete filesystem sandbox.              |

The remaining research questions concern measured trade-offs: how often B loses active commitments,
whether A improves retention at matched budgets, when raw retrieval beats consolidated notes, and
which model configurations meet acceptable cost and continuation quality. They do not require a
larger MVP architecture before dogfooding.
