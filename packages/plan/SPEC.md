# @orbis/plan specification

Status: Package contract. The available implementation still includes a bundled
browser interface; removing it and exposing the optional presentation hook remain
implementation work. The [README](README.md) describes available behavior.

`@orbis/plan` develops a researched, user-approved Markdown plan in the user's
existing Pi conversation. Installing the package supplies the complete terminal
workflow. This specification is for independent Pi extension implementers.

## Scope

`REQ-###` requirements and their contract tables are mandatory. Internal types,
storage layouts, tool names, and visual styling are implementation-defined and
must be documented where they affect usage or compatibility.

**REQ-001 — Complete terminal package.** The package supplies planning instructions,
explicit and model-initiated entry, structured question rounds, clarification,
draft recovery, Markdown review, and approval through Pi's public extension API.
The entire workflow works in local and SSH terminals without another package,
application, service, or graphical desktop.

**REQ-002 — Planning responsibility.** The package researches and develops plans,
saves approved Markdown, and reports approval. It does not execute plans, track
implementation, enforce shell permissions, or host another agent. Browser servers,
HTML rendering, annotation mapping, review-chat transcripts, authentication,
network delivery, and companion process management belong to separate extensions
or applications. They are not dormant features of the base package.

Research quality and frontier selection are agent-instruction obligations. The
extension independently validates identities, explicit submission, current
revisions, and approval. Planning instructions are not a security sandbox.

## Research and question rounds

**REQ-003 — Entry.** `/plan [objective]` and a model-callable entry operation start
the same workflow in the current conversation. Agent instructions recognize
planning intent without requiring a literal phrase. Repeated entry preserves and
reopens active work. Replacing unfinished work requires an explicit user choice.

**REQ-004 — Research first.** The owning agent investigates repository context and
available sources before asking for decisions. It distinguishes verified facts,
assumptions, preferences, and unavailable evidence. Discoverable facts are not
delegated to the user. No particular search provider or subagent package is required.

**REQ-005 — Complete frontier.** The agent tracks decisions and their prerequisites.
Each round contains every unresolved decision the user can answer without guessing
another open decision. Dependent questions wait. After submission or clarification,
the agent continues toward the next frontier or plan review without asking whether
to continue planning.

**REQ-006 — Useful questions.** Each question states its context and trade-offs.
When meaningful alternatives exist, it offers two to four distinct options and
explains its recommendation. The agent considers unconventional alternatives where
useful, without inventing choices to fill a quota. Custom text is always available.

**REQ-007 — Explicit round submission.** Users can inspect the entire round, answer
in any order, and revise drafts before submitting them together. Navigation,
highlighting, and an unaccepted recommendation are not answers. Unanswered items
prevent complete submission; an explicit custom response that defers a decision
is user input the agent must address.

**REQ-008 — Plan readiness.** Once material decisions are resolved, the agent
produces Markdown covering the objective, constraints, decisions, implementation
approach, and verification. Detail scales with the task. Remaining assumptions and
research limits are explicit. A recommendation never becomes a user decision
merely to finish planning; approval remains a separate action.

## TUI interaction

**REQ-016 — Terminal questions.** The TUI focuses on one question while making the
whole round navigable. It displays the question, Markdown context, options,
recommendation, custom-answer controls, and visible keyboard help.

Tab advances and Shift+Tab returns through all questions, including unanswered
ones, wrapping at the ends. Both preserve unfinished text and selections, including
inside the answer editor. Other keys handle editing and option selection; Tab
must not become indentation or completion. Users can review draft answers before
explicit submission and can request clarification or cancel from the TUI.

**REQ-012 — Same-agent clarification.** Before submitting a round, the user can
ask a free-text question about any item. The waiting interaction returns a typed
clarification result with the round, question, request, and unsubmitted drafts.
The owning Pi agent answers, researches further when needed, and updates the same
logical round. The TUI reopens with preserved drafts and the question-associated
response. A separate explanatory model does not satisfy this requirement.

Editing an unsubmitted answer does not invalidate a pending clarification request.
Replacing its session, plan, or round revision does invalidate delivery.

**REQ-022 — Plan review.** The TUI displays the full Markdown plan with scrolling,
explicit approval, free-text revision feedback, and cancellation. Feedback returns
to the owning agent, which revises the plan and presents it for fresh approval.
Approval applies only to the current pending review. Graphical selection,
annotations, a separate chat pane, and direct document editing are not required.

## State and recovery

**REQ-009 — Planning identity.** Records distinguish the plan, owning Pi session
and branch, current phase, round and question revisions, option identities, answer
and revision-feedback drafts, clarification history, and exact Markdown revisions. Accepted records also
identify the saved path and approval time. Identities are stable and independent
of display position. Internal serialization is implementation-defined.

