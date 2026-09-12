# @orbis/plan

Collaborative planning in the existing Pi conversation with terminal question rounds, saved drafts,
Markdown review, and explicit approval. Optional Pi extensions can present pending input through a
public local API. The package does not ship a browser server or HTML renderer. Complete real-host,
SSH, input method editor (IME), and model-quality verification remains pending.

The [system specification](SPEC.md) and [TUI interaction contract](docs/tui-interactions.md) define
a modal frontier with stable question numbers, per-option details, block notes, frontier and
revision browsing, nested Escape behavior, and approval with supplementary notes. The commands,
keyboard controls, and public API below describe the implemented workflow.

## Local use

With Pi available on `PATH`, run from the repository root:

```sh
pnpm install
pi -e ./packages/plan
```

Before using the default Shift+Tab planning shortcut, rebind Pi's `app.thinking.cycle` action to
another key in its agent directory's `keybindings.json`, then run `/reload`. The default path is
`~/.pi/agent/keybindings.json`; `PI_CODING_AGENT_DIR` changes the agent directory. Conflict warnings
name the actual path. Until the conflict clears, Shift+Tab retains Pi's thinking-level action and
`/plan` remains available.

While Pi is idle, use the enabled planning shortcut to select Plan mode, then submit an ordinary
objective. The `orbis-plan` status entry shows Plan or Default mode and the configured shortcut,
marked `blocked` when it conflicts with a Pi binding. A disabled shortcut has no key label. While a
plan exists, the status appends the phase and whether the state is `saved` or `unsaved`. Switching
preserves composer text and does not send it. During a turn, stop with Escape before switching
modes. Modal Shift+Tab retains its navigation behavior. Entering, resuming, or restoring a plan
shows an info notice with a `Planning:` heading, the exact saved objective in a fenced block, and a
separate paragraph for the save status. If the plan has no objective, the fenced block contains
`objective not supplied`.

The composer wraps the configured editor through Pi's public editor factory APIs. Before consuming
the planning shortcut, it checks effective Pi bindings; a conflict preserves Pi's input handling and
reports the binding to reassign. The package does not edit Pi's keybindings. `/plan-settings` can
change or disable the planning shortcut. A later extension that replaces the editor without
composing its previous factory can displace the Plan shortcut. Host-binding checks do not detect
every shortcut registered by another extension.

Run `/plan <objective>` to start planning, or `/plan` to reopen saved work. With no objective and no
saved plan, `/plan` starts a new plan and asks the agent to develop a plan for the objective in the
conversation. During an active turn, `/plan` is refused with
`Stop the current turn before entering planning.` When several unfinished plans exist on the current
branch, select the intended plan. Natural-language requests such as “enter plan mode,” “help me plan
this change,” “resume the plan,” and “continue planning” also invoke the planning tools. These are
examples, not required phrases; recognition depends on the model. The owning Pi agent researches and
calls `plan_start`, `plan_round`, and `plan_review`. Repeated entry preserves active work. When the
agent requests replacement through `plan_start`, Pi asks for confirmation and retains saved
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

For a `plan_round` question with options, supply two to four options and a `recommendation` with an
`optionId` matching one of those options and a nonblank `reason`. A preference stated in context or
an option's explanation does not replace this field. For a free-text question, set `options: []` and
omit `recommendation`. Exactly one option is invalid.

`plan_round` prerequisites reference stable question IDs already recorded as submitted decisions.
For example, if `storage` depends on `interface`, submit the round containing `interface` before
presenting `storage`. Questions in the same frontier and unsubmitted draft answers do not satisfy
prerequisites. When an error lists unresolved prerequisite IDs, defer the dependent question and
preserve those IDs through submission.

Clarification can steer the question, options, recommendation, or frontier membership. To resolve a
pending request, call `plan_round` with the same `roundId`, set `expectedRevision` to the returned
round revision, and supply the complete active `questions` and `clarification: { id, response }`. To
withdraw or defer a question already in that frontier, omit it from `questions` and include
`retire: [{ id, status: "withdrawn" | "deferred", reason }]`. Omitted active questions require an
explicit retirement. When every question is inactive, `questions: []` with the retirements presents
Continue planning for an explicit handoff. Refine the same decision under its existing question ID;
give a different decision a new ID. Reactivation retains the original number, drafts, and sent
clarification history and requires a current answer.

