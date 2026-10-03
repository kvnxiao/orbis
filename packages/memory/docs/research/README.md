# Memory design research

Research synthesis: 2026-10-03. This document records the investigation that preceded the
`@orbis/memory` design draft. It separates inspected behavior from design implications. It does not
establish runtime compatibility or measured continuation quality for the new package.

## Question and scope

Can a small, independently useful Pi extension preserve effective continuation across compaction
while providing evidence for future project and developer knowledge packages?

Memory purpose, scope, persistence, and retrieval are separate choices. An old session observation
does not become a reusable project lesson merely because it remains stored. Reflection is a way of
processing evidence, not necessarily a separate package or storage tier. These distinctions are
consistent with [CoALA](https://arxiv.org/abs/2309.02427) and
[LangGraph's memory concepts](https://docs.langchain.com/oss/python/concepts/memory). Framework
concepts do not prescribe the number of Orbis packages.

## Pi, provider compaction, and Orbis

| Mechanism                | Responsibility                                                                                              | Boundary for this design                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pi session history       | Store the conversation and its branches; rebuild context for resume and navigation.                         | Retaining a transcript does not itself provide an acting-model tool for finding every older detail.                      |
| Pi native compaction     | Summarize selected history, preserve a recent tail, and manage automatic compaction and overflow retry.     | A generated summary can omit information; native summary categories define the comparison for Orbis.                     |
| Provider-side compaction | Compress context using a provider's API and representation.                                                 | Provider behavior is a separate contract; this draft does not select a provider-specific mechanism.                      |
| Proposed Orbis memory    | Prepare continuation state and observations, render eligible checkpoints, and retrieve supporting evidence. | Memory extraction and retrieval still require evaluation; storage and successful rendering do not prove semantic parity. |

The Pi findings below come from installed Pi 0.99.1 and source comparison with the published 1.0.1
package. The relevant compaction implementation and contracts did not add a solution to the open
questions in that comparison. This is source inspection, not a tested-version claim for Orbis.
Provider documentation remains a follow-up research input:
[Anthropic compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) and
[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

### Native information categories

Pi's native summary prompt requests goal, constraints and preferences, progress split into done,
in-progress and blocked work, decisions with rationale, next steps, and critical context. It asks
for exact file paths, function names, and error messages. Later summaries update `previousSummary`.
A cut within a turn can use a separate turn-prefix summary. File-operation lists are derived from
tool calls.

These are qualitative information obligations. An observation index or recall tool cannot replace
information that native Pi would already make visible and that the model needs to continue.
[Summary prompts and preparation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/compaction/compaction.ts),
[file-operation extraction](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/compaction/utils.ts).

### Public API findings and limits

- A returned custom checkpoint summary is stored and becomes a later native compaction's
  `previousSummary`. Native file-operation inheritance excludes hook-produced checkpoints, so
  cumulative file inventory needs explicit design.
- Public extension APIs expose the selected model and registry authentication. Calling a summarizer
  is feasible; reproducing the host's exact resolved routing and request is not guaranteed by those
  APIs.
- Native authentication is resolved after a compaction hook declines in the inspected versions. The
  older assumption that authentication always precedes the hook is outdated.
- Native summarization uses the prepared source spans and previous summary. Ordinary acting-context
  transformations do not automatically correct the input to native summarization.
- Cancelling overflow compaction can suppress the host's retry. Preserving `willRetry` therefore
  conflicts with using cancellation as a general correction mechanism.
- Pi does not merge several extensions' replacement checkpoints. The memory package needs one owner
  of its checkpoint; a companion needs a different integration boundary.

Sources:
[session storage](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/session-manager.ts),
[extension contracts](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts),
[host lifecycle](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/agent-session.ts),
[extension dispatch](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/runner.ts).

Checkpoint-only presentation removes ordinary-request note injection from the proposed design. It
does not eliminate stale information in an earlier checkpoint. A corrected checkpoint, failed
refresh, and native retry must be considered together before choosing recovery behavior.

## Existing Pi packages

The two `pi-observational-memory` repositories are different projects.

| Source inspected                                                                                                                                | Relevant behavior                                                                                                                                                | Implication and limit                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [amosblomqvist/pi-observational-memory](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e) | Background observations, external topic notes, a journey, and deterministic checkpoint rendering.                                                                | Preparation before compaction is useful evidence for the approach. Topic organization and external-file coordination are additional responsibilities, not established prerequisites. |
| [elpapi42/pi-observational-memory](https://github.com/elpapi42/pi-observational-memory/tree/886f7a6628d10ea420eb6ceecaee36691489b2fb)           | In-process observation/reflection, session records, and source recall. The inspected development revision adds bounded catch-up and coverage-sensitive fallback. | Session records are a viable candidate. Its option to move the retained boundary conflicts with the Orbis constraint; development HEAD must not be described as released behavior.   |
| [pi-cache-compact](https://github.com/lennartschoch/pi-cache-compact/tree/a905ed86c3844f1759a9f194dbe4c84d279ac8ca)                             | Reconstruct a summarization request at compaction time with cache behavior in mind.                                                                              | Foreground request optimization and proactive memory preparation solve different parts of the problem.                                                                               |

Neither observational-memory project establishes the proposed protected continuation snapshot or
qualitative parity with native Pi. Their implementations suggest mechanisms; they do not provide a
controlled ranking of coding-session continuity.

## Implications for a smaller core

The selected direction combines a continuation snapshot and source-linked observations in one
observer response. Checkpoints present the snapshot; older observations remain available through
recall without required topic consolidation. This produces a useful standalone extension.

Future knowledge maintenance adds decisions about promotion, applicability, contradictory evidence,
and retirement of claims. A project lesson and a developer-wide preference need different scope
rules. The core should preserve evidence identity and attribution so a companion can assess those
claims. This supports modularity without establishing a shared database, plugin registry, or
universal memory schema as an MVP requirement.

Retrieval must also reach original evidence when extraction misses a detail. A source reference is
not a guarantee that its target remains available; unavailable evidence must remain distinguishable
from an empty search result.

## Follow-up research

The existing survey remains an input to reassess, not a contract to copy. Its
[archived reading map](https://github.com/kvnxiao/orbis/blob/3627f33eaeeb72b1e985e86f6e6ef3b8e27f4eee/packages/tiered-memory/docs/research/README.md)
links the earlier memory-system, continuity, retrieval, and caching comparisons.

The next pass should:

- Revisit the earlier survey against the smaller scope, including retained-source discovery and
  knowledge-maintenance boundaries.
- Resolve observation coverage over every kind of input native Pi summarizes, including prior
  checkpoints, custom messages, branch summaries, and split turns.
- Compare bounded catch-up, summarizing only the unprocessed span, and whole-checkpoint native
  fallback without duplicating summaries of the same evidence.
- Resolve oversized snapshots, manual compaction instructions, corrections, and fallback reporting.
- Choose persistence, user curation, and the smallest concrete interface needed by future packages.
- Define category-level comparison with native checkpoints and continuation tasks. Scripted tests
  verify mechanics; separately authorized model evaluations assess extraction and acting-model use.

No live-model evaluation was performed for this design. Claims of better continuity, lower cost, or
better provider cache use remain unmeasured.
