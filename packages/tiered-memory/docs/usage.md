# Tiered memory configuration

The extension currently provides configuration and activation controls. The observer, which will
extract session evidence, and the consolidator, which will organize older observations, have
independent model settings. Neither worker runs in this version. Memory storage, recall, and custom
compaction are also unavailable.

## Commands and session state

| Command                 | Result                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `/tiered-memory`        | Print status.                                              |
| `/tiered-memory status` | Print status.                                              |
| `/tiered-memory on`     | Set the current session's activation override to enabled.  |
| `/tiered-memory off`    | Set the current session's activation override to disabled. |

Subcommands are case-sensitive and reject additional arguments. Surrounding whitespace is ignored.
Unknown arguments print usage without changing activation. Commands do not edit settings files or
Pi's native auto-compaction setting.

Pi session entries retain the activation override on the selected conversation branch. Resume and
fork restore the override present on that branch; tree navigation selects the override at the
destination. A new unrelated session uses configured defaults.

An in-memory session does not save the override after exit; Pi may defer writing a new session until
its first assistant response.

## Settings files

The personal settings file is `tiered-memory.json` inside Pi's resolved agent configuration
directory. For standard Pi, the path is `~/.pi/agent/tiered-memory.json`; setting
`PI_CODING_AGENT_DIR` changes the containing directory. The extension uses Pi's `getAgentDir()` to
resolve it.

The project settings file is `.pi/tiered-memory/settings.json` inside the current Git worktree root,
or the session's working directory outside Git. Nested repositories and separate worktrees use
separate settings files. Missing settings files do not override values.

Git must be available on `PATH`, including outside a repository. During session start or reload,
project-root discovery has a two-second timeout. If discovery fails, configuration is unavailable
and native Pi remains usable. Restore Git access and run `/reload` to retry.

Configuration applies in this order:

1. Built-in defaults.
2. Fields supplied by personal settings.
3. Fields supplied by project settings, when Pi reports the project trusted.
4. The current session's activation override.

Nested `limits` fields merge individually. Omitted fields inherit the value from the preceding
scope. Temporary and permanent host trust both permit project overrides. Untrusted project settings
are not read, and status reports their exclusion. The extension parses settings as JSON without
executing project code.

For example, a personal settings file can disable activation by default and shorten the worker
timeout:

```json
{
  "enabled": false,
  "limits": {
    "jobTimeoutMs": 30000
  }
}
```

Settings load on session start and `/reload`; file edits take effect on the next load. These
settings do not add rows to Pi's native `/settings` command.

After a successful load, Pi's session retains a snapshot of the effective settings and their
sources, including the personal settings path, project settings path, and host trust state. While
those paths and trust state still match the current session, tree navigation preserves the loaded
configuration and saves it on the destination branch. Tree navigation does not reload files.

If a replacement file is invalid or unreadable and a saved configuration's paths and trust state
still match, the extension reuses the latest valid snapshot on the selected branch. A different
configuration directory, project root, or trust state prevents reuse of that snapshot.

Without a matching valid snapshot, a failed load leaves configuration unavailable and status reports
the error. Native Pi remains available. Correct the file and run `/reload` to retry. Pi writes
snapshots when it writes the session; in-memory sessions do not persist them.

## Activation and model settings

| Setting             | Default | Meaning                                                                         |
| ------------------- | ------- | ------------------------------------------------------------------------------- |
| `enabled`           | `true`  | Default activation before the session override.                                 |
| `observerModel`     | Omitted | Observer provider/model identifier; omission uses the active session model.     |
| `consolidatorModel` | Omitted | Consolidator provider/model identifier; omission uses the active session model. |

Model overrides use `provider/model` form with no whitespace. The first slash separates the provider
from the model identifier; the model identifier may contain further slashes. Overrides resolve
through Pi's model registry. An omitted override uses the active session model and its current
capacity limits. Each role checks Pi's configured credentials independently. Missing models or
credentials suspend the affected role and appear in status. The extension does not substitute
another provider or model.