These workflow rules guide the agent. The extension validates identities, input, submission, and
approval; it cannot determine whether research is sufficient or every design branch has been
considered. Model-quality checks remain separate from runtime tests.

Pi loads `src/index.ts` directly without a build. Interactive planning requires Pi TUI mode; RPC,
JSON, and print execution return unsupported-mode results.

## Tool results

When planning tool execution fails, Pi records a failed tool result. Cancellation and unsupported
modes return explicit outcomes.

When a result exceeds Pi's default text byte or line limit, the tool saves the full JSON under
`orbis-plan-result-*/result.json` in the operating system's temporary directory and returns a
preview. Truncated tool details contain `outcome`, `truncated: true`, and `resultPath`. Read
`resultPath` to retrieve the full result. Input reopened through `/plan` is delivered to the agent
as a displayed custom message of type `orbis-plan-input` that starts a turn. Its results use the
same limits and include the file path in their truncation notice.

The extension retains these files after shutdown. Operating-system cleanup or manual deletion can
remove them; copy any result that needs lasting storage.

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
| Block or overall note editor            | Enter / Shift+Enter             | Retain text and leave editing / insert a newline.                                                                                            |
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

In question fields, Shift+Enter inserts a newline and Tab/Shift+Tab navigate active questions and
the CTA. Other and clarification text appear directly after their row labels without brackets or
answer/question prefixes. Other uses the theme's Markdown code-block color (green in Pi's dark
theme); clarification uses its link color (blue). Option notes retain their accent-colored
`[notes: …]` suffix. Enter finishes inline editing; for Other, it also selects the nonblank custom
answer. A nonblank clarification draft changes the list action to `?. Send clarification`. Enter on
that action sends the request and closes the modal. The owning agent explains in the existing
conversation, then calls `plan_round` to reopen the same round and display the latest response
beside its question. Earlier exchanges remain available in answer review. A blank line separates the
recommendation and latest clarification exchange. Requests read `User question N: …`, numbered from
1 within each logical question and preserved across revisions and reactivation. Responses appear
below their requests with a blank line and two-column indentation, including wrapped Markdown. Very
narrow terminals reduce the indent to retain a content column. Other drafts remain preserved. When a
terminal cannot distinguish Shift+Enter, multiline paste can supply newlines. Live terminal and SSH
key behavior still requires verification.

Plan review renders the full Markdown read-only under `Plan review · revision N · latest`, followed
by a clickable path to its persisted revision file. The link targets an absolute file URL; its
display path may use `~`. Terminals without hyperlink support retain readable path text. The file
and session record must be saved before review opens; a write failure blocks display and reports
retry or cancellation guidance.

Blocks display source-line ranges in a gutter. Selection makes the block and its range bold without
duplicating the excerpt in a footer. Each note appears below its target with an upward arrow, its
source range, and a distinct background; note rows have no line numbers. Block notes retain their
exact source excerpt and revision. F2 opens overall feedback after the complete plan. Typing on a
selected block opens its note directly, including printable brackets. Edits are retained
immediately; Enter or Escape leaves editing, and Shift+Enter inserts a newline. Review-note editors
also accept Pi's effective `tui.input.newLine` aliases; their hints show the configured newline
keys. Clearing text removes that note from the outgoing batch. Notes remain visible outside editing
and never change the plan file.

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

## Optional presenters

