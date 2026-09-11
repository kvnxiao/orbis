# @orbis/plan specification

Status: Package contract. The implementation provides the modal frontier, option details, block
annotations, revision browsing, and an optional presentation hook. Complete real-host, SSH, IME, and
model-quality verification remains pending. The [README](README.md) describes available behavior and
verification limits.

`@orbis/plan` develops a researched, user-approved Markdown plan in the user's existing Pi
conversation. Installing the package supplies the complete terminal workflow. This specification is
for independent Pi extension implementers.

## Scope

`REQ-###` requirements and their contract tables are mandatory. Internal types, storage layouts,
tool names, and styling not prescribed below are implementation-defined and must be documented where
they affect usage or compatibility.

**REQ-001 — Complete terminal package.** The package supplies planning instructions, explicit and
model-initiated entry, structured question rounds, clarification, draft recovery, Markdown review,
and approval through Pi's public extension API. The entire workflow works in local and SSH terminals
without another package, application, service, or graphical desktop.

**REQ-002 — Planning responsibility.** The package researches and develops plans, saves approved
Markdown, and reports approval. It does not execute plans, track implementation, enforce shell
permissions, or host another agent. Browser servers, HTML rendering, browser annotation mapping,
review-chat transcripts, authentication, network delivery, and companion process management belong
to separate extensions or applications. They are not dormant features of the base package.

Research quality and frontier selection are agent-instruction obligations. The extension
independently validates identities, explicit submission, current revisions, and approval. Planning
instructions are not a security sandbox.

## Research and question rounds

**REQ-003 — Entry.** `/plan [objective]` and a model-callable entry operation start the same
workflow in the current conversation. Agent instructions recognize planning intent without requiring
a literal phrase. Repeated entry preserves and reopens active work, including paused rounds, review,
and unanswered clarification. Explicit natural-language requests to resume use the same recovery
path. Examples include “enter plan mode,” “help me plan this change,” “resume the plan,” and
“continue planning”; these illustrate intent rather than an exact-phrase whitelist. Quoted examples,
discussion of the feature, and unrelated messages do not authorize entry or resumption. Ambiguous
saved-plan references require a selection. When multiple unfinished plans are available on the
branch, `/plan` prompts for a selection. Replacing unfinished work requires an explicit user choice
and retains the previous plan. The base package registers only `/plan` and `/plan-settings`.

**REQ-034 — Composer mode.** The main Pi composer shows Plan or Default mode. With the agent idle,
the configured planning shortcut toggles the mode and preserves typed text. Shift+Tab is the
default; users can rebind or disable the shortcut. While an effective Pi composer binding conflicts
with the selected shortcut, the package preserves Pi's key handling and reports the conflict. Before
using Shift+Tab for planning, users must rebind Pi's default `app.thinking.cycle` action in
`keybindings.json` and reload Pi. The package does not edit Pi's keybindings. After reload, the
shortcut uses the effective bindings without requiring another extension reload. Selecting Plan
alone does not send input or resume work. In Plan mode, the next ordinary user message enters or
resumes planning without special wording or a slash prefix. Commands, shell input, and
extension-injected messages retain their existing routing. During an active turn, the enabled
planning shortcut leaves the mode unchanged, reports that the user must stop the current turn to
switch, and does not queue a mode change. An ordinary message submitted during work keeps the
current turn's mode and Pi's delivery policy. Inside modal fields and controls, Shift+Tab retains
REQ-016 navigation.

Default mode does not inject active planning instructions or automatically resume paused work.
Explicit planning intent remains supported in either mode. Switching to Default preserves unfinished
planning as paused work. Approval and cancellation return to Default without starting
implementation. Session restoration uses the mode recorded on the selected branch; a new session
starts in Default. A custom editor integration must compose with an existing editor and document
conflicts with later replacements.

