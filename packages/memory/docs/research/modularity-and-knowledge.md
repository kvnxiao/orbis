# Modularity and future knowledge packages

Research date: 2026-10-03. The selected core prepares session continuation and provides evidence
recall. A future companion can turn experience into project knowledge or developer habits without
making that processing a prerequisite for the core. This document compares integration directions;
it does not approve a public API, storage format, or additional package name.

## Separate the product responsibilities

Continuation asks what the acting model needs to do next in the selected conversation. Knowledge
maintenance asks which claims should apply beyond that conversation, why they are credible, and when
they should stop applying. The latter requires additional judgments even when both products read the
same source.

| Responsibility                        | Core continuation                                                     | Possible companion                                                                    |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Current objective and unfinished work | Preserve applicable task state for the next action.                   | Use it as evidence about the session, not as a permanent project rule.                |
| Source evidence                       | Identify recorded messages, tool results, and their eligible lineage. | Cite evidence supporting a broader claim.                                             |
| Project learning                      | No automatic promotion in the core MVP.                               | Assess repository applicability, verification, contradiction, and retirement.         |
| Developer habits                      | Preserve instructions applicable to this conversation.                | Distinguish explicit preferences from inferred habits and decide cross-project scope. |
| Retrospective or reflection           | Not required to make a checkpoint.                                    | Analyze outcomes and propose lessons with supporting evidence.                        |
| Reusable procedure                    | Recall an earlier attempted procedure when relevant.                  | Decide whether a verified procedure should become a maintained artifact or skill.     |
| Correction and deletion               | Define current evidence and availability under the core contract.     | Decide what happens to claims derived from corrected or unavailable evidence.         |

This separation is consistent with the independently scoped processing and storage systems in
[memory layers](memory-layers.md) and [agent memory systems](agent-memory-systems.md). It does not
establish a mandatory one-package-per-row architecture. The first real companion may combine some
responsibilities or use a different interface than later companions.

## Evidence is not an instruction channel

A useful evidence record lets a consumer distinguish who said something, when it applied, and what
actually happened. The following are candidate information needs, not a universal schema:

- Source and record references, with session identity and eligible ancestry.
- Speaker or tool attribution, source order, and relevant timestamps.
- Proposed action, attempted action, observed result, and verification state.
- Scope, applicable repository context, and superseding corrections.
- Accepted processing versus partial or failed work.
- Bounded lookup with visible truncation and unavailable-source results.

A companion must not silently turn "this worked once" into "always do this." A repeated failure is
not necessarily a general prohibition. User-authored policy has a different authority from inferred
habit. A project-specific workaround does not acquire developer-wide scope through storage alone.

Occurrence time and record-creation time may differ. File paths identify referenced artifacts but do
not recover historical file contents unless those contents were recorded. Source deletion may make
evidence unavailable while a companion still stores a derived claim; retraction needs its own
policy. The Honcho and Hindsight cases in [the system comparison](agent-memory-systems.md)
illustrate why these distinctions matter.

## Public Pi integration options

Pi exposes selected-branch reads, entry lookup, session projection, and custom session entries. Its
event bus provides in-process notifications. These are mechanisms rather than a ready-made memory
service contract.

| Option                                   | Advantages                                                                   | Obligations and limits                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Durable session-artifact reader          | Works without a running core instance; can read selected persisted evidence. | Couples the consumer to a versioned format and Pi session semantics; must validate records and distinguish unavailable evidence. |
| Optional runtime read interface          | Can hide representation and expose current eligibility decisions.            | Needs discovery, versioning, async response/cancellation, and behavior when the core is absent or inactive.                      |
| Both artifact and runtime interfaces     | Supports offline analysis and current-session access.                        | Creates two public contracts before there is evidence both are needed.                                                           |
| Generic shared memory substrate          | Could support several producers and consumers.                               | Adds lifecycle, storage, schema, and coordination policy before actual shared behavior exists.                                   |
| Companion reads Pi sources independently | Avoids a dependency on the core.                                             | Can duplicate processing and must independently implement lineage, source, and correction semantics.                             |

`pi.events.emit()` does not await asynchronous listeners and provides no durable replay,
acknowledgement, or request/response protocol. Runtime invalidation removes tracked listeners; it
does not complete pending application work automatically. `getAllTools()` exposes tool metadata, not
a general tool-execution service for lifecycle handlers. Nested execution through
`ExtensionToolContext.executeTool()` is available during tool execution.
[Event bus](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/event-bus.ts),
[extension contracts](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts),
[loader](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/loader.ts).

**(Recommended) Preserve explicit evidence identity and narrow internal reads, then choose the
public integration with a real companion.** The core's recall operation already requires bounded
reading and scope checks. Those responsibilities can inform a later interface without publishing a
generic plugin framework now. A fixture consumer can test the eventually selected boundary; it
should not become an excuse to invent requirements unsupported by a use case.

