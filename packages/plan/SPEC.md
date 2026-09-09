# @orbis/plan specification

Status: Package contract. A reference implementation is available; its usage and
compatibility limits are documented in the [README](README.md).

This document specifies a Pi extension that develops a researched, user-approved
implementation plan through collaborative question rounds. It is written for
developers and coding agents implementing the complete package independently.

## Contract and scope

Requirements identified as `REQ-###` are mandatory. Examples illustrate those
requirements. Implementation-defined behavior must be documented by the
implementation. Internal modules, types, algorithms, dependencies, and visual
styling are implementation choices. This contract defines observable behavior,
not a source-code structure or task decomposition.

Research, question quality, frontier selection, and plan readiness are obligations
of the instructions supplied to the main agent. They require planning-quality
evaluation; structural input validation does not establish semantic correctness.
The extension enforces submission, revision, persistence, and approval boundaries
independently of whether the agent follows those instructions.

**REQ-001 — Complete Pi experience.** A conforming implementation supplies planning
instructions, explicit and agent-initiated entry, structured questions, browser and
terminal interfaces, session persistence, Markdown plan review, and an approval
event. Both interfaces are required. The implementation uses Pi's public extension
API and runs within the user's Pi session.

**REQ-002 — Responsibility.** The package researches and develops a plan with the
user, saves the approved plan, and reports approval to other extensions. It does
not execute the plan or track implementation progress. Shell-command filtering,
permission enforcement, a separate agent host, RPC-client interfaces, and a
general-purpose workflow engine are outside this contract. Planning instructions
tell the agent to research and plan until approval; this is a behavioral workflow,
not a sandbox.

The package supports interactive Pi in local terminals, SSH terminals, and
browser-hosted terminals running Pi's terminal interface. A browser-hosted terminal
is distinct from an application controlling Pi through RPC.

## Planning workflow

**REQ-003 — Entry.** `/plan` starts planning in the current conversation. An optional
task argument supplies the planning objective. The extension also exposes a
model-callable entry operation with instructions that let the agent recognize
requests such as "create a plan". Both entry paths establish the same state and
planning rules. A literal phrase match is not required for natural-language entry.

When planning is already active, repeated entry preserves the current plan and
answers and presents its current status or interaction. Starting a different plan
requires an explicit user choice. Entry must not silently replace unfinished work.

**REQ-004 — Research before questions.** The agent inspects available project
context and uses available research tools to resolve discoverable facts before
asking for decisions. It distinguishes verified facts, assumptions, preferences,
and unknowns. Unavailable tools or sources remain explicit limitations. The
extension does not require a particular search provider or subagent package.

**REQ-005 — Design tree and frontier.** The agent maintains decisions and the
prerequisites connecting them. A frontier contains all currently unresolved
decisions that the user can answer without guessing the outcome of another open
decision. Dependent questions wait for a later round. After receiving submitted
answers, the agent incorporates the decisions and continues research toward the
next frontier or plan review. It does not stop at an answer summary to ask whether
to continue planning.

Questions may inform one another even when their prerequisites are settled. The
user can inspect the whole frontier before answering any question. For example,
storage location and approval behavior may share a frontier; filename rules wait
until file storage is selected.

**REQ-006 — Question quality.** Questions explain the relevant context and
trade-offs. When meaningful alternatives exist, they offer two to four distinct
options and identify a recommendation with its reason. The agent considers
unconventional alternatives when they serve the objective; it does not invent
irrelevant choices to fill a quota. A free-text answer remains available. Facts
the agent can discover are not delegated to the user as preference questions.

**REQ-007 — Round submission.** Answers remain drafts until the user explicitly
submits the round. The user can answer in any order and revise earlier answers.
The agent receives the submitted decisions together. Merely viewing a question,
highlighting a recommendation, moving focus, or leaving an input empty does not
submit an answer. An unresolved question prevents complete-round submission;
explicit custom responses such as deferring a decision remain user input that the
agent must address.

