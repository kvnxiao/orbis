# Tiered memory

`@orbis/tiered-memory` helps a Pi agent continue the intended work across repeated compactions and
user steering (instructions that refine or redirect ongoing work) while using bounded context. It
retains detailed history outside the prompt and makes relevant recorded details retrievable. The
same compaction policy applies to manual `/compact`, automatic threshold compaction, and automatic
overflow compaction.

**Status:** Experimental minimum viable product (MVP) with partial implementation. The extension
provides activation commands, trusted configuration loading, resource settings, memory-model
resolution, and persisted status reports. The [usage guide](docs/usage.md) describes these controls.
Automatic observation, consolidation, memory storage, recall, and custom compaction are unavailable.
The requirements below define the complete intended system; the available controls do not establish
full conformance or model quality. The contract targets independent Pi extension implementers using
the public capabilities inspected in **Pi 0.87.0**.

The `REQ-*` requirements and their contract tables define conformance. Scenarios describe observable
checks of those requirements. The [research synthesis](docs/research/README.md) and the evaluation
variants section are informative. Commands execute actions or print text; the package does not
require a custom terminal interaction document.

Independent implementations must document their selections wherever this contract permits a choice,
including storage records, source splitting or deferral, and search indexing. The documentation must
describe the selected behavior and any consequences for usage, recovery, or compatibility. Permitted
choices do not relax the requirements.

**Contents**