A separate Pi extension imports `registerPlanPresenter` and the public types from
`@orbis/plan/presentation`. The package exports TypeScript source. In the consuming extension,
install TypeScript and `@types/node` as development dependencies and use this checker configuration:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  }
}
```

Set `"type": "module"` in the consuming package's manifest, or use `.mts` for its source files. Pi
loads the extension source directly; the checker does not emit JavaScript.

The helper accepts the extension's `pi` API and a presenter with `version: 1`, a unique `id`, a
nonempty `label`, and an asynchronous `present(request)` function. IDs contain letters, digits,
underscores, or hyphens; `terminal` is reserved. Duplicate active IDs and unsupported versions are
rejected. Registration returns an idempotent unregister function. Definitions reattach on session
startup and detach on shutdown; explicit unregister is permanent for that registration. Registration
does not select or invoke a presenter. `registerPlanPresenter` is the only supported registration
entry point. The package discovers registered presenters over internal event-bus channels; those
channels are not a public protocol, and definitions that fail the version, ID, label, or `present`
checks are ignored.

Snapshots are detached copies of planning state. Their recursive `readonly` types prevent writes
during TypeScript checking; the objects are not frozen at runtime. Mutating a received snapshot does
not change the plan. Use `updateDraft` to apply draft changes.

| Value                                       | Contract                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request.identity`                          | Version, session ID, plan ID, invocation-specific interaction ID, and displayed revision. Return this identity with every update and result.                                                               |
| `request.snapshot`                          | A detached `kind: "round"` snapshot with the current round and completed-frontier `history`, or `kind: "review"` with exact Markdown, saved path, source blocks, block notes, and overall feedback drafts. |
| `request.updateDraft({ identity, action })` | Synchronously validate a draft action and return the updated detached snapshot. Invalid or stale input throws without mutation.                                                                            |
| `request.signal`                            | Abort signal for completion, transfer, cancellation, removal, or session teardown. Release the presenter's resources when it aborts.                                                                       |
| `present()` result                          | `{ identity, action }` for explicit submission, clarification, revision feedback, approval with or without notes, or cancellation. Returning `undefined` declines the interaction.                         |

Every action has a `type` discriminator. Draft actions update local input without submitting it:

| Interaction | Draft action                                                | Effect                                                                                                      |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Round       | `focus { questionId }`                                      | Change the focused question.                                                                                |
| Round       | `edit { questionId, unfinished }`                           | Preserve unfinished custom-answer text.                                                                     |
| Round       | `answer { questionId, answer: { optionId } \| { custom } }` | Select an option with its current notes or confirm nonempty custom text.                                    |
| Round       | `clear-answer { questionId }`                               | Clear the selected answer and preserve option notes, custom text, and clarification drafts and history.     |
| Round       | `edit-option { questionId, optionId, text }`                | Update that option's notes without selecting it. If it is already selected, also update its answer details. |
| Round       | `edit-clarification { questionId, text }`                   | Preserve an unsent clarification note.                                                                      |
| Review      | `edit-note { blockId, excerpt, text }`                      | Retain current note text against a source block and exact excerpt. Nonblank text enters the outgoing batch. |
| Review      | `remove-note { blockId }`                                   | Remove that block's note.                                                                                   |
| Review      | `edit-feedback { text }`                                    | Retain current overall feedback without submitting or approving it.                                         |

Round drafts expose `unfinished` custom text, the selected `answer`, per-option `options` mapping
option IDs to current note strings, and an optional `clarificationDraft`. Use `edit-option` to
update notes and `answer` to select an option; `answer` accepts an option ID or custom text, without
a details field. When `answer` selects custom text, it also stores that text in `unfinished` for
editing or reselection. `clear-answer` leaves the question unanswered until another `answer` action
selects a response. Round snapshots also expose completed-frontier `history` entries with `number`
and a detached `round`. Questions can include `status: "withdrawn" | "deferred"` and a `reason`;
these questions reject input. Sent clarifications retain their original `question` context. Review
notes expose `blockId`, `excerpt`, `revision`, and current `text`. `review.feedbackDraft` contains
current overall feedback; nonblank notes enter the next explicit submission or approval-with-notes
action without separate confirmation.

Review snapshots expose `blocks`, whose entries contain `id`, `kind`, `start`, `end`, and `excerpt`.
`start` is inclusive and `end` exclusive; both are JavaScript UTF-16 string offsets into
`snapshot.review.markdown`. The excerpt equals `markdown.slice(start, end)` and preserves the
original source, including CRLF line endings. Use the supplied block ID and excerpt for `edit-note`;
do not derive targets from rendered text or interpret the ID format. Targets belong to the
snapshot's revision and can overlap for nested Markdown blocks.

Result actions are `submit`, `clarify { questionId, id, request }`, `submit-feedback`,
`feedback { text }`, `approve`, `approve-with-notes`, and `cancel`. `submit` validates current
answers for every active question. `submit-feedback` sends all current nonblank block notes and
overall feedback as one batch; clearing a field removes its text from the batch. `feedback { text }`
sends explicit feedback directly. `approve` accepts the current Markdown only when no nonblank notes
exist. `approve-with-notes` requires notes and accepts them as supplementary to that exact Markdown.
Only after an explicit user action may presenters return results. Core validation rejects stale
identities and actions for the wrong pending phase.

