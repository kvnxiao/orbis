# Plan terminal interactions

This document is normative with [SPEC.md](../SPEC.md). Requirement identifiers name the shared
system contract. Examples illustrate the required interactions without defining a wire format.

## Modal layout

Requirements: REQ-terminal-interaction-boundary.

Key names below describe defaults. Host actions use their effective Pi bindings for input and
displayed hints, including selection, cancellation, paging, editor movement, submission, and
newlines. Disabled bindings do not appear as available. Extension-owned keys derive their hints from
the keys matched by the modal. While a field owns focus, Enter finishes local editing; Shift+Enter
and Ctrl+J insert newlines by default. Finishing a field does not submit the round or approve the
plan.

The modal uses the configured border and occupies 96% of terminal width. Title, action bar, and
optional hints remain fixed while content scrolls. A divider immediately follows the title, with a
blank row below it before content. The right-edge scrollbar identifies the content position.

Every submission action belongs to a call to action (CTA) bar below the content. A blank row
precedes its content divider; another follows that divider; a blank row follows the buttons. These
rows and the content divider do not depend on hints. When hints are enabled, a separate divider
follows the CTA padding and precedes at most one hint line. F1 toggles hints and their divider, not
CTA controls or errors. Each modal starts with the configured hints default. Short terminals omit
decorative padding, dividers, and hints before action controls or the last usable content row.

Enabled buttons use bracketed accent-colored labels. Focused enabled buttons use a contrasting
background, bold text, and `›`; disabled buttons use muted text. A focused disabled button retains
`›` and displays the reason it cannot activate. Focus styling applies even when only one button
exists. While an editor owns focus, buttons retain their unfocused appearance. Buttons wrap as
complete labels on narrow terminals; labels wider than the terminal wrap without losing text. Errors
remain above the buttons. Tab/Shift+Tab traverse individual buttons; Left/Right also move within the
bar. Enter activates only the focused control. Navigation never submits input.

An active agent waiting for a modal displays `Awaiting Plan` and a rotating working indicator.
Closing, failure, transfer, cancellation, and shutdown restore Pi's defaults. Cleanup from an older
modal cannot replace a newer wait indicator. Idle modal use does not create agent activity.

## Question frontier

Requirements: REQ-complete-frontier, REQ-explicit-round-submission, REQ-revision-validation,
REQ-same-agent-clarification, REQ-stable-question-numbers, REQ-option-details.

The title is `Plan questions (round N)`. Question numbers belong to logical decisions and never
change when questions move, change wording, or are reactivated. A distinct decision gets the next
unused number. Refining a decision preserves its number and increments its revision. Unaffected
answers and all drafts survive; a changed question displays `Please select again` and requires a
current selection. Earlier selections and question-version history are not displayed inline.

Questions show the current context, prompt, generated options, Other, and Ask for clarification. The
recommendation and reason follow the options. Option letters and labels are bold; selected options
have a selection marker distinct from keyboard focus. Generated-option notes follow the option in an
accent-colored `[notes: …]` suffix. Other text appears directly after its label in the theme's
Markdown code-block color; clarification text uses its link color. Neither has an answer/question
wrapper. Input and cursor positions wrap with the row.

Only the latest clarification exchange for a question is visible in the frontier. A blank row
separates it from the recommendation. The request label is `User question N: …`; N counts sent
requests for that question and survives revisions. A blank row precedes the response, whose lines
are indented two columns. Pending responses use `Awaiting response`. Older exchanges remain in
stored history and are available in answer review. Clarification can change alternatives,
recommendations, and the frontier's membership; it does not submit selections.

Withdrawn questions show only their original question heading struck through. Their old options,
answers, explanations, and clarification exchanges are not rendered. Deferred questions retain their
number and display a compact waiting heading; they do not require an answer until reactivated. The
agent must explain a withdrawal or deferral in its update, and stored drafts remain recoverable.