**REQ-004 — Research first.** The owning agent investigates repository context and available sources
before asking for decisions. It distinguishes verified facts, assumptions, preferences, and
unavailable evidence. Discoverable facts are not delegated to the user. No particular search
provider or subagent package is required. When research delegation is available, the agent delegates
bounded factual investigation and waits for relevant results before presenting the frontier.
Otherwise the owning agent researches directly. Each revised frontier follows any further research
required by the user's answers.

**REQ-005 — Complete frontier.** The agent tracks decisions and their prerequisites. Each round
contains every unresolved decision the user can answer without guessing another open decision.
Dependent questions wait. After submission or clarification, the agent continues toward the next
frontier or plan review without asking whether to continue planning. The agent models the design as
decisions and dependent branches. After answers, it recomputes the frontier, develops choices within
selected directions, and closes branches made irrelevant by those directions. It does not substitute
its recommendation for an unresolved user decision. Questions address material decisions with
concise context and distinct alternatives; repeated background and immaterial choices are omitted.
The agent does not impose a question-count quota or split independent questions to shorten a
frontier.

**REQ-006 — Useful questions.** Each question states its context and trade-offs. When meaningful
alternatives exist, it offers two to four distinct options and explains its recommendation. Before
narrowing its recommendation, the agent explores distinct approaches and includes an unconventional
option when it provides a relevant, viable alternative. It does not invent choices to fill a quota.
Custom text is always available.

**REQ-007 — Explicit round submission.** Users can inspect the entire round, answer in any order,
and revise drafts before submitting them together. Navigation, highlighting, and an unaccepted
recommendation are not answers. Unanswered items prevent complete submission; an explicit custom
response that defers a decision is user input the agent must address. Deferral or uncertainty does
not resolve a decision or authorize dependent decisions. Partial submission does not silently carry
unanswered questions into another frontier. The visible review/submission action is labeled
`Review answers and submit`, is separated from the questions by a blank line or divider, identifies
unanswered questions, and offers navigation to the next one. The action uses a bold, accent-colored
bracketed label and `›` when focused. It does not use an option-list dot.

**REQ-030 — Stable question numbers.** Within a plan, new logical questions receive consecutive
display numbers starting at 1. Later frontiers continue the sequence; clarification, reordering, and
revision of an existing question preserve its number. Numbers are not reused for different
questions. Resume preserves numbering, and a new plan starts a new sequence. Display numbers
accompany stable identities rather than replacing them.

**REQ-031 — Options and details.** Each question lists its generated options first and
`Other (please specify)` last. Alphabetic labels follow display order and restart at A for each
question. A separate `?. Ask for clarification` action follows Other. The recommendation and reason
appear below this list. Other requires nonblank custom text. Each generated option can have its own
optional notes. Editing notes updates that option's local notes immediately without selecting it or
requiring confirmation. Changing focus, pressing Escape, or selecting another option preserves those
notes. Pressing Enter on a generated option selects it with its current notes. Editing the selected
option's notes updates its answer preview; clearing them removes its notes. Only the selected answer
and its current notes are included in round submission. The agent receives question numbers and
text, the selected option's identity and label or custom response, and any selected details.
Unselected option notes, unfinished custom answers, and unsent clarification text remain local in
all agent-facing entry, inspection, clarification, and submission results; sending a clarification
is not permission to disclose abandoned option notes. Local presenters can receive the complete
drafts to preserve editing and recovery.

**REQ-008 — Plan readiness.** Once material decisions are resolved, the agent produces Markdown
covering the objective, constraints, decisions, implementation approach, and verification. Detail
scales with the task. Remaining assumptions and research limits are explicit. A recommendation never
becomes a user decision merely to finish planning; approval remains a separate action. Review begins
only when the answerable frontier is empty and remaining relevant branches are settled or explicitly
deferred by the user. Material assumptions require a user decision; the review identifies accepted
assumptions, deferrals, and research limits without silently filling unresolved decisions.

## TUI interaction

