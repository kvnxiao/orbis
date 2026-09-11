# @orbis/plan

Collaborative planning in the existing Pi conversation with terminal question rounds, saved drafts,
Markdown review, and explicit approval. Optional Pi extensions can present pending input through a
public local API. The package does not ship a browser server or HTML renderer. Complete real-host,
SSH, input method editor (IME), and model-quality verification remains pending.

The [specification](SPEC.md) and [TUI walkthroughs](docs/tui-interactions.md) define a modal
frontier with stable question numbers, per-option details, block notes, revision browsing, nested
Escape behavior, and confirmation before discarding notes and approving. The commands, keyboard
controls, and public API below describe the implemented workflow.

## Local use

With Pi available on `PATH`, run from the repository root:

```sh
pnpm install
pi -e ./packages/plan
```

While Pi is idle, press Shift+Tab to select Plan mode, then submit an ordinary objective. The
`orbis-plan` status entry reads `Plan mode · Shift+Tab` or `Default mode · Shift+Tab`; while a plan
exists, it appends the phase and whether the state is `saved` or `unsaved`. Switching preserves
composer text and does not send it. During a turn, stop with Escape before switching modes. Modal
Shift+Tab retains its navigation behavior. Entering, resuming, or restoring a plan shows an info
notice `Planning: <objective>. <save status>`; a plan started without an objective reads
`objective not supplied`.

The composer wraps the configured editor through Pi's public editor factory APIs and consumes
Shift+Tab before the editor's own key handling. While this package is loaded, Pi's default
`app.thinking.cycle` binding (Shift+Tab cycles the thinking level) does not fire from the composer.
To keep cycling the thinking level, bind `app.thinking.cycle` to another key in
`~/.pi/agent/keybindings.json`. A later extension that replaces the editor without composing its
previous factory can displace the Plan shortcut.

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
lines separate question groups. The title is `Plan questions (round N)`; revisions of the same round
retain N. Question numbers continue across rounds independently. Selections and current option notes
remain unsubmitted until explicit whole-round submission. Changed questions require reconfirmation.

Option letters restart at A for each question, with Other lettered last. Selected options remain
bold and checkmarked as focus moves. Answered and Unanswered status rows are omitted; changed
questions retain a reconfirmation warning. Letters are display labels, not keyboard shortcuts.
Generated question headings in the frontier and answer preview use Pi's heading styling without
literal hash prefixes. Pi renders Markdown emphasis as terminal styles and preserves literal markup
inside code blocks; plan Markdown uses the existing renderer without heading rewrites.

Generated-option notes appear directly after the option text as an editable `[notes: …]` suffix in
the theme's accent color. The suffix wraps with the option; nonblank notes support Up/Down cursor
movement between displayed rows. Typing, paste, and Backspace update the notes immediately without
selecting the option or requiring confirmation. Editing a selected option also updates its answer
preview. Enter selects the option with its current notes. Tab/Shift+Tab move to the adjacent
question. When notes are empty or whitespace-only, the suffix is omitted and Up/Down navigate the
list. Clearing a selected option's notes also removes its details from the answer, and submission
then carries no details for that option. Escape preserves edits and returns to the list. Right does
not open a frontier field; inside a field it moves the cursor.

A blank line separates the title from the content unless the terminal is too short. Review answers
and submit appears as a bold, accent-colored bracketed button, separated from the questions by a
blank line. `›` marks its focus; the button does not use an option dot. The frontier footer places
its key hints on one line directly below the divider, including `Typing on an option adds notes`. F1
toggles all hints and their divider, including the double-Escape reminder, without hiding errors or
action controls. Each new modal uses the configured hints default; F1 changes only the current modal
and never saves a setting.

Pi's custom overlay, Markdown renderer, and Editor supply the terminal components. A package-local
frame adds the configured borders and horizontal padding. Below six columns, it omits padding; below
four columns or eight terminal rows, it omits the border.

When hints are shown, a horizontal divider separates scrollable content from the fixed footer.
Review-note editors retain their native bottom border. When a divider would displace controls or the
last content row, it is omitted. Overflow adds a right-edge scrollbar whose thumb shows the visible
proportion and position; the title and footer stay fixed. Extremely narrow views may omit the
scrollbar.

During an agent turn, an open question or review modal replaces Pi's working indicator with
`Awaiting Plan` and the rotating circle sequence `◴ ◷ ◶ ◵`, advancing every 350 ms. Closing,
cancellation, failure, or transfer restores Pi's defaults; an older modal's cleanup does not replace
a newer modal's waiting indicator. Opening a modal while Pi is idle does not add a working
indicator.