**REQ-010 — Workflow transitions.** The visible phases distinguish research,
question input, clarification, plan review, saving, acceptance, and cancellation.
Submission returns to research; clarification returns to the current round;
revision feedback returns to review through the agent. Only explicit user input
submits decisions or approves a plan. Saving may be noninterruptible; cancellation
cannot revoke completed acceptance.

**REQ-011 — Revision validation.** Input identifies the session, interaction, and
revision the user saw. Stale input cannot overwrite newer answers or approve newer
Markdown. Changes to a question's meaning or options require reconfirmation;
unaffected answers and unfinished text survive. Reordering unchanged options,
prerequisites, or serialized fields does not change their meaning. A new decision
round invalidates an earlier plan review, including across cancellation and resume.

**REQ-020 — Session recovery.** The package persists planning records with the Pi
session and restores the last saved state on the active branch. Draft saving does
not submit answers. It documents any saving delay and reports when persistence is
disabled or unavailable. In-memory records alone do not establish durability.
Branch changes cannot import unrelated decisions or approvals; divergent planning
gets a distinct identity before saving another accepted artifact.

**REQ-021 — Cancellation.** Cancellation ends the pending interaction without
submitting drafts, approving a plan, or emitting completion. Saved unfinished work
remains available for explicit resume, including unanswered clarification. After
cancellation, reload, or session replacement, late results and confirmations cannot
modify replacement work or start a stale agent continuation.

**REQ-019 — Configuration.** Personal defaults persist across restarts; trusted
project configuration overrides only supplied fields. The approved-plan directory
defaults to `.pi/plans/` relative to the planning working directory. Absolute paths
remain absolute. Invalid settings report an actionable error. Configuration
changes preserve unrelated settings, decisions, and reviewed Markdown. Filenames
and configuration controls are documented implementation choices. The base
package defaults to the TUI and does not require browser configuration.

## Approval and handoff

**REQ-023 — Save the reviewed plan.** Approval identifies the exact reviewed
revision. The package saves its unchanged Markdown to a distinct `.md` file and
records acceptance in the Pi session. Filename selection prevents path traversal
and accidental overwrite. Completion requires confirmation of both the artifact
and persisted acceptance; unavailable persistence cannot report success.

On failure, review remains recoverable and no completion event is emitted. An
interrupted save requires explicit retry or cancellation. Retry preserves any
recorded revision, content, destination, and approval time, even after settings
change. It reconciles a matching existing artifact without overwriting conflicts,
creating duplicates, or inferring approval from a file alone.

**REQ-024 — Finish idle.** After successful approval, the package exits planning
and leaves the owning agent idle. It does not send an implementation prompt or
change other extensions' tools. Subscribers may independently start another workflow.

**REQ-025 — Approval event.** After confirming saved acceptance and agent idleness,
the package emits `orbis:plan-approved` through Pi's shared event bus. A single
turn-end event does not establish idleness. The version 1 payload is:

| Field         | Type             | Meaning                              |
| ------------- | ---------------- | ------------------------------------ |
| `version`     | `1`              | Event contract version.              |
| `planId`      | string           | Stable plan identity.                |
| `revision`    | positive integer | Approved Markdown revision.          |
| `sessionId`   | string           | Owning Pi session identity.          |
| `cwd`         | string           | Absolute planning working directory. |
| `planPath`    | string           | Absolute saved Markdown path.        |
| `planContent` | string           | Exact approved and saved Markdown.   |
| `approvedAt`  | string           | UTC ISO 8601 approval timestamp.     |

Subscribers deduplicate by `planId` and `revision` and tolerate additional fields
within version 1. They can subscribe without importing private source.

**REQ-026 — Notification semantics.** Approval events report saved acceptance,
not subscriber success. The package does not await subscribers, retry their work,
or revoke approval on subscriber failure. Resume, reload, and reading an accepted
plan do not replay the event. A crash can leave saved acceptance without notification;
subscriber recovery must not be implemented as automatic plan execution by this
package.

## Optional presentation hook

**REQ-029 — Public presentation boundary.** A separate Pi extension can register
an optional presenter through a documented, versioned public API. Registration is
local to the Pi process and returns a way to unregister. The implementation
documents its registration and selection entry points and public input/result
types; callers must not import private modules or edit session files.

The hook exposes only a pending planning interaction:

| Boundary     | Required behavior                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input        | Read-only plan and interaction identities, current revisions, and either the structured round with drafts and clarification history or the exact Markdown under review with its revision-feedback draft.                        |
| Draft update | Validated updates to answer or revision-feedback drafts, preserving their unsubmitted status.                                                                                                                                   |
| Result       | The same submitted-answer, clarification, revision-feedback, approval, or cancellation outcomes accepted by the TUI, bound to the displayed interaction and revision.                                                           |
| Lifetime     | A cancellation signal and cleanup on completion, replacement, unregistration, or session teardown.                                                                                                                              |
| Fallback     | While the interaction remains active, presenter withdrawal, unavailability, failure, or removal returns it to the TUI with drafts preserved. Plan cancellation and session teardown close the interaction without reopening it. |