For example, a review UI can retain feedback without sending it:

```ts
request.updateDraft({
  identity: request.identity,
  action: { type: "edit-feedback", text: draft },
});
```

When the user requests revision, return
`{ identity: request.identity, action: { type: "submit-feedback" } }` from `present`. The owning Pi
agent receives the same batch as terminal feedback, revises the Markdown, and opens a new terminal
review requiring fresh approval. To accept the displayed plan with that feedback as supplementary
notes, return `{ identity: request.identity, action: { type: "approve-with-notes" } }` instead.

While an interaction remains active, decline, failure, or unregister restores it to the terminal
with drafts preserved. Plan cancellation and session teardown close it without reopening.
Transferring away from a presenter invalidates its callbacks. Returning to that presenter creates a
new invocation, even for the same revision; selecting it while it is already active preserves the
invocation. A presenter that ignores cancellation cannot keep the core wait open or apply a late
result.

The API is local to Pi's process. The external extension owns rendering, transport, browser
annotation mapping, authentication, and any broader conversation integration. It does not need
private plan imports or direct session-file writes. Saved planning state and the approval event
remain owned by `@orbis/plan`.

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
immediately and follow trusted-project precedence. Editing Pi's own keybindings still requires
`/reload`. Confirming an unchanged shortcut skips the write, including equivalent key aliases and
modifier order. In a project menu, confirming the inherited shortcut does not create an override.

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

Planning state is stored as Pi session custom entries of type `orbis-plan`. Each record contains
`version: 1`, the selected `mode`, the `active` plan when one exists, and the `unfinished` plans.
Runtime draft writes use a 200 ms debounce. Interaction outcomes, entry, review, and shutdown save
immediately. Before Pi writes its first assistant message, or when persistence is disabled or
unavailable, planning state is unsaved.

Restoration reads disk-confirmed records on the active conversation branch. Only the current record
format is accepted. Incompatible or malformed records report an error without rewriting saved data.
When the session file exists but cannot be read, for example because of a permissions error or a
directory at its path, restoration reports the storage error and restores nothing: the mode is
Default with no active plan until the file is readable and Pi is reloaded. A session file that is
missing before Pi's first assistant write is not an error. Tree navigation preserves planning
identity and pending approval attempts. Before saving another artifact, a divergent continuation
receives a distinct identity, including on sibling branches within the same Pi session. A pending
approval retry retains its recorded identity and destination. Escape stops planning without
submitting decisions; drafts remain recoverable through `/plan` or explicit natural-language resume.
Unrelated conversation in Default mode does not resume a paused plan. Mode selection restores on the
saved branch; new sessions start in Default. Native Escape retains Pi's contextual behavior,
including closing autocomplete. After Pi finishes automatic recovery for an interrupted or failed
planning turn, Plan returns to Default.

When outer double Escape closes plan review, Plan displays
`Plan review closed without approval. Use /plan to resume.` Draft text is retained, and persistence
failures remain visible. The expected empty abort response from the stopped turn does not display an
error banner. Provider failures, unrelated interruptions, and assistant content remain unchanged.

When a failed Pi write advances memory beyond disk, further planning writes stop. Correct storage
and reload the saved session. Reload restores the last saved state and discards unsaved edits. The
package does not repair Pi session files.

Before displaying a revision, Plan saves its exact Markdown as `<planId>-<revision>.md` in the
configured directory and persists its path and content with the session. Earlier revisions retain
their own files. The output filesystem must support hard links; existing conflicting files are
preserved. File existence does not imply approval. A failed artifact or session write prevents
review from opening; correct storage and use `/plan` to retry the saved revision.

Approval verifies the unchanged revision file and records acceptance in the session. Approval with
notes also saves `<planId>-<revision>.notes.md` beside the plan. The companion contains the overall
text and block annotations with their original excerpts and revision identities. Notes remain
separate from the plan Markdown. When approval fails, use `/plan` to reopen review and explicitly
retry, or Escape to pause. An approval attempt preserves its revision, destinations, exact plan and
notes content, and approval time through retries, settings changes, and session-tree navigation.
Partial writes do not report success; acceptance requires every required artifact and the session
record to be confirmed.

