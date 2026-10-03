# Memory systems and knowledge maintenance

Research date: 2026-10-03. This comparison refreshes the broader systems surveyed for tiered-memory.
It records source-inspected behavior and documented capabilities separately from proposed Orbis
implications. No system was executed or benchmarked in this investigation.

## Source boundaries

| System                                 | Source baseline                                                                                         | Qualification                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Hindsight                              | [f7dd3f4](https://github.com/vectorize-io/hindsight/tree/f7dd3f4fd7420f7beec60c32c965e5e5cf7be066)      | Current main source; not a verified published package.                           |
| Honcho                                 | [8e4df99](https://github.com/plastic-labs/honcho/tree/8e4df990d974c146a100e96ab4b3957a6591ceab)         | Current main and v3 documentation.                                               |
| Mem0                                   | [abb81c8](https://github.com/mem0ai/mem0/tree/abb81c88e1f738a8117d8293530fbc31a5ef8fd9)                 | Current open-source implementation; hosted features are separate.                |
| pi-hermes-memory                       | [d5e2d13](https://github.com/chandra447/pi-hermes-memory/tree/d5e2d1384b2f78d7a304f24383ad3aae1da5749e) | Manifest says 0.9.10; several source changes are marked Unreleased.              |
| claude-mem                             | [a1951f2](https://github.com/thedotmack/claude-mem/tree/a1951f2ad247330b2b5d58a1e0c7efeef4a03be5)       | README inspection; not a complete audit of lifecycle hooks.                      |
| Letta, Claude Code, framework services | Official documentation observed on the research date                                                    | Mutable documentation describes capabilities, not a pinned installed deployment. |

A current source revision is not necessarily a released implementation. An extraction prompt
establishes requested model behavior, not semantic correctness. Vendor benchmark claims are
considered in [evidence and evaluation](evidence-and-evaluation.md), not used as a ranking here.

## Hindsight: retention and retrieval are different guarantees

Current [retention documentation](https://hindsight.vectorize.io/developer/retain) describes
concise, verbose, custom, verbatim, and chunk-based modes. Verbatim mode preserves original chunks
alongside extracted metadata; chunk mode skips extraction. A stored document that produces zero
extracted memories can remain unavailable through memory recall and reflection. The documentation
also covers image-derived records and attachment propagation, subject to model capabilities.

For Orbis, this distinguishes three outcomes: the source was retained, the worker processed it, and
the acting model can discover it. None implies the other two. An empty observation response must not
make exact source retrieval depend on a fact the observer failed to extract.

The pinned
[consolidation prompt](https://github.com/vectorize-io/hindsight/blob/f7dd3f4fd7420f7beec60c32c965e5e5cf7be066/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py)
asks for supporting fact IDs, occurrence and mention dates, corrections to matching facets, and
separation of unrelated entities. It may exclude ephemeral details unless the mission needs them.
That is a meaningful knowledge policy, but a temporary blocker can be essential to session
continuation. The core and a knowledge companion should therefore have different admission rules.

The newly verified raw-retention options widen the comparison. They do not establish that Orbis
needs Hindsight's service, inference, or retrieval infrastructure.

## Honcho: broader conclusions have a separate lifecycle

Honcho's [architecture](https://honcho.dev/docs/v3/documentation/core-concepts/architecture) stores
messages while background processes derive representations across workspace, peer, and session
scopes. Persistent peer representations address a broader identity problem than one selected coding
conversation.

The pinned
[deletion contract](https://github.com/plastic-labs/honcho/blob/8e4df990d974c146a100e96ab4b3957a6591ceab/docs/v3/documentation/features/advanced/deleting-data.mdx)
first makes a session inactive, then asynchronously removes its messages and session-scoped
conclusions. Workspace-scoped derived conclusions survive. The documented interface does not provide
a deletion-cascade completion endpoint.

This exposes a decision that a future Orbis companion cannot avoid: does removing supporting
evidence also withdraw a reusable claim? Merely sharing source IDs does not implement retraction.
The companion needs to explain its policy and the state of derived knowledge; the core need not
implement a general dependency engine before that consumer exists.

## Mem0: current OSS differs from the historical paper

The [v3 migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3) describes ADD-only extraction,
coexisting facts, explicit update/delete operations, and removal of OSS graph memory. Temporal
features of the hosted platform must not be attributed to the open-source package.

In the pinned
[implementation](https://github.com/mem0ai/mem0/blob/abb81c88e1f738a8117d8293530fbc31a5ef8fd9/mem0/memory/main.py),
non-inference mode stores non-system messages directly. Inferred extraction uses conversation and
retrieved memory. Provider failure raises an error, while malformed extraction JSON can result in an
empty extraction result.

The important comparison is the output contract. Failure, valid empty output, accepted evidence, and
superseded claims are different states. Additive storage avoids one destructive rewrite, but it does
not decide which conflicting fact is currently applicable. The earlier Mem0 paper remains research
evidence for its evaluated system, not documentation of current OSS behavior.

## Letta: distinguish current MemFS from MemGPT

The current [Letta SDK memory documentation](https://docs.letta.com/agent-sdk/memory) describes a
Git-backed repository. Files under `system/` enter context routinely; other files are discoverable
and read on demand. Shared repositories are on-demand context. Memory edits are committed and
pushed, and dreaming can be triggered by step or compaction events.

This separates prompt placement, storage ownership, and background maintenance. It is a different
API generation from the memory-block/archive descriptions associated with early MemGPT. Its
agent-editable repository and synchronization workflow are a valid broader product, not an
established requirement for the smaller core. Git history alone does not settle conflicting edits,
source validity, or which repository facts remain applicable.

## Claude Code: authored instructions and learned notes

[Claude Code's native memory documentation](https://code.claude.com/docs/en/memory) distinguishes
authored instructions from learned auto-memory. An index and topic files support selective loading.
Startup reads the first 200 lines or 25 KB of the index, whichever limit comes first; topic files
are read on demand. Oversized writes can succeed with feedback to shorten the index, while excess
content will not load on the next startup. Memory persists independently of transcript cleanup.

This provides an explicit comparison for capacity policy: a system can permit a write whose entire
content will not be presented. It does not establish parity for Orbis's continuation snapshot, where
silently omitted obligations could prevent the next correct action. A readable Markdown file also
does not determine whether its contents are instructions or attributed evidence.

The separate
[claude-mem project](https://github.com/thedotmack/claude-mem/blob/a1951f2ad247330b2b5d58a1e0c7efeef4a03be5/README.md)
documents lifecycle capture, a local worker, SQLite records, and staged retrieval through search,
timeline context, and selected details. It also offers a hosted observer path. This is a third-party
product, not Claude Code's native memory. Staged retrieval is a useful candidate; its savings claims
were not reproduced here, and its services add deployment and maintenance responsibilities.

## Hermes: native compaction plus separate memory

The pinned
[defaults](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/src/config.ts)
select policy-only memory with explicit standing instructions enabled. Its
[pre-compaction flush](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/src/handlers/session-flush.ts)
reads the selected branch, takes a bounded recent subset, and attempts extraction with a subprocess
fallback within a shared time window. It permits native compaction to continue instead of returning
a replacement checkpoint.

This is evidence that knowledge capture can complement native compaction without owning it. It does
not establish that Hermes's separate memory could replace all native checkpoint information.

Its historical retrieval has a different scope. The
[JSONL parser](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/src/store/session-parser.ts)
and
[session indexer](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/src/store/session-indexer.ts)
read messages without preserving parent relationships, or use all session entries. Tool-result
bodies are excluded. The
[search tool](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/src/tools/session-search-tool.ts)
provides filtered snippets and optional source anchors. These features do not establish
selected-lineage recall of an exact error buried in a tool result.

The
[changelog](https://github.com/chandra447/pi-hermes-memory/blob/d5e2d1384b2f78d7a304f24383ad3aae1da5749e/CHANGELOG.md)
describes synchronization, corruption recovery, index repair, and source retention work, including
Unreleased entries. These are concrete costs of maintaining multiple representations. Attribute the
inspected behavior to its source revision, not automatically to published version 0.9.10.

## What transfers to the core

| Finding                                                       | Candidate core response                                                  | Limit                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Extraction can miss a detail or return no records.            | Keep source discovery independent of generated observations.             | Retention and indexing still need explicit scope and availability rules.             |
| Broad knowledge can outlive its source session.               | Preserve provenance and let companions own applicability and retraction. | Stable references alone do not implement correction propagation.                     |
| Source time differs from processing time.                     | Keep ordering and available source timestamps.                           | A timestamp is not proof that a claim is true or still applicable.                   |
| Some obligations cannot be recovered by an unprompted search. | Keep active constraints in visible continuation state.                   | A snapshot can itself omit or misstate them.                                         |
| Several representations require reconciliation.               | Add representations only for a concrete caller or measured failure.      | One representation can also become inadequate; simplicity is not a proof of quality. |

The [memory-layer analysis](memory-layers.md) covers LangGraph, LangMem, and AgentCore's scope and
processing distinctions. The [companion analysis](modularity-and-knowledge.md) turns these findings
into integration options without selecting a common backend.

## Mechanisms to defer, and evidence that could reopen them

| Mechanism                                                 | Reason to keep outside the current core                                   | Reconsider when                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Embeddings, reranking, or entity graphs                   | They add indexing and operational policy beyond exact evidence access.    | Repeated paraphrase or relationship queries defeat a simpler retriever and materially harm continuation.   |
| Query-time reasoning agent                                | The acting model can initially interpret returned evidence.               | Controlled comparisons show a separate reasoning pass improves actual outcomes enough to justify its cost. |
| Automatic project/developer profiles                      | Promotion and scope are different from session preservation.              | A companion has explicit ownership, correction, and applicability requirements.                            |
| Automatic skill or instruction generation                 | Knowledge admission does not authorize changing operating policy.         | A separate user-facing capability defines approval and verification.                                       |
| Shared storage service or generalized backend abstraction | Current continuation does not establish a multi-consumer deployment need. | Actual consumers require shared behavior or a supported deployment cannot use the simple store.            |

These are research recommendations, not approved implementation choices. The sources do not choose
session entries versus files, user-edit semantics, or the public companion interface for Orbis.