**REQ-008 — Plan readiness.** Once the material design decisions are resolved,
the agent produces a complete Markdown plan that reflects the objective,
constraints, decisions, implementation approach, and verification. Detail scales
with the task. Any remaining assumptions or research limitations are explicit.
Approval remains a separate user action. The agent must not silently convert a
recommendation into a user decision to finish planning.

## Planning records and state

**REQ-009 — Stable identities.** The implementation distinguishes the following
records. Their serialization is implementation-defined except for the completion
event below.

| Record           | Required meaning                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Planning session | Stable plan identity, owning Pi session and conversation branch, objective, current phase.     |
| Frontier round   | Stable identity, revision, ordered questions, submission state.                                |
| Question         | Stable identity, prerequisite decisions, Markdown context, options, recommendation and reason. |
| Option           | Stable identity, label, and explanation of its trade-off.                                      |
| Answer draft     | Selected option or custom text, unfinished text, and the question revision it answers.         |
| Clarification    | Question identity, user request, response, and unresolved or resolved state.                   |
| Plan revision    | Plan identity, revision, exact Markdown content, and review state.                             |
| Accepted plan    | Approved revision, saved path, approval time, and owning session.                              |

Identifiers must not depend on an option's display position. Reordering unchanged
questions or options must not assign existing answers to different choices.

**REQ-010 — State transitions.** The implementation exposes whether it is
researching, awaiting round input, answering clarification, awaiting plan review,
or finished. The logical transitions are:

```text
entry → research → frontier input → research
                     ↕
                 clarification

research → plan review → revision/research → plan review
                ↓
          approval and save → accepted
```

Cancellation interrupts research, round input, clarification, and plan review.
Approval and save may form a noninterruptible commit; cancellation cannot revoke
an accepted plan. Internal state names are not prescribed.
Only the user approves a plan or submits decisions. Only the current question or
plan revision can receive a valid submission. Renderer events do not bypass these
rules.

**REQ-011 — Revisions and stale input.** Each submission identifies the revision
the user saw. When an agent changes a question's meaning or options, an existing
answer to that question requires reconfirmation. Unaffected answers and unfinished
text remain intact. A stale browser tab or delayed terminal action must not
overwrite newer state or approve a newer plan. An approval action remains bound to
the revision displayed when the user chose approval, including across a refresh
or conflict response. The interface explains the change and presents the current
revision for a fresh action.

Equivalent records retain their meaning despite serialization field order or
reordering of unchanged options and prerequisite identities. These changes do not
invalidate answers. A new decision round invalidates any pending plan review;
resuming the plan must not make that review approvable again.

## Main-agent clarification

**REQ-012 — Per-question clarification.** Every question supports a free-text
clarification request before round submission. The same Pi agent that owns the
planning conversation answers the request and may perform further research. The
response remains associated with its question. Clarification can update an
explanation, revise options, or reveal new prerequisites.

To let the main agent continue, a waiting question operation returns a structured
clarification result with the pending question, request, round identity, and
current draft state. Those drafts are explicitly unsubmitted context, not accepted
decisions. After answering, the agent updates the same logical round. The browser
page remains usable and the terminal interface can reopen with the preserved
state. A separate explanatory model call does not satisfy this requirement.

While clarification delivery is pending, edits to unsubmitted answer text do not
invalidate the request. Replacing its session, plan, or round revision invalidates
delivery to the main agent. After answering clarification, the agent continues
with the updated round rather than asking for permission to resume planning.

**REQ-013 — Structured exchanges.** Model-facing operations use validated
structured input and results for starting planning, presenting or revising a round,
and reviewing a plan. The results distinguish submitted answers, clarification
requests, revision feedback, approval, and cancellation. Tool names and schema
layout are implementation-defined; their semantics must preserve these
distinctions. Unknown option identities and contradictory answer forms are rejected
without changing accepted state. Execution failures use Pi's failed-tool status;
cancellation and unsupported-mode outcomes remain distinguishable from failures
and from submitted decisions. Browser and model-facing exchanges preserve Unicode
text, including characters split across transport reads.

## Browser and terminal interaction

**REQ-014 — Shared interaction state.** Both interfaces operate on the same
planning records and support the complete workflow. Switching interfaces preserves
drafts, question position, clarification history, and the current plan revision.
Neither renderer independently owns approval or decision state.

