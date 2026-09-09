# @orbis/plan

Collaborative planning in Pi with terminal and browser question rounds, saved
drafts, Markdown review, and explicit approval. The implementation is available;
complete workflow verification remains pending.
The [specification](SPEC.md) defines the required behavior.

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
and retains saved unfinished work.

Pi loads `src/index.ts` directly. Browser assets ship with source and do not require
a build. Interactive planning requires Pi TUI mode; RPC, JSON, and print execution
return unsupported-mode results.

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
| Ctrl+B              | Switch the active interaction to the browser                        |
| Escape              | Cancel and retain saved unfinished work                             |

During plan review, Ctrl+E opens or closes the feedback editor and Enter sends
feedback. Outside the editor, Ctrl+A approves the displayed revision. Each revised
plan requires fresh approval. Page Up and Page Down scroll the plan.

`/plan-ui [terminal|browser]` switches interfaces and saves the preference in the
configuration scope supplying the current interface. During a browser wait, Pi
displays terminal-switching and cancellation controls. Open the displayed browser URL manually
on the machine running Pi. The server binds loopback and uses a session credential
in the URL fragment. Browser launch and server startup do not establish remote
reachability; use terminal input when the browser cannot connect.

The browser provides question navigation, custom input, clarification, draft review,
submission, and plan feedback or approval. Refreshing or closing a tab does not
submit input. Stale text remains available for recovery as a draft. Markdown escapes
raw HTML, excludes remote images, and permits only HTTP, HTTPS, and mailto links.

## Settings

`/plan-settings` displays effective settings and edits personal defaults or trusted
project overrides. Personal settings are `orbis-plan.json` under Pi's
`getAgentDir()`; trusted project settings are `.pi/plan.json` under the session
working directory. Only explicitly supplied project fields override personal
values. Untrusted project settings are ignored.

```json
{
  "interface": "terminal",
  "planDirectory": ".pi/plans/"
}
```

These are the defaults. `interface` accepts `terminal` or `browser`.
Relative directories resolve against the planning session's working directory;
absolute directories remain absolute. Invalid settings report the file and failed
field or action. Settings changes preserve decisions and reviewed Markdown.

## Saving and recovery

Runtime draft writes use a 200 ms debounce; browser text input also uses a 200 ms
debounce before sending edits. Interaction outcomes, entry, review, and shutdown
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
`orbis:plan-approved` with the [version 1 payload](SPEC.md#completion-event).
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
pnpm format
pnpm check
```

To include rendered browser checks, run
`ORBIS_BROWSER=1 pnpm --filter @orbis/plan test`. On Windows, the checks use
installed Microsoft Edge; other platforms require Playwright Chromium. HTTP
checks run without that environment variable.

Node.js 22.19.0 is the declared minimum. Pi 0.85.1 is the compatibility baseline;
standalone Pi binary support remains unverified.

Real-model checks run separately under a live orchestrator during an explicit
verification session. They are excluded from Vitest discovery and `pnpm check`.

## License

[MIT](./LICENSE).