**REQ-014 — One active interaction.** The TUI is the default presenter. An explicit
user selection can use a registered presenter for a pending interaction. Only one
presenter can submit that interaction; returning to the TUI invalidates late
external results. The package retains state, applies REQ-011 validation, and
controls approval and saving. Presenter callbacks cannot bypass those checks.

The hook does not require a generic event protocol, durable message queue, external
transcript, or network session registry. An external extension can use Pi's public
tools, message APIs, and lifecycle events for broader agent interaction. It owns
the resulting transport, delivery policy, and application state.

## Errors and bounded results

**REQ-013 — Typed planning outcomes.** Validated model-facing operations cover
entry, rounds, and review. Outcomes distinguish submitted answers, clarification,
revision feedback, approval, and cancellation. Unknown identities and contradictory
answer forms are rejected without changing accepted state. Text preserves Unicode.
Execution errors use Pi's failed-tool status; cancellation and unsupported-mode
outcomes are distinct from errors and decisions.

**REQ-027 — Recoverable failures.** Invalid input, unavailable presentation,
configuration errors, and save failures preserve unrelated drafts and accepted
plans. Errors identify the failed action and available retry, TUI fallback, or
cancellation. Timeouts never become answers. Unsupported noninteractive or RPC
execution returns an explicit outcome instead of waiting for unavailable custom
terminal components. Cleanup affects only the originating interaction's resources.

**REQ-028 — Bounded agent results.** Structured tool responses and results from
reopened interactions stay within Pi's default output byte and line limits. Oversized
results provide the outcome, a bounded preview, a truncation notice, and a path to
the full result. The file remains readable after interaction and session cleanup;
its retention policy is documented. Truncation does not alter decisions, saved
Markdown, or event content and does not limit stored plans or drafts.

## Conformance

These scenarios define observable obligations, not completed verification. Use
scripted providers for automated checks and real Pi terminal interaction to verify
keyboard behavior. Instruction quality also requires representative planning tasks.

| Scenario                     | Expected outcome                                                                                                                                                                                                                                                                     | Requirements              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Install and enter planning   | The TUI completes the workflow alone; explicit and model entry share state and preserve unfinished work.                                                                                                                                                                             | REQ-001, REQ-002, REQ-003 |
| Research and decisions       | Discoverable facts are investigated; the full answerable frontier has useful choices and custom responses.                                                                                                                                                                           | REQ-004, REQ-005, REQ-006 |
| Navigate and submit          | Tab and Shift+Tab preserve unfinished answers; unresolved items block submission and recommendations are not silently accepted.                                                                                                                                                      | REQ-007, REQ-016          |
| Clarification                | The owning agent receives the question and unsubmitted drafts, answers, and restores the round without a permission-to-continue prompt.                                                                                                                                              | REQ-005, REQ-012          |
| Revisions and identity       | Changed meaning requires reconfirmation; reordering preserves identity; stale input and reopened decisions cannot approve old review.                                                                                                                                                | REQ-009, REQ-010, REQ-011 |
| Plan review                  | Complete Markdown reflects decisions and limitations; feedback produces another review requiring fresh approval.                                                                                                                                                                     | REQ-008, REQ-022          |
| Settings                     | Trusted project fields override supplied defaults; invalid settings fail visibly without changing decisions.                                                                                                                                                                         | REQ-019                   |
| Recovery and cancellation    | Saved drafts restore on their branch; cancellation and late results cannot submit or replace work; unsaved state is reported.                                                                                                                                                        | REQ-020, REQ-021          |
| Save and retry               | Saved bytes equal reviewed Markdown; partial failures preserve the recorded attempt and retries avoid conflicting or duplicate artifacts.                                                                                                                                            | REQ-023                   |
| Approval handoff             | Saved acceptance emits the version 1 event with the agent idle; the package does not start implementation or replay after resume.                                                                                                                                                    | REQ-024, REQ-025, REQ-026 |
| Optional presenter           | A fake presenter receives the current interaction, updates answer and revision-feedback drafts, and returns validated input; withdrawal, failure, or removal restores active work to the TUI and rejects late results. Plan cancellation and session teardown close the interaction. | REQ-014, REQ-029          |
| Invalid or unavailable input | Unknown identities and malformed outcomes fail without mutation; unsupported modes return explicitly and cleanup cannot affect newer work.                                                                                                                                           | REQ-013, REQ-027          |
| Oversized outcome            | Agent output is bounded and identifies a readable full result; decisions and approved content remain unchanged.                                                                                                                                                                      | REQ-028                   |

## References

- [Planning research](docs/research/README.md): package comparisons and planning
  behavior; informative rather than an additional contract.
- [Pi integration research](docs/research/pi-integration.md): terminal components,
  session recovery, handoff, and the optional presentation boundary.
- [Pi extension API](https://pi.dev/docs/latest/extensions): tools, custom UI,
  message delivery, lifecycle callbacks, session entries, and shared events.