**REQ-015 — Browser questions.** An on-demand local server presents one focused
question at a time, with a navigator covering the full round and indicating
answered and unresolved questions. Context, option explanations, clarification
responses, and plans render Markdown as styled HTML prose. Text has readable line
lengths, clear hierarchy, and keyboard-accessible controls. Raw Markdown is not
the primary reading interface. Visual themes and frontend libraries are
implementation-defined.

Each question supports selecting an option, accepting the recommendation,
entering a custom answer, and asking for clarification. A recommendation may be
highlighted, but it is not an answer until the user explicitly accepts it.
Switching questions preserves unfinished text. The interface provides a review
of the draft answers before final round submission.

**REQ-016 — Terminal questions.** The terminal focuses on one question and shows
its Markdown context, options, recommendation, and answer controls. Tab advances
to the next question and Shift+Tab returns to the previous question, including
while the current answer is unfinished. Navigation covers unanswered questions and
wraps at the ends. It preserves draft text and selections. Other keys control
options and editing; Tab must not be consumed as indentation or completion inside
an answer editor. The visible help documents navigation, clarification, review,
submission, and cancellation controls.

The terminal interface supports the same draft-answer review and explicit round
submission as the browser. It must work without a graphical desktop or reachable
browser server. Terminal-specific key handling is verified in a real Pi terminal.

**REQ-017 — Interface selection.** A persisted setting selects browser or terminal.
The implementation supplies a discoverable way to change it and to switch the
current interaction without discarding answers. It does not infer browser
reachability from Pi's TUI mode or successful browser launch. When the configured
browser is inaccessible, the user can select terminal input from Pi without
visiting the browser page. Both views are available within one implementation;
separate installations are not required.

**REQ-018 — Browser lifecycle.** The server starts only when a browser interaction
needs it. It binds to loopback, uses a per-session access credential, and validates
state-changing requests. Rendering must not execute scripts embedded in model or
user Markdown. Implementation-specific endpoints are not a public integration
contract. The extension closes resources during Pi session shutdown and reload.
Closing or refreshing a browser tab is not approval, submission, or cancellation.
Reopening the interface restores its current state.

## Configuration and persistence

**REQ-019 — Configuration.** Personal configuration persists across Pi restarts;
project configuration overrides explicitly provided personal fields. Omitted
fields inherit their defaults. The configurable behavior includes the preferred
interface and approved-plan directory. The default plan directory is
`.pi/plans/`, resolved against the planning session's working directory. A configured
absolute directory is used as supplied. Configuration filenames, the initial
interface default, and configuration controls are implementation-defined and
documented. Project settings follow Pi's project-trust boundary.

Invalid configuration produces an actionable error rather than silently selecting
an unrelated value. A change to an active plan's output location or interface does
not alter the reviewed Markdown or accepted decisions. Concurrent setting changes
preserve unrelated fields. Once a newer interface selection succeeds, an older
pending selection cannot overwrite it or reopen the superseded interface.

**REQ-020 — Session persistence.** Planning identity, decisions, current rounds,
draft answers, clarification history, and plan revisions persist with the Pi
session. Saving draft state does not submit it to the agent as an answer. A normal
reload or session resume restores the last saved state. The implementation
documents any draft-saving delay and its behavior when Pi session persistence is
disabled or unavailable; it must not claim an unsaved draft is durable. A record
visible only in Pi's in-memory session state does not establish persistence.

Recovery reads the active conversation branch. Switching or navigating branches
must not import answers or approvals from another branch. A branch fork preserves
its inherited context but must not emit a new approval event or overwrite the
accepted artifact of its source branch. Divergent planning gets a distinct plan
identity before producing another accepted artifact.

**REQ-021 — Cancellation and interruption.** Cancellation stops the pending
interaction and returns an explicit cancellation result to Pi. It does not submit
partial answers, approve a plan, or emit a completion event. Saved unfinished work
remains available for explicit resumption. When clarification or research is
interrupted, the unanswered request remains visible on resumption. A fresh plan
must not silently reuse cancelled drafts as submitted decisions. Pending
replacement confirmations and agent-continuation requests belong to the
interaction that created them; cancellation or session replacement prevents their
late completion from replacing work or starting an agent turn.