| Focus                               | Input                       | Result                                                                                                        |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Question list                       | Up/Down                     | Move across options and question boundaries without selecting.                                                |
| Question list                       | Tab/Shift+Tab               | Move between active questions and the CTA; preserve fields.                                                   |
| Generated option or Other           | Enter                       | Toggle an existing selection; otherwise select the option or nonblank Other draft. Empty Other opens editing. |
| Option, Other, or clarification row | Typing, paste, Backspace    | Start inline editing and apply the initiating input.                                                          |
| Inline field                        | Enter                       | Retain text and return to its row. Generated/Other fields select the answer; clarification remains unsent.    |
| Inline field                        | Shift+Enter / Ctrl+J        | Insert a newline. Multiline paste remains available.                                                          |
| Inline field                        | Escape                      | Retain text and return to the row without arming outer closure.                                               |
| Empty inline field                  | Up/Down                     | Return to list navigation and move to the adjacent row.                                                       |
| Clarification row with text         | Enter on Send clarification | Send the request and close the modal for the owning agent's response.                                         |

Selecting another answer preserves unselected drafts. Clearing a selected answer preserves all text
and leaves the question unanswered. Unsent Other text, clarification text, and unselected option
notes remain local and never enter model-facing results.

The CTA is `Review answers and submit`. Until every active question has a current answer, it is
disabled; focus shows `Question N is not answered` or `Question N needs reconfirmation`. When every
question is withdrawn or deferred, the frontier shows `Continue planning`, which returns control
without creating decisions or approving a plan.

## Answer review

Requirements: REQ-explicit-round-submission, REQ-same-agent-clarification,
REQ-bounded-agent-results.

The review shows the current questions, selected answers, and selected notes. Sent clarification
history is collapsed by default and expandable per question. It contains the sent user questions,
agent responses, and historical question context. The submitted result includes this history
alongside decisions. Unsent drafts remain excluded.

The CTA contains only `Submit round`; Escape returns to the frontier. Tab/Shift+Tab traverse history
disclosures and the submit button. Enter expands a focused history or activates Submit round.
Scrolling retains the action bar and all draft data. Entering review and expanding history do not
submit. The package's normal bounded-result policy also applies to clarification history.

## Frontier history

Requirements: REQ-session-recovery, REQ-frontier-browsing.

F3/F4 browse previous/next logical frontiers within the plan. Each frontier has one browsing stop,
its latest completed snapshot; clarification updates do not create additional stops. Earlier
frontiers have an `earlier — read-only` title and disabled submission controls. They permit reading
and scrolling, but cannot edit answers, send clarification, or submit. Returning to the current
frontier restores its drafts, selection, focus, and reading position. Browsing does not restore
session-tree state or change the owning interaction identity. Snapshot history survives session
reload on the active branch.

## Plan review

Requirements: REQ-read-only-plan-review, REQ-plan-save, REQ-inline-block-annotations,
REQ-revision-browsing.

The title identifies the revision and renders its saved Markdown path as a clickable file link. The
path may be shortened for display; its link targets the absolute file URL. Unsupported terminals
retain readable path text. Before the modal opens, the immutable Markdown file and its recorded path
must be persisted. Failed persistence blocks display with retry/cancellation guidance.

The full Markdown remains read-only and scrollable without source-line numbers. Actual blank source
lines remain visible, including consecutive blank lines. Equal outer margins surround the document
content. The left margin reserves space for `→` on the selected block's first visual row. The entire
selected block is bold, including wrapped rows and descendants of a selected container. A heading
targets only its heading text. Selection is rendered in the document without a duplicated
`Block N: excerpt` footer. Paragraphs, headings, list items, code blocks, and other block structures
retain their source identities, including repeated and nested text. Markdown references, tables,
lists, and code content remain intact.

