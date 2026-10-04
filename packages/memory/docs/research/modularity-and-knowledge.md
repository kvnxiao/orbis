# Modularity and future knowledge packages

Research date: 2026-10-04. The selected core prepares session continuation and provides evidence
recall. A future companion can turn experience into project knowledge or developer habits without
making that processing a prerequisite for the core. This document compares integration directions;
it records the selected session-entry storage direction but does not approve a public companion API,
persisted record schema, or additional package name.

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

**Selected direction: preserve explicit evidence identity and narrow internal reads; defer the
public companion integration until a concrete consumer needs it.** The core's recall operation
already requires bounded reading and scope checks. Those responsibilities can inform a later
interface without publishing a generic plugin framework now. A fixture consumer can test the
eventually selected boundary; it should not become an excuse to invent requirements unsupported by a
use case.

This does not preclude an optional runtime API or shared reader library. Extract shared code when
multiple packages need the same behavior. Select whether the first companion depends on the core
when its evidence requirements are concrete.

## Persistence for the core MVP

The MVP follows Pi session retention and defers user curation of derived records. It needs to
persist accepted continuation state and retrieve eligible evidence within that scope. Editable
files, independent retention, and broader knowledge indexes would introduce additional
responsibilities.

| Candidate                              | Fit for the selected core                                                                                        | Cost or uncertainty                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi custom session entries              | Keeps derived records with the host's lineage and persisted source history; public append/read operations exist. | Session lifetime, forks, corruption, repeated snapshots, context edits, and in-memory sessions need explicit rules. No human-editable memory-file contract comes for free. |
| Separate files                         | Supports inspection and editing independently of Pi's session representation.                                    | Adds cross-store consistency, branch attachment, source references, locking, and recovery.                                                                                 |
| Separate database                      | Can support broader indexing and cross-session queries.                                                          | Adds schema/index lifecycle, deployment, backup, and reconciliation before the core needs broad knowledge search.                                                          |
| Session records plus rebuildable index | Keeps one evidence authority while accelerating retrieval.                                                       | Index invalidation and rebuilding still need a contract; no measured need for it yet.                                                                                      |

**Selected direction: use Pi custom session entries as authoritative core storage.** Pi retains
recorded source through compaction, and custom entries do not enter model context automatically. A
single accepted observer result could associate snapshot, observations, and coverage in one record;
the exact commit and failure semantics still need specification. This is not a claim that Pi
supplies a transactional memory database.

Independent retention or manual file curation could justify a different store in a future product.
They are outside this MVP. A generic abstraction over every candidate would increase the core
without resolving the candidates' behavioral differences.

Sources:
[session storage](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[extension state management](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/extensions.md#state-management).

## State validity and delayed work

Pi's selected ancestry can change while an observer runs. Stored order and callback completion order
do not establish that a result belongs to the current selection. These are design obligations for
any persistence option:

- Accept a delayed result only when its source and selected-lineage assumptions are still valid.
- Prevent an older result from replacing newer accepted state.
- Distinguish invalid or unavailable state from a valid empty result.
- Use conversation ancestry when deciding which evidence is eligible; publication order alone is
  insufficient.

The exact acceptance and recovery protocol remains open. These obligations follow from the selected
lineage requirement and Pi's asynchronous lifecycle; they do not require an external registry,
publication-head protocol, or general recovery framework.
[Session manager](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[extension lifecycle](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts).

## Companion-specific integration obligations

A companion managing editable files needs its own revision and conflict policy. A direct tool-call
guard or cooperating writer queue does not prevent shell writes or external editors. File existence
also does not establish project trust; public `ctx.isProjectTrusted()` supplies the host's trust
state when project-local behavior depends on it.
[Extension contracts](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts).

Pi's default session discovery is keyed by working directory, not an Orbis-defined project root.
Cross-session knowledge therefore needs an explicit scope/index policy. Repository basenames are not
unique, and deliberate forks can cross directories. Define applicability from actual identity and
user intent rather than imposing an absolute path-equality rule.
[Session discovery](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[adapter examples](agent-memory-systems.md#pi-adapters-and-operational-footprint).

Structured task identities, dependencies, and validated transitions are another possible companion
or workflow capability. They may help when prose repeatedly loses task relationships, but introduce
transition maintenance and can still encode an incorrect model judgment. The core's explicit
obligation preservation does not require a general task-management system.

A public integration API for external retrieval is a selected post-MVP follow-up. Basic internal
reads should preserve identity, attribution, scope, and unavailable-source outcomes so that a real
consumer can define that API later. Vector indexes, query-time reasoning, and separate knowledge
stores remain optional companion mechanisms, not prerequisites for the core's `recall` tool.

## A possible product family

`@orbis/memory` remains the selected core name. Future names should describe user-visible jobs, for
example project knowledge or developer preferences, once those jobs are defined. No companion name,
count, or dependency graph is selected by this research.

The product has three distinct responsibilities: Pi manages conversation history and native
compaction; the core prepares continuation and source recall; optional companions assess broader
knowledge. Provider compaction is a separate API mechanism, not a synonym for any of these products.

## Decisions still required

Define the record schema, source availability, and exact bounded browse/search/read contract within
Pi session retention. Design the public companion interface, broader knowledge admission, and
correction policy when a concrete companion needs them. These dependencies allow the core to remain
extensible without making future knowledge maintenance part of its first release.
