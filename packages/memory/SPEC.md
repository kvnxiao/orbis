# Memory

## Status and purpose

**Approved behavioral contract; runtime implementation pending.** This specification defines
`@orbis/memory` for independent implementers. The package prepares context for continuation after Pi
compaction and provides recall of earlier evidence within the selected session lineage.

The MVP owns continuation and evidence access. Project knowledge, developer habits, cross-session
retrieval, topic consolidation, generated journeys, and user curation of derived memory are outside
its scope. The [research](docs/research/README.md) explains evidence and trade-offs.

Reference baseline: Pi 0.99.1's public
[extension](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts)
and
[session](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/session-manager.ts)
capabilities. This is not a runtime compatibility claim.

## Concepts

Pi owns conversation history and compaction. The **selected lineage** is the ancestry selected by
resume, fork, or tree navigation. **Original evidence** is recorded source; **effective text** is
its content after applicable Pi context edits. A **checkpoint** precedes retained recent history
following compaction. Pi generates native checkpoints; extensions can supply custom checkpoints.

An **observer** proposes updates to a **continuation snapshot**, the state needed to continue work,
and source-linked **observations**, retained accounts of events and findings. An **active
obligation** is a goal, constraint, unfinished task, or waiting condition. **Accepted state** is
validated memory reconstructed from the selected lineage. **Recall** retrieves observations or
original evidence on demand. Processing coverage identifies accepted source processing; it does not
prove semantic preservation.

## Requirements

### Session continuity — `REQ-session-continuity`

A package checkpoint must provide the applicable native information categories: goals and scope;
constraints and preferences; completed, active, paused, and blocked work with verification state;
decisions and rationale; next actions and critical context; relevant exact identifiers; prior
checkpoint information; split-turn context; and cumulative file information.

The semantic snapshot is self-contained. Observations remain available for recall without becoming
mandatory checkpoint sections. Recall cannot compensate for omitted critical continuation context.
Distinguish intent, attempts, results, and verified completion. Preserve attribution and instruction
authority; retain original wording where paraphrase would weaken constraints or acceptance criteria.

Compare information and subsequent actions with native Pi. Token count alone does not establish
parity, quality, or lower total cost.

### Session observations — `REQ-session-observations`

One observer response proposes snapshot changes and observations. Each job receives the full active
obligation set and bounded effective-text inputs. Eligible inputs follow Pi's text compaction scope,
including assistant thinking and tool arguments, tool-result text, included custom messages, and
derived checkpoint or branch-summary text. Images remain original evidence under Pi retention; text
processing must not claim image coverage. Arbitrary extension state is not conversation input.

References identify the source session, entry, content portion, and effective version or edit.
Process bounded portions of oversized text without claiming coverage of omitted content. Observing a
summary establishes coverage of that derived text, not its originals.

Validate and accept a complete response as one logical operation: snapshot changes, observations,
coverage, and an operation identity in one versioned Pi custom entry. A valid response with no
changes may advance coverage. Invalid or partial output applies nothing. Reuse operation identity
for uncertain retries, reconcile an ambiguous append before further commits, and apply each accepted
operation once during reconstruction. Scheduling or receiving a partial response is not acceptance.

### Continuation snapshot — `REQ-current-work-note`

Accepted obligations persist unless an explicit evidence-linked proposal adds, amends, completes,
cancels, or supersedes them. Omission and age preserve them. Natural-language cancellation and
supersession can support retirement without a special user command. Every observer update reviews
the active set; valid references provide traceability, not proof of a correct interpretation.

Present the complete snapshot through checkpoints, without routinely injecting background revisions
into ordinary requests. When a checkpoint exceeds capacity, use bounded presentation condensation
that preserves required information and leaves accepted obligations unchanged. If it still cannot
fit, report native fallback. Do not repeat an identical failed repair until relevant accepted state,
evidence, or configuration changes.

Observation may continue accepting supported retirement while its inputs fit. If the full active set
exceeds the observer input budget, suspend observation and report the need for an admissible model,
budget, or lineage. Presentation condensation cannot repair that input limit.

### Source recall — `REQ-source-recall`