Each nonblank annotation appears directly below its target block with the label `↑ Note` and a
distinct theme background. Note labels, retained note text, and retained overall feedback use Pi's
built-in `warning` foreground, which the bundled themes define as yellow. Without a supplied theme,
note text is uncolored. Active editors retain native input styling. The label omits source-line
numbers; annotations retain their source identities and exact excerpts. Nested notes are ordered by
their source position and target range. When the selected block owns a note, its label and retained
text are also bold. Selecting a different block removes that note's bold highlight. The note
background remains visible. Overall feedback appears after the complete plan, beneath a divider
matching the configured border style and a blank padding row. Its title,
`Overall feedback (optional)`, is a nonselectable label above a persistent input with horizontal
borders. The title, field, and retained text align with the document content. On the latest
revision, an empty unfocused field displays muted `Add overall feedback` placeholder text. Focusing
the field immediately displays the input cursor and hides the placeholder. Leaving an empty field
restores the placeholder. Earlier revisions display retained feedback or a read-only empty state
without an editing invitation. Clearing a field removes its outgoing note. Notes remain visible
outside editing and are never inserted into the immutable plan file.

Up/Down select document blocks; PgUp/PgDn scroll. A simple list item has one navigation stop; its
text does not create a duplicate paragraph stop. Separate paragraphs and nested blocks inside list
items remain distinct targets. A separately annotated paragraph remains reachable for editing. Down
visits a parent list item, its distinct paragraphs and nested items in document order, then the next
sibling. Up reverses that order. Wrapped continuation rows do not add navigation stops. A selected
parent item includes its descendants in both the bold highlight and the annotation excerpt;
selecting a child limits the target to that child. Typing, paste, or Backspace on a selected block
opens its note and applies the input. Enter opens an empty note; while editing, Enter retains text
and returns to document navigation, and Shift+Enter and Ctrl+J insert newlines. Escape leaves
editing with text retained. F2 opens overall feedback and moves document focus to the field at the
document's end; leaving editing retains that position. Down from the final document block
immediately focuses the latest revision's feedback editor. Within the editor, arrows move the
cursor. When Pi's cursor-up action cannot move the cursor, it returns focus to the final document
target. On the top visual row, a cursor after column zero first moves to column zero. The title does
not add a navigation stop. The shortcut hint labels the action `overall feedback`. Tab/Shift+Tab
leave fields and traverse content and individual CTA buttons. No Confirm note control or separate
feedback preview exists. Printable brackets enter note text like other characters.

Without nonblank notes the CTA is `Approve`. With notes it contains `Approve with notes` and
`Request revision`. Approve with notes accepts the displayed Markdown and supplementary notes;
Request revision submits the same current notes to the agent and awaits a newly reviewed plan.
Neither action interprets the note wording to choose the other outcome. Approval with notes saves a
companion Markdown file and includes structured notes and that file in the approval payload. The
plan artifact remains unchanged. Failed writes preserve drafts and require explicit retry.

F3/F4 browse earlier/later plan revisions. Earlier revisions are clearly read-only and cannot accept
notes, revision requests, or approval. Returning to the latest restores its notes and position.
Browsing cannot change the pending approval identity. New revisions do not inherit active notes from
their predecessors.

## Implementation options

Requirements: REQ-idle-completion, REQ-implementation-handoff, REQ-launch-idempotency,
REQ-handoff-recovery.

After the package saves approval and review releases its input resources, a native Pi selector opens
immediately in the composer area with the transcript visible. It is not a floating overlay. The
title is `Implement approved plan?`. Options appear in this order:

- Implement in this session
- Implement in a new session
- Decide later

The first option starts focused. Native selection bindings navigate and activate the options. Escape
is equivalent to Decide later: it closes the selector, preserves acceptance and composer text, and
finishes planning gracefully without implementation or agent abort. The selector never reopens
automatically. Active unfinished planning interactions retain their double-Escape cancellation.

Either implementation option authorizes execution without another confirmation. The selector closes
before planning completes. The new-session action waits for idleness before replacing the session.
When replacement is cancelled or fails, the saved plan and notes remain available and the failure is
visible. A stale selector cannot launch into a replacement session.