| Context                                 | Control                | Action                                                                                                                                       |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontier                                | Up / Down              | Move across options and question boundaries without selecting.                                                                               |
| Frontier                                | Tab / Shift+Tab        | Jump between questions with wraparound and focus the selected option, or the first generated choice when unanswered.                         |
| Generated option                        | Enter                  | Select without advancing to another question.                                                                                                |
| Generated option                        | Backspace              | Edit its notes immediately and delete the preceding character without selecting the option.                                                  |
| Question inline field                   | Tab / Shift+Tab        | Move to the next/previous question without selecting an answer.                                                                              |
| Empty or whitespace-only question field | Up / Down              | Return to list navigation and move focus without selecting an answer.                                                                        |
| Focused option or clarification         | Typing or paste        | Start inline notes immediately; wrapping moves following rows while preserving the cursor and fixed actions.                                 |
| Other                                   | Enter                  | Open the required inline answer field; Enter confirms nonempty text.                                                                         |
| Clarification action                    | Enter                  | Open the inline field; Enter retains the draft. Enter on Send clarification explicitly sends it.                                             |
| Review answers and submit               | Enter                  | Preview answers, navigate to missing input, or explicitly submit the complete round.                                                         |
| Plan document                           | Up / Down, Enter       | Focus a source block and open its note editor.                                                                                               |
| Plan review                             | Tab / Shift+Tab        | Switch between document and action-bar focus. With action focus, arrows select an action and Enter opens it.                                 |
| Block or overall note editor            | Enter, Tab / Shift+Tab | Insert a newline in the note, or move focus to confirmation and removal controls.                                                            |
| Plan document                           | `[` / `]`              | Browse full earlier or later revisions.                                                                                                      |
| Scrollable content                      | Page Up / Page Down    | Scroll without editing Markdown.                                                                                                             |
| Pending interaction                     | Ctrl+P                 | Select a registered presenter, when one is available.                                                                                        |
| Nested editor, preview, or confirmation | Escape                 | Return to the outer view and preserve unfinished text without sending it.                                                                    |
| Outermost frontier or review            | Escape, Escape         | Arm closing, showing a reminder only when hints are visible; press again to stop planning with drafts retained. Other input disarms closing. |

Each generated option retains its current notes. Only the selected answer and its current notes
enter the submission preview. Clarification returns to the owning agent with that selected context
marked unsubmitted; unfinished custom text, other options' drafts, and unsent clarification text
stay local. Tool results exclude private drafts before truncation or writing result files.

In question fields, Shift+Enter inserts a newline and Tab/Shift+Tab navigate questions. Other text
uses an accent-colored `[answer: …]` suffix; clarification text uses `[question: …]` in the theme's
link color. Enter finishes inline editing; for Other, it also selects the nonblank custom answer. A
nonblank clarification draft changes the list action to `?. Send clarification`. Enter on that
action explicitly sends the request. When a terminal cannot distinguish Shift+Enter, multiline paste
can supply question-field newlines. Live terminal and SSH key behavior still requires verification.

Plan review renders the full Markdown read-only under the title `Plan review · revision N · latest`.
Its action bar lists `Annotate`, `Overall feedback`, `Review feedback`, `Approve`, and
`Discard notes and approve…` separated by `|`. Block notes retain their exact source excerpt and
revision. Confirming a block note or overall feedback includes it in the local batch; Review
feedback previews that batch, identifies excluded unfinished edits, and requires an explicit
`Send feedback`. The agent receives the batch and returns a revised plan requiring fresh approval.

Unsent notes prevent ordinary approval. Discard notes and approve opens a confirmation for the
latest revision; its `Discard + approve` control discards the pending note text only on explicit
confirmation. Older revisions are read-only and titled
`Plan review · revision N · older — read-only`. Returning to the latest revision restores its drafts
and reading position. Below 120 content columns, the action bar shows only the selected action with
its full label; arrows still reach every action.

Each pending interaction starts in the terminal. When another presenter is registered, Ctrl+P closes
the modal and opens the presenter selector. Selecting an available presenter explicitly transfers
input. Selecting Terminal or cancelling the selector reopens the TUI with drafts preserved and the
saved hints default. Selecting an unavailable presenter also preserves drafts and reopens the TUI.
During external input, Pi shows the presenter's label and controls to return to the terminal or
cancel planning. Selection is not persisted.

## Optional presenters

A separate Pi extension imports `registerPlanPresenter` and the public types from
`@orbis/plan/presentation`. The helper accepts the extension's `pi` API and a presenter with
`version: 1`, a unique `id`, a nonempty `label`, and an asynchronous `present(request)` function.
IDs contain letters, digits, underscores, or hyphens; `terminal` is reserved. Duplicate active IDs
and unsupported versions are rejected. Registration returns an idempotent unregister function.
Definitions reattach on session startup and detach on shutdown; explicit unregister is permanent for
that registration. Registration does not select or invoke a presenter. `registerPlanPresenter` is
the only supported registration entry point. The package discovers registered presenters over
internal event-bus channels; those channels are not a public protocol, and definitions that fail the
version, ID, label, or `present` checks are ignored.

