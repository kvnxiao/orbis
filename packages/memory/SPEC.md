# Memory

## Status and purpose

**Draft: approved direction, incomplete behavioral contract.** This specification is for developers
and coding agents designing `@orbis/memory`. No runtime implementation is provided by this package.
Open decisions below must be resolved before dependent implementation.

The package preserves effective continuation across Pi compaction and provides recall of earlier
evidence. It is independently useful and forms the core for future complementary packages that
maintain project knowledge or developer habits across sessions and projects.

The MVP prepares memory within the selected session lineage. It does not automatically promote
session evidence into project or developer knowledge. Topic consolidation, a generated journey, and
project-learning maintenance are outside this core MVP.

The `REQ-*` sections state the settled design constraints. Their conformance scenarios identify
required evidence, not completed tests. Open decisions are unresolved behavior, not permission for
an implementer to choose silently. The [research synthesis](docs/research/README.md) is informative.

## Concepts and responsibilities

Pi owns the branching conversation history and compaction lifecycle. A **checkpoint** is the summary
Pi places before retained recent history after compaction. A **native checkpoint** is produced by
Pi's summarizer; a **custom checkpoint** is supplied by this package. **Native fallback** means
allowing Pi to produce the whole checkpoint.

An **observer** processes conversation evidence before it leaves recent context. Its response
updates a **continuation snapshot**, the current-work note needed for the next action, and records
**observations**, source-linked accounts of relevant events and findings. **Recall** retrieves older
observations or original evidence when the acting model needs more detail.

The **selected session lineage** is the conversation ancestry selected through resume, fork, or
session-tree navigation. A future **companion package** may use session evidence to maintain broader
knowledge. Its interface and dependency on this package remain open.

## Settled behavior

### Session continuity — `REQ-session-continuity`

Effective continuation is the primary objective. After compaction, the acting model must receive at
least the kinds of information that native Pi's checkpoint provides. Equivalence is qualitative;
matching native token count or cost is not the criterion.

The comparison covers:

- The goal, scope, constraints, and preferences.
- Completed, in-progress, paused, and blocked work, including verification state.
- Decisions and their rationale, next steps, and critical continuation context.
- Exact paths, identifiers, and error text when relevant to continuation.
- Information preserved through repeated summaries, split-turn context, and file-operation lists.

The checkpoint must present the information needed to continue. Recall supplements that information;
it does not establish parity merely by making omitted critical context theoretically retrievable.
The exact allocation among snapshot, observations, and deterministic rendering remains open.

### Session observations — `REQ-session-observations`

One observer response maintains the continuation snapshot and source-linked observations. The acting
agent does not perform routine memory maintenance. Older observations remain available for recall
without requiring consolidation into topics or reflections.

Processing coverage and semantic preservation are distinct. A processed source span does not prove
that the observer retained every relevant fact. Coverage eligibility, commit atomicity, and source
formats need a complete contract before implementation.

### Current-work note — `REQ-current-work-note`

The continuation snapshot records the operative objective, active constraints, superseding
corrections, pending or paused work, confirmed completion and verification state, and the next
continuation point or waiting condition. Older active obligations must not expire merely through
age.

The complete snapshot appears in checkpoints. The package does not routinely inject successive
snapshot revisions between compactions. Exact schema, freshness rules, and oversized-snapshot
handling remain open.

### Source recall — `REQ-source-recall`

Recall provides bounded access to retained observations and original evidence within the permitted
scope. It must allow recovery of original evidence when an observation omitted a detail. Retrieved
evidence preserves attribution and must not grant new instruction authority or turn attempted work
into confirmed completion.

Search behavior, reference formats, missing-source results, and tool arguments remain open. The
acting agent uses recall when needed, rather than as a required maintenance step on every turn.

### Session lineage — `REQ-session-lineage`

Memory follows the selected session lineage through resume, forks, and tree navigation. Abandoned
branch evidence must not silently become current working state. Pending observer results must not be
committed to a different selected lineage.

The persisted format, source-retention guarantees, and reconstruction protocol remain open.

### Unified compaction — `REQ-unified-compaction`

Pi retains ownership of native automatic compaction settings and triggering. The package preserves
the prepared `firstKeptEntryId` boundary and the host's `willRetry` decision.

A custom checkpoint must not embed, append, or restate a native Pi summary of the same messages.
This exclusion does not settle whether an unprocessed span may be summarized separately. The package
needs explicit behavior for manual compaction, automatic compaction, overflow, and
`/compact <instructions>`.