Subsequent requests such as “Implement it here,” “Implement it in a fresh session,” or “Show me the
options again” invoke the same actions through model intent recognition. Ambiguous references open
an explicit saved-plan selection. Selection identifies the plan; it does not add an implementation
confirmation after an already authorized destination.

Hidden startup content does not appear in the transcript. It asks the receiving model to make a real
`plan_implement` call, whose result includes the title derived from the first nonblank top-level
Markdown heading, absolute path, supplementary notes, and execution authorization. Without a title,
the result identifies the plan by its absolute path. Repeated here/new actions reuse the launch;
only an explicit restart creates another launch. Options remain available after a launch.

| Scenario                                                            | Expected result                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Approve while the planning tool waits                               | Review closes and releases input before the selector opens; no idle wait or agent abort occurs.                                                 |
| Dismiss with Escape or Decide later                                 | Both retain exact artifacts and composer text, finish gracefully, and do not start implementation.                                              |
| Choose either implementation destination                            | Hidden startup requests a real receiving tool call; its result includes the approved path, notes, title when present, and authorization.        |
| Repeat here/new after launch or restoration                         | The receiving session returns execution instructions; another session reports status. Repeats do not create another startup message or session. |
| Reopen options, restart explicitly, or approve changed content      | Options remain available; ordinary selections reuse the launch, while explicit restart or a changed approval permits a new launch.              |
| Queue user input or finalize a mixed batch                          | Pi retains its normal continuation behavior; replacement waits for idleness.                                                                    |
| Reload, restore, or replace a session during selection or idle wait | Old actions cannot launch and the selector does not reopen.                                                                                     |
| Cancel replacement or reject startup submission                     | Approval survives, failures remain visible, and another attempt requires explicit restart.                                                      |

## Closing and recovery

Requirements: REQ-revision-validation, REQ-session-recovery, REQ-interaction-cancellation,
REQ-recoverable-failures.

Escape leaves an editor, disclosure view, or answer review without submitting. From the outermost
frontier or plan review, Escape arms closure; a consecutive Escape closes and returns to Default.
For unfinished work, closure also stops the owning agent turn. Other input disarms closure. The
optional reminder belongs to hints. Closing plan review without a matching approval warns
`Plan review closed without approval. Use /plan to resume.` Its expected empty abort response does
not display a model error. Other failures and interruptions remain visible. Pending saves are
flushed; persistence failures cannot be reported as saved drafts. Saved work requires explicit
resume. Late callbacks cannot modify a replacement session or revision.

## Interaction scenarios