With a valid configuration, model checks run on session start, reload, tree navigation, model
selection, and `/tiered-memory on`. Changing the active model changes roles whose override is
omitted. Status reports the latest check without repeating it. `/tiered-memory off` clears the
resolved role details, so status may show `not resolved` until the next check.

## Resource limits

All fields below belong inside the `limits` object. Token values are estimates or caps, not measured
provider usage or billing guarantees. These settings define limits for the intended memory
operations; unavailable operations do not consume their budgets.

In the intended system, the current-work note summarizes ongoing work, the index points to retained
memory, and the checkpoint replaces older conversation content after compaction.

| Field                          | Default | Unit and purpose                                                |
| ------------------------------ | ------- | --------------------------------------------------------------- |
| `queuedJobs`                   | 8       | Maximum queued jobs.                                            |
| `workerInputTokens`            | 8192    | Estimated input-token cap per worker request.                   |
| `workerOutputTokens`           | 2048    | Generated-token cap per worker request.                         |
| `jobTimeoutMs`                 | 60000   | Milliseconds per job.                                           |
| `retries`                      | 1       | Additional attempts per job.                                    |
| `compactionWaitMs`             | 5000    | Milliseconds per compaction attempt, including catch-up.        |
| `workNoteTokens`               | 1024    | Estimated tokens reserved for the current-work note.            |
| `consolidationThresholdTokens` | 4096    | Estimated active-observation tokens that trigger consolidation. |
| `activeObservationTokens`      | 8192    | Estimated active-observation token cap.                         |
| `indexTokens`                  | 512     | Estimated index tokens, including recall guidance.              |
| `checkpointTokens`             | 4096    | Estimated checkpoint-token cap.                                 |
| `recallTokens`                 | 2048    | Estimated recall-output token cap.                              |
| `recallBytes`                  | 16384   | UTF-8 recall-output byte cap.                                   |

The settings file and its `limits` field must be JSON objects. Limits must be finite safe integers.
`retries` permits zero; every other limit must be positive. Unknown fields, malformed model
identifiers, non-boolean activation values, and invalid JSON are rejected. Omit optional fields to
inherit values; `null` is invalid. The work-note reserve must fit both the checkpoint and
worker-output budgets. The consolidation threshold must fit the active-observation budget, and the
work-note reserve plus index must fit the worker-input budget.

For each resolved worker model, the output cap is the smaller of `workerOutputTokens` and the
model's maximum output. The input cap is the smaller of `workerInputTokens` and the model's context
window minus that output cap. If the work-note reserve exceeds the output cap, or the work-note
reserve plus index exceeds the input cap, status reports the role as suspended.

The acting model runs the main conversation. Status checks its current-work-note reserve separately
against its context window and Pi's available context-usage estimate. These preliminary checks do
not establish whether a complete model request fits. The intended system must account for
instructions, sources, retained context, tool schemas, and generation headroom separately for worker
requests and requests to the acting model.

## Status and recovery

Status identifies activation and its source, effective model and limit sources, model suspension
reasons, and settings paths. It marks memory paths and revisions, observations, worker accounting,
and compaction outcomes unavailable while those capabilities are unimplemented.

In the terminal, commands display a notification. RPC clients receive Pi's `extension_ui_request`
event with `method: "notify"`, `notifyType: "info"`, and the report in `message`. Each report is
also saved in an `orbis-tiered-memory-report` custom session entry with the report text in
`data.text`. Rerun `/tiered-memory status` to record and display current state. JSON and print-mode
report rendering are not supported in this version. Status does not start a model turn or add
diagnostic messages to model context.

For an unresolved model, correct the provider/model identifier or configure it in Pi, then run
`/reload`. For missing credentials, configure the selected provider in Pi and run `/reload` to
refresh the model checks. For invalid settings, correct the reported field and run `/reload`.
