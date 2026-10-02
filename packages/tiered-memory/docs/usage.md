# Tiered memory configuration

The extension currently provides configuration and activation controls. The observer, which will
extract session evidence, and the consolidator, which will organize older observations, have
independent model settings. Neither worker runs in this version. Storage records source identities
and supports controlled memory revisions; recall and custom compaction remain unavailable. The
[storage guide](storage.md) describes saved files, external curation, and recovery.

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

Pi session entries retain the activation override on the selected conversation branch, in an
`orbis-tiered-memory-activation` custom entry, which Pi excludes from model context. Resume and fork
restore the override present on that branch; tree navigation selects the override at the
destination. A new unrelated session uses configured defaults.

Storage adds two custom entry types, which Pi also excludes from model context. An
`orbis-tiered-memory-project` entry binds the session's branch to its canonical project root,
project identifier, and memory session identifier. An `orbis-tiered-memory-revision` entry
references a committed memory revision by project, session, and revision identifier; it selects that
revision once Pi has written the entry to the session file. A revision entry whose data fails
validation is damaged: it selects nothing, the extension leaves it unchanged in the session file,
and status lists it while it is on the active branch.

At session start, the extension writes identity and source records for every persisted Pi session in
the project, including while memory is disabled. Disabling memory preserves stored records and
cancels pending memory writes. A commit that has already written its revision head still completes
and records the revision on the branch. A cancelled commit that has already registered its sources
still refreshes storage status. Source registration at session start and tree navigation,
session-note curation checks, and managed-file write guards remain active.

An in-memory session does not save the override after exit and gets no memory storage; status
reports that storage needs a persisted session, and the write guard still applies. Pi may defer
writing a new session until its first assistant response.

## Settings files

The personal settings file is `tiered-memory.json` inside Pi's resolved agent configuration
directory. For standard Pi, the path is `~/.pi/agent/tiered-memory.json`; setting
`PI_CODING_AGENT_DIR` changes the containing directory. The extension uses Pi's `getAgentDir()` to
resolve it.

The project settings file is `.pi/tiered-memory/settings.json` inside the current Git worktree root,
or the session's working directory outside Git. Nested repositories and separate worktrees use
separate settings files. Missing settings files do not override values.

Project-root discovery checks the session's working directory and then each of its ancestors for a
`.git` file or directory; the first directory that has one is the project root. Without one, the
working directory is the project root. Discovery does not invoke Git.

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
sources, including the personal settings path, project settings path, and host trust state, in an
`orbis-tiered-memory-configuration` custom entry, which Pi excludes from model context. While those
paths and trust state still match the current session, tree navigation preserves the loaded
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
reasons, settings paths, the memory project root, the selected and latest durable memory revisions,
and storage errors. It reports the registered-source and curated-note counts from the latest storage
refresh. Both counts are labeled with the event of the registration that refresh used:
`session_start`, `session_tree`, or `commit`. A refresh runs:

- At session start and after tree navigation.
- After a model selection or `/tiered-memory on`.
- After each commit attempt that registered its sources and then committed, conflicted, or was
  cancelled, unless a reconciliation is pending or failed.

Status reads that cached state and the active branch and writes no memory files. Observations,
worker accounting, recall, and custom compaction remain unavailable.

In every storage state, status lists the damaged `orbis-tiered-memory-revision` entries on the
active branch in branch order, with each entry ID and the first path that fails validation. The line
appears only when such entries exist:

```text
Damaged revision references on the active branch: 2 excluded from lineage selection (entry 7f3a91c2 at /version, entry 9c1e04b8 at /revisionId)
```

Memory commits are blocked while a damaged entry could hide a revision newer than the selected one;
the [storage guide](storage.md#recovery) defines when that applies. While storage is open and
commits are blocked, status names the first blocking entry:

```text
Memory commits: blocked by damaged revision reference entry 7f3a91c2. Navigate with /tree to a point before that entry to remove this lineage block.
```

For a selected revision, the validity line then reads
`uncertain: damaged revision references follow the selected revision` in place of `current`. A
selected revision that is already invalid keeps its reason and invalid notes, and the line ends with
`Uncertain: damaged revision references follow the selected revision.`

Memory commits are also blocked for the causes below, and the validity line still describes the
selected revision's notes. While storage is open, status prints one line for each cause that
applies, after any damaged-reference line:

- The selected revision is unavailable. The line names the branch entry that selected it.
- Storage is not ready for proposals, as the [storage guide](storage.md#reconciliation-readiness)
  defines: reconciliation is running, the latest reconciliation failed, or a revision is unresolved.
  This line appears only while memory is enabled.
- A committed revision's branch reference is not yet recorded, or is recorded but not yet saved in
  the session file.

```text
Memory commits: blocked because the selected revision is unavailable. Navigate with /tree to a point before entry 3a7c2e19 to continue memory work without it.
Memory commits: blocked while memory reconciles with the current settings and models.
Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.
Memory commits: blocked by revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40, which is not recorded on this branch: it was committed with other settings or models. Navigate with /tree to a point before entry 5b2e91aa to continue memory work without it.
Memory commits: blocked until revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40 is recorded on this branch. If its commit failed, run /reload to record it.
Memory commits: blocked until the branch reference to revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40 is saved in the session file. Pi saves a new session file after its first assistant response.
```

The first line omits its second sentence when the active branch has no valid reference to the
selected revision. The fourth line appears when a revision's branch reference is missing and
reconciliation leaves the revision unresolved, as the [storage guide](storage.md#orphan-heads)
describes. It names that revision and the entry where its proposal was captured, and gives the first
of these reasons that applies:

| Reason                                                         | Cause                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `its lineage from the selected revision cannot be established` | The selection is unavailable, its base and parent do not continue the selection, or more damaged references block commits than recovery permits. |
| `it was committed with other settings or models`               | Its configuration fingerprint differs from the current one. Selecting those settings and models again can recover it.                            |
| `its evidence or curated notes changed after it was committed` | Its evidence or curation no longer holds.                                                                                                        |

In the terminal, commands display a notification. RPC clients receive Pi's `extension_ui_request`
event with `method: "notify"`, `notifyType: "info"`, and the report in `message`. Each report is
also saved in an `orbis-tiered-memory-report` custom session entry with the report text in
`data.text`. Rerun `/tiered-memory status` to record and display current state. JSON and print-mode
report rendering are not supported in this version. Status does not start a model turn or add
diagnostic messages to model context.

For an unresolved model, correct the provider/model identifier or configure it in Pi, then run
`/reload`. For missing credentials, configure the selected provider in Pi and run `/reload` to
refresh the model checks. For invalid settings, correct the reported field and run `/reload`. For
memory commits blocked by a damaged entry, an unavailable selected revision, or an unresolved
revision, navigate with `/tree` to a point before the named entry; the extension does not repair or
remove damaged entries or reconstruct missing revisions.