| Scenario                                                       | Expected result                                                                                                                                                                                                                                                       | Requirements                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Browse an earlier revision and return                          | Earlier revisions reject notes, revision requests, and approval. Returning to the latest restores its notes and reading position without changing the pending approval identity.                                                                                      | REQ-revision-browsing                                                                                     |
| Clarification revises options and withdraws a sibling question | Current choices require reconfirmation; the sibling retains only its struck heading; drafts and history survive.                                                                                                                                                      | REQ-complete-frontier, REQ-revision-validation, REQ-same-agent-clarification, REQ-stable-question-numbers |
| All active questions are withdrawn                             | Continue planning returns an explicit empty-decision outcome after user activation.                                                                                                                                                                                   | REQ-explicit-round-submission                                                                             |
| Browse an earlier frontier and return                          | Historical input is rejected; current drafts, focus, and scroll remain intact.                                                                                                                                                                                        | REQ-session-recovery, REQ-frontier-browsing                                                               |
| Expand history in answer review                                | Sent exchanges appear; submission includes them and excludes unsent drafts.                                                                                                                                                                                           | REQ-same-agent-clarification, REQ-bounded-agent-results, REQ-option-details                               |
| Type notes on repeated or nested blocks                        | Each note remains bound to the selected source range through resize and appears beneath that target.                                                                                                                                                                  | REQ-terminal-interaction-boundary, REQ-inline-block-annotations                                           |
| Navigate ordered and unordered lists in both directions        | Down visits parent items, distinct paragraphs, nested children and grandchildren, then siblings; Up reverses that order. Wrapped rows and duplicate unannotated paragraphs do not add stops. Parent selection covers its subtree; child selection narrows the target. | REQ-inline-block-annotations                                                                              |
| Review consecutive blank source lines and resize               | Blank source rows remain visible without source numbers; the selection arrow remains on the block's first visual row and wrapped rows remain bold.                                                                                                                    | REQ-inline-block-annotations                                                                              |
| Leave a note and navigate between blocks                       | The selected block's note label and retained text are bold; selecting a different block removes that note's bold highlight.                                                                                                                                           | REQ-inline-block-annotations                                                                              |
| Reach empty overall feedback, edit it, and leave editing       | Down from the final block or F2 focuses the persistent input, shows its cursor, and hides the placeholder. Leaving the empty field restores `Add overall feedback`; the padded title is not selectable. Earlier revisions remain read-only.                           | REQ-read-only-plan-review, REQ-inline-block-annotations, REQ-revision-browsing                            |
| Move upward within overall feedback                            | Pi's cursor-up action moves through wrapped and multiline text; on the top visual row it first moves to column zero. When the cursor cannot move, focus returns to the final document block with text retained.                                                       | REQ-read-only-plan-review, REQ-inline-block-annotations                                                   |
| Traverse actions from overall feedback                         | Tab and Shift+Tab leave the editor and traverse individual action buttons without submitting feedback.                                                                                                                                                                | REQ-read-only-plan-review, REQ-inline-block-annotations                                                   |
| Request revision                                               | All current nonblank notes are submitted once; the next revision requires fresh review.                                                                                                                                                                               | REQ-read-only-plan-review, REQ-inline-block-annotations                                                   |
| Approve with supplementary notes                               | Both immutable artifacts and session acceptance are confirmed before the idle approval event.                                                                                                                                                                         | REQ-session-recovery, REQ-plan-save, REQ-approval-event                                                   |
| File creation or session save fails before display             | Review does not open; exact content remains recoverable for retry.                                                                                                                                                                                                    | REQ-read-only-plan-review, REQ-recoverable-failures                                                       |
| Hide hints or shrink the terminal                              | CTA focus and activation remain available; decoration yields before controls.                                                                                                                                                                                         | REQ-terminal-interaction-boundary                                                                         |

```mermaid
flowchart TD
  Frontier -->|Clarify| Research
  Research -->|Updated same frontier| Frontier
  Frontier -->|All active answers current| Answers[Answer review]
  Frontier -->|No active questions; Continue planning| Research
  Answers -->|Escape| Frontier
  Answers -->|Submit round| Research
  Research -->|Persist exact revision and session| Review[Plan review]
  Review -->|Request revision| Research
  Review -->|Approve or Approve with notes| Save[Verify artifacts and persist acceptance]
  Save -->|Failure| Review
  Save -->|Success| Options[Implementation options]
  Options -->|Decide later or Escape| Accepted
  Options -->|This session| Idle[Graceful completion and idle wait]
  Options -->|New session| Idle
  Idle -->|This session| Startup[Hidden startup message]
  Idle -->|New session| Replace[Fresh session]
  Replace -->|Fresh context| Startup
  Startup -->|Model calls plan_implement| Implement[Tool result supplies execution instructions]
  Replace -->|Cancelled or failed| Accepted
```

## Composer mode, entry, and settings

Requirements: REQ-planning-entry, REQ-configuration-precedence, REQ-session-recovery,
REQ-interaction-cancellation, REQ-composer-mode.

