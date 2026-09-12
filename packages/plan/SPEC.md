# @orbis/plan specification

Status: Package contract. The implementation provides the modal frontier, option details, block
annotations, revision browsing, implementation selection, and an optional presentation hook.
Complete real-host, SSH, IME, and model-quality verification remains pending. The
[README](README.md) describes first use; the [development guide](docs/development.md) describes
compatibility checks and verification limits.

`@orbis/plan` develops a researched, user-approved Markdown plan in the user's existing Pi
conversation. Installing the package supplies the complete terminal workflow. This specification is
for independent Pi extension implementers.

## Scope

`REQ-<slug>` requirements and their contract tables define the system contract. The linked
[interaction contract](docs/tui-interactions.md) defines required TUI behavior and appearance under
the same requirement IDs. Both documents are normative; illustrative examples are labeled. Internal
types, storage layouts, tool names, and choices not prescribed by either document are
implementation-defined and must be documented where they affect usage or compatibility.

### REQ-complete-terminal-package — Complete terminal package

The package supplies planning instructions, explicit and model-initiated entry, structured question
rounds, clarification, draft recovery, Markdown review, and approval through Pi's public extension
API. The entire workflow works in local and SSH terminals without another package, application,
service, or graphical desktop.

### REQ-planning-responsibility — Planning responsibility

The package researches and develops plans, saves approved Markdown, reports approval, and starts
implementation through the owning Pi agent only on explicit user selection or implementation intent.
It does not track implementation, enforce shell permissions, or host another agent. Browser servers,
HTML rendering, browser annotation mapping, review-chat transcripts, authentication, network
delivery, and companion process management belong to separate extensions or applications. They are
not dormant features of the base package.

Research quality and frontier selection are agent-instruction obligations. The extension
independently validates identities, explicit submission, current revisions, and approval. Planning
instructions are not a security sandbox.

## Research and question rounds

### REQ-planning-entry — Planning entry

`/plan [objective]` and the `plan_open` model-callable entry operation start the same workflow in
the current conversation. Agent instructions recognize planning intent without requiring a literal
phrase. Repeated entry preserves and reopens active work, including accepted-plan review, paused
rounds, review, and unanswered clarification. Explicit natural-language requests to resume use the
same recovery path. Examples include “enter plan mode,” “help me plan this change,” “resume the
plan,” and “continue planning”; these illustrate intent rather than an exact-phrase whitelist.
Quoted examples, discussion of the feature, and unrelated messages do not authorize entry or
resumption. Ambiguous saved-plan references require a selection. When multiple saved plans are
available on the branch, `/plan` prompts for a selection. Replacing unfinished work requires an
explicit user choice and retains the previous plan. The base package registers only `/plan` and
`/plan-settings`.

`plan_open` creates or reopens collaborative planning, questions, or review; it does not start
implementation. Calls with `replace: true` require a stable, nonblank `requestId`. An exact retry of
a completed replacement reuses its result without another confirmation or plan. Ordinary entry
remains an explicit reopening action. The package does not register the former entry-tool name as an
alias.

### REQ-tool-idempotency — Tool idempotency

Question-round and Markdown-review calls identify their operation by the plan, interaction, and
expected predecessor revision. Replacement entry uses its explicit request identity. Each accepted
operation binds that identity to its exact input and records its outcome on the owning branch.
Object member ordering does not change request meaning; ordered questions and options retain their
order. Exact retries of completed operations return their recorded typed result without opening UI,
creating revisions, submitting decisions, emitting approval events, or dispatching implementation.
Different input under an existing identity fails without mutation.

Replay requires the same current planning state. When newer state supersedes an operation, replay
fails without restoring an older approval, revision, or drafts. A recorded cancellation remains
cancelled. An unfinished or uncertain operation reports its state and requires explicit opening for
recovery; a retry does not resume it automatically. Unsubmitted drafts remain unsubmitted and retain
the normal agent-result privacy boundary. Records survive reload and restoration on their saved
branch. Persistence failures remain visible; a missing terminal result does not authorize
repetition. When a recorded result includes an implementation launch, replay also requires that
launch's identity, status, and owning session to remain current for the exact approval. When the
launch changes, Plan reports an error and directs the agent to inspect its current state through
`plan_implement`.