- [Purpose and terms](#purpose-and-terms)
- [Architecture choices](#architecture-choices)
- [Memory and persistence](#memory-and-persistence)
- [Recall and authority](#recall-and-authority)
- [Compaction contract](#compaction-contract)
- [State ownership and curation](#state-ownership-and-curation)
- [Activation, models, and costs](#activation-models-and-costs)
- [Conformance scenarios](#conformance-scenarios)
- [Evaluation variants](#evaluation-variants)

## Purpose and terms

Effective continuation is the primary objective. The agent should retain the intended work, apply
still-relevant constraints and corrections, and resume pending work without drifting or requiring
the user to reconstruct the session. Simplicity, low acting-agent ceremony, total token cost, and
foreground waiting are secondary objectives. A smaller prompt that causes more task drift does not
satisfy the primary objective.

Compaction is inherently lossy. The extension minimizes loss that affects continuation while keeping
active context and auxiliary work bounded. “Never-ending sessions” describes effective continuation
across many finite context windows, not an infinite prompt, perfect recall, or proof about every
future turn and model.

| Term                                     | Meaning in this contract                                                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source evidence and source span          | Recorded user or assistant messages, tool results, or available artifacts; a span identifies the portion assigned to a memory job. A recorded claim is not automatically true.                                                                  |
| Session lineage                          | The selected path through Pi's conversation tree. Abandoned branches remain historical, and navigation does not rewind repository files.                                                                                                        |
| Effective context                        | The selected conversation after Pi applies recorded context edits that replace or omit messages. Raw entries remain historical evidence; editing context does not undo recorded external actions.                                               |
| Observation                              | A compact, source-linked record of a request, decision, correction, attempt, result, or other session event.                                                                                                                                    |
| Active observation pool                  | Committed observations selected for routine context, before older records are consolidated. Historical observations remain retrievable after leaving the pool.                                                                                  |
| Consolidation                            | An auxiliary model pass that proposes updates to longer-lived notes from selected observations.                                                                                                                                                 |
| Topic and journey                        | A topic describes a session subject in detail; the journey briefly describes progress through the session. Neither is a separately protected task-state register.                                                                               |
| Project learning                         | Reusable repository knowledge with evidence and applicability, distinct from temporary session status. It can persist across sessions without being included in every prompt.                                                                   |
| Index and recall                         | An index advertises bounded descriptions and source references. The read-only `recall` tool searches or reads detailed records when visible evidence is insufficient.                                                                           |
| Compaction and checkpoint                | Compaction reduces active conversation context. A checkpoint is the persisted summary and memory snapshot used with Pi's retained recent messages afterward.                                                                                    |
| Processing coverage                      | A record that assigned source spans completed and committed. It does not prove semantic completeness or useful continuation.                                                                                                                    |
| Memory revision                          | A committed version of notes and their associated metadata. Writers compare revisions to reject stale proposals.                                                                                                                                |
| Working state                            | The operative objective, constraints, corrections, decisions, pending or paused work, and known artifact/verification state needed for the next action.                                                                                         |
| Observer, consolidator, and acting agent | The observer extracts evidence; the consolidator proposes note changes; the acting agent performs the user's work. Extension code commits accepted memory proposals.                                                                            |
| Protected current-work note              | A bounded, source-linked summary of working state with reserved prompt space. It stays separate from historical topics and is updated in the observer's existing response. “Protected” describes retention priority, not infallible extraction. |

When eligible, the extension supplies a **custom checkpoint** in place of Pi's generated summary.
Otherwise it permits Pi's native summarizer to produce a **native checkpoint**; this delegation is
**native fallback**. A **worker** runs an observer or consolidator model job. The **controlled
writer** is extension code that validates and commits those workers' proposals.

Memory purpose, persistence, scope, and prompt access are independent dimensions. An old session
decision can remain durable session memory; it does not become a project learning through age. A
project learning can remain in storage and enter context only when relevant.

### Session continuity — `REQ-session-continuity`

**Continuation outcome.** A successful continuation after compaction or steering advances the latest
operative objective, retains earlier requirements that still apply, respects active constraints,
applies superseding corrections, and distinguishes pending work from confirmed completion. When the
next action needs missing or conflicting historical evidence, the agent must recover that evidence
or identify the gap before relying on an invented detail.

Observation, consolidation, and recall instructions must prioritize these work-state facts over
routine progress narration. Age alone must not be treated as evidence that a constraint or pending
obligation is obsolete. The protected current-work note gives these facts separate retention
priority without an additional acting-agent maintenance tool.

**Verification obligations.** Mechanical invariants and model-quality outcomes require distinct
verification. Scripted tests verify source coverage, persistence, bounds, scope, cancellation, and
revision checks. Supervised continuation evaluations verify whether the model uses the retained
information correctly. A complete processing marker or a successfully stored note is not proof of
semantic preservation.

**Evaluation obligation.** The implementation must provide the reproducible comparison protocol and
results described below. Missing protocol inputs, omitted required metrics, unreported failures, or
an unreproducible comparison fail this obligation. Measured task failures remain results to report
and investigate; no minimum success rate or improvement over native Pi is required.

The experimental implementation must support reproducible comparison with native Pi, with the
extension unloaded in the baseline and enabled from session start in the treatment. Paired runs
start from equivalent repository state, task history, acting model, tools, native settings, and
declared prior knowledge. Isolate their session and memory stores and count auxiliary preparation.
Before scoring, the protocol declares fixture versions, steering, model configurations, scoring
rules, repetitions, resource limits, exclusions, and a finite work horizon. Sample sizes and run
budgets belong to that protocol; this contract sets no numerical MVP quality or efficiency gate.

The evaluation includes controlled runs with manual compaction at matched milestones and runs with
automatic compaction under the same native settings. Automatic compaction counts may differ and are
measured outcomes. Histories must exercise corrections, distractions, paused work, old active
constraints, and actual repository actions after relevant evidence leaves recent context. Questions
about remembered facts are supporting diagnostics.

Report final correctness against task obligations and repository checks, partial completion,
continuity failures, constraint violations, repeated work, false completion, and user intervention.
Report total task tokens and known cost, compaction attempts and outcomes by origin and mechanism,
end-to-end time, and foreground waiting. Include failed runs, auxiliary calls, native summaries,
fallback, retries, and repair; do not double-count recalled tokens or host-reported worker usage.
Label unavailable accounting and pricing. Report paired results and uncertainty across histories and
repetitions without treating checkpoints in one history as independent trials.

Comparison data and its interpretation guide subsequent iterations. Negative, mixed, and
inconclusive results are valid experimental outcomes; proving superiority over native compaction is
not a completion prerequisite. Mechanical conformance remains required, and improvement claims
require evidence for the evaluated configurations and horizon. Live evaluations remain separately
authorized, supervised, and outside ordinary automated test discovery.

## Architecture choices

Current-work preservation and historical organization are separate decisions. The current-work
policy determines what remains routinely visible. The history policy determines how older detail is
condensed and found again. All compared policies can retain original source evidence.

### Current-work preservation

These approaches can share observations, topic notes, project learnings, and recall. The letter
labels identify alternatives within this comparison; the requirements use their concrete names.

| Approach                             | Representation of current work                                                                                                                   | Additional maintenance                                                                                       | Status                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **A: protected current-work note**   | A separately retained note summarizes the operative objective, active constraints, and pending or paused work alongside observations and topics. | The observer updates it in the existing response; reserved context, revision, and freshness checks add cost. | Selected MVP.                                         |
| **B: observations and topics alone** | Current intentions and constraints use ordinary observations and topic notes without a separately retained work note.                            | Automatic observation and consolidation; conditional read-only recall.                                       | Optional evaluation baseline.                         |
| **C: structured task state**         | Explicit task identities, statuses, dependencies, and permitted transitions describe current work.                                               | Validate and maintain task transitions as well as memory.                                                    | Outside the MVP; requires a separate design decision. |

A gives current work separate retention priority, but its writer can omit a constraint or leave the
note stale. B has fewer competing representations, but ordinary consolidation can make an old active
obligation harder to find. C adds precise state transitions, but correctness depends on selecting
the right transitions and maintaining more state. Evaluation compares continuation first and then
the cost of achieving it.

### Historical organization

| Policy                            | How it represents older detail                                                                                              | Trade-off                                                                                                                                              | Selection                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Topic consolidation               | Older observations become detailed subject notes and a short journey; an index exposes their subjects.                      | Detailed bodies stay outside routine context, but discovery, validity, and source links require explicit rules.                                        | Selected alongside the protected current-work note. |
| Accumulated reflections           | Conclusions append alongside references to supporting observations; separate decisions remove observations from active use. | Conclusions remain directly available, but growing reflections need bounds, correction, and retirement. More model-directed removal can add inference. | Comparative research only.                          |
| Repeated observation condensation | A model periodically rewrites the active observation log into a smaller representation; new observations append afterward.  | The active log can remain bounded, but repeated rewriting can omit details or commitments; retained originals permit later recovery.                   | Comparative research only.                          |

### Selected architecture

The MVP combines **observational memory with a protected current-work note and topic
consolidation**. The observer extracts source-linked observations and proposes the work-note update
in one response. The consolidator files older observations into topics, updates the descriptive
journey, and proposes reusable project learnings. Extension code validates and commits these
outputs, then renders a bounded checkpoint and index. The acting agent retrieves detail through
`recall`.

The protected note uses the session scope and has reserved context space. Project learnings remain
separate and can be shared through Git. Neither note type changes instruction authority or requires
the acting agent to perform routine memory maintenance.

| Actor               | Responsibility                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Pi host             | Own the conversation, compaction preparation and triggers, committed compaction entries, and native overflow retry. |
| Acting agent        | Perform the user's work and invoke `recall` when relevant evidence is missing.                                      |
| Observer            | Propose source-linked observations and the current-work note update from newly eligible session spans.              |
| Consolidator        | Propose session-topic, journey, and project-learning changes from selected observations.                            |
| Controlled writer   | Validate proposals, scope, revisions, and cancellation before committing memory.                                    |
| Checkpoint renderer | Compose a bounded snapshot from committed memory without another model call when the required inputs are ready.     |
| Recall service      | Search and read allowed records with bounded output and explicit source references.                                 |

The MVP does not require structured task tracking, embeddings, a graph database, provider compaction
endpoints, a separate learning-review model, or acting-agent memory maintenance tools. Updating the
work note in the observer response avoids a required extra call; it does not eliminate its added
input/output tokens, validation, or recovery cost.

The [continuity analysis](docs/research/continuity-and-invariants.md) and
[implementation comparison](docs/research/observational-memory-comparison.md) explain the evidence
behind the alternatives without adding requirements.

## Memory and persistence

### Memory scopes — `REQ-memory-scopes`

The extension distinguishes purpose from lifetime:

| Memory                      | Purpose and scope                                                                                 | Routine context policy                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Recent conversation         | Current instructions and recent actions on the selected Pi lineage                                | Pi retains a complete recent tail.                                                                                |
| Protected current-work note | Operative objective, constraints, corrections, and pending or paused work on the selected lineage | Reserved context in valid custom checkpoints and subsequent requests; newer visible instructions take precedence. |
| Session observations        | Decisions, corrections, attempts, outcomes, constraints, and unfinished work in this session      | A bounded active pool participates in checkpoints.                                                                |
| Session topics and journey  | Detailed session subjects and a short descriptive account of progress                             | The journey and a bounded topic index participate; detailed topic bodies require recall.                          |
| Project learnings           | Reusable repository knowledge with stated applicability and evidence                              | A bounded index advertises relevant entries; bodies require recall.                                               |
| Original evidence           | Recorded conversation and available referenced artifacts                                          | Read on demand; compaction and consolidation do not delete it.                                                    |

Durable session history does not become a project learning merely through age or consolidation.
Project learnings persist across sessions in the same repository. The MVP does not automatically
transfer learnings between unrelated repositories or maintain a global personal-learning store.

The extension accounts for memory responsibilities through these allocations:

| Responsibility                | Pi or repository contribution                           | Extension responsibility or boundary                                                                                                             |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working context               | Current instructions, recent messages, and tool results | Bounded checkpoint and index; correct continuation is evaluated under `REQ-session-continuity`.                                                  |
| Episodic memory: experience   | Original session transcript and selected lineage        | Source-linked observations, topics, journey, and historical recall.                                                                              |
| Semantic memory: facts        | Current repository files and authored context           | Evidence-bearing project learnings with correction and applicability rules. Semantic memory does not require semantic search.                    |
| Procedural knowledge: methods | Authored skills, code, templates, and instructions      | Verified recipes remain retrievable knowledge. Automatic skill generation, policy rewriting, and model-weight updates are outside this contract. |
| Active intentions             | Current requests and retained conversation              | The protected current-work note retains the operative objective, constraints, and unresolved work alongside historical observations.             |
| Detailed archive              | Recorded messages and available artifacts               | Bounded lookup and explicit missing-source results; the archive remains outside routine context.                                                 |

Scope, authority, and correction apply across these responsibilities. They are not additional
content tiers. General document indexing, organization-wide learning, and automatic procedural
modification introduce responsibilities beyond continuation within the selected project. Their
exclusion does not remove Pi's existing authored instructions, skills, or ordinary repository tools.

The project root is the current Git worktree root, or the session working directory outside Git.
Nested repositories have separate roots. Separate worktrees use their own local memory directories;
tracked learning files may be shared through Git. Git branch changes do not establish continued
applicability of every learning. Session resumption in another root must not silently associate the
old root's project memory with the new root.

### Memory storage — `REQ-memory-storage`

Project-local files use these public boundaries:

| Location relative to the project root | Content                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `.pi/tiered-memory/sessions/`         | Session-private current-work note, historical notes, source indexes, and recovery data as needed. |
| `.pi/tiered-memory/learnings/`        | Human-readable project learning files and their index.                                            |
| `.pi/tiered-memory/settings.json`     | Optional project settings.                                                                        |

Session observations and checkpoint metadata may use Pi's persisted custom entries. Original Pi
session files remain valid source storage; the extension need not duplicate the entire transcript
under the project directory. It must retain resolvable references to the recorded source spans it
processes and report unavailable sources explicitly.

Pi's `pi.appendEntry` stores custom data outside model context; `pi.sendMessage` stores a custom
message that can enter model context. The implementation must document its record selection and
preserve the specified lifetime of each record: private metadata stays out of routine context, while
durable continuation messages remain available to later native compaction.

Source records may include references to non-text attachments. Retaining an attachment reference
does not establish that a memory model interpreted its contents. When the selected worker cannot
process source material, report that capability limit and do not advance processing coverage over
the unsupported material. Custom checkpoint eligibility must account for the unsupported span
through an applicable prior checkpoint or native fallback. General multimodal continuity requires
separate qualification of the host, worker model, and recall representation; text-based checks do
not establish it.

Automatic compaction and consolidation must not prune original session records or historical
observations. Disk use may grow with session history. Moving observations out of the active pool
changes prompt selection, not their availability for historical recall.

Learning files must be usable without access to the originating private session. They contain the
claim, applicability, and enough non-secret evidence or reproduction context to assess it. Optional
private source references may be unavailable to collaborators; the index must not imply otherwise.
The extension must not copy raw transcripts, worker prompts, or session-private topic bodies into
the shareable learning directory as a storage shortcut.

Users choose which paths Git tracks or ignores. The extension must not alter ignore rules, stage,
commit, push, or synchronize memory automatically. Documentation must explain that a parent `.pi/`
ignore can also exclude learnings, and that Git recovery requires previously committed content.

Persisted state must include enough format and scope information to validate it on load. On an
unsupported or damaged record, preserve the bytes, report the affected memory, and exclude it from
custom checkpoint eligibility where its meaning or coverage cannot be established. Storage layout
below the public directories and internal record encoding are implementation-defined and must be
documented.

### Session observations — `REQ-session-observations`

When completed conversational activity accumulates an eligible source batch, the extension schedules
observation extraction automatically. The acting agent does not need to invoke a maintenance tool.
Scheduling must resume after startup or resumption and after completed turns, subject to activation
and resource limits.

Each job uses an immutable source interval, selected lineage, effective-context source revisions,
and model/settings revision. Current instructions come from the effective context; replaced or
omitted raw text must not be restored as active instructions. Raw records may still document actual
actions and side effects, identified as historical evidence. Source preparation must preserve
attribution, ordering, and tool-call/result relationships. When an individual recorded result
exceeds the worker input budget, the implementation must split or defer it with explicit coverage
accounting; silently marking an unseen suffix as processed is invalid.

Observer instructions must distinguish user requests, questions, proposals, actual actions, observed
results, corrections, and completion claims. They must ask for exact identifiers and constraints
when those affect later work. A failed command must not be described as a successful operation.

Source preparation must preserve available source-time context: when a statement was recorded and
any event time or applicability interval supplied by its evidence. Observer instructions must anchor
relative-time expressions to that source context when unambiguous and preserve uncertainty without
inventing dates or timezones otherwise. Later processing, retry, or recall must not by itself make
old evidence supersede newer evidence. Accurate extraction and temporal interpretation are
model-quality obligations to evaluate, not guarantees established by output syntax.

Accepted observations contain source references and enough ordering information to interpret
supersession. Preserve available source-time context with accepted observations, either in their
records or through resolvable source metadata, and supply it to later consolidation. The writer
validates that references belong to the assigned source interval. Only after committing a complete,
valid result may it mark an interval processed. Empty extraction can record that a span was
processed, but it cannot by itself justify an empty replacement checkpoint.

Malformed, truncated, timed-out, cancelled, or uncommitted results do not advance successful
processing coverage. Later successful intervals must not conceal an earlier gap. Retries must not
duplicate accepted observations.

Generated checkpoints, injected memory, recalled excerpts, and extension status messages must not be
re-extracted as independent evidence. New user corrections or new tool observations about recalled
material remain eligible sources.

### Current-work note — `REQ-current-work-note`

The protected current-work note records the operative objective and scope, active constraints,
superseding corrections, pending or paused work, relevant confirmed completion and verification
state, and the next continuation point or waiting condition. Its instructions must distinguish
completed work from plans, attempts, and blocked work. Elapsed time or movement into an older topic
does not establish completion or retire an unresolved obligation.

Each observer request receives the previous committed note and its evidence references alongside the
new assigned source span and any applicable native checkpoint needed for continuity. The observer
proposes observations and a note update in the same response. An explicit unchanged result preserves
the note's content; an explicit empty working state records that no active work is identified.
Neither result bypasses output validation. The previous note supplies continuity state, not
independent evidence for new claims. Retained claims keep their source references; additions and
corrections cite the assigned sources. When an applicable native checkpoint supplies claims whose
original spans have not been processed, the observer may carry those claims into the note as derived
checkpoint evidence. Preserve the checkpoint reference and any available original links; do not
invent direct-source verification or mark its unseen original spans processed. This refresh uses the
ordinary bounded observer path without requiring a separate recovery model or full replay.

The writer commits accepted observations, the updated or unchanged note, and their processed source
boundary as one consistent revision. Invalid, truncated, oversized, or uncommitted note output
leaves the previous revision intact and does not advance that batch's successful coverage. A valid
format and source boundary do not prove that the observer retained every relevant obligation.

The note identifies its session lineage, revision, and source boundary. Newer instructions in Pi's
retained conversation take precedence over the note. Observation may remain asynchronous while that
newer evidence is visible. Before compaction discards newer working-state evidence, the extension
must refresh the note within the bounded preparation allowance or use native compaction with an
explicit warning. A previous native checkpoint may supply already-compacted working state, but a
later custom checkpoint requires a note that accounts for it as well.

Valid custom checkpoints reserve space for the current-work note. Subsequent model requests expose
the latest valid note with its source boundary as the sole current working summary. During request
assembly, the extension must suppress older embedded note revisions or mark them historical, and it
must avoid injecting redundant copies of the same revision. Persisted checkpoints remain unchanged.
Newer retained user instructions take precedence over the latest note. When curation or fallback
invalidates the current note, an older embedded revision must not become current again.

Optional historical detail and index entries yield to the note's reserve. A note that cannot fit its
configured bound invalidates the candidate checkpoint; rendering must not silently truncate it.
Before each acting request, account for the current model's context limit, instructions, tools,
retained conversation, and generation headroom. Remove optional memory first. If the complete valid
current-work note still cannot fit, preserve committed data and stop that acting request before
provider dispatch. On Pi 0.87.0, record the capacity cause in extension status, call the public
`ctx.abort()` method, and let the context callback return without waiting for the session to become
idle. Pi reports this through its ordinary abort path; the extension's status record distinguishes
the capacity stop from user cancellation. Preserve an already established user or host cancellation
cause rather than relabeling it as a capacity stop. Report recovery options, such as explicit
compaction or selecting a model with sufficient context. Do not silently omit the note, discard
retained conversation to make it fit, or start an automatic compaction or retry loop. Inside an
already prepared compaction, an oversized candidate uses native fallback under the compaction
contract. The reserve remains finite, and model-generated omissions remain a continuity evaluation
concern.

Only the observer and the controlled writer update the note automatically. Topic consolidation does
not rewrite the note or remove it from active context. User curation remains authoritative over
automatic file updates: preserve external edits or deletion and reject proposals based on the prior
revision. When a curated note cannot supply a valid current snapshot, report the conflict, exclude
the invalid note, and use native fallback when compaction is requested. An absent or invalid note
does not itself require stopping an ordinary request that can use the committed checkpoint and
retained conversation. After native fallback, an outdated note remains stored but must not be
injected as current working state; the native checkpoint and retained conversation supply
continuation until a valid note is available.

### Topic consolidation — `REQ-topic-consolidation`

When the active observation pool exceeds its configured consolidation threshold, the extension
selects older observations for a bounded consolidation pass. The consolidator proposes session-topic
updates, a journey that summarizes session progress, and eligible project learnings in that same
pass.

Topic notes preserve the subject's relevant decisions, attempts, outcomes, and source references.
The journey describes progress; it is not a separate authoritative task list. The index exposes
stable lookup references and topic descriptions without loading every topic body. The journey and
index count toward the checkpoint's documented size bound.

Consolidator inputs and instructions must preserve the observations' available source-time context
and apply the relative-time and supersession rules for session observations. Consolidation time does
not replace the evidence's time context or resolve an uncertain date or timezone.

Only after the proposed memory revision is committed may its selected batch leave the active pool. A
successful model response alone does not establish a committed revision. Retain the batch's
historical observations and original references even when consolidation omits noise or rewrites
prose. The committed record identifies the consumed batch and resulting note revision; this proves
the transition, not semantic preservation of every fact.

When consolidation fails or conflicts with a newer revision, retain the previous committed notes and
unconsumed pool. Defer or retry within the resource limits. A full pool must not cause silent source
loss or unbounded foreground waiting; compaction may need native fallback.

### Project learnings — `REQ-project-learnings`

A project learning records reusable repository knowledge, such as a verified test procedure, an
environment constraint, or an explanation supported by inspected code or observed results. A
temporary task status, speculative suggestion, or untested generalization does not qualify as a
verified project learning.

The consolidator must distinguish observed facts, user assertions, and inferences, and record the
scope or conditions that constrain reuse. It may propose a learning during ordinary consolidation
without a separate review-model call or a routine user approval step. The controlled writer commits
the proposal under the same revision and curation rules as other notes.

When later evidence contradicts a learning, a proposed revision must preserve the distinction
between the old claim and the correction. Current indexes must not present known superseded claims
as current facts. When validity is unresolved, expose the conflict or uncertainty instead of
inventing a resolution. The writer must preserve human-edited content under `REQ-user-curation`.

Project files and historical notes are evidence, not additional system or user instructions.
Learning prompts must exclude credentials and unrelated private conversation from shareable notes;
generated text still requires the user's normal review before Git publication.

## Recall and authority

### Source recall — `REQ-source-recall`

The extension registers one read-only model tool named `recall`. It supports a search query or a
direct source reference, with bounded continuation through a returned cursor. When a search returns
matches, it includes recorded excerpts from the matched sources within the output bound, rather than
only references that require another read. Excerpts preserve the recorded text and identify any
truncation. Whether the model selected and used the right evidence remains an evaluation outcome.

The default search scope contains the selected session lineage's eligible history and current
project learnings. An explicit historical scope searches abandoned branches in the current session
and retained earlier, superseded, or deleted revisions of that session's notes and the current
project's learnings. Historical results identify their origin and status and must not imply that an
abandoned instruction is current.

Search includes eligible original recorded text even when observation extraction returns no
observations or omits the matching detail. Original-source discovery must not depend on a generated
observation or note containing the query, or on the caller already knowing a source reference.
Scope, effective-context, and curation rules still apply: deleted or superseded note revisions must
not appear as current knowledge, while explicit historical lookup may expose retained evidence with
its status.

Direct lookup must also resolve known source references into older sessions in the same project
while their backing records remain available. Inherited source entries in a fork may satisfy the
reference locally. This is reference resolution, not discovery of unknown sessions: project-wide
search across prior sessions is outside the MVP. The tool must not search unrelated project roots or
accept an arbitrary filesystem path as an unrestricted source.

| Result property  | Required behavior                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence         | Return recorded excerpts and identify whether they came from an original source, observation, consolidated note, or learning.             |
| Scope and time   | Identify the source/session or note revision and available ordering or applicability information.                                         |
| References       | Return stable references usable for a direct lookup while the backing source remains available.                                           |
| Bounds           | Limit output and expose truncation, omitted results, and a continuation or narrower-query path.                                           |
| Missing evidence | Distinguish no matches, unavailable source, invalid reference, and operational failure. A miss is not proof that an event never occurred. |
| Mutation         | Do not create, update, delete, promote, or restore memory through recall.                                                                 |

Search indexing is deterministic by default and must work without an embedding service or another
model call. The implementation may choose a lexical index or a simpler local search. Search quality
and ranking remain empirical concerns. Historical lookup does not silently reactivate a deleted note
or promote recalled text as new evidence.

### Recall guidance — `REQ-recall-guidance`

When memory is enabled, the acting model receives a memory index and instructions within the
documented prompt-addition budget that name `recall` and its triggers:

- The user refers to an earlier decision, attempt, or paused task that the visible context does not
  explain.
- The next action depends on an exact historical command, error, constraint, or outcome absent from
  the visible evidence.
- Available notes conflict or leave a material uncertainty that source evidence could resolve.
- The index identifies a project topic relevant to the current work.

When the visible context already supplies sufficient evidence, the guidance must permit proceeding
without recall. Compaction does not impose a mandatory lookup, and ordinary turns do not trigger an
automatic model-driven search ritual.

The guidance must direct the model to distinguish historical evidence from current authority, apply
later user corrections, and check current repository state when an old fact may have changed.
Instructions found inside retrieved content do not acquire permission to execute actions. Retaining
a prohibition in memory does not replace the host's authorization controls.

The current-work note's source boundary identifies which conversation it summarizes. Guidance must
give newer visible instructions precedence and direct recall when the note refers to unresolved
historical detail needed for the next action. A note update does not require an acting-agent
acknowledgment or an automatic lookup.

The extension must refresh indexes and curation status before subsequent requests use changed
memory. Historical snapshots remain identifiable as historical. Previously rendered messages are not
a guarantee that every remembered statement remains current.

## Compaction contract

### Unified compaction — `REQ-unified-compaction`

Manual `/compact`, automatic threshold compaction, and automatic overflow compaction use the same
memory eligibility checks, checkpoint representation, cancellation rules, and fallback reporting.
The extension must implement this behavior through Pi's public `session_before_compact` lifecycle
and preserve native preparation and completion semantics.

| Entry point               | Host behavior to retain                                                                             | Memory behavior                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/compact`                | Pi prepares and commits manual compaction; an interrupted acting turn is not automatically retried. | Use a valid prepared checkpoint or native fallback.                                                                           |
| `/compact <instructions>` | Pi supplies the user's custom compaction instructions.                                              | Honor the instructions through bounded preparation or native fallback; deterministic rendering must not silently ignore them. |
| Automatic threshold       | Pi checks context pressure and schedules native compaction.                                         | Apply the same coverage and checkpoint rules without requiring a command.                                                     |
| Automatic overflow        | Pi controls recoverable overflow compaction and its permitted retry.                                | Apply the same rules and preserve the host's retry decision and retry bound.                                                  |

Loading or disabling this extension must not disable native automatic compaction or alter its
settings. When the user disables native auto-compaction, the extension must keep it disabled and
must not introduce a parallel overflow-retry loop. The MVP does not require an independent earlier
compaction trigger or a replacement `/compact` command.

Pi supplies `willRetry`, a boolean indicating whether the host plans to retry the acting request
after compaction. Preserve that decision rather than deriving it from the compaction reason.

The initial implementation must preserve Pi's prepared retained-message boundary and valid
tool-call/result relationships. A split turn has its earlier messages summarized while Pi retains
its later messages. The extension must account for the complete discarded prefix, any split-turn
prefix, and previously compacted context. An earlier valid memory snapshot or native checkpoint can
supply the already-compacted portion; later custom checkpoints must not silently omit it.

Before returning a custom checkpoint, validate that its `firstKeptEntryId` equals the prepared
identifier and belongs to the selected lineage's retained boundary. Pi stores the supplied
identifier without validating branch membership. An invalid identifier can omit the earlier retained
tail from subsequent context; a successful append does not establish a valid boundary.

For integration details, use the pinned
[Pi compaction API](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts)
and
[native lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).
Model/authentication resolution before the hook remains a host prerequisite.

### Checkpoint eligibility — `REQ-checkpoint-eligibility`

Before returning a custom checkpoint, the extension must establish that:

- Every source span being replaced has committed processing coverage or is represented by an
  applicable previously committed checkpoint. Failed or merely scheduled spans do not qualify.
- The selected current-work note, observations, topics, journey, and source boundaries refer to a
  consistent committed snapshot on the active lineage and remain valid for its effective context.
- The current-work note accounts for working state through the discarded span, including applicable
  prior checkpoints, and fits its reserved budget. Newer retained instructions remain authoritative.
- The checkpoint is nonempty, structurally valid, and within the acting model's available input
  budget alongside instructions, tools, retained messages, and generation headroom.
- Custom instructions have been incorporated, or the request is delegated to native compaction.

The custom checkpoint contains the protected current-work note, bounded journey, session-topic and
project-learning indexes, selected active observations, and any prior checkpoint material still
needed for coverage. Detailed topic bodies remain available through recall. Once inputs are ready,
ordinary rendering must not require another model call.

Only work required for the candidate discarded span may delay compaction, and that wait must end by
a finite deadline. Catch-up extraction is permitted within that deadline and the ordinary call
budget. Compaction must not wait for unrelated queued work or an unbounded history replay.

Coverage establishes that assigned evidence was processed and committed. It does not prove that the
model retained every important fact. Status output and documentation must preserve this distinction.
Native fallback also produces a lossy summary and is not a semantic guarantee.

### Compaction fallback — `REQ-compaction-fallback`

When a custom checkpoint is unsafe because of missing coverage, empty or invalid memory, unavailable
sources needed for preparation, a stale or invalid current-work note, exhausted budgets, or failed
worker output, the extension must decline replacement and permit Pi's native summarizer. Until its
content is otherwise covered, a previous native fallback must remain part of the next checkpoint.

Before native fallback proceeds, emit an explicit warning identifying the memory failure and the
planned native fallback. After Pi reports the compaction outcome, record whether native compaction
succeeded, failed, or was cancelled. A worker error toast or a generic compaction-success message is
insufficient. If the host never prepares a compaction, do not report that a checkpoint was created.

When the user or host cancels compaction, propagate cancellation, stop attempt-owned work, and
reject late commits. Cancellation must not initiate an unwanted native fallback or retry. Keep the
last committed memory intact. Disabling memory during preparation may delegate an otherwise live
request to native Pi; it must not revive an already cancelled request.

Outcome classification must combine the captured cancellation signal with host completion or failure
events. A host failure flag must not reclassify a known cancellation as a non-cancellation failure.
Preserve Pi's supplied retry decision; an overflow reason alone does not imply a retry.

Another extension that replaces the same checkpoint is an unsupported competing owner unless
explicit compatibility is established. Document that boundary and report detected ownership
conflicts. Pi 0.87.0 does not expose a complete exclusive-owner registry, so the implementation must
not claim universal detection or silently claim that another extension's checkpoint was its own.

## State ownership and curation

### Session lineage — `REQ-session-lineage`

On startup, resume, fork, and conversation-tree navigation, reconstruct session memory from the
selected lineage and its committed revisions. Current-work, topic, and journey snapshots must match
that lineage; live files from an abandoned future must not silently replace an earlier snapshot.

Before each commit, verify the captured session identity, lineage generation, source interval and
effective-context revisions, settings/model revision, and expected note revisions. A changed
dependency invalidates the result. A context edit affecting assigned evidence invalidates pending
proposals and any derived current state that no longer matches the effective context. Navigation
before an edit reconstructs that earlier effective context without treating abandoned-future
instructions as current. The extension must not restore replaced or omitted instructions from raw
history. Stopping or switching a session must cancel owned work and prevent its results from
entering the new session. Resumption may retry incomplete source intervals within normal budgets and
must not duplicate completed intervals.

Project learnings describe repository knowledge and are not rewound by conversation navigation. They
retain source and applicability information, and must not turn an abandoned session proposal into a
current instruction. A Git checkout does not rewind the Pi conversation or validate all existing
learnings.

Concurrent sessions may update the same project learnings. A commit must check the current revision
under mutation coordination; a losing proposal must preserve the committed content and defer or
recompute. A multi-note consolidation is eligible for checkpoint use only after its complete
revision is durable. After interruption, recovery must expose a complete prior or new revision,
without consuming observations for a partially committed proposal.

### User curation — `REQ-user-curation`

Treat external edits and deletions as intentional curation. Because the extension cannot reliably
identify whether an external writer was a person, editor, or shell process, unknown external changes
receive the same preservation policy.

When a managed note changes outside the controlled writer, preserve its text, refresh or invalidate
its derived index, and reject proposals based on the older revision. Automatic consolidation may
record new observations, but must not overwrite the curated body. If the format is unusable,
preserve it and report why it is excluded.

When a user deletes a note, remove it from current indexes and prevent the same previously processed
evidence from silently recreating it. New evidence may justify a new note, provided its source is
distinguished from the deleted note's consumed evidence. Missing expected files or directories on
resume must not trigger blind regeneration from old snapshots. Curation exclusions apply across
conversation navigation and delayed worker results.

Known corrections and invalidation must remain available to subsequent request assembly and native
compaction, including while memory is disabled. A persisted checkpoint remains historical evidence;
its embedded obsolete note must not regain current authority when request-time memory is no longer
injected. Preserve the correction or exclusion in durable continuation state before a later
compaction can consume the older snapshot. Recording this state must not require a model call.

Deleting a derived note does not delete Pi's original transcript or every historical snapshot.
Default lookup excludes deleted or superseded note revisions as current knowledge; explicit
historical lookup can still expose retained evidence with its status. The extension must not promise
secure erasure or Git recovery for never-committed content.

### Controlled writes — `REQ-controlled-writes`

Observer and consolidator models propose data and changes; extension code validates and commits
them. These model roles must not receive unrestricted filesystem mutation tools. A valid proposal
cannot bypass scope, revision, curation, or cancellation checks.

The acting agent receives read-only `recall` and guidance against direct maintenance of managed
memory. The extension must block its ordinary direct `write` and `edit` calls targeting managed
memory, including resolved path aliases within that guard's supported filesystem boundary. A blocked
call explains that automatic observation records the conversation and that direct file maintenance
belongs to user curation.

These guards do not provide a complete filesystem sandbox. Arbitrary shell commands and
nonparticipating tools can still change files. When the extension detects those changes, it must
preserve them as external curation. The implementation must document supported guards without
claiming to infer intent or prevent every possible mutation.

## Activation, models, and costs

### Activation controls — `REQ-activation-controls`

When loaded, the extension is enabled by default. `/tiered-memory on` and `/tiered-memory off` set
the current session's activation override. Resume restores that override; a new unrelated session
uses settings defaults. `/tiered-memory` and `/tiered-memory status` print status without toggling.
Unknown arguments print supported usage and do not change state.

When disabled, stop automatic extraction, consolidation, new memory injection, and custom checkpoint
replacement; cancel pending memory writes and retain stored records. Native Pi compaction remains
available. `recall` must not read memory while disabled and must return an explicit disabled result
if an outstanding or stale call reaches it. The direct managed-file guards remain protective of
stored memory. Keep Pi's committed continuation checkpoint and retained conversation, including
active constraints and known corrections or invalidation that must survive later native compaction.
Disabling does not erase that continuation state or start a model call. Re-enabling selects the
latest checkpoint on the active lineage, including native compactions made while disabled, and
schedules only bounded catch-up. Report any coverage gap; an older stored work note must not replace
the newer continuation state.

The package loads personal defaults from `tiered-memory.json` in Pi's resolved agent configuration
directory and project overrides from `.pi/tiered-memory/settings.json`. Defaults apply first,
supplied personal fields next, supplied trusted project fields next, and the session activation
override last. Determine project trust through Pi's public `ctx.isProjectTrusted()` result,
including temporary host trust decisions. Ignore project overrides while the project is untrusted
and report that exclusion with the effective configuration sources. Configuration loading must not
execute project-supplied code. The package must not claim integration into native `/settings` on Pi
0.87.0.

Settings must support `enabled`, independent observer/consolidator model overrides, and the bounded
resource controls described below. Omitted model overrides mean the active session model. The
implementation must document exact field names, units, numeric defaults, validation, and effective
configuration paths. Numeric defaults are implementation-defined finite policy values chosen to fit
resolved model limits; invalid or impossible budgets must not be silently accepted.

Settings are read on session start and extension reload. A running job retains its captured
settings; reload invalidates jobs whose dependencies changed. If replacement configuration is
invalid and a valid effective configuration exists, the extension must retain the valid
configuration. Without a valid prior configuration, suspend automatic memory work and report the
error while native Pi remains available. Status identifies which scope supplied each effective
override. Commands do not rewrite settings files.

### Model selection — `REQ-model-selection`

By default, each observer or consolidator job uses the active session model at dispatch. Users may
override either role independently with a provider/model identifier resolved through Pi's public
model registry and configured credentials. A model change affects newly dispatched work and must not
mix an obsolete in-flight result into a revision that requires the new configuration.

Memory extraction must work through ordinary in-process completion calls without requiring
provider-specific compaction APIs, hosted memory services, subprocess agents, or a proprietary
model. A local acting model and local memory models must permit operation without a cloud fallback.
Unresolved model identifiers, missing credentials, and provider failures must be reported; the
extension must not silently substitute another provider or model.

Only complete validated output may commit. Model quality remains distinct from protocol support:
structurally valid output can omit facts or misinterpret evidence. Original-source recall and
previously committed records must remain usable after a worker failure. Native compaction still uses
its own resolved model and can fail independently.

Changing the memory model must not automatically re-extract the entire archive. Future targeted
re-extraction may use retained sources under explicit bounded control; it is not an MVP requirement.

### Resource budgets — `REQ-resource-budgets`

Automatic memory inference is serial by default across observer and consolidator jobs. The
implementation must bound queued work, input size, generated output, retries, job duration,
compaction waiting, the current-work note reserve, active observations, injected indexes, checkpoint
size, and recall output. Unprocessed source records remain on disk when work is deferred.

Budget selection must account for the resolved writer and acting model context limits separately.
Instructions, source material, tool schemas, retained messages, and generation headroom participate
in the applicable input budget. Estimates and unavailable provider accounting must be labeled; an
estimate is not exact usage or a billing guarantee.

The observer budget includes the previous current-work note and its proposed replacement. Usage
reports include those tokens and any repair or catch-up work. Sharing the observer response does not
establish zero overhead, and a separate routine work-note model call is not required.

The extension must expose effective limits in status and document their configuration. Bounded
retries may repair a failed proposal; exhausting them leaves the last committed memory intact and
reports the deferred work. Compaction cannot require an unbounded queue to drain. Model-invoked
maintenance loops and an additional approval or classification call per observation are outside the
MVP contract.

### Status reporting — `REQ-status-reporting`

Text status must expose activation and its source, resolved memory models, memory paths, effective
budgets, current-work note revision, source boundary and freshness or invalidation reason,
active-pool size, pending or failed work, processing gaps, last committed revision, and the latest
compaction outcome. Compaction reports identify manual, threshold, or overflow origin, custom versus
native outcome, fallback reason, cancellation, and any unverified outcome. A request stopped for
current-work-note capacity reports its cause and recovery guidance separately from user cancellation
or a completed compaction.

Usage reporting separates observer, consolidator, instruction-specific preparation, and fallback
usage where available. It distinguishes known provider usage from estimates, unknown cost, and
cached-token accounting. Timing separates auxiliary work from foreground compaction waiting.
Reporting must not require another model call.

Warnings and outcomes must remain inspectable after transient terminal notifications disappear.
Persist the latest report with session state and provide a documented Pi-supported text or event
output in noninteractive modes. A successful observer, returned `ctx.compact()` call, or rendered
candidate is not a committed-compaction success. When another owner or host failure prevents
attribution, report the outcome as unverified instead of claiming success.

## Conformance scenarios

The implementation must supply checks with expected outcomes derived from these requirements. The
harness column identifies the required verification methods:

| Harness  | Required environment and evidence                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture  | Local source, storage, and model-output fixtures exercise deterministic assertions.                                                                                                             |
| Pi       | The installed Pi host's actual session, extension, and provider-dispatch paths run with scripted in-process providers and blocked external network access. A mocked hook alone is insufficient. |
| Terminal | A supervised real Pi terminal session verifies command routing or visible status. Scripted providers can supply model responses.                                                                |
| Model    | Separately authorized and supervised real-model runs measure extraction, evidence use, or continuation quality.                                                                                 |

Fixture and Pi checks can run in ordinary automated test discovery without model charges. Terminal
and Model checks run separately under supervision. Passing scripted checks does not establish
semantic retention quality. Each listed method covers its part of a scenario; combined methods do
not require replaying every deterministic assertion with a real model.

For `REQ-session-continuity`, Fixture checks validate the protocol and result accounting, including
missing metrics and failed runs; Model checks produce comparative measurements from predeclared work
histories with repeated compactions and steering. An old still-active constraint, a later
correction, and paused work must each affect a subsequent repository action. Score the action and
confirmed completion against the source history; do not infer success from a correct summary alone.
Compare with native Pi under matched conditions and report the horizon, correctness, failures, user
repair, uncertainty, total usage and known cost, compaction counts, elapsed time, and foreground
waiting. Include negative and inconclusive results without turning an improvement hypothesis into a
numerical completion gate. This scenario establishes only the measured outcomes for the evaluated
configurations.

| Requirements                                                                                            | Initial state and action                                                                                                                                                                                               | Expected observation                                                                                                                                                                                                                                                                                | Harness               |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `REQ-memory-scopes`, `REQ-memory-storage`                                                               | Resume a session, open unrelated repositories with identical directory basenames, and open another worktree with tracked learnings.                                                                                    | Session records remain correctly scoped; only the selected root's learnings are indexed; unavailable private references are identified.                                                                                                                                                             | Fixture; Pi           |
| `REQ-memory-storage`                                                                                    | Compact and consolidate repeatedly, then read an older observation and its source; remove the backing source separately.                                                                                               | Original retained records remain addressable until removed; a missing source returns unavailable rather than fabricated evidence.                                                                                                                                                                   | Fixture; Pi           |
| `REQ-session-observations`                                                                              | Complete batches containing a correction, two distinct attempts with identical errors, an oversized result, and an empty valid extraction; retry a committed batch and fail an intervening batch.                      | Source attribution and structural boundaries persist; distinct attempts keep distinct provenance; retries do not duplicate accepted observations; unseen or failed spans remain gaps. Semantic extraction is evaluated separately against the source.                                               | Fixture; Model        |
| `REQ-current-work-note`, `REQ-resource-budgets`                                                         | Observe a changed goal, an older active constraint, paused work, and an unverified completion claim; then accept an explicit unchanged note.                                                                           | One observer response supplies observations and the note; the committed revision includes their source boundary; the note has reserved context without duplicate injection. Scripted checks verify the prompt and transaction, and supervised runs score retained working state and total cost.     | Fixture; Pi; Model    |
| `REQ-current-work-note`, `REQ-checkpoint-eligibility`                                                   | Add steering beyond the note's source boundary, then prepare manual, threshold, and overflow compactions with the steering retained or discarded; return invalid or oversized catch-up output.                         | Visible newer instructions retain precedence. Before discarding newer working-state evidence, the extension commits a valid refresh or warns and delegates to native compaction; failed output preserves the previous revision without advancing coverage.                                          | Fixture; Pi           |
| `REQ-current-work-note`, `REQ-user-curation`                                                            | Edit or delete the work note during extraction, then attempt compaction and deliver the old proposal.                                                                                                                  | External curation survives and the stale proposal is rejected. When a valid note is unavailable, native compaction supplies continuation and an outdated note is not injected as current.                                                                                                           | Fixture; Pi           |
| `REQ-current-work-note`, `REQ-recall-guidance`, `REQ-user-curation`                                     | Commit a checkpoint containing one note revision, accept a newer note without compaction, then invalidate or delete the note before the next request.                                                                  | Only the latest valid revision appears as current; older embedded revisions are suppressed or marked historical. Invalidation does not reactivate an older revision, and persisted checkpoint evidence remains unchanged.                                                                           | Fixture; Pi           |
| `REQ-topic-consolidation`                                                                               | Consolidate an overflowing pool, then repeat with invalid output and an interrupted write.                                                                                                                             | Only a complete committed revision consumes the selected pool batch; old observations remain retrievable; failure preserves the prior revision.                                                                                                                                                     | Fixture               |
| `REQ-project-learnings`                                                                                 | Record a verified repository procedure and a speculative claim in one session; supply contradictory evidence and complete consolidation in another session.                                                            | Verified and inferred status remain distinct; the shared learning and current index expose the correction or unresolved conflict with applicable scope. Inactive session notes are not automatically rewritten.                                                                                     | Fixture; Model        |
| `REQ-source-recall`                                                                                     | Search for an old error, follow a source reference and cursor, search an empty result, and submit a foreign-root reference.                                                                                            | Returned excerpts match fixture source text and carry source metadata; continuation is available; errors are distinct; foreign sources are rejected; no memory is mutated.                                                                                                                          | Fixture               |
| `REQ-recall-guidance`, `REQ-source-recall`                                                              | Present an absent old decision, sufficient visible evidence, and hostile instructions inside a recalled source.                                                                                                        | Guidance names the relevant trigger, permits skipping redundant lookup, and preserves instruction authority; scripted fixtures verify the prompt contract, supervised runs verify model behavior.                                                                                                   | Fixture; Model        |
| `REQ-unified-compaction`, `REQ-checkpoint-eligibility`                                                  | Prepare equivalent manual, threshold, and overflow compactions, including a split turn, an earlier checkpoint, and overflow with each value of `willRetry`.                                                            | Each uses the same eligibility and memory-content policy, preserves the prepared boundary and prior continuity, and retains the host's supplied retry decision and bound.                                                                                                                           | Pi                    |
| `REQ-unified-compaction`                                                                                | Use `/compact` with custom instructions; disable native auto-compaction and exceed a memory threshold.                                                                                                                 | Instructions are honored or delegated to native summarization; the extension does not override the user's native-auto setting or start its own retry loop.                                                                                                                                          | Pi; Terminal          |
| `REQ-checkpoint-eligibility`, `REQ-compaction-fallback`                                                 | For every compaction reason, inject missing coverage, empty memory, stale state, malformed output, or an exhausted wait deadline.                                                                                      | Custom replacement is declined, an explicit native-fallback warning is recorded, and the eventual native success/failure is reported accurately.                                                                                                                                                    | Fixture; Pi           |
| `REQ-compaction-fallback`                                                                               | Cancel each compaction reason while a worker is pending; deliver its result late. Also cancel native automatic fallback while its summarizer is running.                                                               | The attempt remains cancelled, no new fallback or extra retry starts, and no late attempt-owned write commits; the captured signal and host outcome consistently classify native fallback as cancelled.                                                                                             | Pi                    |
| `REQ-session-lineage`                                                                                   | Fork, navigate `/tree`, resume, and complete an old worker after a session switch; race project-learning updates.                                                                                                      | Selected session snapshots match their lineage, stale results are rejected, and a losing writer preserves newer committed content.                                                                                                                                                                  | Fixture; Pi; Terminal |
| `REQ-user-curation`                                                                                     | Edit or delete a note during consolidation; resume with a missing expected directory; revisit an earlier conversation branch.                                                                                          | Curated text and deletion exclusions survive; old evidence does not silently restore a live note; new evidence remains distinguishable.                                                                                                                                                             | Fixture; Pi           |
| `REQ-controlled-writes`                                                                                 | Attempt direct acting-agent writes and edits through ordinary and aliased managed paths, then commit a valid observer proposal.                                                                                        | Direct calls are blocked within the documented guard boundary; the controlled writer can commit valid data; shell-based changes receive the external-curation policy when detected.                                                                                                                 | Fixture; Pi           |
| `REQ-activation-controls`                                                                               | Load with defaults, set a project default of disabled, override on/off, resume, reload invalid settings, and invoke an unknown subcommand.                                                                             | Precedence and persistence match the contract; disabled work stops without deleting records; invalid settings and arguments produce explicit output.                                                                                                                                                | Pi; Terminal          |
| `REQ-model-selection`, `REQ-resource-budgets`                                                           | Use the session model, independent local overrides, an unresolved model, a context limit smaller than configured work, and repeated provider failures.                                                                 | Dispatch uses the selected model, inference remains serial by default, invalid work is bounded or suspended, and no silent cloud substitution occurs.                                                                                                                                               | Fixture; Pi           |
| `REQ-status-reporting`                                                                                  | Complete custom compaction, succeed and fail native fallback, cancel, and lose reliable outcome attribution in interactive and noninteractive modes.                                                                   | Reports distinguish origin, mechanism, reason, outcome, and known versus estimated usage; the latest report remains inspectable without a model call.                                                                                                                                               | Pi; Terminal          |
| `REQ-session-observations`, `REQ-session-lineage`, `REQ-current-work-note`                              | Replace or omit a source message through a context edit while its observer runs, then navigate before the edit.                                                                                                        | Changed effective evidence rejects the pending proposal and invalidates affected current state; raw text remains historical evidence and does not restore instructions. Navigation selects the appropriate earlier effective context.                                                               | Fixture; Pi           |
| `REQ-current-work-note`, `REQ-checkpoint-eligibility`, `REQ-compaction-fallback`                        | Fall back to native compaction with unprocessed source spans, refresh from its checkpoint and retained tail, then prepare a custom checkpoint.                                                                         | The ordinary observer can carry checkpoint-derived claims with their provenance; unseen original spans remain unprocessed; the custom checkpoint retains required prior continuity.                                                                                                                 | Fixture; Pi           |
| `REQ-current-work-note`, `REQ-resource-budgets`, `REQ-status-reporting`                                 | Switch to a smaller acting model or grow retained context until the valid mandatory note cannot fit after optional memory is removed; repeat with native auto-compaction disabled.                                     | No acting provider request is dispatched; committed data survives; the extension records a capacity cause before invoking host abort and reports recovery guidance; a pre-existing user cancellation retains its cause. No silent note truncation, conversation discard, or automatic retry occurs. | Pi                    |
| `REQ-source-recall`, `REQ-memory-scopes`                                                                | Search by default, request historical lookup on an abandoned current-session branch or retained deleted revision, follow a known older-session reference, and resolve inherited source entries after a fork.           | Default search excludes abandoned or obsolete memory as current knowledge; historical lookup labels it; available same-project references resolve without requiring project-wide prior-session discovery; missing sources remain explicit.                                                          | Fixture; Pi           |
| `REQ-activation-controls`, `REQ-user-curation`, `REQ-current-work-note`                                 | Commit a custom checkpoint, correct or invalidate its note, disable memory, perform native compaction, then re-enable.                                                                                                 | Disabling stops new memory injection and auxiliary jobs without a model call; committed continuation and known corrections remain available to native compaction; re-enabling starts from its latest result and does not restore an obsolete note.                                                  | Pi                    |
| `REQ-activation-controls`, `REQ-status-reporting`                                                       | Load project overrides with host trust denied, granted, and temporarily granted, then reload settings.                                                                                                                 | Only the host's effective trust result permits project overrides; status identifies ignored project settings and the actual source of each effective value.                                                                                                                                         | Pi                    |
| `REQ-unified-compaction`, `REQ-checkpoint-eligibility`                                                  | Supply a custom checkpoint candidate whose retained-entry identifier differs from valid preparation or is absent from the selected path.                                                                               | The extension rejects the invalid candidate before Pi persists it; native fallback retains the valid prepared boundary.                                                                                                                                                                             | Fixture; Pi           |
| `REQ-session-observations`, `REQ-topic-consolidation`, `REQ-project-learnings`, `REQ-current-work-note` | Record an observed test procedure in observations, a topic, a project learning, and the work note; observe in the active session that it skipped tests, then complete observation and consolidation.                   | Affected current notes and indexes reflect the correction or unresolved conflict without overriding curation; historical recall distinguishes prior evidence from the correction.                                                                                                                   | Fixture; Model        |
| `REQ-source-recall`, `REQ-session-observations`                                                         | Accept empty extraction for a source containing an exact error, then search for that error without its reference; repeat with a nonempty observation that omits the identifier, including after compaction and resume. | Search returns bounded original excerpts and stable references independently of generated text; existing scope, effective-context, curation, and missing-source results still apply. Searchability does not establish semantic coverage or checkpoint eligibility.                                  | Fixture; Pi           |
| `REQ-session-observations`, `REQ-topic-consolidation`, `REQ-recall-guidance`                            | Resume extraction days after a statement containing a relative date, consolidate it later, and encounter an older dated log after confirming a current setting; include sources without a usable date or timezone.     | Inputs and stored evidence retain available source-time context; prompts require source-anchored relative dates and preserve uncertainty. Supervised runs assess note meaning and subsequent actions; processing or encounter time alone does not supersede newer evidence.                         | Fixture; Model        |

## Evaluation variants

Beyond the required native-Pi comparison, optional variants include native Pi plus source recall and
observations/topics without a protected current-work note. These variants are informative and do not
add production modes. Hold the acting model, source history, retrieval policy, and budgets constant
where possible. Measure work-state retention and actual continuation alongside total usage, known
cost, compactions, elapsed time, and foreground waiting.

The protected note can still miss a constraint or become stale. Its reserved context and shared
observer call do not establish improved quality or negligible cost. Accumulated reflections,
repeated observation condensation, and structured task state remain distinct experiments; their
adoption would require a new design decision. The
[evaluation research](docs/research/evidence-and-evaluation.md) describes the supporting
comparisons.