Eligibility, catch-up, fallback, correction, and failure behavior remain open. The previous
package's cancellation and fallback rules are not implicitly adopted by this draft.

### Modular memory — `REQ-modular-memory`

The core must remain useful without complementary knowledge packages. Its design must permit future
packages to use evidence for developer habits, project learnings, retrospectives, and reflections
without making those capabilities part of core continuation.

Knowledge maintenance must distinguish session-specific evidence from generally applicable claims.
Companion names, package count, dependency direction, and public integration contracts remain open.
A generic plugin framework is not implied by the modularity goal.

### Resource budgets — `REQ-resource-budgets`

Automatic preparation, checkpoint size, and recall output require finite bounds. The evaluation
accounts for auxiliary work and fallback rather than comparing only acting-model tokens.

Budget defaults, retry policy, deadlines, cancellation, and pressure handling remain open. Ordinary
automated tests must not call real models or incur model charges. Live evaluations require separate
explicit authorization and supervision.

## Open decisions

| Area                     | Decision required before implementation                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Native parity            | Allocate every native information category; preserve prior checkpoints, split turns, exact details, and cumulative file operations. |
| Unprocessed evidence     | Choose bounded observer catch-up, a summary of only the uncovered span, native fallback, or a defined combination.                  |
| Fallback                 | Define each trigger and observable report, including unavailable credentials, invalid output, cancellation, and failed correction.  |
| Snapshot capacity        | Compare condensation, priority sections, and fallback; define failure without copying the old ordinary-request abort.               |
| Manual instructions      | Define how `/compact <instructions>` is honored without duplicating a native summary.                                               |
| Correction               | Handle stale prior checkpoint material while preserving Pi's retry decision; determine whether a host change is needed.             |
| Persistence and curation | Choose session entries or external storage; define inspection, correction, deletion, source lifetime, and user-edit ownership.      |
| Companion integration    | Choose a minimal evidence-consumption contract and whether the first companion depends on this core.                                |
| User controls            | Define activation, model selection, configuration, status, and any commands; do not inherit an old interface by default.            |
| Evaluation               | Define category-level parity checks, continuation scenarios, failure reporting, and finite evaluation budgets.                      |

## Conformance scenarios

These scenarios constrain the completed design. They do not make the unresolved contract
implementation-ready.

| Requirement                | Input and action                                                                                                                                | Expected evidence                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`   | Compact a history with an old active constraint, a correction, a blocker, decisions, exact identifiers, and a split turn; continue actual work. | Compare each native category and subsequent actions; report omissions, false completion, and incorrect continuation.                                  |
| `REQ-session-observations` | Process an eligible source span, then let older observations leave checkpoint selection.                                                        | One response updates snapshot and observations; committed older evidence remains available for recall.                                                |
| `REQ-current-work-note`    | Change objectives between two compactions while an earlier obligation remains active.                                                           | Ordinary turns receive no routine full-snapshot injections; the next eligible checkpoint preserves the current objective and still-active obligation. |
| `REQ-source-recall`        | Search for an exact error omitted from observations after its source leaves recent context.                                                     | Recover original eligible evidence with attribution, or report its unavailability under the chosen source contract.                                   |
| `REQ-session-lineage`      | Navigate to another branch while an observer result is pending, then resume and fork.                                                           | Reconstruct only eligible state and reject a result belonging to the abandoned selection.                                                             |
| `REQ-unified-compaction`   | Exercise manual, automatic, overflow, and instructed compaction with both host retry values.                                                    | Preserve settings, boundary, and retry behavior; produce one nonduplicative checkpoint under the completed recovery contract.                         |
| `REQ-modular-memory`       | Use the core alone, then exercise the selected integration with a fixture consumer.                                                             | Core continuation works independently; the consumer can assess evidence without silently promoting its scope or authority.                            |
| `REQ-resource-budgets`     | Use scripted providers that exceed chosen limits or finish after cancellation.                                                                  | Enforce declared finite limits and reject stale output without real-model calls.                                                                      |

## Explored alternatives

- **Native summary plus memory sections for the same messages:** rejected because it duplicates
  content instead of making the package's checkpoint itself sufficient.
- **Routine full-snapshot revisions between compactions:** excluded from this MVP to simplify
  presentation and avoid the associated ordinary-request capacity mechanism.
- **Topics, journey, and project learnings inside the core:** deferred to keep continuation and
  evidence recall independently useful. Broader knowledge maintenance remains a future goal.
- **Naming the package for tiers or session scope:** use `@orbis/memory` so the package name
  reflects the broader product family; documentation defines the core's actual scope.