Explicit `plan_open` and `/plan` continue to reopen saved input and approved review. New revisions
and new replacement requests use new operation identities. Implementation launches retain
REQ-launch-idempotency and its explicit restart behavior.

### REQ-composer-mode — Composer mode

The composer provides Plan and Default modes. Idle mode changes preserve typed text and do not send
input or resume work. In Plan mode, the next ordinary user message enters or resumes planning
without special wording or a slash prefix. Commands, shell input, and extension-injected messages
retain their existing routing. During an active turn, mode changes are rejected with an explanation,
and no change is queued. Messages submitted during work keep the current mode and Pi delivery
policy.

Users can configure or disable the planning shortcut. Effective host-binding conflicts preserve Pi
input and report the conflict; the package does not edit host keybindings. After reload, the
shortcut uses the effective bindings. Shortcut configuration changes require `/reload`. The
interaction contract defines the default key, rebinding prerequisite, and modal key behavior.

Default mode does not inject active planning instructions or automatically resume paused work.
Explicit planning intent remains supported in either mode. Switching to Default preserves unfinished
planning as paused work. Approval and cancellation return to Default. Approval alone does not
authorize implementation; the separate implementation action supplies that authorization. Session
restoration uses the mode recorded on the selected branch; a new session starts in Default. A custom
editor integration must compose with an existing editor and document conflicts with later
replacements.

### REQ-research-prerequisites — Research prerequisites

The owning agent investigates repository context and available sources before asking for decisions.
It distinguishes verified facts, assumptions, preferences, and unavailable evidence. Discoverable
facts are not delegated to the user. No particular search provider or subagent package is required.
When research delegation is available, the agent delegates bounded factual investigation and waits
for relevant results before presenting the frontier. Otherwise the owning agent researches directly.
Each revised frontier follows any further research required by the user's answers.

### REQ-complete-frontier — Complete frontier

The agent tracks decisions and their prerequisites. Each round contains every unresolved decision
the user can answer without guessing another open decision. Dependent questions wait. After
submission or clarification, the agent continues toward the next frontier or plan review without
asking whether to continue planning. The agent models the design as decisions and dependent
branches. After answers, it recomputes the frontier, develops choices within selected directions,
and closes branches made irrelevant by those directions. It does not substitute its recommendation
for an unresolved user decision. Questions address material decisions with concise context and
distinct alternatives; repeated background and immaterial choices are omitted. The agent does not
impose a question-count quota or split independent questions to shorten a frontier.

### REQ-question-quality — Question quality

Each question states its context and trade-offs. When meaningful alternatives exist, it offers two
to four distinct options and explains its recommendation. Before narrowing its recommendation, the
agent explores distinct approaches and includes an unconventional option when it provides a
relevant, viable alternative. It does not invent choices to fill a quota. Custom text is always
available.

### REQ-explicit-round-submission — Explicit round submission

Users can inspect the entire round, answer in any order, and revise drafts before submitting them
together. Navigation, highlighting, and an unaccepted recommendation are not answers. Unanswered
items prevent complete submission; an explicit custom response that defers a decision is user input
the agent must address. Deferral or uncertainty does not resolve a decision or authorize dependent
decisions. Partial submission does not silently carry unanswered questions into another frontier.
Once every active question has a current answer, users can review the answers before final
confirmation. Unanswered or outdated answers prevent entry to review.

### REQ-stable-question-numbers — Stable question numbers

Within a plan, new logical questions receive consecutive display numbers starting at 1. Later
frontiers continue the sequence; clarification, reordering, and revision of an existing question
preserve its number. Numbers are not reused for different questions. Resume preserves numbering, and
a new plan starts a new sequence. Display numbers accompany stable identities rather than replacing
them.

Question revisions preserve the identity of the decision being refined. A different decision
receives a new identity and number. Withdrawn questions retain their last displayed question and
drafts but do not require an answer. Deferred questions retain their identity while waiting for
submitted prerequisites. Reactivation preserves the number and revision history and requires a
current answer. An entirely withdrawn or deferred frontier supports explicit continuation without
creating answers or approving a plan.

### REQ-frontier-browsing — Frontier browsing

