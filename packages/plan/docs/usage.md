# Using @orbis/plan

Start with the [quick start](../README.md#try-it). This guide covers keyboard controls, settings,
and recovery. The [integration reference](integrations.md) documents planning tools and optional
presenters.

## Planning entry

Before using the default Shift+Tab planning shortcut, rebind Pi's `app.thinking.cycle` action to
another key in its agent directory's `keybindings.json`, then run `/reload`. Alt+T is unclaimed
across Pi's editor, input, selection, and application bindings:

```json
{
  "app.thinking.cycle": "alt+t"
}
```

On terminals that draw a menu bar, Alt+T opens the Terminal menu; on macOS, Option+T emits `†`
unless the Option key sends Meta. Choose another unclaimed key on those hosts.

The default keybindings path is `~/.pi/agent/keybindings.json`; `PI_CODING_AGENT_DIR` changes the
agent directory. Conflict warnings name the actual path. Until the conflict clears, Shift+Tab
retains Pi's thinking-level action and `/plan` remains available.

While Pi is idle, use the enabled planning shortcut to select Plan mode, then submit an ordinary
objective. The `orbis-plan` status entry shows Plan or Default mode and the configured shortcut,
marked `blocked` when it conflicts with a Pi binding. A disabled shortcut has no key label. While a
plan exists, the status appends the phase and whether the state is `saved` or `unsaved`. Switching
preserves composer text and does not send it. During a turn, stop with Escape before switching
modes. Modal Shift+Tab retains its navigation behavior. Entering, resuming, or restoring a plan
shows an info notice with a `Planning:` heading, the exact saved objective in a fenced block, and a
separate paragraph for the save status. Pending debounced saves omit that paragraph; disabled
persistence and failed saves still report warnings. If the plan has no objective, the fenced block
contains `objective not supplied`.

Plan preserves the configured editor factory and registers its planning shortcut through Pi's SDK.
The registered shortcut appears in `/hotkeys`. Before registration, Plan checks effective Pi
bindings; a conflict preserves Pi's input handling and reports the binding to reassign. The package
does not edit Pi's keybindings. `/plan-settings` can change or disable the planning shortcut; saved
changes require `/reload`. If a replacement editor does not invoke Pi's extension shortcut
dispatcher, the planning shortcut stops working; `/plan` remains available. Host-binding checks do
not detect every shortcut registered by another extension.

Run `/plan <objective>` to start planning, or `/plan` to reopen saved work. With no objective and no
saved plan, `/plan` starts a new plan and asks the agent to develop a plan for the objective in the
conversation. During an active turn, `/plan` is refused with
`Stop the current turn before entering planning.` When several saved plans exist on the current
branch, select the intended plan. Natural-language requests such as “enter plan mode,” “help me plan
this change,” “resume the plan,” and “continue planning” also invoke the planning tools. These are
examples, not required phrases; recognition depends on the model. The owning Pi agent researches and
calls `plan_open`, `plan_round`, and `plan_review`. Repeated entry preserves active work. When the
agent requests replacement through `plan_open`, Pi asks for confirmation and retains saved
unfinished work. Cancelling the confirmation preserves the current plan. Session replacement
invalidates pending confirmation.

The agent researches before each round and presents every unresolved decision whose prerequisites
are settled. It explores viable alternatives before recommending an approach, including relevant
unconventional choices. When research delegation is available, it assigns factual questions and
waits for the findings. After answers, it develops the selected branches and recomputes the
questions. Deferrals remain explicit and do not authorize dependent assumptions. Review summarizes
the shared design and requires a separate approval action.

Each frontier uses concise context and distinct alternatives for material decisions. The agent omits
repeated background and immaterial choices without imposing a question quota or splitting
independent questions across rounds. The package does not cap tool-input lengths, question counts,
or retained plan revisions.

These workflow rules guide the agent. The extension validates identities, input, submission, and
approval; it cannot determine whether research is sufficient or every design branch has been
considered. Model-quality checks remain separate from runtime tests.

Pi loads `src/index.ts` directly without a build. Interactive planning requires Pi TUI mode; RPC,
JSON, and print execution return unsupported-mode results.

## Questions and review

The modal presents the complete question frontier as a continuous list, with generated options
followed by Other and `?. Ask for clarification`. Plan adds these actions; generated options
describe the choices without duplicating them. The recommendation appears below the choices. Blank
lines separate question groups. A blank line separates question context and any reconfirmation
warning from its options. The title is `Plan questions (round N)`; revisions of the same round
retain N. Question numbers continue across rounds independently. Selections and current option notes
remain unsubmitted until explicit whole-round submission. Changed questions show
`Please select again` and require reconfirmation. Withdrawn questions retain only their
struck-through heading; deferred questions show a compact waiting heading. Neither displays old
options nor requires an answer until reactivated.

Option letters restart at A for each question, with Other lettered last. Every option letter and
label is bold before selection, including Other and `?. Ask for clarification`. A selected option's
complete row remains bold and checkmarked as focus moves. Answered and Unanswered status rows are
omitted; changed questions retain a reconfirmation warning. Letters are display labels, not keyboard
shortcuts. Generated question headings in the frontier and answer preview use Pi's heading styling
without literal hash prefixes. Pi renders Markdown emphasis as terminal styles and preserves literal
markup inside code blocks; plan Markdown uses the existing renderer without heading rewrites.

Generated-option notes appear directly after the option text as an editable `[notes: …]` suffix in
the theme's accent color. The suffix wraps with the option; nonblank notes support Up/Down cursor
movement between displayed rows. Typing, paste, and Backspace update the notes immediately without
selecting the option or requiring confirmation. Editing a selected option also updates its answer
preview. In the editor, Enter selects the option with its current notes and returns to its row. On a
selected row, Enter clears the answer and preserves notes, Other text, and clarification drafts and
history. Enter on an unselected option selects it. Tab/Shift+Tab move between active questions and
the submission button. When notes are empty or whitespace-only, the suffix is omitted and Up/Down
navigate the list. Clearing a selected option's notes also removes its details from the answer, and
submission does not include details for that option. Escape preserves edits and returns to the list.
Right does not open a frontier field; inside a field it moves the cursor.

A divider immediately follows the fixed title, with a blank row before scrollable content. The fixed
call to action (CTA) bar has a blank row before its divider, another below the divider, and a blank
row below its buttons. When hints are hidden, the CTA divider and padding remain. Enabled buttons
use bracketed accent-colored labels; focused buttons add a contrasting background, bold text, and
`›`. Disabled buttons are muted; focusing one shows its reason. Tab/Shift+Tab traverse controls, and
Left/Right move within the CTA bar. Buttons wrap onto additional rows as needed. Short terminals
omit decoration before controls or the last usable content row.

Until every active question has a current answer, Review answers and submit is disabled. Focusing it
lists unanswered question numbers and answers that need reconfirmation. With all answers current, it
opens a local answer review showing selected answers and notes. Each question's sent clarification
history is collapsed by default; expanding it shows the exchanges and their original question,
options, and recommendation. Tab/Shift+Tab traverse these disclosures and the single Submit round
button. Enter activates the focused control; Escape returns to the frontier. Submission includes
sent history with the decisions and excludes unsent drafts. An entirely inactive frontier instead
displays Continue planning without creating answers or approving a plan.

F3/F4 browse previous/next logical frontiers. Completed frontiers are saved as detached snapshots;
clarification updates do not create extra browsing stops. Historical frontiers are marked
`earlier — read-only` and cannot accept edits or submissions. Returning restores the active
frontier's drafts, focus, and position. History persists with the plan on the selected session
branch.

F1 toggles at most one hint line and its separate divider, including the double-Escape reminder.
Errors and CTA controls remain visible. Each new modal uses the configured hints default; F1 changes
only the current modal and never saves a setting.

Pi's custom overlay, Markdown renderer, and Editor supply the terminal components. A package-local
frame adds the configured borders and horizontal padding. Below six columns, it omits padding; below
four columns or eight terminal rows, it omits the border.

Review-note editors retain their native borders. When decoration would displace controls or the last
content row, it is omitted. Overflow adds a right-edge scrollbar whose thumb shows the visible
proportion and position; the title and footer stay fixed. Extremely narrow views may omit the
scrollbar.

During an agent turn, an open question or review modal replaces Pi's working indicator with
`Awaiting Plan` and the rotating circle sequence `◴ ◷ ◶ ◵`, advancing every 350 ms. Closing,
cancellation, failure, or transfer restores Pi's defaults; an older modal's cleanup does not replace
a newer modal's waiting indicator. Opening a modal while Pi is idle does not add a working
indicator.

The controls below describe default bindings. Host actions use Pi's effective keybindings for
selection, cancellation, paging, cursor movement, submission, and newlines. Hints show the bindings
used for input and omit disabled bindings. Finishing a field does not submit answers or approve the
plan; use the visible submission controls.

| Context                                 | Control                         | Action                                                                                                                                       |
| --------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier                                | Up / Down                       | Move across options and question boundaries without selecting.                                                                               |
| Frontier                                | Tab / Shift+Tab                 | Move between active questions and the CTA. On a question, focus the selected option or the first generated choice when unanswered.           |
| Generated option                        | Enter                           | Toggle selection without advancing to another question.                                                                                      |
| Generated option                        | Backspace                       | Edit its notes immediately and delete the preceding character without selecting the option.                                                  |
| Question inline field                   | Tab / Shift+Tab                 | Move between active questions and the CTA without selecting an answer.                                                                       |
| Empty or whitespace-only question field | Up / Down                       | Return to list navigation and move focus without selecting an answer.                                                                        |
| Focused option or clarification         | Typing or paste                 | Start inline notes immediately; wrapping moves following rows while preserving the cursor and fixed actions.                                 |
| Other                                   | Enter                           | Clear a selected answer; select nonblank draft text; otherwise open the required field.                                                      |
| Clarification action                    | Enter                           | Open the inline field; Enter retains the draft. Enter on Send clarification explicitly sends it.                                             |
| Review answers and submit               | Enter                           | When every answer is current, open answer review; otherwise remain on the frontier.                                                          |
| Plan document                           | Up / Down                       | Select source blocks or the overall feedback field at the document's end.                                                                    |
| Selected plan block                     | Typing, paste, Backspace, Enter | Open its note and apply the initiating input; Enter opens without inserting text.                                                            |
| Plan review                             | Tab / Shift+Tab                 | Leave editing and traverse the document and individual CTA buttons. Left/Right select a button; Enter activates it.                          |
| Block or overall note editor            | Enter                           | Retain text and leave editing.                                                                                                               |
| Question, block, or overall note editor | Shift+Enter / Ctrl+J            | Insert a newline.                                                                                                                            |
| Plan review                             | F2                              | Focus overall feedback.                                                                                                                      |
| Frontier / plan review                  | F3 / F4                         | Browse previous/next frontiers or plan revisions.                                                                                            |
| Scrollable content                      | Page Up / Page Down             | Scroll without editing Markdown.                                                                                                             |
| Pending interaction                     | Ctrl+P                          | Select a registered presenter, when one is available.                                                                                        |
| Editor or answer review                 | Escape                          | Return to the outer view and preserve draft text without sending it.                                                                         |
| Outermost frontier or review            | Escape, Escape                  | Arm closing, showing a reminder only when hints are visible; press again to stop planning with drafts retained. Other input disarms closing. |

Each generated option retains its current notes. Only the selected answer and its current notes
enter the submission preview. Clarification returns to the owning agent with that selected context
marked unsubmitted; unfinished custom text, other options' drafts, and unsent clarification text
stay local. Tool results exclude private drafts before truncation or writing result files.

In question fields, Shift+Enter and Ctrl+J insert newlines, and Tab/Shift+Tab navigate active
questions and the CTA. Other and clarification text appear directly after their row labels without
brackets or answer/question prefixes. Other uses the theme's Markdown code-block color (green in
Pi's dark theme); clarification uses its link color (blue). Option notes retain their accent-colored
`[notes: …]` suffix. Enter finishes inline editing; for Other, it also selects the nonblank custom
answer. A nonblank clarification draft changes the list action to `?. Send clarification`. Enter on
that action sends the request and closes the modal. The owning agent explains in the existing
conversation, then calls `plan_round` to reopen the same round and display the latest response
beside its question. Earlier exchanges remain available in answer review. A blank line separates the
recommendation and latest clarification exchange. Requests read `User question N: …`, numbered from
1 within each logical question and preserved across revisions and reactivation. Responses appear
below their requests with a blank line and two-column indentation, including wrapped Markdown. Very
narrow terminals reduce the indent to retain a content column. Other drafts remain preserved. When a
terminal cannot distinguish Shift+Enter, Ctrl+J or multiline paste can supply newlines. Live
terminal and SSH key behavior still requires verification.

Plan review renders the full Markdown read-only under `Plan review · revision N · latest`, followed
by a clickable path to its persisted revision file. The link targets an absolute file URL; its
display path may use `~`. Terminals without hyperlink support retain readable path text. The file
and session record must be saved before review opens; a write failure blocks display and reports
retry or cancellation guidance.

The document renders without source-line numbers and preserves actual blank source lines. Equal
outer margins surround the content; the left margin reserves space for `→` beside the selected
block's first visual row. Selection makes the entire block bold, including wrapped rows, without
duplicating the excerpt in a footer. Headings target only their heading text. Unless a simple list
item's paragraph has its own annotation, Up/Down skip the duplicate paragraph stop. Separate
paragraphs and nested blocks remain reachable, and source targets stay unchanged. Down visits a
parent list item, its distinct paragraphs and nested items, then the next sibling; Up reverses that
order. Wrapped rows do not add stops. Selecting a parent item highlights and annotates its full
subtree; selecting a child narrows the target to that child.

Each note appears below its target with the label `↑ Note` and a distinct background; note rows have
no line numbers. Note labels, retained note text, and retained overall feedback use Pi's `warning`
foreground, yellow in the bundled themes. Active editors retain native input styling. Block notes
retain their exact source excerpt and revision. When the selected block owns a note, its label and
retained text are also bold. Moving to another block removes that note's bold highlight and
preserves its background. Overall feedback follows the complete plan beneath a divider and blank
padding row. Its nonselectable `Overall feedback (optional)` title and persistent bordered input
align with the document content. On the latest revision, an empty unfocused field displays muted
`Add overall feedback` placeholder text. Down from the final block or F2 immediately focuses the
editor, displays its cursor, and hides the placeholder. Leaving an empty field restores the
placeholder. The F2 hint reads `overall feedback`. Within the editor, arrows move the cursor. When
Pi's cursor-up action cannot move the cursor, it returns focus to the final document block; on the
top visual row, a cursor after column zero first moves to column zero. Tab and Shift+Tab leave
editing and traverse the action buttons. Empty feedback on earlier revisions displays
`No overall feedback · read-only`.

Typing on a selected block opens its note directly, including printable brackets. Edits are retained
immediately; Enter or Escape leaves editing, and Shift+Enter and Ctrl+J insert newlines by default.
Question and review-note editors use Pi's effective `tui.input.submit` and `tui.input.newLine`
bindings; configured bindings replace the defaults in input and hints. Clearing text removes that
note from the outgoing batch. Notes remain visible outside editing and never change the plan file.

Without nonblank notes, the CTA contains Approve. With notes, it contains Approve with notes and
Request revision. Approve with notes accepts the displayed Markdown together with the current
supplementary notes and saves a companion file. Request revision sends every current nonblank note
and overall feedback directly to the owning agent, which returns a revised plan requiring fresh
approval. There is no separate note-confirmation or feedback-preview step; the chosen button
determines the note batch's intent.

F3/F4 browse earlier/later plan revisions. Older revisions are read-only and titled
`Plan review · revision N · older — read-only`; their approval controls are disabled. Returning to
the latest revision restores its notes and reading position. A new revision starts without active
notes from its predecessor.

Each pending interaction starts in the terminal. When another presenter is registered, Ctrl+P closes
the modal and opens the presenter selector. Selecting an available presenter explicitly transfers
input. Selecting Terminal or cancelling the selector reopens the TUI with drafts preserved and the
saved hints default. Selecting an unavailable presenter also preserves drafts and reopens the TUI.
During external input, Pi shows the presenter's label and controls to return to the terminal or
cancel planning. Selection is not persisted.

## Settings

`/plan-settings` asks which scope to edit, then opens a menu for personal defaults or trusted
project overrides. When a trusted project field masks a personal setting, the personal menu names
its effective project value and configuration file. The project menu includes inherited personal
values. Personal settings are `orbis-plan.json` under Pi's `getAgentDir()`; trusted project settings
are `.pi/plan.json` under the session working directory. Only explicitly supplied project fields
override personal values. Untrusted project settings are ignored.

```json
{
  "planDirectory": ".pi/plans/",
  "symbols": "unicode",
  "border": "rounded",
  "showHints": true,
  "shortcut": "shift+tab"
}
```

The defaults are shown above. Symbols can be `unicode` or `emoji`. Border styles are `rounded`,
`square`, `double`, `ascii`, and `none`; None omits the outer frame while retaining modal content
and CTA dividers. Hints add their own divider only when enabled. Appearance settings apply to the
outer Plan frame and Plan-owned dividers. Pi's native editor decorations retain their own style. The
menu uses Pi's `SettingsList`; Pi 0.85.1 does not expose an extension API for adding rows to native
`/settings`.

The Planning shortcut field accepts a Pi special or modified key, such as `shift+tab` or
`ctrl+alt+p`; enter `disabled` in the menu or set `"shortcut": null` in JSON to disable it. Plain
printable keys and Shift-only printable keys are rejected. The menu reports conflicts with effective
host bindings separately from the saved setting. After a successful save, shortcut changes apply
after `/reload` and follow trusted-project precedence. Until reload, the previous shortcut remains
active. Editing Pi's own keybindings also requires `/reload`. Confirming an unchanged shortcut skips
the write, including equivalent key aliases and modifier order. In a project menu, confirming the
inherited shortcut does not create an override.

Use Up/Down to select a setting and Enter to change it. The Approved-plan directory row shows the
value stored in the file being edited; the project menu falls back to the personal value, and both
fall back to the unresolved default `.pi/plans/`. The row never shows the resolved absolute path.
Directory changes open a text field; Enter saves and Escape returns without changing it. Confirming
the field without changing its text writes nothing. The menu displays each change immediately and
saves without progress or success messages; the key hints remain unchanged. A failed write restores
the previous value and reports the error. Escape closes the menu immediately, including while a
write is pending; the pending write finishes independently. When a planning interaction next opens,
it uses the updated appearance settings.

Show hints by default controls the initial hints in each question or review modal. Its default is
On. F1 toggles hints within an open modal without changing this setting. Only `planDirectory`,
`symbols`, `border`, `showHints`, and `shortcut` are accepted; unknown fields and invalid values
report an error without rewriting the file. Relative directories resolve against the planning
session's working directory; absolute directories remain absolute. Invalid settings report the file
and failed field or action. Settings changes preserve decisions and reviewed Markdown.

## Saving and recovery

Plan stores drafts and decisions in the Pi session. Before Pi's first assistant-message save, or
when persistence is disabled or fails, state is unsaved. The status entry reports saved or unsaved
state. With storage restored, reload to recover the last disk-confirmed state; unsaved edits are
lost.

Before opening Markdown review, Plan saves the exact revision as `<planId>-<revision>.md` in the
configured directory, defaulting to `.pi/plans/`. The filesystem must support hard links. Existing
conflicting files are preserved. A saved file is not an approval. When a write fails, correct
storage and use `/plan` to reopen the saved revision.

Approval binds the displayed Markdown and any supplementary notes. Notes are saved in a separate
companion file; they do not edit the plan Markdown. After approval, choose implementation in the
current session, a new session, or Decide later. Escape and Decide later preserve approval and do
not start implementation. A selected implementation action authorizes execution without another
confirmation. It does not establish that implementation has completed.

Use `/plan` to reopen saved work on the current conversation branch. With several saved plans,
select the intended one. Reopening an approved plan restores its Markdown and notes. Closing it
unchanged preserves approval; approving it unchanged reopens implementation options. Changed notes
require fresh approval, and agent-revised Markdown creates a new revision.

When the latest saved state is incompatible, explicit entry can offer an earlier valid checkpoint on
the same branch. Recovery may omit newer drafts and requires fresh approval of recovered accepted
content. When a recorded artifact is missing or changed, review can recreate its recorded bytes at a
new path without overwriting existing files. Dismissing recovery preserves the records.

Implementation requests reuse a recorded launch across reload and restoration. After a failed or
uncertain launch, inspect the intended session before explicitly requesting a restart. Restoration
does not automatically start implementation or reopen its selector.

The [integration reference](integrations.md#saving-and-recovery) documents persistence records,
approval events, operation retries, and implementation dispatch.