Before using the default Shift+Tab planning shortcut, rebind Pi's `app.thinking.cycle` in its agent
directory's `keybindings.json` and run `/reload`. The default path is
`~/.pi/agent/keybindings.json`; `PI_CODING_AGENT_DIR` changes the directory, and conflict warnings
name the actual path. Until the conflict clears, Shift+Tab retains its Pi action and Plan reports
the required correction. `/plan` remains available. In `/plan-settings`, choose another shortcut or
disable it. The menu shows any trusted project override and any host binding that blocks the
selected shortcut. After a successful save, shortcut changes require `/reload`. Until reload, the
previous shortcut remains active. The shortcut registers through Pi's SDK with a description in
`/hotkeys`; focused modals retain their own input routing.

```mermaid
flowchart TD
    Default[Default composer, idle] -->|Enabled shortcut, preserve text| Plan[Plan composer, idle]
    Plan -->|Enabled shortcut| Default
    Plan -->|Submit ordinary objective| Work[Planning turn]
    Default -->|Explicit planning intent or /plan| Work
    Work -->|Enabled shortcut| Busy[Keep mode; explain stop action]
    Busy --> Work
    Work -->|Escape interrupts| Paused[Default; unfinished plan saved]
    Paused -->|/plan or explicit resume request| Resume[Select saved plan if ambiguous]
    Resume --> Work
    Work -->|Approval| Default
```

Selecting Plan alone does not send composer text or open a saved interaction. While work is running,
mode switching is rejected rather than deferred. Inside modals, Shift+Tab navigates their fields and
questions. Ordinary queued messages retain Pi's delivery policy and the running turn's mode. Default
conversation does not silently restart paused work. Native Escape can dismiss autocomplete without
interrupting the turn. After Pi finishes automatic recovery for an interrupted or failed planning
turn, Plan returns to Default.

Natural-language examples include “enter plan mode,” “help me plan this change,” “resume the plan,”
and “continue planning.” A feature question such as “what does plan mode do?” is not an entry
request. These are examples of intent, not keyword matching rules. The agent asks the user to select
a plan when a reference is ambiguous.

`/plan` restores the current unfinished plan or lists saved plans on this branch for selection.
`/plan-settings` selects personal defaults or trusted project overrides and shows the approved-plan
directory, symbols, border style, Show hints by default, and Planning shortcut. When a trusted
project value masks a personal setting, the personal menu names that value and its configuration
file. Updating appearance does not submit drafts. Unicode and Rounded are defaults; Double uses
double-line frames and dividers, ASCII uses ASCII frame characters and dividers, and None omits the
outer frame while retaining content and CTA dividers. Hints add a separate divider only when shown.
Pi's editor lines retain native styling. When a planning interaction next opens, it uses the updated
appearance settings and preserves its drafts. The settings menu displays each change immediately and
saves without progress or success messages. Key hints remain unchanged. A failed write restores the
previous setting and reports the error; Escape closes the menu.

Show hints by default uses the same personal/trusted-project precedence as the other settings. Set
it to Off and open a modal: hints and their divider are hidden, while errors and action controls
remain visible. Press F1 to show hints for that modal, then reopen it: the saved Off default applies
again. The first outer Escape arms closing even when the reminder is hidden.

| Scenario                                                                                       | Expected result                                                                                                                 | Requirements                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Switch composer modes while idle, then attempt a switch during work                            | Idle switching preserves typed text without sending input. During work, switching is rejected and does not queue a mode change. | REQ-composer-mode                               |
| Save another planning shortcut or disable it, then run `/reload`                               | Before reload, the previous shortcut remains active. After reload, the saved shortcut registers unless disabled or blocked.     | REQ-composer-mode, REQ-configuration-precedence |
| Rebind the host action that blocks the planning shortcut, then run `/reload`                   | The conflict check uses the reloaded host bindings; an unblocked planning shortcut registers and appears in `/hotkeys`.         | REQ-composer-mode                               |
| Update a personal setting with a trusted project override, then force a settings write failure | The menu identifies the overriding value and file. A failed write restores the previous displayed value and reports the error.  | REQ-configuration-precedence                    |

## Terminal and integration scenarios

