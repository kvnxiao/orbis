# @orbis/plan

Collaborative planning in the existing Pi conversation with terminal question
rounds, saved drafts, Markdown review, and explicit approval. Optional Pi extensions
can present pending input through a public local API. The package does not ship a
browser server or HTML renderer. Complete real-host and model-quality verification
remains pending.

The [specification](SPEC.md) and [TUI walkthroughs](docs/tui-interactions.md) define
a modal frontier with stable question numbers, per-option details, block notes,
revision browsing, nested Escape behavior, and confirmation before discarding
notes and approving. Those interactions and their extended presenter data await implementation.
The commands, keyboard controls, and public API below describe the available
question-by-question interface.

## Local use

With Pi available on `PATH`, run from the repository root:

```sh
pnpm install
pi -e ./packages/plan
```

Run `/plan <objective>` to start planning, or `/plan` to use the conversation's
objective or reopen active input. The owning Pi agent researches and calls
`plan_start`, `plan_round`, and `plan_review`. Repeated entry preserves active work.
When the agent requests replacement through `plan_start`, Pi asks for confirmation
and retains saved unfinished work. Cancelling the confirmation preserves the
current plan. Session replacement invalidates pending confirmation.

Pi loads `src/index.ts` directly without a build. Interactive planning requires Pi
TUI mode; RPC, JSON, and print execution
return unsupported-mode results.

## Tool results

When planning tool execution fails, Pi records a failed tool result. Cancellation
and unsupported modes return explicit outcomes.

When a result exceeds Pi's default text byte or line limit, the tool saves the full
JSON under `orbis-plan-result-*/result.json` in the operating system's temporary
directory and returns a preview. Truncated tool details contain `outcome`,
`truncated: true`, and `resultPath`. Read `resultPath` to retrieve the full result.
Results from input reopened through `/plan` use the same limits and include the
file path in their truncation notice.

The extension retains these files after shutdown. Operating-system cleanup or
manual deletion can remove them; copy any result that needs lasting storage.

## Questions and review

Question selection and custom text remain drafts until explicit whole-round
submission. Clarification returns to the owning agent with the unsubmitted drafts.
Changed questions require reconfirmation.

| Terminal control    | Action                                                              |
| ------------------- | ------------------------------------------------------------------- |
| Tab / Shift+Tab     | Navigate questions, including wraparound; preserve unfinished input |
| Up / Down, Enter    | Highlight and select an option                                      |
| Ctrl+A              | Accept the question's recommendation                                |
| Ctrl+E, Enter       | Edit and confirm custom text                                        |
| Ctrl+Q, Enter       | Ask the owning agent for clarification                              |
| Ctrl+R              | Open or leave draft review                                          |
| Ctrl+S              | Submit the complete round from draft review                         |
| Page Up / Page Down | Scroll Markdown                                                     |
| Ctrl+P              | Select a registered presenter, when one is available                |
| Escape              | Cancel and retain saved unfinished work                             |

During plan review, Ctrl+E opens or closes the feedback editor and Enter sends
feedback. Outside the editor, Ctrl+A approves the displayed revision. Each revised
plan requires fresh approval. Page Up and Page Down scroll the plan.

Each pending interaction starts in the terminal. Ctrl+P opens the presenter
selector. `/plan-ui terminal|presenter-id` transfers active input explicitly;
`/plan-ui` lists registered IDs. Selecting an unavailable presenter preserves the
current interaction. Selecting the active interface does nothing. During external
input, Pi shows the presenter's label and controls to return to the terminal or
cancel planning. Selection is not persisted.

## Optional presenters

A separate Pi extension imports `registerPlanPresenter` and the public types from
`@orbis/plan/presentation`. The helper accepts the extension's `pi` API and a
presenter with `version: 1`, a unique `id`, a nonempty `label`, and an asynchronous
`present(request)` function. IDs contain letters, digits, underscores, or hyphens;
`terminal` is reserved. Duplicate active IDs and unsupported versions are rejected.
Registration returns an idempotent unregister function. Definitions reattach on
session startup and detach on shutdown; explicit unregister is permanent for that
registration. Registration does not select or invoke a presenter.