Expose `memory_recall` with `browse`, `search`, and `read` actions. Support independent discovery of
original text and observations without requiring an extracted identifier first. Search uses literal
text with explicit case sensitivity; document chronological ordering. Bound search work, page size,
and returned content. Use opaque references and cursors tied to lineage and effective source view.

Preserve attribution and distinguish historical originals from effective content, including known
omissions or replacements. Omission alone does not retire an obligation. Report no matches,
unavailable sources, stale cursors, invalid arguments, and bounded partial results distinctly.
Retrieval does not grant additional instruction authority. The acting agent chooses when recall
helps; the MVP uses neither an auxiliary retrieval model nor vectors or a generated filesystem
mirror.

### Session lineage — `REQ-session-lineage`

Pi custom session entries are authoritative and follow Pi retention. Reconstruct accepted state on
resume; indexes may be rebuilt. Validate selected ancestry as well as identity, since forks can copy
entry IDs into a different session. Reject pending results whose lineage, effective source, or
accepted-state basis became stale. Disabling memory cancels package work and prevents late commits.

A native or external checkpoint may establish an attributed derived baseline without replaying the
entire archive. Preserve existing accepted obligations and track original-source coverage
separately. Resolve known invalidations or missing facts from original evidence when needed; a
summary cannot silently repair them.

Malformed, unsupported, or inconsistent memory records stop reconstruction at the last trustworthy
state. Do not accept descendants of an invalid dependency. Report degradation and use native
compaction until trustworthy eligibility is restored; original recall remains available where
provenance is valid. Pi append can change memory before persistence fails, and ephemeral or
unflushed sessions can lose records. Do not promise transactional rollback or crash durability.

### Unified compaction — `REQ-unified-compaction`

Preserve Pi's automatic settings, prepared `firstKeptEntryId`, and incoming `willRetry`. Through
`session_before_compact`, use this pipeline for automatic, manual, SDK, and extension calls that
reach the hook:

1. Use an eligible prepared snapshot; perform bounded observer catch-up when coverage is missing.
2. Recheck source coverage, freshness, required content, and size. Condense presentation when
   needed.
3. Use accepted state and Pi's prepared inputs to shape checkpoint presentation under supplied
   instructions, including relevant split-turn context, without changing accepted state. Do not
   initiate archive search. Report requested detail that cannot be supplied.
4. Return one complete eligible checkpoint, or decline for whole-checkpoint native fallback while
   the host attempt remains active. Never append a native summary of the same evidence to a custom
   checkpoint. Report the fallback reason separately from its eventual outcome.

Catch-up, condensation, and instructed generation share one foreground deadline, including waiting,
inference, validation, and rechecking. They use the resolved observer model policy with explicit
routing, credential resolution, and cancellation handling. Native summarization has separate host
controls. Missing helper credentials need not invalidate an already eligible candidate. A helper
timeout can permit decline; host cancellation ends the attempt. Throwing or cancelling the hook is
not a general fallback mechanism.

A **file inventory** records recognized file-operation invocations, not proof of successful effects
or arbitrary shell changes. Provide deterministic cumulative file information in custom checkpoints
and a bounded, request-local supplement to native checkpoints while enabled. Reconcile repeated file
blocks and keep the inventory fixed to the checkpoint boundary; later operations remain in recent
history. Report unavailable or incomplete inventory. This model-facing supplement does not repair
stored checkpoints, TUI rendering, or native metadata inheritance. Use public context
transformation, not undocumented preparation-object mutation.

Single checkpoint ownership is an operating assumption. Later handlers can replace a candidate;
`turn_end` and `agent_before_settle` drafts bypass the usual compaction hooks. Check selected stored
identity and ownership rather than relying on summary text or `fromHook`. Treat other writers'
checkpoints as derived evidence. Failure reporting must also work without a preceding before-hook.

### Modular memory — `REQ-modular-memory`

The core works independently. Preserve evidence identity, attribution, scope, and verification state
for bounded internal reads. Session observations do not automatically become general project facts
or developer preferences. Defer a public companion or external-retrieval API until a concrete
consumer establishes its needs; no fixture companion or generic plugin framework is required.

### Resource budgets — `REQ-resource-budgets`