The approval payload contains `version: 1`, `planId`, `revision`, `sessionId`, `cwd`, `planPath`,
`planContent`, and `approvedAt`. With supplementary notes it also contains `notes`, `notesPath`, and
`notesContent`; without notes, these fields are omitted together. `notes.overall` contains the
overall text, and `notes.blocks` contains `blockId`, `excerpt`, `revision`, and `text` for each
nonblank annotation. `planContent` remains the exact revision Markdown, and `notesContent` matches
the companion file. Tool results and the approval event contain the same payload.

After saving approval, the package checks Pi's idleness immediately and on `agent_settled`. When Pi
is idle, it emits `orbis:plan-approved` with the [version 1 payload](SPEC.md#approval-and-handoff).
It does not start implementation or replay events on restoration. Subscriber failure does not revoke
acceptance or trigger delivery retries. Pi can display its normal aborted-operation banner while the
package stops model continuation.

## Verification

The Vitest tests and benchmarks run local fixtures without live models. The tests do not launch the
Pi CLI. Persistence checks use disposable Pi SDK sessions; agent-turn checks use an in-process
scripted provider. The Vitest process blocks external fetch and TCP connections and fetch redirects;
loopback fixture traffic is allowed. Tests and benchmarks do not incur model charges.

```sh
pnpm --filter @orbis/plan test
just format
just check
```

To measure document layout, modal rendering, draft transitions, and session saves, run the offline
benchmarks separately:

```sh
pnpm --filter @orbis/plan exec vitest bench --run
```

Benchmark results are written under the package's ignored `implementation/performance/` directory.
Rendering and save timings depend on the fixture, terminal width, runtime, and machine; these
measurements do not establish real-terminal responsiveness or model quality.

To exercise source exports, terminal input, and presenter load order without a model, run
`node packages/plan/tests/packed-probe.mts` from the repository root. The standalone probe blocks
network connections. For a distribution check, run `pnpm pack` in this package, install the emitted
tarball and its Pi peers in a disposable directory, copy `tests/packed-probe.mts` and
`tests/presenter-probe.mts` there, and run `node packed-probe.mts`. This checks public imports
without workspace links or the package's development dependencies.

To generate scripted modal recordings, run from the repository root:

```sh
node packages/plan/tests/record-tui.mts
```

The command prints the generated offline player's path and writes asciinema v2 `.cast` files and
`frames.json` beside it. These files remain in the ignored local evidence directory. The player
displays plain text and provides frame navigation; the casts retain ANSI colors. Each captured frame
lasts two seconds.

The fixture drives the actual `TerminalRound`, `TerminalReview`, and Pi `Editor` with a fake
terminal and scripted state transitions. It checks viewport bounds and scenario outcomes without
launching Pi or calling a model. Its editor uses Pi's Markdown horizontal-rule and select-list theme
colors, and its frame uses the horizontal-rule color. The production wrapper uses border and muted
colors. The fixture does not capture the Pi shell, hardware cursor, real input timing, or disk
recovery.

For real terminal input, use a disposable project and isolated `PI_CODING_AGENT_DIR`. Load this
package and `tests/terminal-probe.mts` with Pi's `-e` option and select
`--provider plan-probe --model probe`. Run `/probe-round` in a fresh session to exercise question
navigation; use another fresh session and `/probe-review` for Markdown review. The fixture calls the
installed package tools through a scripted in-process provider. It does not call a real model. Add
`tests/presenter-probe.mts` to test Ctrl+P and presenter registration; that fixture submits answers
and approves reviews automatically after selection. Use it only with disposable fixture plans.

Check unfinished custom text, per-option details, and multiline clarification across navigation,
wraparound, resize, nested Escape, cancellation, and resume locally and over SSH. Exercise IME input
and narrow terminals. During review, check block focus and batch submission, frontier and revision
browsing, transfer back to the TUI, direct notes, revision requests, and exact-revision approval
with supplementary notes. Separately verify reload, branch navigation, unresolved clarification,
storage failures, and retry. Scripted fixtures do not establish real-host usability or real-model
research and frontier quality.

Node.js 22.19.0 is the declared minimum. Pi 0.85.1 is the compatibility baseline; standalone Pi
binary support remains unverified.

Real-model checks run separately under a live orchestrator during an explicit verification session.
They are excluded from Vitest discovery and `pnpm check`.

## License

[MIT](./LICENSE).