**REQ-016 — Modal terminal interaction.** Planning input uses a focused modal over the Pi
conversation. The frontier is one continuous, scrollable list of numbered questions, options, and
visible actions. Each question exposes its Markdown context, recommendation and reason, and
clarification action. Selection checkmarks show answers without separate Answered or Unanswered
rows. Changed questions retain a visible reconfirmation warning. Question headings use `❓` in emoji
mode and `?` in Unicode mode; recommendations use `➡️` and `→`, respectively. Blank lines separate
question groups. A blank line also separates the `Review answers and submit` action from the
questions. The title is `Plan questions (round N)`. A blank line separates the modal title from its
content. When terminal height cannot fit the gap, controls, and a content row, the gap is omitted. N
starts at 1 and increments for each new logical frontier; clarification, same-round updates,
reopening, and resumption preserve it. Question numbering remains independent of this count. A
selected option's complete rendered text is bold and begins with a persistent checkmark, including
while focused. An unselected focused row uses `🔹` in emoji mode and `›` in Unicode mode;
recommendation arrows are reserved for recommendations. Unselected unfocused options use a dot. No
extra focus marker is required for a selected row. Display labels do not add letter or question-mark
shortcuts.

The following key behavior is required. Extra shortcuts are optional; visible controls expose
required actions without memorizing Ctrl-key combinations.

| Focus                                   | Keys            | Behavior                                                                                                                                                         |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier list                           | Up / Down       | Move through options and actions across question boundaries without selecting answers.                                                                           |
| Frontier list                           | Tab / Shift+Tab | Move to the next/previous question, wrap at the ends, and focus its selected option or its first option if unanswered.                                           |
| Generated option                        | Enter           | Select the option and remain on its row.                                                                                                                         |
| Generated option                        | Backspace       | Edit its notes immediately, deleting the preceding character.                                                                                                    |
| Option row                              | Typing / paste  | Focus its inline field and insert the input immediately.                                                                                                         |
| Other                                   | Enter           | Focus its required inline text field.                                                                                                                            |
| Generated-option notes                  | Enter           | Select the option with its current notes and return to its row.                                                                                                  |
| Other text                              | Enter           | Confirm the custom answer and return to its row. Empty Other is rejected.                                                                                        |
| Clarification field                     | Enter           | Retain the text and return to the list without sending it.                                                                                                       |
| Question text field                     | Shift+Enter     | Insert a newline in option notes, Other text, or clarification text.                                                                                             |
| Review-note field                       | Enter           | Insert a newline in the note, never in the plan.                                                                                                                 |
| Question inline field                   | Tab / Shift+Tab | Navigate to the next/previous question without selecting an answer.                                                                                              |
| Other or clarification field            | Tab / Shift+Tab | Preserve drafts and navigate to the next/previous question without selecting or sending.                                                                         |
| Review field                            | Tab / Shift+Tab | Transfer focus among visible controls without submitting.                                                                                                        |
| Visible action                          | Enter           | Activate the focused action; merely focusing it has no effect.                                                                                                   |
| Nested editor, preview, or confirmation | Escape          | Return one level without sending, selecting, or approving; preserve current option notes, unfinished text, confirmed custom answers, and confirmed review notes. |
| Outermost frontier or review            | Escape          | Arm closing and, when hints are shown, display the close reminder. A second consecutive Escape closes with drafts retained; other input disarms closing.         |

An Escape that returns from a nested view does not arm outer dismissal. The next opened modal starts
unarmed. Review has an always-visible action bar; document focus supports arrow navigation and
scrolling, while action-bar focus uses arrows to choose controls. When hints are shown,
context-sensitive help identifies what Enter and Escape will do. The complete plan, including long
blocks, remains readable.