## Plan review and accepted artifact

**REQ-022 — Review in both interfaces.** The selected interface renders the full
Markdown plan and offers approval, a free-text request for changes, and
cancellation. Browser review uses the same local interface as the question rounds;
terminal review remains sufficient over SSH. Feedback returns to the main Pi agent,
which revises the plan and requests approval again. Only the current pending
review is approvable. A new revision or decision round invalidates approval of an
earlier draft, including after cancellation and resumption. Inline section
annotations and direct Markdown editing are not required.

**REQ-023 — Approval and save.** The approval action identifies the exact reviewed
revision. The extension saves that Markdown to a distinct `.md` file in the
configured directory and records its path and approval in the session. Filename
construction is implementation-defined and must avoid path traversal and accidental
overwrite of another plan or an unrelated file. The saved document contains the
approved text, without unreviewed implementation instructions appended to it.

The extension reports completion only after it confirms the saved artifact and
persisted accepted session record. Disabled or unavailable session persistence
cannot produce a completed approval. Configuration and destination failures leave
the review recoverable for retry or cancellation, not permanently saving.

When saving fails, the extension preserves the reviewed content, reports the
failure, and does not emit an approval event. Once an approval attempt has a
persisted session record, retries preserve the recorded revision, content, path,
and approval time, including across output-directory changes. An existing file can
satisfy that retry only when it matches that approval record and exact content;
a conflicting file must not be overwritten. Retrying must not create duplicate
artifacts or duplicate live-session completion notifications.

When interruption leaves the artifact and session record inconsistent, recovery
shows the incomplete approval and requires explicit retry or cancellation. Retry
reconciles the attempted approval record with the file before completing acceptance.
Recovery does not infer completed approval from a file's existence alone.

**REQ-024 — Finish planning.** After approval and successful persistence, the
package exits active planning and leaves the ordinary Pi agent idle. It does not
send an implementation prompt, execute commands from the plan, or change another
extension's tools or workflow. A completion subscriber may independently initiate
the next workflow.

## Completion event

**REQ-025 — Public handoff.** After saving approval, exiting active planning, and
confirming that the main Pi agent is idle, the extension emits
`orbis:plan-approved` through Pi's shared event bus. An agent-turn-end notification
alone does not establish idleness. The version 1 payload has the following fields:

| Field         | Type             | Meaning                                       |
| ------------- | ---------------- | --------------------------------------------- |
| `version`     | `1`              | Event contract version.                       |
| `planId`      | string           | Stable identity of this plan.                 |
| `revision`    | positive integer | Approved revision within this plan.           |
| `sessionId`   | string           | Owning Pi session identity.                   |
| `cwd`         | string           | Absolute planning working directory.          |
| `planPath`    | string           | Absolute path of the saved Markdown artifact. |
| `planContent` | string           | Exact approved and saved Markdown content.    |
| `approvedAt`  | string           | UTC approval timestamp in ISO 8601 format.    |

The pair `planId` and `revision` identifies an approval for subscriber
deduplication. Timestamps are not identifiers. Subscribers can listen to the
channel string without importing this package's internal source. Compatible
consumers tolerate additional fields in version 1 payloads.

**REQ-026 — Delivery semantics.** The event reports a persisted approval, not
successful implementation or successful subscriber execution. Pi's event bus
provides in-process notification without acknowledgement or durable delivery.
The planning package does not wait for workflows to complete, retry subscribers,
or revoke approval when a subscriber fails. Reloading, resuming, switching
interfaces, or reading an accepted plan must not re-emit its event. A process crash
or session teardown may leave a saved approval without a delivered event;
recovery must not silently launch a workflow to compensate. Subscribers own
recovery and side effects.

Built-in command hooks, prompt hooks, and an implementation scheduler are not
required. Companion extensions can implement those behaviors using the approval
event and saved artifact.

## Failure behavior