Package loading alone does not enable auxiliary inference. `/memory on` enables it; new sessions
default to disabled. Persist enablement and the selected observer model with the lineage; forks
inherit the state at their branch point. Unless settings specify a model, select the acting model at
activation. Pin configuration per job and make explicit configuration changes visible.

Provide status, disablement, and configuration inspection through commands usable interactively and
noninteractively, with validated file-based settings. Status reports the effective model, coverage,
pending work, capacity degradation, and fallback reasons. No settings dialog is required.

Enforce documented finite limits on observation, foreground preparation, retries, concurrency,
checkpoint size, and recall. Account for auxiliary work, failures, fallback, recall, and acting work
without double-counting; mark unavailable usage as unknown. Keep fixed checkpoint rendering
idempotent and deterministic, background revisions out of the acting prefix, tool definitions
stable, and stable observer instructions/schema before variable inputs. Lineage correctness and
required corrections take precedence over cache stability.

## Implementation-defined choices

Document record and argument schemas, source-reference encoding, remaining command spelling,
settings locations and precedence, reload triggers, scheduling, and model-aware numerical defaults.
These choices must preserve the requirements above; they cannot introduce unbounded work, change the
lineage's selected model implicitly, or silently weaken failure reporting. Provider-specific prefix
reuse, replay/warming, and immutable checkpoint segments are post-MVP experiments.

## Conformance scenarios

Use local fixtures and scripted providers for automated checks, with no real-model calls. An early
scripted native-baseline harness is recommended for host mechanics. Live continuation comparisons
require separate authorization, finite budgets, and supervision; mechanical tests cannot establish
semantic quality or provider-cache savings.

| Requirement                | Input and action                                                                                                                                                   | Expected evidence                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`   | Compact representative histories with corrections, blockers, identifiers, prior summaries, and split turns; continue work.                                         | Native-category comparison and subsequent actions reveal omitted constraints, revived abandoned work, or false completion.                                           |
| `REQ-session-observations` | Process edited text, a derived summary, and image-bearing records; exercise valid empty, partial, invalid, and retried responses.                                  | Exact accepted coverage, no implied image/original coverage, one logical update, and idempotent recovery after an uncertain append.                                  |
| `REQ-current-work-note`    | Omit an active obligation, then supply evidence of supersession; exceed presentation and observer-input budgets separately.                                        | Omission preserves state; supported retirement changes it; bounded repair, visible degradation, unchanged-input suppression, and input suspension behave distinctly. |
| `REQ-source-recall`        | Search for an omitted identifier, page through originals and observations, and change the selected view.                                                           | Attributed discovery, bounded work/output, explicit partial or unavailable results, and stale-cursor rejection.                                                      |
| `REQ-session-lineage`      | Resume, fork, navigate, edit source, or disable during pending work; introduce corruption and an external checkpoint.                                              | Correct ancestry and model/enablement inheritance, stale-result rejection, trustworthy-prefix recovery, and a derived baseline without invented original coverage.   |
| `REQ-unified-compaction`   | Exercise hook entry paths, both retry values, missing coverage/credentials, instructions, deadline/abort, external drafts, and repeated custom/native transitions. | Preserved settings and cut, one eligible checkpoint or reported fallback, bounded fixed inventory, actual-owner checks, and handling of unpaired failure events.     |
| `REQ-modular-memory`       | Use continuation and recall with no companion installed.                                                                                                           | Independent operation and attributed session evidence without broader-knowledge promotion.                                                                           |
| `REQ-resource-budgets`     | Load disabled, enable and resume, change configuration, exceed limits, and complete cancelled work; compare request fixtures.                                      | Explicit activation, pinned jobs, finite work, rejected late commits, stable request construction, and honest usage reporting.                                       |

## Explored alternatives

- **Native summary plus memory sections for the same evidence:** duplicates checkpoint content.
- **Routine snapshot injection:** adds changing ordinary-request state and another capacity path.
- **Separate gap summarizer:** adds a representation and acceptance protocol beside the observer.
- **Dropping obligations to fit:** can hide unfinished work or weaken constraints.
- **Mandatory archive replay or search during compaction:** adds cost and recovery dependencies;
  attributed derived baselines and optional recall cover the MVP needs.
- **Additional stores, vectors, knowledge maintenance, and speculative companion APIs:** expand the
  core before a concrete consumer or evaluation establishes their value.