Answer details and clarification text are edited within the question list rather than in a
replacement view. Typing on a generated option appends an editable `[notes: …]` suffix directly to
its rendered text, using the theme accent color. The option row does not add a separate notes
column, label row, or unsubmitted marker. The suffix wraps with the option and retains its color
after editing. Empty or whitespace-only notes are omitted from the list and answer preview. Nonempty
selected-option notes use the same suffix in the preview. As text grows, later rows move; the
cursor, focused option, other drafts, and fixed controls remain available. Other and clarification
text use inline `[answer: …]` and `[question: …]` suffixes with the same wrapping and cursor
behavior. Other uses the option-note accent color; clarification uses the theme's link color. Enter
retains the field text and exits editing; for Other it also selects the nonblank custom answer. The
frontier footer uses one hint line directly below its divider, without a blank row between them.
Editing changes the hints without changing the footer height. F1 toggles all hints and their divider
in question and review views, including the double-Escape reminder. With hints hidden, the first
outer Escape still arms closure and the second closes without displaying a reminder. The toggle
retains drafts and focus, remains usable while hints are hidden, and does not hide action buttons or
errors. Each new modal reads the configured hints default. F1 changes only the current modal and
never changes that saved default. Escape returns from inline editing without arming outer dismissal.

Right arrow does not open a field or activate an action from the frontier list. Generated-option
notes have no separate Confirm action. Enter selects the option and returns to its row;
Tab/Shift+Tab navigate to the next/previous question. When a question's inline field is empty or
whitespace-only, Up/Down return to list navigation and move focus without selecting an answer.
Nonblank notes retain arrow-key cursor editing. The list hint reads
`Typing on an option adds notes`.

During an agent turn, a planning question or review modal replaces Pi's working indicator with
`Awaiting Plan` and a distinct waiting animation. Closing, cancellation, failure, or transfer
restores the normal working indicator without changing a newer wait.

Overflow scrolls within the modal. Narrow terminals can stack content, but cannot lose actions,
question context, focused fields, or draft text. Resize preserves selection and drafts and keeps the
focused control visible. The layout fits terminal display width and preserves Unicode text and
input-method focus. When the terminal distinguishes Shift+Enter, that key inserts question-field
newlines; multiline paste is also supported. Mouse input is not required. The Page Up/Page Down hint
says `scroll`. When content overflows, a right-edge scrollbar shows the visible proportion and
position without scrolling the title or footer. Extremely narrow terminals may omit the scrollbar to
preserve usable content width.

**REQ-012 — Same-agent clarification.** Before submitting a round, the user can ask a free-text
question about any item. The waiting interaction returns a typed clarification result identifying
the round, question, and request. It can include current selections and current selected-option
notes explicitly labeled as unsubmitted; unfinished custom answers, unsent clarification text, and
unselected option notes stay local under REQ-031. The owning Pi agent answers, researches further
when needed, and updates the same logical round. The TUI reopens with preserved drafts and the
question-associated response. With an empty draft, Ask for clarification focuses its inline field.
Enter retains the draft and returns to the list without sending. With nonblank text, the row
displays Send clarification; Enter activates that explicit send action and returns control to the
agent. Typing or Backspace edits the draft. When the round reopens, focus identifies the originating
question and makes its response accessible. A separate explanatory model does not satisfy this
requirement.

Editing an unsubmitted answer does not invalidate a pending clarification request. Replacing its
session, plan, or round revision does invalidate delivery.

**REQ-022 — Read-only plan review.** The TUI opens on the latest complete Markdown revision with
scrolling and an always-visible action bar for annotation, overall feedback, feedback
review/submission, and approval. The plan cannot be edited; only user notes accept text. Feedback
returns to the owning agent, which revises the plan and presents it for fresh approval. A new review
opens on the latest plan without a diff or historical annotations overlaid on it.

**REQ-032 — Inline block annotations.** Users can focus document blocks and write notes directly
beside or beneath them while the plan remains visible. Paragraphs, list items, headings, and code
blocks are annotation targets; other Markdown structures can be targeted as whole blocks. Repeated
text and nested blocks remain distinguishable. An annotation identifies its plan revision, source
block, exact source excerpt, and note. Visual wrapping and resize do not change its target.
Arbitrary substring selection and editing plan content are outside this contract.

