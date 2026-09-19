# Integrating with @orbis/plan

The [system specification](../SPEC.md) and [interaction contract](tui-interactions.md) define the
package contract. For everyday planning, see the [quick start](../README.md#try-it) and
[usage guide](usage.md).

## Planning tools

The agent calls these tools in response to planning or implementation intent:

| Tool             | Arguments and behavior                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_open`      | Optional `objective` and `replace` create or reopen planning. `replace: true` requires a nonblank `requestId` and confirmation before replacing existing work. It does not start implementation.                       |
| `plan_round`     | `planId`, `roundId`, `expectedRevision`, and `questions` present an answerable frontier. Clarification updates retain the round identity and include the pending clarification response.                               |
| `plan_review`    | `planId`, `expectedRevision`, and complete `markdown` present a revision for user feedback or approval.                                                                                                                |
| `plan_implement` | `action: "here"`, `"new"`, or `"options"` implements an approved plan or reopens its implementation options. Optional `planId` selects an unambiguous plan; `restart: true` requires an explicit user restart request. |

When no plan exists, `plan_open` with `{ "objective": "Plan a local cache" }` creates one. To
explicitly reopen saved questions or review, call it with `{ "replace": false }`. To replace
existing work, use
`{ "objective": "Plan a local cache", "replace": true, "requestId": "replace-local-cache" }`. Reuse
that request ID and the original arguments for a retry; choose a new request ID only for a new
replacement request.

For a new round, set `expectedRevision: 0`. To retry that call, resend its original arguments,
including `expectedRevision: 0`; using its returned revision requests an update. The same rule
applies to `plan_review`: resend the original Markdown and predecessor revision to retrieve its
recorded result. A changed review or clarification update uses the current returned revision. Object
member order does not affect a retry, but question and option order does.

Completed retries return recorded feedback, decisions, approval, or cancellation without another
modal, revision, approval event, or implementation launch. Replay requires unchanged planning state
and intact approved artifacts. Conflicting arguments and superseded results fail without changing
the plan. Pending or uncertain operations require explicit recovery through `plan_open` or `/plan`;
repeating the mutation does not reopen input. A recorded cancellation continues to return
cancellation; explicit reopening restores the interaction. Local-only drafts remain private, and
clarification selections remain explicitly unsubmitted.

If a recorded result includes an implementation launch whose identity, status, or owning session has
changed, replay fails. Use `plan_implement` to inspect the current launch; ordinary repeats do not
start another launch. Only an explicit restart request permits `restart: true`.

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

## Tool results

When planning tool execution fails, Pi records a failed tool result. Cancellation and unsupported
modes return explicit outcomes.

Failed tool results contain message text and empty `details`; thrown error fields are not included.
The message adds the applicable recovery instruction once. Revision conflicts include
`Current revision: <number>. Reload this revision before retrying.` Settings failures identify the
file to correct; artifact conflicts identify the file to preserve and reconcile. Session storage
failures require repair and reload, preserving unsaved changes first. A deferred first-assistant
save reports that deferred state without storage-repair advice. Refusals retain their specific
correction, and unexpected defects retain their original message without retry advice.

When a result exceeds Pi's default text byte or line limit, the tool saves the full JSON under
`orbis-plan-result-*/result.json` in the operating system's temporary directory and returns a
preview. Truncated tool details contain `outcome`, `truncated: true`, and `resultPath`. Read
`resultPath` to retrieve the full result. Input reopened through `/plan` is delivered to the agent
as a displayed custom message of type `orbis-plan-input` that starts a turn. Its results use the
same limits and include the file path in their truncation notice. When approved content exceeds the
output limit, approval results retain completion instructions in the preview and request graceful
termination.

The extension retains these files after shutdown. Operating-system cleanup or manual deletion can
remove them; copy any result that needs lasting storage.

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

The version 1 `updateDraft` callback throws errors with a string `kind`. Import
`PlanPresentationErrorKind`, `PlanPresentationError`, and `isPlanningError` from
`@orbis/plan/presentation` to inspect them. Validate the error structurally with `isPlanningError`
and branch on `kind`; separate extension loaders need not share a class identity.

| Callback kind        | Presenter action                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid-input`      | Correct the update payload before retrying.                                                                                                |
| `rejected`           | Correct the refused edit described by the message.                                                                                         |
| `revision-conflict`  | Reload current input before retrying. `data.expected` identifies the supplied revision and `data.current` identifies the current revision. |
| `interaction-closed` | Stop using the callback and wait for a new presentation request.                                                                           |

Changed session, plan, or interaction identities close the callback. A revision mismatch within the
same identity reports a revision conflict. Invalid updates preserve current drafts. On signal abort,
close the presenter and discard late input.

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

## Saving and recovery

Planning state is stored as Pi session custom entries of type `orbis-plan`. Each record contains
`version: 1`, the selected `mode`, the `active` plan when one exists, and the `unfinished` plans.
Runtime draft writes use a 200 ms debounce. Interaction outcomes, entry, review, and shutdown save
immediately. Before Pi writes its first assistant message, or when persistence is disabled or
unavailable, planning state is unsaved.

Question, review, and replacement operations also save `orbis-plan-operation` session entries.
Before opening UI or mutating planning state, Plan records pending intent with the operation
identity and arguments. After completion, it records the result and planning state. Replay reads
disk-confirmed records on the active branch, including after reload or restoration. A failed record
write remains an error; an absent completed result does not authorize another mutation.

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

When outer double Escape closes review without a matching approval, Plan displays
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

Approval verifies the unchanged revision file and records acceptance in the session. New approvals
with notes also save a companion beside the plan. To derive its path, Plan replaces the plan's `.md`
suffix with `.<approvalId>.notes.md`, including for recreated artifacts. The companion contains the
overall text and block annotations with their original excerpts and revision identities. Notes
remain separate from the plan Markdown. When approval fails, use `/plan` to reopen review and
explicitly retry, or Escape to pause. An approval attempt preserves its revision, destinations,
exact plan and notes content, and approval time through retries, settings changes, and session-tree
navigation. Partial writes do not report success; acceptance requires every required artifact and
the session record to be confirmed.

The approval payload contains `version: 1`, `approvalId`, `planId`, `revision`, `sessionId`, `cwd`,
`planPath`, `planContent`, and `approvedAt`. With supplementary notes it also contains `notes`,
`notesPath`, and `notesContent`; without notes, these fields are omitted together. `notes.overall`
contains the overall text, and `notes.blocks` contains `blockId`, `excerpt`, `revision`, and `text`
for each nonblank annotation. `planContent` remains the exact revision Markdown, and `notesContent`
matches the companion file. Tool results and the approval event contain the same payload.

After saving approval, the package checks Pi's idleness immediately and on `agent_settled`. When Pi
is idle, it emits `orbis:plan-approved` with the
[version 1 payload](../SPEC.md#approval-and-handoff). It does not replay events on restoration.
Subscriber failure does not revoke acceptance or trigger delivery retries. Successful approval
returns a terminating tool result without aborting the agent. A mixed tool batch can continue the
model, and queued user messages retain Pi's normal delivery behavior. The approval result asks a
continuing model to acknowledge approval and finish; it does not guarantee immediate idleness.

After saving acceptance and closing review, Plan immediately opens a native composer-area selector
with the transcript visible. Its options are `Implement in this session`,
`Implement in a new session`, and `Decide later`, in that order, with the first focused. Escape and
Decide later preserve approval and composer text and do not start implementation. Reload and
restoration do not reopen the selector.

Either implementation option authorizes execution without another confirmation, including when the
saved plan says implementation awaits separate authorization. After planning completes and Pi is
idle, the current-session action starts implementation with conversation context retained. The
new-session action creates a fresh Pi session and starts its turn through the replacement context.
Pending user input retains Pi's queue behavior before replacement.

A hidden extension startup message asks the receiving model to call `plan_implement` with action
`here`. The resulting real tool call returns the absolute approved Markdown path, supplementary
notes, and execution authorization. The tool result directs the agent to read the file and implement
the plan with ordinary tools. The startup message does not appear as a pasted user prompt, and Plan
does not fabricate tool-call history. Model adherence to the startup instruction is not guaranteed.
The result includes the first nonblank top-level Markdown heading as the plan title. ATX and Setext
headings are supported; fenced code and nested headings are excluded. Without a heading, the result
identifies the plan by its absolute path.

Natural-language requests to implement here, implement in a fresh session, or show the options again
use `plan_implement` with action `here`, `new`, or `options`. These are intent examples, not exact
phrases; recognition depends on the model. An optional `planId` identifies an unambiguous approved
plan. Without `planId`, multiple saved approvals require explicit selection. Unknown or unapproved
plans cannot launch implementation. Internal token routing resolves the planning command's
invocation name, including any numeric suffix Pi assigns for a command collision. Missing or
ambiguous command registration fails before dispatch. Users do not need a launcher command.

Each launch records its identity, exact approval, destination, and delivery state in session
history. Ordinary repeats reuse that launch across reload and restoration, including requests for
another destination. In the receiving session, the tool returns execution instructions without
another startup message or session and does not require a local planning record. In another session,
it reports the recorded status without starting implementation there. Launch status does not
establish that implementation has completed. Reopening options remains available and still checks
for an existing launch before dispatch.

Only an explicit user request to restart implementation permits `restart: true`. A restart creates
another launch and preserves prior records. A new approval for changed Markdown or supplementary
notes can start a new launch. Ordinary repeats of failed or uncertain launches report their state;
they do not retry.

Before scheduling implementation for a saved approval, Plan returns to Default mode and pauses other
unfinished planning work. Dismissing the options preserves that unfinished work's mode and state.
Saved drafts remain resumable. An active planning interaction must finish before a separate
implementation request can proceed.

Cancelled replacement preserves approval and requires an explicit restart for another attempt.
Handoff failures remain visible. Stale actions cannot launch into another session, and an
ambiguously completed launch is never automatically retried. Inspect the intended session before
requesting further work. Changed or missing approved artifacts must be restored before dispatch.
When the user interrupts the originating turn during the idle wait, its pending implementation
action expires without launching work.

## Reopening approved plans and recovery

To inspect or fine-tune an approved plan, ask to resume its review or run `/plan`. The normal review
modal restores the same Markdown revision, overall notes, and block annotations. Closing unchanged
content preserves approval and completes without a cancellation warning or agent abort. Closure does
not reopen implementation options. Approving unchanged content reopens implementation options
without replaying its approval event. Editing notes creates unapproved drafts; approval binds their
exact contents to a new `approvalId`. When approved notes are nonblank, Plan saves an immutable
companion file. Only agent-returned Markdown creates the next review revision. Historical approvals
do not approve later revisions or changed notes.

Approval-event subscribers deduplicate by `approvalId`. Older version-1 records without that field
retain their original plan/revision identity and companion path. Plan accepts records that omit
those optional fields without rewriting historical entries.

When the latest planning record is incompatible, explicit entry offers the latest valid earlier
checkpoint on the same disk-confirmed branch and warns that newer drafts may be missing. Escape or
Decide later preserves the records. Recovery appends new state; it does not rewind files or external
effects. Unfinished drafts reopen normally. Recovered accepted content requires fresh review and
approval. Without a valid checkpoint, the package reports the limitation and permits explicitly
requested replacement planning.

When a recorded artifact is missing or changed, review offers to recreate its exact recorded bytes
at a new path. Existing files remain unchanged, and the recovered copy requires fresh approval.
Failed recovery reports its error and preserves the original records for another explicit attempt.

During model generation, Pi can display a streamed tool call before executing it. If the user
interrupts that generation, the modal has not opened. Explicit resume restores saved work;
unfinished tool arguments are not a saved question frontier or review revision.