Completed logical frontiers persist as detached, read-only snapshots scoped to the active plan and
branch. Clarification updates revise their existing frontier rather than creating additional
browsing stops. Browsing cannot change answers, send clarification, or submit historical input.
Returning restores the active frontier's drafts, focus, and position.

### REQ-option-details — Option details

Each question supports generated options and a nonblank custom response. Users can clear a selected
answer without discarding option notes, custom text, or clarification drafts and history. Clearing
leaves the question unanswered and blocks round submission until an answer is selected again.
Generated options own independent optional notes. Note edits update local drafts immediately without
changing the selected answer or requiring confirmation. Changing focus, leaving an editor, or
selecting another option preserves those notes. Selecting an option includes its current notes;
later edits update its answer preview, and clearing them removes its details. Only the selected
answer and its current notes are included in round submission. The agent receives question numbers
and text, the selected option's identity and label or custom response, and any selected details.

Unselected option notes, unfinished custom answers, and unsent clarification text remain local in
all agent-facing entry, inspection, clarification, and submission results. Sending a clarification
does not authorize disclosure of abandoned option notes. Local presenters can receive the complete
drafts to preserve editing and recovery.

### REQ-plan-readiness — Plan readiness

Once material decisions are resolved, the agent produces Markdown covering the objective,
constraints, decisions, implementation approach, and verification. Detail scales with the task.
Remaining assumptions and research limits are explicit. A recommendation never becomes a user
decision merely to finish planning; approval remains a separate action. Review begins only when the
answerable frontier is empty and remaining relevant branches are settled or explicitly deferred by
the user. Material assumptions require a user decision; the review identifies accepted assumptions,
deferrals, and research limits without silently filling unresolved decisions.

## Interaction and review boundaries

### REQ-terminal-interaction-boundary — Terminal interaction boundary

Planning questions and review use a focused terminal modal over the existing Pi conversation. The
complete frontier and plan remain readable and scrollable. Users can distinguish focus, draft input,
selected answers, and submitted decisions. Visible controls expose required actions; navigation and
editing do not imply submission or approval. Inline question fields and plan annotations preserve
their context and drafts.