Notes and overall feedback remain local drafts until explicit batch submission. Users can edit or
remove notes and inspect the outgoing feedback before sending. Confirming a block note requires
nonblank text. The preview identifies unfinished, unconfirmed note edits and excludes them until
confirmed. It includes the overall feedback, confirmed block notes, original excerpts, and revision
identities that the agent will receive. Empty feedback cannot be submitted. Persist unfinished text
as well as confirmed notes under REQ-020. Confirming a note does not submit it to the agent or
change Markdown. After the agent revises the plan, the new revision starts without active notes; old
annotation targets are not silently reassigned to revised text.

**REQ-033 — Revision browsing.** With document focus, `[` and `]` display the previous and next
complete revisions; inside note fields they are ordinary text. The display identifies the viewed
revision and whether it is the latest. Older revisions are read-only: annotation, feedback
submission, and approval apply only to the latest pending review. Returning to the latest restores
its drafts and reading position. Browsing does not change the pending approval identity, create a
revision, replay feedback, or replace the latest revision with an older one.

## State and recovery

**REQ-009 — Planning identity.** Records distinguish the plan, owning Pi session and branch, current
phase, round and question revisions, option identities, answer and per-option details drafts,
clarification history, block annotations, overall feedback drafts, display question numbers, and
exact Markdown revisions. Accepted records also identify the saved path and approval time.
Identities are stable and independent of display position. Internal serialization is
implementation-defined.

**REQ-010 — Workflow transitions.** The visible phases distinguish research, question input,
clarification, plan review, saving, acceptance, and cancellation. Submission returns to research;
clarification returns to the current round; revision feedback returns to review through the agent.
Only explicit user input submits decisions or approves a plan. Saving may be noninterruptible;
cancellation cannot revoke completed acceptance.

**REQ-011 — Revision validation.** Input identifies the session, interaction, and revision the user
saw. Stale input cannot overwrite newer answers or approve newer Markdown. Changes to a question's
meaning or options require reconfirmation; unaffected answers and unfinished text survive.
Reordering unchanged options, prerequisites, or serialized fields does not change their meaning. A
new decision round invalidates an earlier plan review, including across cancellation and resume.

**REQ-020 — Session recovery.** The package persists planning records with the Pi session and
restores the last saved state on the active branch. Draft saving does not submit answers. It
documents any saving delay and reports when persistence is disabled or unavailable. In-memory
records alone do not establish durability. Branch changes cannot import unrelated decisions or
approvals. Navigation preserves recorded planning identity and pending approval attempts. When
planning diverges, including on sibling branches within one Pi session, the continuation receives a
distinct identity before saving another accepted artifact. A pending approval remains bound to its
recorded revision, content, destination, and approval time until explicit retry or cancellation.
Round counts survive persistence and archived-plan selection. Only the current planning record and
settings formats are supported. Unknown settings and incompatible saved records report an error
without changing the stored bytes. The package does not migrate earlier development formats or infer
missing record fields.

**REQ-021 — Cancellation.** Cancellation ends the pending interaction without submitting drafts,
approving a plan, or emitting completion. Saved unfinished work remains available for explicit
resume, including unanswered clarification. After cancellation, reload, or session replacement, late
results and confirmations cannot modify replacement work or start a stale agent continuation. Outer
double Escape also stops the owning agent turn and returns to Default mode. Pi's normal interrupt
during planning research or clarification leaves saved work paused. A later unrelated message cannot
restart it. Cancellation flushes pending draft saves and reports a persistence failure instead of
claiming that unsaved drafts are durable.