**REQ-027 — Preserve recoverable work.** Invalid model input, malformed browser
requests, unavailable UI, server failure, and persistence errors leave unrelated
answers and prior accepted plans unchanged. Errors identify the failed action and
the available retry, switch, or cancel action. A timeout or disconnected client is
not a default answer. Unsupported noninteractive or RPC execution returns an
explicit unsupported-mode result instead of waiting for an unavailable custom
terminal component.

Pending interactions can be cancelled within the phase boundaries in REQ-010.
During cancellation or session teardown, the extension releases the interaction's
event listeners, server connections, and terminal components. Pending planning
interactions, replacement confirmations, initiated interface changes, and prepared
interaction-result delivery belong to their originating session and interaction.
Their completion or failure must not mutate replacement state, report an obsolete
error to a new session, start a continuation turn, or close a replacement
interaction's resources.

**REQ-028 — Bounded model-facing results.** Successful structured tool responses
and results delivered from reopened round or review interactions stay within Pi's
default tool-output byte and line limits. When a result exceeds those limits, the
extension returns a bounded preview, an explicit truncation notice, the outcome,
and a path to the full result. The full result remains readable after interaction
and session cleanup; the implementation documents its storage and cleanup policy.
Truncation does not change accepted decisions, the approved Markdown artifact, or
event content. This requirement does not impose a size limit on stored plans,
user drafts, or continuation prompts.

## Conformance scenarios

Conformance requires the entire contract, including both interfaces. The scenarios
below are acceptance obligations, not claims about completed tests. Deterministic
tests can use a scripted agent; real Pi checks must additionally verify tool
registration, terminal keys, browser communication, and session lifecycle.

