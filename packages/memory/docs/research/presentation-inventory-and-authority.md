---
date: 2026-10-11
questions:
  - How can presentation calls, cumulative file inventory, and edited permission claims remain bounded and attributable?
observed-in: [Pi 1.1.0, Claude Code and Codex documentation dated 2026-10-11]
recheck-when: Pi changes its compaction or source-access contracts, or the compared mechanisms are reconsidered.
---

# Presentation capacity, file inventory, and edited authority

Use a bounded presentation attempt, treat file inventory as recorded invocations, and distinguish edited evidence from independently supported permission. Native host mechanisms inform these policies but do not establish an optimal file ranking or a measured information-loss advantage.

Pi source baseline: **1.1.0**, commit `abe508e1b89912adde45528136c3221eb69acdd7`. Other host comparisons use official documentation accessed on that date, not inspected release source. This investigation used source inspection and documentation; it did not run a host fixture or model-quality evaluation.

## Questions and findings

The investigation asks how a bounded checkpoint can preserve continuation information, which file facts the host supplies, and what authority can be inferred from a context edit. Native mechanisms provide useful comparisons, but none establishes an optimal preservation policy for Orbis.

### File tracking in Pi

**Observed in Pi 1.1.0:** `extractFileOpsFromMessage` reads assistant tool-call blocks and calls recorded in a tool result's `nestedCalls.calls`. It recognizes `read`, `write`, and `edit` only when `path` is a non-empty string. `computeFileLists` combines write and edit targets, excludes those paths from the read-only set, and sorts both sets lexically. The renderer places read-only paths before write/edit targets. Failed invocations can appear because extraction does not test success. Printed call-like text and arbitrary shell changes are not recognized file operations. [File tracking source](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/compaction/utils.ts).

Native compaction appends these lists after model summarization. This formatter does not select a capacity-bounded subset or rank by relevance or recency. Native inheritance reads prior file lists only when a checkpoint is not marked as extension-produced by `fromHook`; those lists do not record invocation times. Recency selection over such inherited data would therefore need an additional policy for unknown times. [Compaction source](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/compaction/compaction.ts).

### File restoration in other hosts

Claude Code's documentation describes rereading up to five files read or edited in the session, ordered by most recent modification. A selected file over 5,000 tokens contributes a path reference instead of its contents. The documentation does not define the timestamp used for that ordering or promise an exhaustive inventory of modified files. It also recommends custom compaction instructions when users want a full modified-file list and test commands preserved. [Context window](https://code.claude.com/docs/en/context-window#what-survives-compaction), [context management guidance](https://code.claude.com/docs/en/best-practices#manage-context-aggressively).

Codex documents `/compact` as replacing older history with a concise summary that preserves critical details. The public command documentation does not specify a file-ranking algorithm. OpenAI's API compaction guide describes an opaque encrypted compaction item; it does not expose a file-priority rule either. API behavior alone does not establish which internal path a Codex client uses. [Codex command documentation](https://learn.chatgpt.com/docs/developer-commands?surface=cli#keep-transcripts-lean-with-compact), [API compaction guide](https://developers.openai.com/api/docs/guides/compaction).

These sources describe different mechanisms: deterministic path lists, selective file-content restoration, and a summary whose internal selection is unspecified. They do not provide a measured comparison of information loss. Orbis visits write/edit targets before read-only paths, lexically within each group, and skips a path that cannot fit while trying later paths. This preserves more available path references than stopping at the first non-fitting path, but can include a shorter read path while omitting a longer write path. This ranking and selection rule is an Orbis design choice, not Pi's native ordering or an empirically established quality advantage.

### Request capacity and presentation calls

**Observed in Pi 1.1.0:** a rendered checkpoint shares the model request with system context, tool definitions, retained history, and output headroom. Immediately after compaction, context usage may be unknown. An output-token allowance is not the size of the complete rendered request. [Capacity analysis](pi-compaction.md#threshold-output-allowance-and-actual-request-size).

A design that first applies instructions and then checks whether condensation is needed can require a second inference when those instructions expand the presentation. Supplying instructions and the final capacity target together permits one structured presentation attempt. Protected strings are exact identifiers or original wording that must remain verbatim in an item. Restoring omitted items or protected strings can still make the result too large. This is an engineering analysis of the failure path, not evidence that one call produces better summaries.

### Context-edit attribution and authority

**Observed in Pi 1.1.0:** replacing an entry preserves its original role and message metadata. The edit has an identity and timestamp but no reliable editor identity or reason. A replacement in a user-role entry therefore does not establish that the user authored it. [Session-manager source](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/session-manager.ts), [effective-context analysis](pi-compaction.md#original-records-and-effective-context).

The distinction matters when an edited statement permits an additional action. An ordinary factual correction and a new permission claim have different consequences even if both replace text in the same role. A summary repeating the replacement adds no independent support. Previously accepted state can preserve evidence of independently established permission; access to hidden originals is not necessary in every case and remains governed by the recall policy.

## Implications for design and evaluation

The continuation snapshot stores active goals, constraints, unfinished tasks, waiting conditions, decisions, completed work, and critical context. This semantic state is distinct from the checkpoint text rendered from it and from the supplementary file list.

The [presentation contract](../../specs/compaction.md#req-unified-compaction--unified-compaction) defines the call limit and fallback. The [inventory contract](../../specs/compaction.md#req-file-inventory--file-inventory) defines capacity-dependent selection. The [continuity contract](../../SPEC.md#req-session-continuity--session-continuity) keeps task-critical paths in semantic state independently of the supplementary inventory. The [observation contract](../../specs/session-state.md#req-session-observations--session-observations) defines how edited evidence affects permission claims. These choices belong to the SPEC, not to host behavior.

Useful scripted checks include instruction-induced expansion, repair overflow, and changes in available request capacity. Inventory fixtures can compare repeated requests, a smaller acting model, and a growing retained tail without admitting post-cut operations. Authority fixtures can separate a new permission claim from an ordinary correction and distinguish independently supported permission from repetition of edited text.

Semantic quality remains unmeasured. Evaluation should test whether the snapshot preserves critical paths even when a supplementary list omits them, whether shortening keeps the reason for a decision, and whether subsequent actions respect constraints after repeated compactions. Deterministic file ordering and structural inclusion checks cannot prove those outcomes.