**REQ-019 — Configuration.** Personal defaults persist across restarts; trusted project
configuration overrides only supplied fields. The approved-plan directory defaults to `.pi/plans/`
relative to the planning working directory. Absolute paths remain absolute. Invalid settings report
an actionable error. Configuration changes preserve unrelated settings, decisions, and reviewed
Markdown. Filenames and configuration controls are documented implementation choices. The base
package defaults to the TUI and does not require browser configuration. `/plan-settings` opens a
dedicated menu using Pi's settings interaction. When a setting changes, the menu displays the new
value immediately and persists it without progress or success messages. The key hints remain
unchanged. If persistence fails, the menu restores the previous value and reports an actionable
error. Settings include the approved-plan directory, symbols (Unicode by default, emoji opt-in),
modal border (Rounded by default, Square, Double, ASCII, or None), Show hints by default (On by
default), and the planning shortcut (Shift+Tab by default, optionally disabled). The shortcut and
hints settings use the same personal and trusted-project precedence as other settings. The personal
settings menu identifies trusted project values that mask personal choices and names their
configuration file. After a successful save, shortcut changes apply immediately; the menu
distinguishes the saved shortcut from a shortcut blocked by a host binding. Border choice applies to
the outer question, review, and note-dialog frames. Double uses `╔═╗`, `║`, and `╚═╝`; ASCII uses
`+`, `-`, and `|`. Plan-owned footer dividers use `═` for Double, `-` for ASCII, and `─` otherwise.
When hints are shown, None retains the divider. Pi editor decorations remain host-controlled.
Small-terminal fallback preserves accessible content and controls. Appearance changes preserve
drafts and do not change Markdown, decisions, or approval.

## Approval and handoff

**REQ-023 — Save the reviewed plan.** Approval identifies the exact reviewed revision. The package
saves its unchanged Markdown to a distinct `.md` file and records acceptance in the Pi session.
Filename selection prevents path traversal and accidental overwrite. Completion requires
confirmation of both the artifact and persisted acceptance; unavailable persistence cannot report
success.

Unsent annotations, overall feedback, and unfinished note text prevent ordinary approval. A visible
`Discard notes and approve…` action opens a confirmation naming the latest pending revision and
explaining that all its unsent note text will be discarded. Confirming discards that feedback and
approves the unchanged revision. Dismissal preserves the notes and does not approve. The
confirmation is bound to its session, plan, and revision; a stale confirmation cannot discard
replacement notes or approve another revision. Notes are never incorporated into saved Markdown.

On failure, review remains recoverable and the package does not emit a completion event. An
interrupted save requires explicit retry or cancellation. Retry preserves any recorded revision,
content, destination, and approval time, even after settings change. It reconciles a matching
existing artifact without overwriting conflicts, creating duplicates, or inferring approval from a
file alone.

**REQ-024 — Finish idle.** After successful approval, the package exits planning and leaves the
owning agent idle. It does not send an implementation prompt or change other extensions' tools.
Subscribers may independently start another workflow.

**REQ-025 — Approval event.** After confirming saved acceptance and agent idleness, the package
emits `orbis:plan-approved` through Pi's shared event bus. A single turn-end event does not
establish idleness. The version 1 payload is:

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

Subscribers deduplicate by `planId` and `revision` and tolerate additional fields within version 1.
They can subscribe without importing private source.

**REQ-026 — Notification semantics.** Approval events report saved acceptance, not subscriber
success. The package does not await subscribers, retry their work, or revoke approval on subscriber
failure. Resume, reload, and reading an accepted plan do not replay the event. A crash can leave
saved acceptance without notification; subscriber recovery must not be implemented as automatic plan
execution by this package.

## Optional presentation hook

**REQ-029 — Public presentation boundary.** A separate Pi extension can register an optional
presenter through a documented, versioned public API. Registration is local to the Pi process and
returns a way to unregister. The implementation documents its registration and selection entry
points and public input/result types; callers must not import private modules or edit session files.

The hook exposes only a pending planning interaction:

