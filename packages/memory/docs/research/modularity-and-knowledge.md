# Modularity and future knowledge packages

Research date: 2026-10-04. **Design inference:** This document compares integration options for
future knowledge companions based on inspected host and companion mechanisms. The
[core contract](../../SPEC.md) defines current behavior.

## Separate the product responsibilities

Continuation concerns the acting model's next action in the selected conversation. Knowledge
maintenance decides which claims apply beyond that conversation, why they are credible, and when
they stop applying. The
[session-observations contract](../../SPEC.md#session-observations--req-session-observations) keeps
the latter outside the core. The [memory-layer analysis](memory-layers.md) and
[system comparison](agent-memory-systems.md) show why scope, promotion, and correction need separate
policies.

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

The [core scope](../../SPEC.md#status-and-purpose) defers a public interface until a concrete
consumer supplies its evidence needs. The options above remain useful when that need is defined.

## Persistence for the core MVP

Pi session retention provides the core's storage scope. Editable files, independent retention, and
broader knowledge indexes introduce additional responsibilities.

| Candidate                              | Fit for the selected core                                                                                        | Cost or uncertainty                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi custom session entries              | Keeps derived records with the host's lineage and persisted source history; public append/read operations exist. | Session lifetime, forks, corruption, repeated snapshots, context edits, and in-memory sessions need explicit rules. No human-editable memory-file contract comes for free. |
| Separate files                         | Supports inspection and editing independently of Pi's session representation.                                    | Adds cross-store consistency, branch attachment, source references, locking, and recovery.                                                                                 |
| Separate database                      | Can support broader indexing and cross-session queries.                                                          | Adds schema/index lifecycle, deployment, backup, and reconciliation before the core needs broad knowledge search.                                                          |
| Session records plus rebuildable index | Keeps one evidence authority while accelerating retrieval.                                                       | Index invalidation and rebuilding still need a contract; no measured need for it yet.                                                                                      |

The [session-lineage contract](../../SPEC.md#session-lineage--req-session-lineage) selects Pi custom
entries. They survive compaction but do not enter model context automatically. Pi's append path does
not supply a crash-durable transaction; the
[host audit](pi-compaction.md#persistence-and-selected-lineage) records its limits.

Sources:
[session storage](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[extension state management](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/extensions.md#state-management).

## State validity and delayed work

Pi's selected ancestry can change while an observer runs. Stored order and callback completion order
do not establish that a result belongs to the current selection. The
[lineage contract](../../SPEC.md#session-lineage--req-session-lineage) therefore requires a
selection check before acceptance. Pi's session manager and extension lifecycle expose the relevant
change points.
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

A public external-retrieval API is deferred. Internal reads preserve identity, attribution, scope,
and unavailable-source outcomes; the eventual consumer can define its interface from those needs.

## A possible product family

Pi manages conversation history and native compaction. The core prepares continuation and source
recall. Optional companions may assess broader knowledge. Provider compaction is a separate API
mechanism. Companion names and count depend on defined user-facing jobs.