Narrow terminals and resize preserve access to content, focused fields, actions, and drafts.
Rendering supports Unicode and input-method focus. An active planning interaction distinguishes
waiting for user input from agent work and restores the working indicator when that interaction
closes, fails, or transfers. The required layout, labels, key mappings, hints, colors, and terminal
fallback behavior are defined in [the interaction contract](docs/tui-interactions.md#modal-layout).

### REQ-same-agent-clarification — Same-agent clarification

Before submitting a round, the user can ask a free-text question about any item. The waiting
interaction returns a typed clarification result identifying the round, question, and request. It
can include current selections and current selected-option notes explicitly labeled as unsubmitted;
unfinished custom answers, unsent clarification text, and unselected option notes stay local under
REQ-option-details. The owning Pi agent answers, researches further when needed, and updates the
same logical round. The TUI reopens with preserved drafts and the question-associated response. A
separate explanatory model does not satisfy this requirement.

Clarification can steer the decision, alternatives, recommendation, and membership of the frontier.
Updates preserve unaffected answers, resolve the pending clarification, and require reconfirmation
of changed questions. Sent exchanges retain the question context in which they were asked. Round
submission includes sent clarification history with its decisions; unsent text remains local.

Editing an unsubmitted answer does not invalidate a pending clarification request. Replacing its
session, plan, or round revision does invalidate delivery.

### REQ-read-only-plan-review — Read-only plan review

Review presents the latest complete Markdown revision for annotation, overall feedback, feedback
submission, and approval. The plan remains read-only; user notes are separate inputs. Feedback
returns to the owning agent, which revises the plan and presents it for fresh approval. Each new
review presents the latest revision.

### REQ-inline-block-annotations — Inline block annotations

Annotations attach to document blocks and preserve source identity. Paragraphs, list items,
headings, and code blocks are annotation targets; other Markdown structures can be targeted as whole
blocks. Repeated text and nested blocks remain distinguishable. An annotation identifies its plan
revision, source block, exact source excerpt, and note. Visual wrapping and resize do not change its
target. Arbitrary substring selection and editing plan content are outside this contract.

Notes and overall feedback remain local drafts until explicit submission or approval with notes.
Edits update retained text immediately; navigation does not require separate note confirmation.
Clearing note text removes that note from the outgoing batch. Revision requests include every
current nonblank note, its original excerpt and revision identity, and overall feedback. Empty
revision feedback cannot be submitted. After the agent revises the plan, the new revision starts
without active notes; old annotation targets are not silently reassigned to revised text.

Before review begins, the exact revision Markdown must exist in a distinct immutable file and its
path and content must be persisted with the session. A failed artifact or session write prevents the
modal from opening and reports retry or cancellation. Earlier revisions retain their paths. Existing
conflicting files are preserved. Notes do not modify the revision artifact.

### REQ-revision-browsing — Revision browsing

Users can inspect complete earlier revisions without changing the latest pending review. Older
revisions are read-only: annotation, feedback submission, and approval apply only to the latest
pending review. Returning to the latest restores its drafts and reading position. Browsing does not
change the pending approval identity, create a revision, replay feedback, or replace the latest
revision with an older one.

Reopening accepted review preserves its Markdown revision and restores supplementary notes as
editable drafts in the normal review interaction. Closing unchanged content preserves approval.
Unchanged re-approval reuses that approval and opens implementation options without replaying its
event. Changed notes require approval of their exact contents; only agent-returned Markdown creates
the next review revision. Historical approvals do not authorize changed content or a later revision.

## State and recovery

### REQ-planning-identity — Planning identity

Records distinguish the plan, owning Pi session and branch, current phase, round and question
revisions, option identities, answer and per-option details drafts, clarification history, block
annotations, overall feedback drafts, display question numbers, and exact Markdown revisions.
Accepted records also identify the saved path and approval time. Identities are stable and
independent of display position. Internal serialization is implementation-defined.

### REQ-workflow-transitions — Workflow transitions

The visible phases distinguish research, question input, clarification, plan review, saving,
acceptance, and cancellation. Submission returns to research; clarification returns to the current
round; revision feedback returns to review through the agent. Only explicit user input submits
decisions or approves a plan. Saving may be noninterruptible; cancellation cannot revoke completed
acceptance.

### REQ-revision-validation — Revision validation

Input identifies the session, interaction, and revision the user saw. Stale input cannot overwrite
newer answers or approve newer Markdown. Changes to a question's meaning or options require
reconfirmation; unaffected answers and unfinished text survive. Reordering unchanged options,
prerequisites, or serialized fields does not change their meaning. A new decision round invalidates
an earlier plan review, including across cancellation and resume.

### REQ-session-recovery — Session recovery

The package persists planning records with the Pi session and restores the last saved state on the
active branch. Draft saving does not submit answers. It documents any saving delay and reports when
persistence is disabled or unavailable. In-memory records alone do not establish durability. Branch
changes cannot import unrelated decisions or approvals. Navigation preserves recorded planning
identity and pending approval attempts. When planning diverges, including on sibling branches within
one Pi session, the continuation receives a distinct identity before saving another accepted
artifact. A pending approval remains bound to its recorded revision, content, destination, and
approval time until explicit retry or cancellation. Round counts survive persistence and
archived-plan selection. Only the current planning record and settings formats are supported.
Unknown settings and incompatible saved records report an error without changing the stored bytes.
The package does not migrate earlier development formats or infer missing record fields.

When the latest planning record is invalid or unsupported, explicit entry offers the latest valid
earlier checkpoint on the same disk-confirmed branch. The choice identifies the checkpoint and warns
that newer drafts may be absent. Dismissal preserves history and does not create a blank plan.
Recovery appends restored state without changing prior records. Unfinished interactions restore with
their drafts; recovered approved content requires fresh review and approval. When no valid
checkpoint exists, the package reports that limitation and supports explicit replacement planning.

When a recorded artifact is missing or changed, review offers to recreate the recorded bytes at a
new immutable path. Existing files remain unchanged. Recreated content requires fresh approval;
recovery never infers approval from file existence. Failed recreation remains retryable.

### REQ-interaction-cancellation — Interaction cancellation

Cancellation ends the pending interaction without submitting drafts, approving a plan, or emitting
completion. Saved unfinished work remains available for explicit resume, including unanswered
clarification. After cancellation, reload, or session replacement, late results and confirmations
cannot modify replacement work or start a stale agent continuation. Closing unfinished planning
stops the owning agent turn and returns to Default mode. Pi's normal interrupt during planning
research or clarification leaves saved work paused. A later unrelated message cannot restart it.
Cancellation flushes pending draft saves and reports a persistence failure instead of claiming that
unsaved drafts are durable.

Explicitly closing plan review without a matching approval reports cancellation. An empty abort
response from the turn stopped by that closure must not appear as a model failure. Unrelated
interruptions, provider failures, and assistant content remain unchanged.

### REQ-configuration-precedence — Configuration precedence

Personal defaults persist across restarts; trusted project configuration overrides only supplied
fields. The approved-plan directory defaults to `.pi/plans/` relative to the planning working
directory. Absolute paths remain absolute. Invalid settings report an actionable error.
Configuration changes preserve unrelated settings, decisions, and reviewed Markdown. Filenames and
configuration controls are documented implementation choices.

The base package defaults to the TUI and does not require browser configuration. `/plan-settings`
edits the approved-plan directory, appearance, hints default, and optional planning shortcut. These
settings use the same personal and trusted-project precedence. Failed persistence restores the
previous displayed value and reports the failure. After a successful save, shortcut changes apply
after `/reload`; appearance changes apply when the next interaction opens. The interaction contract
defines settings choices, visual defaults, override notices, and menu behavior.

## Approval and handoff

### REQ-plan-save — Plan save

Approval identifies the exact reviewed revision. The package verifies its unchanged Markdown in the
preexisting revision file and records acceptance in the Pi session. Filename selection prevents path
traversal and accidental overwrite. Completion requires confirmation of both the artifact and
persisted acceptance; unavailable persistence cannot report success.

Without notes, ordinary approval accepts the displayed Markdown. With notes, explicit approval with
notes accepts that unchanged Markdown together with the current supplementary notes. The package
saves those notes in a companion Markdown file and includes their source identities, excerpts, text,
path, and content in the approval payload. Approval requires confirmation of the plan file,
companion file when present, and persisted acceptance. A revision request instead submits the notes
to the owning agent and requires fresh user approval of its revised plan. Neither action infers
intent from the note text. Notes are never silently incorporated into the plan Markdown.

On failure, review remains recoverable and the package does not emit a completion event. An
interrupted save requires explicit retry or cancellation. Retry preserves any recorded revision,
content, destination, and approval time, even after settings change. It reconciles a matching
existing artifact without overwriting conflicts, creating duplicates, or inferring approval from a
file alone.

An approval retry also preserves any supplementary notes and companion destination. Partial writes
do not emit approval. Reconciliation checks every required artifact before accepting the revision.

### REQ-idle-completion — Idle completion

After successful approval, the package exits planning and completes its tool successfully with the
supported graceful-termination request. Approval and dismissal of the subsequent selector do not
abort the agent. The package preserves queued user input and Pi's normal queue behavior. Mixed
batches can continue the model; the returned instructions ask it to acknowledge approval and finish.
This guidance does not guarantee immediate idleness. The package does not block other tools, replace
providers, or access private SDK state to force completion.

### REQ-implementation-handoff — Implementation handoff

After confirming acceptance and closing review, the package immediately opens the native action
selector defined in the [interaction contract](docs/tui-interactions.md#implementation-options).
Displaying the selector does not wait for agent idleness. Dismissal preserves approval and does not
start implementation. The selector is ephemeral and does not reopen on dismissal, reload, or
restoration.

Selecting an implementation destination authorizes execution without another confirmation. The
package gracefully completes planning before starting the receiving implementation turn.
Current-session implementation retains conversation context. Fresh-session implementation waits for
idleness in command context, revalidates the originating session, creates a session through Pi's
public lifecycle, and starts the turn only through the fresh replacement context. Ordinary queued
input retains Pi's delivery policy before replacement.

The receiving session uses a hidden extension startup message to request a real `plan_implement`
call. The tool result supplies the implementation instructions, authorization, and absolute Markdown
path. The package does not display a pasted user implementation prompt or fabricate tool-call
history. The startup instruction guides the model; tool selection is not guaranteed. When the
approved Markdown contains a nonblank top-level heading, the result includes the first nonblank
heading as the plan title. This title is derived from the approved content without a model request.
When the approval includes supplementary notes, the result includes them. Even when the saved plan
says implementation awaits separate authorization, the selected action supplies that authorization.
Saved plan and note bytes remain unchanged.

A model-callable operation supports subsequent natural-language requests to implement here,
implement in a fresh session, or reopen the options. These describe intent, not a literal-phrase
whitelist. Quoted examples and feature questions do not authorize execution. Ambiguous saved-plan
references require explicit resolution; unknown or unapproved references fail without launching
work. Internal command routing is permitted without adding a user-facing launcher command.

### REQ-launch-idempotency — Launch idempotency

Each implementation launch records its identity, exact approval, destination, and delivery state.
The originating and receiving sessions retain their records across reload and restoration. Ordinary
repeated requests for the same approval reuse the existing launch, even when they request another
destination. They do not create a session or send another startup message. In the receiving session,
the repeated operation returns the execution instructions and permits normal agent continuation
without requiring a local planning record. Elsewhere it reports the recorded launch status without
starting implementation in that session. Launch status does not assert implementation completion.

An explicit restart request creates another launch and preserves prior records. Changed approved
Markdown or supplementary notes can start a new launch. The options selector remains available;
selecting a destination also checks the existing launch. An ordinary repeat of a failed or uncertain
launch reports that state without retrying. Only explicit restart authorizes another attempt.

### REQ-handoff-recovery — Handoff recovery

Before delayed dispatch, the package revalidates the approved artifacts and originating session.
Stale callbacks and repeated delivery cannot launch duplicate work or send a prompt into another
session. Session replacement invalidates pending actions; only the replacement operation's fresh
context may receive its bound prompt.

A failed handoff or cancelled replacement preserves approved artifacts and acceptance. Cancelled
replacement does not send an implementation prompt to the original session. Real errors remain
visible. An ambiguously completed launch is reported without automatic retry. Reload and restoration
never infer execution authorization from saved acceptance or replay an implementation action.

### REQ-approval-event — Approval event

After confirming saved acceptance and agent idleness, the package emits `orbis:plan-approved`
through Pi's shared event bus. A single turn-end event does not establish idleness. The version 1
payload is:

| Field         | Type             | Meaning                                            |
| ------------- | ---------------- | -------------------------------------------------- |
| `version`     | `1`              | Event contract version.                            |
| `approvalId`  | optional string  | Exact approval identity; present on new approvals. |
| `planId`      | string           | Stable plan identity.                              |
| `revision`    | positive integer | Approved Markdown revision.                        |
| `sessionId`   | string           | Owning Pi session identity.                        |
| `cwd`         | string           | Absolute planning working directory.               |
| `planPath`    | string           | Absolute saved Markdown path.                      |
| `planContent` | string           | Exact approved and saved Markdown.                 |
| `approvedAt`  | string           | UTC ISO 8601 approval timestamp.                   |

When approval includes supplementary notes, the payload also contains `notes` with structured block
annotations and overall text, `notesPath`, and `notesContent`. These fields are present together and
describe the saved companion Markdown. Without supplementary notes they are omitted.

New approvals include an `approvalId` identifying the exact revision and supplementary content.
Subscribers deduplicate by `approvalId`; older payloads without it use `planId` and `revision`.
Subscribers tolerate additional fields within version 1. On approval of changed supplementary
content, the package assigns a new approval identity. When the approved notes are nonblank, it saves
an immutable companion artifact. Previous approvals remain historical records. Subscribers can
register without importing private source.

### REQ-notification-semantics — Notification semantics

Approval events report saved acceptance, not subscriber success. The package does not await
subscribers, retry their work, or revoke approval on subscriber failure. Resume, reload, and reading
an accepted plan do not replay the event. A crash can leave saved acceptance without notification;
subscriber recovery must not be implemented as automatic plan execution by this package.

## Optional presentation hook

### REQ-public-presentation-boundary — Public presentation boundary

A separate Pi extension can register an optional presenter through a documented, versioned public
API. Registration is local to the Pi process and returns a way to unregister. The implementation
documents its registration and selection entry points and public input/result types; callers must
not import private modules or edit session files.

The hook exposes only a pending planning interaction:

| Boundary     | Required behavior                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input        | Read-only plan and interaction identities, current revisions, and either the numbered round with per-option drafts and clarification history or the exact Markdown under review with block-note and overall-feedback drafts.    |
| Draft update | Validated updates to answer details, block annotations, or overall feedback, preserving their unsubmitted status and source identities.                                                                                         |
| Result       | The same submitted-answer, clarification, revision-feedback, approval, or cancellation outcomes accepted by the TUI, bound to the displayed interaction and revision.                                                           |
| Lifetime     | A cancellation signal and cleanup on completion, replacement, unregistration, or session teardown.                                                                                                                              |
| Fallback     | While the interaction remains active, presenter withdrawal, unavailability, failure, or removal returns it to the TUI with drafts preserved. Plan cancellation and session teardown close the interaction without reopening it. |

### REQ-exclusive-interaction — Exclusive interaction

The TUI is the default presenter. An explicit user selection can use a registered presenter for a
pending interaction. Only one presenter can submit that interaction; returning to the TUI
invalidates late external results. The package retains state, applies REQ-revision-validation
validation, and controls approval and saving. Presenter callbacks cannot bypass those checks.

The hook does not require a generic event protocol, durable message queue, external transcript, or
network session registry. An external extension can use Pi's public tools, message APIs, and
lifecycle events for broader agent interaction. It owns the resulting transport, delivery policy,
and application state.

## Errors and bounded results

### REQ-typed-planning-outcomes — Typed planning outcomes

Validated model-facing operations cover entry, rounds, review, and implementation selection.
Outcomes distinguish submitted answers, clarification, revision feedback, approval, and
cancellation. Unknown identities and contradictory answer forms are rejected without changing
accepted state. Text preserves Unicode. Execution errors use Pi's failed-tool status; cancellation
and unsupported-mode outcomes are distinct from errors and decisions.

### REQ-recoverable-failures — Recoverable failures

Invalid input, unavailable presentation, configuration errors, and save failures preserve unrelated
drafts and accepted plans. Errors identify the failed action and available retry, TUI fallback, or
cancellation. Timeouts never become answers. Unsupported noninteractive or RPC execution returns an
explicit outcome instead of waiting for unavailable custom terminal components. Cleanup affects only
the originating interaction's resources.

### REQ-bounded-agent-results — Bounded agent results

Structured tool responses and results from reopened interactions stay within Pi's default output
byte and line limits. Oversized results provide the outcome, a bounded preview, a truncation notice,
and a path to the full result. The file remains readable after interaction and session cleanup; its
retention policy is documented. Truncation does not alter decisions, saved Markdown, or event
content and does not limit stored plans or drafts.

## Conformance

These scenarios define observable obligations, not completed verification. Use scripted providers
for automated checks and real Pi terminal interaction to verify keyboard behavior. Instruction
quality also requires representative planning tasks.

| Scenario                     | Expected outcome                                                                                                                                                                                                                                                                     | Requirements                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Install and enter planning   | The TUI completes the workflow alone; explicit and model entry share state and preserve unfinished work.                                                                                                                                                                             | REQ-complete-terminal-package, REQ-planning-responsibility, REQ-planning-entry |
| Research and decisions       | Discoverable facts are investigated; the full answerable frontier has useful choices and custom responses.                                                                                                                                                                           | REQ-research-prerequisites, REQ-complete-frontier, REQ-question-quality        |
| Number and qualify answers   | Later frontiers continue question numbering; revisions preserve existing numbers. Other requires text; per-option drafts survive navigation and only the selected option and its current notes are submitted with full question/option context.                                      | REQ-stable-question-numbers, REQ-option-details                                |
| Clarification                | The owning agent receives the question and selected answers with current option notes labeled unsubmitted. Full drafts remain local and restore with the response; no permission-to-continue prompt is added.                                                                        | REQ-complete-frontier, REQ-same-agent-clarification                            |
| Revisions and identity       | Changed meaning requires reconfirmation; reordering preserves identity; stale input and reopened decisions cannot approve old review.                                                                                                                                                | REQ-planning-identity, REQ-workflow-transitions, REQ-revision-validation       |
| Plan review                  | Complete Markdown reflects decisions and limitations; feedback produces another review requiring fresh approval.                                                                                                                                                                     | REQ-plan-readiness, REQ-read-only-plan-review                                  |
| Approve with notes           | Explicit approval preserves the displayed Markdown and supplementary notes in bound artifacts and the approval payload. Revision requests require a fresh reviewed revision; stale actions cannot approve replacement content.                                                       | REQ-plan-save, REQ-interaction-cancellation                                    |
| Recovery and cancellation    | Saved drafts restore on their branch; cancellation and late results cannot submit or replace work; unsaved state is reported.                                                                                                                                                        | REQ-session-recovery, REQ-interaction-cancellation                             |
| Save and retry               | Saved bytes equal reviewed Markdown; partial failures preserve the recorded attempt and retries avoid conflicting or duplicate artifacts.                                                                                                                                            | REQ-plan-save                                                                  |
| Approval handoff             | After saving acceptance, the package opens the selector immediately. When the agent is idle, the package emits the version 1 event. Only a selected implementation action launches work; restoration does not replay the event or action.                                            | REQ-idle-completion, REQ-approval-event, REQ-notification-semantics            |
| Implementation destinations  | Current-session launch retains context; fresh-session launch waits for idle and starts only through the replacement context. Hidden startup requests a real tool call whose result includes the title when present, absolute path, notes, and execution authorization.               | REQ-implementation-handoff                                                     |
| Tool retry and reopening     | Exact retries return recorded results without repeated UI or mutations; conflicts, pending work, cancellation, supersession, failed persistence, and restored branches preserve state. Explicit opening remains available.                                                           | REQ-tool-idempotency, REQ-planning-entry                                       |
| Launch reuse and restart     | Repeated destinations and restoration reuse the exact approval's recorded launch. Receiving tools continue it without another message or session; other sessions report status. Only explicit restart or a changed approval permits another launch.                                  | REQ-launch-idempotency                                                         |
| Handoff failures             | Dismissal, stale callbacks, duplicate dispatch, artifact changes, cancelled replacement, and rejected prompts preserve approval and never launch into the wrong session or automatically retry ambiguous completion.                                                                 | REQ-handoff-recovery, REQ-implementation-handoff                               |
| Optional presenter           | A fake presenter receives the current interaction, updates answer and revision-feedback drafts, and returns validated input; withdrawal, failure, or removal restores active work to the TUI and rejects late results. Plan cancellation and session teardown close the interaction. | REQ-exclusive-interaction, REQ-public-presentation-boundary                    |
| Invalid or unavailable input | Unknown identities and malformed outcomes fail without mutation; unsupported modes return explicitly and cleanup cannot affect newer work.                                                                                                                                           | REQ-typed-planning-outcomes, REQ-recoverable-failures                          |
| Oversized outcome            | Agent output is bounded and identifies a readable full result; decisions and approved content remain unchanged.                                                                                                                                                                      | REQ-bounded-agent-results                                                      |

Required interaction checks are defined in
[the interaction contract](docs/tui-interactions.md#interaction-scenarios), including keyboard
routing, appearance, resizing, and draft preservation.

## References

- [Composer mode research](docs/research/composer-mode.md): key routing, natural-language entry, and
  harness comparison limits.

- [TUI interactions](docs/tui-interactions.md): required presentation, key mappings, user flows, and
  interaction conformance scenarios under the package requirement IDs.
- [TUI design research](docs/research/tui-interaction-design.md): modal, keyboard, and
  block-annotation feasibility and verification limits.
- [Planning research](docs/research/README.md): package comparisons and planning behavior;
  informative rather than an additional contract.
- [Pi integration research](docs/research/pi-integration.md): terminal components, session recovery,
  handoff, and the optional presentation boundary.
- [Pi extension API](https://pi.dev/docs/latest/extensions): tools, custom UI, message delivery,
  lifecycle callbacks, session entries, and shared events.