| Boundary     | Required behavior                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input        | Read-only plan and interaction identities, current revisions, and either the numbered round with per-option drafts and clarification history or the exact Markdown under review with block-note and overall-feedback drafts.    |
| Draft update | Validated updates to answer details, block annotations, or overall feedback, preserving their unsubmitted status and source identities.                                                                                         |
| Result       | The same submitted-answer, clarification, revision-feedback, approval, or cancellation outcomes accepted by the TUI, bound to the displayed interaction and revision.                                                           |
| Lifetime     | A cancellation signal and cleanup on completion, replacement, unregistration, or session teardown.                                                                                                                              |
| Fallback     | While the interaction remains active, presenter withdrawal, unavailability, failure, or removal returns it to the TUI with drafts preserved. Plan cancellation and session teardown close the interaction without reopening it. |

**REQ-014 — One active interaction.** The TUI is the default presenter. An explicit user selection
can use a registered presenter for a pending interaction. Only one presenter can submit that
interaction; returning to the TUI invalidates late external results. The package retains state,
applies REQ-011 validation, and controls approval and saving. Presenter callbacks cannot bypass
those checks.

The hook does not require a generic event protocol, durable message queue, external transcript, or
network session registry. An external extension can use Pi's public tools, message APIs, and
lifecycle events for broader agent interaction. It owns the resulting transport, delivery policy,
and application state.

## Errors and bounded results

**REQ-013 — Typed planning outcomes.** Validated model-facing operations cover entry, rounds, and
review. Outcomes distinguish submitted answers, clarification, revision feedback, approval, and
cancellation. Unknown identities and contradictory answer forms are rejected without changing
accepted state. Text preserves Unicode. Execution errors use Pi's failed-tool status; cancellation
and unsupported-mode outcomes are distinct from errors and decisions.

**REQ-027 — Recoverable failures.** Invalid input, unavailable presentation, configuration errors,
and save failures preserve unrelated drafts and accepted plans. Errors identify the failed action
and available retry, TUI fallback, or cancellation. Timeouts never become answers. Unsupported
noninteractive or RPC execution returns an explicit outcome instead of waiting for unavailable
custom terminal components. Cleanup affects only the originating interaction's resources.

**REQ-028 — Bounded agent results.** Structured tool responses and results from reopened
interactions stay within Pi's default output byte and line limits. Oversized results provide the
outcome, a bounded preview, a truncation notice, and a path to the full result. The file remains
readable after interaction and session cleanup; its retention policy is documented. Truncation does
not alter decisions, saved Markdown, or event content and does not limit stored plans or drafts.

## Conformance

These scenarios define observable obligations, not completed verification. Use scripted providers
for automated checks and real Pi terminal interaction to verify keyboard behavior. Instruction
quality also requires representative planning tasks.