| Scenario                                       | Required outcome                                                                                                                                                                                                               | Requirements              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Explicit and model-initiated entry             | Both start the same planning workflow; repeated entry preserves work.                                                                                                                                                          | REQ-001, REQ-003          |
| Discoverable repository fact                   | The agent investigates before asking the user and reports unavailable evidence honestly.                                                                                                                                       | REQ-004                   |
| Dependent decisions                            | Unblocked questions share a round; dependent questions appear after prerequisites are settled.                                                                                                                                 | REQ-005, REQ-006          |
| Planning phases                                | Entry, round submission, clarification, revision, approval, and cancellation follow the specified transitions; current phase is observable.                                                                                    | REQ-010                   |
| Draft round                                    | Unanswered items prevent submission; recommendations are not silently accepted.                                                                                                                                                | REQ-007                   |
| Question navigation                            | Tab and Shift+Tab traverse the whole terminal round, preserving unfinished text and selections.                                                                                                                                | REQ-009, REQ-016          |
| Browser navigation                             | The navigator exposes all questions and preserves drafts while Markdown remains readable.                                                                                                                                      | REQ-014, REQ-015          |
| Clarification                                  | The main Pi agent receives a question-specific request, can research, and restores the round with other drafts intact.                                                                                                         | REQ-012, REQ-013          |
| Revised question                               | A changed question requires reconfirmation; unaffected answers remain intact.                                                                                                                                                  | REQ-011                   |
| Interface switch                               | Browser and terminal show the same current round, answers, and plan revision.                                                                                                                                                  | REQ-014, REQ-017          |
| Remote terminal                                | The complete workflow, including plan review, works without an accessible browser.                                                                                                                                             | REQ-001, REQ-016, REQ-022 |
| Browser reload and stale tab                   | Reload restores state; stale submissions cannot replace newer answers or approve newer text.                                                                                                                                   | REQ-011, REQ-018          |
| Configuration precedence                       | Project fields override personal fields, missing fields inherit, and invalid values report errors.                                                                                                                             | REQ-019                   |
| Session reload and branch change               | Saved work resumes on its branch; other branches do not supply answers or trigger approval events.                                                                                                                             | REQ-020                   |
| Cancel or interrupt                            | Work remains resumable without submitting drafts or emitting completion.                                                                                                                                                       | REQ-021                   |
| Revision feedback                              | Feedback produces another reviewable plan and requires fresh approval.                                                                                                                                                         | REQ-008, REQ-022          |
| Successful approval                            | Saved bytes match reviewed content; the session records acceptance and the event identifies that artifact.                                                                                                                     | REQ-023, REQ-025          |
| Repeated approval or restart                   | No duplicate live-session handoff or automatic event replay occurs.                                                                                                                                                            | REQ-023, REQ-026          |
| Save failure                                   | Completion remains pending, retry preserves work, and no approval event is emitted.                                                                                                                                            | REQ-023, REQ-027          |
| Subscriber failure                             | Approval remains saved and subscriber execution is not reported as successful.                                                                                                                                                 | REQ-026                   |
| Package boundary                               | Approval alone does not start implementation; tools and permissions remain under their owners.                                                                                                                                 | REQ-002, REQ-024          |
| Invalid input or unavailable mode              | Invalid execution produces Pi's failed-tool status; unsupported mode returns an explicit distinct outcome without waiting for unavailable UI.                                                                                  | REQ-013, REQ-027          |
| Server and session teardown                    | The server releases resources and rejects requests from the previous session.                                                                                                                                                  | REQ-018, REQ-027          |
| Continued planning                             | After submitted answers or clarification, agent instructions direct the next frontier or review without a continue-planning prompt.                                                                                            | REQ-005, REQ-008, REQ-012 |
| Equivalent question records                    | Reordering serialized fields, unchanged options, or prerequisites preserves answer validity and choice identity.                                                                                                               | REQ-009, REQ-011          |
| Approval during refresh                        | A delayed approval for an older displayed revision cannot approve the revision returned by a refresh or conflict response.                                                                                                     | REQ-011, REQ-022          |
| Decisions reopened after review                | A new round makes the earlier review ineligible for approval, including after cancellation and resumption.                                                                                                                     | REQ-010, REQ-011, REQ-022 |
| Draft edit during clarification                | Editing an unsubmitted answer while clarification delivery waits preserves the still-current request.                                                                                                                          | REQ-012                   |
| Split Unicode transport                        | Browser requests containing multibyte characters preserve the text across transport read boundaries.                                                                                                                           | REQ-013                   |
| Overlapping settings changes                   | Unrelated fields survive concurrent changes; an older pending interface selection cannot overwrite the newest successful selection.                                                                                            | REQ-017, REQ-019          |
| Pending work after cancellation or replacement | Late replacement confirmations, initiated interface changes, prepared interaction results, and interaction cleanup cannot replace work, notify a new session, start a stale turn, or close a newer interaction.                | REQ-021, REQ-027          |
| Memory-only session record                     | Without confirmed session persistence, approval cannot report completion or emit its event.                                                                                                                                    | REQ-020, REQ-023          |
| Approval setup failure                         | Invalid settings or destination failure leaves review available for retry or cancellation.                                                                                                                                     | REQ-023, REQ-027          |
| Partial save and changed directory             | After an interrupted save and a directory change, explicit retry uses the recorded artifact path and content without overwriting a conflict or creating a duplicate.                                                           | REQ-023, REQ-026          |
| Idle handoff                                   | A subscriber observes an idle main agent and the saved approval; planning does not send an implementation prompt.                                                                                                              | REQ-024, REQ-025          |
| Oversized result                               | A successful structured tool response or reopened round/review result is bounded and identifies the outcome and retrievable full result; after session cleanup, the result remains readable and approved content is unchanged. | REQ-028                   |

Planning-quality evaluation uses representative tasks with discoverable facts,
dependent decisions, user corrections, and unresolved assumptions. A successful
schema check alone does not demonstrate researched or collaborative planning.

## Integration references

- [Research synthesis](docs/research/README.md): package comparisons, public Pi
  capabilities, and Codex and Claude Code planning behavior. This is informative
  background, not an additional source of requirements.
- [Pi extension API](https://pi.dev/docs/latest/extensions): tools, commands,
  session persistence, event delivery, and resource lifecycle.
- [Pi questionnaire example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/questionnaire.ts):
  terminal question navigation and submission.
- [Pi RPC protocol](https://pi.dev/docs/latest/rpc#extension-ui-protocol):
  distinction between standard dialogs and custom terminal components.

These references describe host capabilities. They do not replace the requirements
in this document or demonstrate conformance of an implementation.