This does not preclude an optional runtime API or shared reader library. Extract shared code when
multiple packages need the same behavior. Select whether the first companion depends on the core
when its evidence requirements are concrete.

## Persistence for the smaller core

The former package's external store supported editable files, topic and learning maintenance,
independent publication, and durable revisions. The new core has fewer responsibilities. Its storage
choice should be reevaluated against those responsibilities rather than inherited by name.

| Candidate                              | Fit for the selected core                                                                                        | Cost or uncertainty                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi custom session entries              | Keeps derived records with the host's lineage and persisted source history; public append/read operations exist. | Session lifetime, forks, corruption, repeated snapshots, context edits, and in-memory sessions need explicit rules. No human-editable memory-file contract comes for free. |
| Separate files                         | Supports inspection and editing independently of Pi's session representation.                                    | Adds cross-store consistency, branch attachment, source references, locking, and recovery.                                                                                 |
| Separate database                      | Can support broader indexing and cross-session queries.                                                          | Adds schema/index lifecycle, deployment, backup, and reconciliation before the core needs broad knowledge search.                                                          |
| Session records plus rebuildable index | Keeps one evidence authority while accelerating retrieval.                                                       | Index invalidation and rebuilding still need a contract; no measured need for it yet.                                                                                      |

**(Recommended) Prefer session entries as the next design candidate if editable external memory is
outside the MVP.** Pi retains recorded source through compaction, and custom entries do not enter
model context automatically. A single accepted observer result could associate snapshot,
observations, and coverage in one record; the exact commit and failure semantics still need
specification. This is not a claim that Pi supplies a transactional memory database.

The external-file option remains reasonable if independent retention or manual file curation is a
hard requirement. The storage recommendation therefore depends on settling those requirements first.
A generic abstraction over every candidate would increase the MVP without resolving their behavioral
differences.

Sources:
[session storage](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[extension state management](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/extensions.md#state-management).

## What the earlier decisions still teach

The [decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) and recorded tiered-memory
positions describe a different, larger package. They remain useful evidence of failure mechanisms.
They are not obsolete merely because the new core has less functionality.

| Recorded position                                                                                           | Original reason                                                                                                                           | Consequence for the new design                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Keep MVP caching within memory](https://github.com/kvnxiao/orbis/issues/12#issuecomment-5808141625)        | Preserve native triggers, cut, and fallback; defer optimizing native/provider summarization.                                              | Keep this constraint. Current provider capabilities do not make a second compaction owner compose safely.                                                                    |
| [Append complete memory revisions](https://github.com/kvnxiao/orbis/issues/12#issuecomment-5808979268)      | Give the acting model a self-contained current note while retaining a stable earlier prefix; accept accumulated input and bounded resets. | The user selected checkpoint-only presentation for the new core. The former ordinary-request note-fitting/reset rules no longer follow automatically.                        |
| [Use the newest completed registration](https://github.com/kvnxiao/orbis/issues/12#issuecomment-5879378417) | Prevent an older refresh from restoring stale validity and counts.                                                                        | Preserve the invariant that delayed work cannot restore old state. The external registry and refresh protocol need not be copied.                                            |
| [Block ambiguous or changed lineage](https://github.com/kvnxiao/orbis/issues/12#issuecomment-5879378739)    | Prevent a proposal based on an older or damaged selection from rolling back current memory.                                               | Pending observer results still require source/selection validation under whichever persistence scheme is chosen.                                                             |
| [Recover orphan heads conservatively](https://github.com/kvnxiao/orbis/issues/12#issuecomment-5884541595)   | Publication order and a matching base did not prove that an orphan belonged to the current conversation.                                  | Avoid inventing content ancestry from publication order. Session storage may remove a separate publication head, but its own ancestry and corruption rules still need tests. |

The earlier request-time abort and stale-note cancellation were responses to their surrounding
presentation and curation contract. [The continuity analysis](continuity-and-invariants.md) explains
why they should not transfer unchanged. This is a scope-dependent reassessment, not evidence that
the earlier decisions were irrational.

## A possible product family

`@orbis/memory` remains the selected core name. Future names should describe user-visible jobs, for
example project knowledge or developer preferences, once those jobs are defined. No companion name,
count, or dependency graph is selected by this research.

The package README can explain three separate layers of behavior: Pi manages conversation history
and native compaction; the core prepares continuation and source recall; optional companions assess
broader knowledge. Provider compaction is a separate API mechanism, not a synonym for any of these
products.

## Decisions still required

Settle curation and source lifetime before choosing persistence guarantees. Define the actual recall
surface before publishing a consumer interface. Define broader knowledge admission and correction
when a companion is designed. These dependencies allow the core to remain extensible without making
future knowledge maintenance part of its first release.