| Value                                       | Contract                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request.identity`                          | Version, session ID, plan ID, invocation-specific interaction ID, and displayed revision. Return this identity with every update and result.           |
| `request.snapshot`                          | A detached `kind: "round"` snapshot with questions, drafts, and clarification history, or `kind: "review"` with exact Markdown and its feedback draft. |
| `request.updateDraft({ identity, action })` | Synchronously validate a draft action and return the updated detached snapshot. Invalid or stale input throws without mutation.                        |
| `request.signal`                            | Abort signal for completion, transfer, cancellation, removal, or session teardown. Release the presenter's resources when it aborts.                   |
| `present()` result                          | `{ identity, action }` for explicit submission, clarification, feedback, approval, or cancellation. Returning `undefined` declines the interaction.    |

Draft actions are `focus { questionId }`, `edit { questionId, unfinished }`,
`answer { questionId, answer: { optionId } | { custom } }`, and
`edit-feedback { text }`, each with a `type` discriminator. Draft selections do
not submit a round. Result actions are `submit`,
`clarify { questionId, id, request }`, `feedback { text }`, `approve`, and `cancel`.
Submit validates the complete core draft set; approval requests saving of the
current Markdown. Presenters must return these results only after an explicit user
action. Round and review actions are validated against the pending phase.

For example, a review UI can preserve unfinished feedback without sending it:

```ts
request.updateDraft({
  identity: request.identity,
  action: { type: "edit-feedback", text: draft },
});
```

After the user explicitly sends the feedback, the presenter's `present` function returns
`{ identity: request.identity, action: { type: "feedback", text: draft } }`.
The owning Pi agent receives the same result as terminal feedback. It revises the
Markdown and opens a new terminal review requiring fresh approval.

While an interaction remains active, decline, failure, or unregister restores it
to the terminal with drafts preserved. Plan cancellation and session teardown
close it without reopening. Transferring away from a presenter invalidates its
callbacks. Returning to that presenter creates a new invocation, even for the
same revision; selecting it while it is already active preserves the invocation.
A presenter that ignores cancellation cannot keep the core wait open or apply a
late result.

The API is local to Pi's process. The external extension owns rendering, transport,
browser annotation mapping, authentication, and any broader conversation integration.
It does not need private plan imports or direct session-file writes. Saved
planning state and the approval event remain owned by `@orbis/plan`.

## Settings

`/plan-settings` displays effective settings and edits personal defaults or trusted
project overrides. Personal settings are `orbis-plan.json` under Pi's
`getAgentDir()`; trusted project settings are `.pi/plan.json` under the session
working directory. Only explicitly supplied project fields override personal
values. Untrusted project settings are ignored.

```json
{
  "planDirectory": ".pi/plans/"
}
```

The default output directory is shown above. Older files may contain
`interface: "terminal"` or `interface: "browser"`; these values are accepted and
preserved during unrelated settings writes, but do not select an interface.
Malformed legacy values still report a configuration error.
Relative directories resolve against the planning session's working directory;
absolute directories remain absolute. Invalid settings report the file and failed
field or action. Settings changes preserve decisions and reviewed Markdown.

## Saving and recovery

Runtime draft writes use a 200 ms debounce. Interaction outcomes, entry, review, and shutdown
save immediately. Before Pi writes its first assistant message, or when persistence
is disabled or unavailable, planning state is unsaved.

Restoration reads disk-confirmed records on the active conversation branch.
Forked planning receives a distinct identity before creating divergent artifacts.
`/plan-cancel` cancels without submitting decisions. `/plan-resume` selects archived
unfinished work; `/plan` reopens it or continues research.

When a failed Pi write advances memory beyond disk, further planning writes stop.
Correct storage and reload the saved session. Reload restores the last saved state
and discards unsaved edits. The package does not repair Pi session files.

Approval saves the exact reviewed Markdown as `<planId>-<revision>.md` and records
acceptance in the session. The output filesystem must support hard links; existing
files are never overwritten. When approval fails, the current revision remains
available for review. Correct the reported settings or storage error, then use
`/plan` to reopen review and explicitly retry approval, or `/plan-cancel` to cancel.
A failed acceptance save can leave the Markdown file present. Even if the
configured directory changes, explicit approval of the same revision retries
reconciliation at its recorded path. After confirming both records, the interface reports
acceptance.

After saving approval and observing Pi idle, the package emits
`orbis:plan-approved` with the [version 1 payload](SPEC.md#approval-and-handoff).
It does not start implementation or replay events on restoration. Subscriber
failure does not revoke acceptance or trigger delivery retries. Pi can display its
normal aborted-operation banner while the package stops model continuation.

## Verification

The Vitest suite runs local unit and integration fixtures. It does not launch
the Pi CLI or call real models. Persistence checks use disposable Pi SDK sessions;
agent-turn checks use an in-process scripted provider. The Vitest process blocks
external fetch and TCP connections and fetch redirects; loopback fixture traffic
is allowed. These tests do not incur model charges.

```sh
pnpm --filter @orbis/plan test
just format
just check
```

To exercise source exports, terminal input, and presenter load order without a
model, run `node packages/plan/tests/packed-probe.mts` from the repository root.
The standalone probe blocks network connections. For a distribution check, run
`pnpm pack` in this package, install the emitted tarball and its Pi peers in a
disposable directory, copy `tests/packed-probe.mts` and `tests/presenter-probe.mts`
there, and run `node packed-probe.mts`. This checks public imports without
workspace links or the package's development dependencies.

For real terminal input, use a disposable project and isolated `PI_CODING_AGENT_DIR`.
Load this package and `tests/terminal-probe.mts` with Pi's `-e` option and select
`--provider plan-probe --model probe`. Run `/probe-round` in a fresh session to
exercise question navigation; use another fresh session and `/probe-review` for
Markdown review. The fixture calls the installed package tools through a scripted
in-process provider. It does not call a real model. Add `tests/presenter-probe.mts`
to test Ctrl+P and presenter registration; that fixture submits answers and approves
reviews automatically after selection. Use it only with disposable fixture plans.

Check unfinished text across Tab, Shift+Tab, wraparound, resize, cancellation,
and resume locally and over SSH. During review, check scrolling, draft feedback,
transfer back to the TUI, and exact-revision approval. Separately verify reload,
branch navigation, unresolved clarification, storage failures, and retry. Scripted
fixtures do not establish real-model research or frontier quality.

Node.js 22.19.0 is the declared minimum. Pi 0.85.1 is the compatibility baseline;
standalone Pi binary support remains unverified.

Real-model checks run separately under a live orchestrator during an explicit
verification session. They are excluded from Vitest discovery and `pnpm check`.

## License

[MIT](./LICENSE).