Requirements: REQ-complete-terminal-package, REQ-revision-validation, REQ-exclusive-interaction,
REQ-terminal-interaction-boundary, REQ-session-recovery, REQ-recoverable-failures,
REQ-public-presentation-boundary.

| Situation                                                             | Observable outcome                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier or plan exceeds terminal height.                             | Content scrolls with a proportional right-edge scrollbar; title and footer stay fixed. Actions and every content line remain reachable. |
| Terminal narrows or resizes while a note is open.                     | Content adapts, actions remain visible, and focus, target identity, text, and confirmed selections survive.                             |
| Unicode, wide characters, or an input method is used.                 | Text is preserved, lines fit display width, and the active field receives cursor/input focus.                                           |
| Terminal cannot distinguish Shift+Enter.                              | Ctrl+J or multiline paste supplies newlines in question and review-note fields; Enter retains text and leaves editing.                  |
| Host selection, cancellation, submission, or newline bindings change. | Input and hints use the effective bindings. Disabled bindings are omitted from hints and do not invoke their former actions.            |
| Optional presenter returns input for an old revision.                 | Validation rejects it without changing current answers, note targets, or approval.                                                      |
| Terminal is selected or the presenter selector is cancelled.          | The TUI reopens with drafts preserved and the saved hints default.                                                                      |
| An active presenter fails or unregisters.                             | The TUI restores the pending interaction with drafts preserved. Cancellation closes without reopening.                                  |
| Persistence fails or a session is restored.                           | The UI reports the save state and restores only the applicable saved branch; it does not infer submission or replay approval.           |

These scenarios define checks to perform during implementation. They are not records of executed
tests or proof that the current interface implements them.

## Reopening and recovery

Requirements: REQ-planning-entry, REQ-read-only-plan-review, REQ-session-recovery, REQ-plan-save,
REQ-implementation-handoff, REQ-handoff-recovery.

Reopening an approved plan uses the normal review modal and its existing CTA actions. Overall text
and block notes restore as editable drafts. Unchanged approval opens implementation options again;
closing unchanged review preserves acceptance without a cancellation warning, agent abort, or
implementation selector. Changed drafts remain unapproved across dismissal and resume. A revision
request sends the current feedback to the agent.

When the latest record is incompatible, explicit entry opens a native selector titled
`Recover planning`. Its first option identifies the latest valid checkpoint, its plan, and phase;
`Decide later` follows. The selector warns that newer drafts may be missing. Escape equals Decide
later. A successful selection restores the checkpoint and reopens its pending interaction. Recovered
accepted content requires fresh approval. Without a valid checkpoint, entry reports the limitation;
explicit replacement remains available and preserves the existing records.

When an artifact needs recovery, a native confirmation identifies the original path and offers to
recreate its recorded content at a new path. Dismissal closes the attempted interaction without
writing a replacement. On confirmation, the package saves the replacement and opens normal review.

```mermaid
flowchart TD
  Entry[Explicit entry] --> State{Saved state}
  State -->|Valid unfinished| Resume[Restore pending interaction]
  State -->|Accepted| Review[Reopen same revision and notes]
  State -->|Invalid latest record| Choice[Offer valid branch checkpoint]
  Choice -->|Recover| Resume
  Choice -->|Dismiss| Preserve[Preserve history]
  Review -->|Unchanged approval| Options[Implementation options]
  Review -->|Changed notes| Approval[Approve exact supplementary content]
  Review -->|Request revision| Agent[Agent returns next revision]
```

Recovery scenarios cover accepted review without identity changes, unchanged closure and
re-approval, changed and cleared notes, fresh Markdown revisions, incompatible latest records,
divergent branches, dismissed recovery, and missing or modified artifacts. Each recovered approval
requires fresh review. Scripted provider scenarios distinguish interrupted tool-argument generation
from an open modal for question frontiers and plan review. Production frontier, answer-confirmation,
and review components must preserve drafts through interruption and explicit resume and reject late
callbacks.