| Value                                       | Contract                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request.identity`                          | Version, session ID, plan ID, invocation-specific interaction ID, and displayed revision. Return this identity with every update and result.                                                                 |
| `request.snapshot`                          | A detached `kind: "round"` snapshot with numbered questions, per-option drafts, and clarification history, or `kind: "review"` with exact Markdown, source blocks, block notes, and overall feedback drafts. |
| `request.updateDraft({ identity, action })` | Synchronously validate a draft action and return the updated detached snapshot. Invalid or stale input throws without mutation.                                                                              |
| `request.signal`                            | Abort signal for completion, transfer, cancellation, removal, or session teardown. Release the presenter's resources when it aborts.                                                                         |
| `present()` result                          | `{ identity, action }` for explicit submission, clarification, feedback, approval, discard-and-approve, or cancellation. Returning `undefined` declines the interaction.                                     |

Every action has a `type` discriminator. Draft actions update local input without submitting it:

| Interaction | Draft action                                                | Effect                                                                                                      |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Round       | `focus { questionId }`                                      | Change the focused question.                                                                                |
| Round       | `edit { questionId, unfinished }`                           | Preserve unfinished custom-answer text.                                                                     |
| Round       | `answer { questionId, answer: { optionId } \| { custom } }` | Select an option with its current notes or confirm nonempty custom text.                                    |
| Round       | `edit-option { questionId, optionId, text }`                | Update that option's notes without selecting it. If it is already selected, also update its answer details. |
| Round       | `edit-clarification { questionId, text }`                   | Preserve an unsent clarification note.                                                                      |
| Review      | `edit-note { blockId, excerpt, text }`                      | Preserve unfinished note text against a current source block and exact excerpt.                             |
| Review      | `confirm-note { blockId }`                                  | Confirm nonempty note text for the feedback batch.                                                          |
| Review      | `remove-note { blockId }`                                   | Remove that block's unfinished and confirmed note.                                                          |
| Review      | `edit-feedback { text }`                                    | Preserve unfinished overall feedback.                                                                       |
| Review      | `confirm-feedback`                                          | Confirm overall feedback for the batch.                                                                     |

Round drafts expose `unfinished` custom text, the selected `answer`, per-option `options` mapping
option IDs to current note strings, and an optional `clarificationDraft`. Use `edit-option` to
update notes and `answer` to select an option; `answer` accepts an option ID or custom text, without
a details field. Review notes expose `blockId`, `excerpt`, `revision`, `unfinished`, and optional
`confirmed` text. `review.feedbackDraft` contains unfinished overall feedback;
`review.overallConfirmed` contains the confirmed text.

Review snapshots expose `blocks`, whose entries contain `id`, `kind`, `start`, `end`, and `excerpt`.
`start` is inclusive and `end` exclusive; both are JavaScript UTF-16 string offsets into
`snapshot.review.markdown`. The excerpt equals `markdown.slice(start, end)` and preserves the
original source, including CRLF line endings. Use the supplied block ID and excerpt for `edit-note`;
do not derive targets from rendered text or interpret the ID format. Targets belong to the
snapshot's revision and can overlap for nested Markdown blocks.

Result actions are `submit`, `clarify { questionId, id, request }`, `submit-feedback`,
`feedback { text }`, `approve`, `discard-approve`, and `cancel`. `submit` validates the complete
core draft set. `submit-feedback` sends confirmed block notes and overall feedback as one batch;
unfinished edits remain excluded. `feedback { text }` sends explicit feedback directly. `approve`
requests saving the current Markdown and rejects unsent notes. Before returning `discard-approve`,
the presenter must obtain explicit confirmation to discard all unsent notes for the current revision
and approve it. Presenters return results only after an explicit user action. Core validation
rejects stale identities and actions for the wrong pending phase.

For example, a review UI can preserve unfinished feedback without sending it:

```ts
request.updateDraft({
  identity: request.identity,
  action: { type: "edit-feedback", text: draft },
});
```

When the user confirms the overall feedback, call `updateDraft` with
`{ identity: request.identity, action: { type: "confirm-feedback" } }`. After previewing the
confirmed notes and obtaining an explicit Send, return
`{ identity: request.identity, action: { type: "submit-feedback" } }` from `present`. The owning Pi
agent receives the same batch as terminal feedback, revises the Markdown, and opens a new terminal
review requiring fresh approval.

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
project overrides. The personal menu omits project overrides; the project menu includes inherited
personal values. Personal settings are `orbis-plan.json` under Pi's `getAgentDir()`; trusted project
settings are `.pi/plan.json` under the session working directory. Only explicitly supplied project
fields override personal values. Untrusted project settings are ignored.

```json
{
  "planDirectory": ".pi/plans/",
  "symbols": "unicode",
  "border": "rounded",
  "showHints": true
}
```

The defaults are shown above. Symbols can be `unicode` or `emoji`. Border styles are `rounded`,
`square`, `double`, `ascii`, and `none`; None retains the footer divider when hints are shown.
Appearance settings apply to the outer Plan frame and Plan-owned dividers. Pi's native editor
decorations retain their own style. The menu uses Pi's `SettingsList`; Pi 0.85.1 does not expose an
extension API for adding rows to native `/settings`.

Use Up/Down to select a setting and Enter to change it. The Approved-plan directory row shows the
value stored in the file being edited; the project menu falls back to the personal value, and both
fall back to the unresolved default `.pi/plans/`. The row never shows the resolved absolute path.
Directory changes open a text field; Enter saves and Escape returns without changing it. Confirming
the field without changing its text writes nothing. The menu displays each change immediately and
saves without progress or success messages; the key hints remain unchanged. A failed write restores
the previous value and reports the error. Escape closes the menu. When a planning interaction next
opens, it uses the updated appearance settings.

Show hints by default controls the initial hints in each question or review modal. Its default is
On. F1 toggles hints within an open modal without changing this setting. Only `planDirectory`,
`symbols`, `border`, and `showHints` are accepted; unknown fields and invalid values report an error
without rewriting the file. Relative directories resolve against the planning session's working
directory; absolute directories remain absolute. Invalid settings report the file and failed field
or action. Settings changes preserve decisions and reviewed Markdown.

## Saving and recovery

Planning state is stored as Pi session custom entries of type `orbis-plan`. Each record holds
`version: 1`, the selected `mode`, the `active` plan when one exists, and the `unfinished` plans.
Runtime draft writes use a 200 ms debounce. Interaction outcomes, entry, review, and shutdown save
immediately. Before Pi writes its first assistant message, or when persistence is disabled or
unavailable, planning state is unsaved.

Restoration reads disk-confirmed records on the active conversation branch. Only the current record
format is accepted. Incompatible or malformed records report an error without rewriting saved data.
When the session file exists but cannot be read, for example because of a permissions error or a
directory at its path, restoration reports the storage error and restores nothing: the mode is
Default with no active plan until the file is readable and Pi is reloaded. A session file that is
missing before Pi's first assistant write is not an error. Forked planning receives a distinct
identity before creating divergent artifacts. Escape stops planning without submitting decisions;
drafts remain recoverable through `/plan` or explicit natural-language resume. Unrelated
conversation in Default mode does not resume a paused plan. Mode selection restores on the saved
branch; new sessions start in Default. Native Escape retains Pi's contextual behavior, including
closing autocomplete. After Pi finishes automatic recovery for an interrupted or failed planning
turn, Plan returns to Default.

When a failed Pi write advances memory beyond disk, further planning writes stop. Correct storage
and reload the saved session. Reload restores the last saved state and discards unsaved edits. The
package does not repair Pi session files.

Approval saves the exact reviewed Markdown as `<planId>-<revision>.md` and records acceptance in the
session. The output filesystem must support hard links; existing files are never overwritten. When
approval fails, the current revision remains available for review. Correct the reported settings or
storage error, then use `/plan` to reopen review and explicitly retry approval, or Escape to pause.
A failed acceptance save can leave the Markdown file present. Even if the configured directory
changes, explicit approval of the same revision retries reconciliation at its recorded path. After
confirming both records, the interface reports acceptance.

After saving approval and observing Pi idle, the package emits `orbis:plan-approved` with the
[version 1 payload](SPEC.md#approval-and-handoff). It does not start implementation or replay events
on restoration. Subscriber failure does not revoke acceptance or trigger delivery retries. Pi can
display its normal aborted-operation banner while the package stops model continuation.

## Verification

The Vitest suite runs local unit and integration fixtures. It does not launch the Pi CLI or call
real models. Persistence checks use disposable Pi SDK sessions; agent-turn checks use an in-process
scripted provider. The Vitest process blocks external fetch and TCP connections and fetch redirects;
loopback fixture traffic is allowed. These tests do not incur model charges.

```sh
pnpm --filter @orbis/plan test
just format
just check
```

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
and narrow terminals. During review, check block focus, note confirmation and batch submission,
revision browsing, transfer back to the TUI, and exact-revision approval with discard confirmation.
Separately verify reload, branch navigation, unresolved clarification, storage failures, and retry.
Scripted fixtures do not establish real-host usability or real-model research and frontier quality.

Node.js 22.19.0 is the declared minimum. Pi 0.85.1 is the compatibility baseline; standalone Pi
binary support remains unverified.

Real-model checks run separately under a live orchestrator during an explicit verification session.
They are excluded from Vitest discovery and `pnpm check`.

## License

[MIT](./LICENSE).