| Scenario                     | Expected outcome                                                                                                                                                                                                                                                                     | Requirements              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Install and enter planning   | The TUI completes the workflow alone; explicit and model entry share state and preserve unfinished work.                                                                                                                                                                             | REQ-001, REQ-002, REQ-003 |
| Research and decisions       | Discoverable facts are investigated; the full answerable frontier has useful choices and custom responses.                                                                                                                                                                           | REQ-004, REQ-005, REQ-006 |
| Navigate and submit          | Tab and Shift+Tab preserve unfinished answers; unresolved items block submission and recommendations are not silently accepted.                                                                                                                                                      | REQ-007, REQ-016          |
| Number and qualify answers   | Later frontiers continue question numbering; revisions preserve existing numbers. Other requires text; per-option drafts survive navigation and only the selected option and its current notes are submitted with full question/option context.                                      | REQ-030, REQ-031          |
| Nested modal navigation      | Arrows traverse question boundaries; Enter selects without advancing; editors route keys by context; one Escape returns a level, and only consecutive outer Escapes close. Resize preserves drafts and reachable controls.                                                           | REQ-016, REQ-021          |
| Clarification                | The owning agent receives the question and selected answers with current option notes labeled unsubmitted. Full drafts remain local and restore with the response; no permission-to-continue prompt is added.                                                                        | REQ-005, REQ-012          |
| Revisions and identity       | Changed meaning requires reconfirmation; reordering preserves identity; stale input and reopened decisions cannot approve old review.                                                                                                                                                | REQ-009, REQ-010, REQ-011 |
| Plan review                  | Complete Markdown reflects decisions and limitations; feedback produces another review requiring fresh approval.                                                                                                                                                                     | REQ-008, REQ-022          |
| Annotate and revise          | Block notes retain exact source/revision context through wrapping and resize. Batch preview exposes what will be sent; submission includes overall feedback and never edits Markdown. The revised plan starts without reassigned notes.                                              | REQ-022, REQ-032          |
| Browse revisions             | Review opens on the latest plan. Bracket navigation displays full older revisions without permitting annotation or approval; returning restores current drafts and position.                                                                                                         | REQ-033, REQ-011          |
| Discard and approve          | Unsent notes block ordinary approval. Explicit confirmation discards all pending notes and saves the exact latest revision; Escape or a stale confirmation neither discards replacement notes nor approves.                                                                          | REQ-023, REQ-021          |
| Settings                     | Trusted project fields override supplied defaults; invalid settings fail without changing saved data or decisions. New modals use the saved hints default; F1 changes only the current modal.                                                                                        | REQ-019                   |
| Recovery and cancellation    | Saved drafts restore on their branch; cancellation and late results cannot submit or replace work; unsaved state is reported.                                                                                                                                                        | REQ-020, REQ-021          |
| Save and retry               | Saved bytes equal reviewed Markdown; partial failures preserve the recorded attempt and retries avoid conflicting or duplicate artifacts.                                                                                                                                            | REQ-023                   |
| Approval handoff             | Saved acceptance emits the version 1 event with the agent idle; the package does not start implementation or replay after resume.                                                                                                                                                    | REQ-024, REQ-025, REQ-026 |
| Optional presenter           | A fake presenter receives the current interaction, updates answer and revision-feedback drafts, and returns validated input; withdrawal, failure, or removal restores active work to the TUI and rejects late results. Plan cancellation and session teardown close the interaction. | REQ-014, REQ-029          |
| Invalid or unavailable input | Unknown identities and malformed outcomes fail without mutation; unsupported modes return explicitly and cleanup cannot affect newer work.                                                                                                                                           | REQ-013, REQ-027          |
| Oversized outcome            | Agent output is bounded and identifies a readable full result; decisions and approved content remain unchanged.                                                                                                                                                                      | REQ-028                   |

Additional conformance checks for REQ-003, REQ-016, REQ-019, REQ-021, REQ-030, REQ-031, and REQ-034
cover: idle and busy mode toggles; plain-message entry and natural-language resume; branch
restoration; immediate option-note edits, paste, wrapping, selection and Escape; empty-note list
navigation; Other-last ordering and recommendation placement; selected-row styling; round count
recovery; every border and symbol setting; invalid settings and trusted overrides; interruption
without stale continuation.

## References

- [Composer mode research](docs/research/composer-mode.md): key routing, natural-language entry, and
  harness comparison limits.

- [TUI interactions](docs/tui-interactions.md): scenario walkthroughs and flow diagrams illustrating
  the requirements; required behavior is defined above.
- [TUI design research](docs/research/tui-interaction-design.md): modal, keyboard, and
  block-annotation feasibility and verification limits.
- [Planning research](docs/research/README.md): package comparisons and planning behavior;
  informative rather than an additional contract.
- [Pi integration research](docs/research/pi-integration.md): terminal components, session recovery,
  handoff, and the optional presentation boundary.
- [Pi extension API](https://pi.dev/docs/latest/extensions): tools, custom UI, message delivery,
  lifecycle callbacks, session entries, and shared events.
