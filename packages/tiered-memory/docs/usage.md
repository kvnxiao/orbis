# Tiered memory usage

The extension runs the observer, a model job that extracts source-linked observations from the
session and keeps the protected current-work note: a bounded summary of ongoing work with reserved
space in each request. The extension presents that note to the acting model, the model that runs the
main conversation. The consolidator, which will organize older observations, has its own model
setting but does not run in this version. Recall and custom compaction remain unavailable. The
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
and status lists it while it is on the active branch. Presentation adds
`orbis-tiered-memory-presentation` custom messages, which Pi includes in model context, as
[Presentation](#presentation) describes.

At session start, the extension writes identity and source records for every persisted Pi session in
the project, including while memory is disabled. Disabling memory preserves stored records and
cancels pending memory writes. It also discards waiting observer jobs, cancels the running one, and
stops presenting new memory. A commit that has already written its revision head still completes and
records the revision on the branch. A cancelled commit that has already registered its sources still
refreshes storage status. Source registration at session start and tree navigation, session-note
curation checks, note freshness checks, corrections, compaction safety, and managed-file write
guards remain active.

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
provider usage or billing guarantees. The extension estimates a text's tokens as its UTF-16 length
divided by four, rounded up. These settings define limits for the intended memory operations;
unavailable operations do not consume their budgets.

The current-work note summarizes ongoing work, and presentation shows committed memory to the acting
model. In the intended system, the index points to retained memory; this version does not present
one. A checkpoint is the summary that replaces older conversation content after compaction; the
observer reads Pi's native checkpoints.

| Field                          | Default | Unit and purpose                                                        |
| ------------------------------ | ------- | ----------------------------------------------------------------------- |
| `queuedJobs`                   | 8       | Maximum waiting observer jobs, and jobs planned per pass.               |
| `workerInputTokens`            | 8192    | Estimated input-token cap per worker request.                           |
| `workerOutputTokens`           | 2048    | Generated-token cap per worker request.                                 |
| `jobTimeoutMs`                 | 60000   | Milliseconds per job, from queueing until its commit starts publishing. |
| `retries`                      | 1       | Additional attempts per job.                                            |
| `compactionWaitMs`             | 5000    | Milliseconds per compaction attempt, including catch-up.                |
| `workNoteTokens`               | 1024    | Estimated tokens reserved for the current-work note.                    |
| `consolidationThresholdTokens` | 4096    | Estimated active-observation tokens that trigger consolidation.         |
| `activeObservationTokens`      | 8192    | Estimated active-observation token cap.                                 |
| `indexTokens`                  | 512     | Estimated index tokens, including recall guidance.                      |
| `presentationTokens`           | 4096    | Estimated tokens for accumulated note and index presentation.           |
| `checkpointTokens`             | 4096    | Estimated checkpoint cap; larger native summaries are not read.         |
| `recallTokens`                 | 2048    | Estimated recall-output token cap.                                      |
| `recallBytes`                  | 16384   | UTF-8 recall-output byte cap.                                           |

The settings file and its `limits` field must be JSON objects. Limits must be finite safe integers.
`retries` permits zero; every other limit must be positive. Unknown fields, malformed model
identifiers, non-boolean activation values, and invalid JSON are rejected. Omit optional fields to
inherit values; `null` is invalid. The limits must also fit inside each other:

- The work-note reserve must fit both the checkpoint and worker-output budgets.
- The consolidation threshold must fit the active-observation budget.
- The work-note reserve plus index must fit the worker-input budget.
- The work-note reserve plus index plus 768 tokens must fit `presentationTokens`. The 768 tokens
  allow 256 for each of three headers in a complete re-presentation of memory, described under
  [Presentation](#presentation): its opening line and the headers of the note and the index. With
  the default work-note and index limits, the smallest accepted value is 2304.

For each resolved worker model, the output cap is the smaller of `workerOutputTokens` and the
model's maximum output. The input cap is the smaller of `workerInputTokens` and the model's context
window minus that output cap. If the work-note reserve exceeds the output cap, or the work-note
reserve plus index exceeds the input cap, status reports the role as suspended.

Status also checks the acting model's current-work-note reserve against its context window and Pi's
available context-usage estimate, and reports the preliminary remaining capacity. This check does
not establish whether a complete request fits; [Request capacity](#request-capacity) describes the
check that runs before each acting request. When the reserve does not fit the remaining context,
status reads
`Acting model: mandatory work note does not fit remaining context; a request that presents the note stops before dispatch. Run /compact, or select a model with a larger context window.`
Memory work continues.

## Observation

The observer reads the session in intervals. An interval is a set of unprocessed spans in branch
order, where a span is a whole message entry or a character range of one. For each interval, the
observer returns one JSON response with observations and a current-work note result, and extension
code commits the accepted result as a memory revision. Processing coverage is the set of spans that
the selected revision and the earlier revisions it builds on processed, excluding revisions whose
evidence changed. When one of those revisions cannot be read, processing coverage is unavailable.

### Scheduling

The extension plans observer jobs at these points:

- After storage opens on session start and after tree navigation.
- After each completed turn, when Pi emits `turn_end`.
- After `/tiered-memory on`.
- When the queue empties after at least one job since the previous empty queue committed a revision.
  Intervals planned before that commit can stop fitting once the new note adds reference labels, so
  this pass lets a backlog keep draining without another turn. A queue that empties after only
  skipped or failed jobs does not plan again.
- After the extension records a detected edit or deletion of the current-work note, or finishes a
  storage refresh that a note check started.

Each pass plans at most `queuedJobs` intervals from the active branch's unprocessed text and offers
them to the queue in branch order. The queue has room for at most `queuedJobs` waiting jobs besides
the running one. When the queue is full, the pass stops. Deferred and unplanned spans stay in the Pi
session for a later pass. A pass skips spans that are already queued or running, and spans whose job
failed every attempt in the current storage session.

Scheduling pauses while any of these holds:

- Memory is disabled.
- Storage is not open.
- Memory commits are blocked; status prints a `Memory commits: blocked` line with the cause.
- No configuration is current.
- The observer role is suspended or not yet resolved.
- Processing coverage is unavailable.
- The current-work note's freshness is unknown; status prints an `Observer planning: deferred` line
  with the reason and a recovery step.

`/tiered-memory off` discards waiting jobs and cancels the running one.

### Request contents

Each request has the observer instructions, the previous current-work note with its references, an
applicable native checkpoint, and the interval's spans. A native checkpoint is the summary of a Pi
native compaction. The previous note is included while it is current, as
[Note freshness](#note-freshness) defines. It is also included when a native compaction is the only
reason it stopped being current, so the observer continues from it instead of starting over. The
applicable checkpoint is the newest compaction whose discarded entries include unprocessed text and
whose summary fits `checkpointTokens`; when the newest such compaction's summary is too large, an
older one can apply.

Labels identify sources in the request: `S` labels name assigned spans, `P` labels name the previous
note's source references and native checkpoints, and `C1` names the applicable checkpoint. The
request labels at most 64 of the previous note's source references, the newest by branch order.
Observations cite `S` or `C` labels; the note may also cite `P` labels. Each span shows its role,
entry, branch order, recorded time, event time, and timezone; an unknown time value reads `unknown`.

Sources are the user and assistant messages, tool results, and user shell commands that Pi includes
in model context. The user runs such shell commands with `!`. A shell command's span is labeled
`user shell command` and is attributed to the user, not to the agent. Its text has the command, exit
status, cancellation, and truncation, then the output. When Pi saved the full output to a file, the
span names the path without reading it. Commands run with `!!` are excluded from model context and
are not sources. Pi 0.99.1 can omit a shell command's record through a context edit but cannot
replace it.

The interval budget is the observer input cap, described under [Resource limits](#resource-limits),
minus the instructions, the work-note reserve, the previous note's labeled references, the
applicable checkpoint, and separators. When the budget leaves no room for a span, the pass plans
again without the checkpoint. When no span fits even then, the pass plans nothing, and status prints
an `Observer planning: stalled` line with the remaining budget and recovery steps.

An entry whose text does not fit one interval is split into consecutive ranges at code-point
boundaries, and each range is its own span. Every range of a tool result names the tool call, tool
name, and outcome. When a tool result does not fit after its assistant message, both start the next
interval if they fit together. Image attachments are reported as gaps and never assigned. If a
request still exceeds the input cap when its job starts, the request drops the checkpoint; if it
still does not fit, the job is skipped.

### Requests and retries

Inference is serial. Each storage session has one queue with one consumer, so at most one observer
request runs at a time. A storage session lasts from the point storage opens, at session start or
after tree navigation, until the next tree navigation, session change, reload, or shutdown, which
cancels its running job.

Requests go through Pi's in-process model registry, which authenticates each request when it is
sent, and do not declare tools. The extension resolves the observer model again when a job starts
and does not substitute another model.

`retries` counts attempts after the first. A job's `jobTimeoutMs` deadline starts when the job is
queued. It bounds queue waiting, preparation, every attempt, and the commit's wait for its turn in
storage and for the project lock. Each attempt gets the remaining time divided by the attempts left.
Provider calls use `maxRetries: 0`, so only the extension retries.

Before its first attempt, a job is skipped without a model call when:

- Its spans were already processed, changed, or left the branch.
- Storage refuses new proposals, or processing coverage is unavailable.
- The observer model is unresolved or too small for the mandatory budgets.
- Its request no longer fits the observer input cap, even without the native checkpoint.
- The current-work note's freshness was unknown.
- Its deadline passed while it waited or while it was prepared.

A later pass plans the skipped job's unprocessed spans again.

An attempt fails when:

- The provider returns an error, or the attempt times out.
- The output stops at its token limit, is not one JSON object in the expected format, or exceeds the
  output cap.
- The response cites a label that the request did not assign to that field.
- The note exceeds `workNoteTokens`.
- The response returns an `unchanged` note when the request supplied no previous note.

Failed and cancelled attempts never advance coverage. When every attempt fails, or the deadline
passes after the first attempt, the job is exhausted: its spans are skipped for the rest of the
storage session, and status counts them as failed. Reload, resume, or tree navigation starts a new
storage session, which retries them.

When the deadline passes after an accepted attempt but before the commit starts writing its head,
the commit is abandoned. No head is published and coverage does not advance, though a source
registration or an unreferenced revision file written before that point can remain. The job is
exhausted. Once the head write starts, the commit finishes even after the deadline: it writes the
head, the note and learning views, the learning provenance, and the materialized marker, then
records the branch reference and refreshes.

### Commits

A job with an accepted response commits once. The commit stores the accepted observations, the note
result, and the processed interval together, so coverage advances only with a committed revision.
The note result maps to the note as follows:

- `updated` writes the new note, with the sources and native checkpoints it cites.
- `unchanged` does not write a note; the new revision keeps the previous note.
- `empty` writes an empty note, which records that no active work is identified.

An externally edited current-work note is never rewritten or presented as current; the commit still
stores observations and coverage without the note. When the edited note is deleted later, the
extension records the deletion. A deleted note can be recreated only from evidence that it did not
consume: a commit whose note cites the deleted note's evidence is rejected. A job records the note's
curation state before its first attempt, and a commit that writes the note is rejected when the note
was edited or deleted after that point. A rejected or cancelled commit is not retried, and a later
pass plans its spans again.

## Presentation

Presentation shows the selected revision's current-work note to the acting model. The extension
appends `orbis-tiered-memory-presentation` custom messages instead of editing earlier messages, so
earlier messages keep their positions. This version does not present an index.

Each acting request presents the memory committed before its `context` hook, so a commit that lands
while Pi prepares the request appears in the next request. At that hook, the extension also checks
the note against the request's conversation. When a context edit omitted or replaced a message that
the note relies on, the request does not present the note. While the agent is streaming, Pi appends
a sent record after the current turn's messages; until then, the request shows the record at the end
of the conversation, after the newest message. The extension appends these records:

- A complete component record when the note's body changes. It names the revision and the source
  boundary, which is the newest processed span in branch order. The boundary reads as that message's
  role and recorded time, followed by its exact `tm1:` reference. The record states that newer user
  instructions retained in the conversation take precedence over the note, and that it supersedes
  every earlier copy of the note.
- A short boundary record when only the revision or source boundary advanced. An unchanged body is
  not repeated.
- A correction record when a presented note stops being current. It states the cause:
  - The note file was edited or deleted outside tiered memory.
  - The evidence the note relied on changed.
  - A native compaction replaced it, as described below.
  - Its freshness could not be verified, as [Note freshness](#note-freshness) describes.

A component record looks like this to the model:

```text
[Tiered memory: current-work note, revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40 of session <sessionId>]
Source boundary: this note covers the conversation through the user message recorded at 2026-10-03T14:05:12.000Z (reference tm1:<projectId>:<sessionId>:a41c09e2:0).
Newer user instructions retained in the conversation take precedence over this note. It supersedes every earlier current-work note representation.

<note body>
```

A correction hides every earlier copy of the note from acting context, including the note portion of
a reset baseline, so an older revision cannot become current again. A note presented after the
correction stays visible. The extension sends a correction as soon as it detects the change: when a
prompt is processed, before an agent run starts, at the start or end of a turn, and at idle points
(after the agent settles, at session start, and after tree navigation). While the agent is
streaming, Pi appends it after the turn's messages, never between a tool call and its result. A
correction is always sent, even when it takes accumulated presentation past
`limits.presentationTokens`; it counts toward that budget, so the next update can start a reset.

When accumulated presentation plus the new records would exceed `limits.presentationTokens`, the
extension appends one complete reset baseline of the current note and hides the superseded copies
from acting context. A reset does not call a model, and status counts resets separately from
compactions. If a baseline of the note alone exceeds the budget, the extension does not reset.
Instead, it records a capacity stop and aborts the request before any provider call, without a retry
or compaction; status reports the stop with recovery guidance.

After a native compaction, the note stays current only when processing coverage of its revision, or
a native checkpoint that the note cites, accounts for every source span the compaction discarded.
Otherwise the note stays stored but is not presented, and, when the note was presented, a correction
names the compaction. Presentation resumes when the observer commits a note that accounts for the
discarded spans. When the discarded spans cannot be checked against processing coverage, the note's
freshness is unknown.

The transcript shows each record as one collapsed line naming the record kind, the revision, and the
source boundary's role and recorded time. Expanded, the line shows the text the model sees. Acting
context also hides these records, which the [storage guide](storage.md#presentation-records)
describes:

- Records of another project, of a session other than this one or its fork ancestors, or anchored
  off the selected branch.
- Damaged records.
- Records that a context edit omitted or replaced.

While memory is disabled, the extension does not append component, boundary, or reset records and
does not stop requests for capacity. It still checks freshness, appends corrections, and hides
superseded, corrected, foreign, and damaged records from acting context.

### Note freshness

A note is fresh when its file still matches the committed revision and its evidence still matches
the conversation. The extension checks the current-work note file at these points:

- When a prompt is processed and before an agent run starts.
- At the end of each turn, and at a turn's start when no check ran since the agent was last idle.
- Before it accepts a compaction.
- At session start, after tree navigation, and during reconciliation.

A check compares the file with the digest that the memory head recorded, reading the head before and
after the file. It does not take the project lock or wait for reconciliation, and it counts as
unknown when it does not finish within 2000 ms. Each request uses the result of the latest completed
check, so an edit made after a check completes is detected by the next one. A check has these
outcomes:

- **Verified:** the file matches.
- **Edited or deleted:** the extension stops presenting the note, sends a correction, and records
  the curation in storage in the background. The detection stays in effect even when the original
  bytes are restored before the curation is recorded. Until it is recorded, memory proposals are
  refused and a commit based on the older note conflicts. If Pi stops first, the next session start
  records the curation from the correction saved in the session.
- **Pending:** the memory head was not completely written when the check read it. While this
  process's memory work for the session is running, the head is a write in progress, not an edit,
  and the previous result stays. Otherwise the write is unfinished: the result is unknown, and the
  extension refreshes storage in the background, which completes the write as the
  [storage guide](storage.md#recovery) describes.
- **Head changed by another process:** the extension refreshes storage instead of treating the
  change as an edit.
- **Edited note without a view:** after an observation-only commit, the head no longer records the
  edited note, so the check compares the file with its curation record instead. When the file no
  longer matches that record, for example because the edited note was deleted, the extension
  refreshes storage, which records the change without a reload.
- **Unknown:** the note's freshness cannot be established. This happens when:
  - The file or head changed during the check, a read failed, or the check timed out.
  - A memory head stayed unfinished, as described above.
  - The note's evidence could not be checked against the conversation.
  - The sources that a native compaction discarded could not be checked against processing coverage.
  - Memory storage is not open, and the branch presented a note earlier.

  The extension stops presenting the note and sends a correction stating that its freshness could
  not be verified. It does not record curation, and it defers observer planning. Requests continue
  without the note and are not stopped for capacity. The note is presented again once the check that
  failed succeeds; a file check that verifies the file does not clear a failed evidence or
  compaction check.

### Compaction safety

Pi's native summarizer reads the prepared conversation directly, so an earlier copy of a note that
is no longer current would reach the summary as current. The checks above usually save the
correction before Pi prepares a compaction. Before accepting a compaction, the extension checks
again. When the prepared input includes a note that is no longer current, and no correction saved in
the session file follows it, the extension cancels that compaction before the summarizer runs. It
then sends the correction and shows a warning that names the cause and the next step:

- Manual `/compact`: Pi reports `Compaction cancelled`; run `/compact` again.
- Automatic threshold compaction: Pi runs it again at a later check, no later than the next prompt.
- Overflow compaction that Pi would retry: Pi does not retry the request that overflowed; send it
  again.
- Overflow compaction after a completed response: Pi runs automatic compaction again at a later
  check, no later than the next prompt.

The extension cancels at most twice for one change: once before the correction is sent, and once
more while Pi still queues it. When the correction was sent but is not saved in the session file, or
is not in the compaction input, cancelling would not help, so compaction proceeds and a warning
reports that gap. When the check itself fails, compaction proceeds with a warning. A compaction
aborted during the check is not cancelled or reported. The warnings are also saved as
`orbis-tiered-memory-report` entries. These rules also apply while memory is disabled. The extension
never starts a compaction, retry, or turn itself, and does not change Pi's auto-compaction setting.
Cancellation counts are kept in memory and start over at each session start, reload, and tree
navigation.

## Request capacity

Before each acting request that presents memory, the extension estimates the request's tokens: the
system prompt, tool declarations, conversation, presented note, optional memory, and generation
headroom. The system prompt and tool declarations use the text estimate under
[Resource limits](#resource-limits); messages use Pi's own message estimate, which also counts
images. The generation headroom is the package's own finite reserve: the model's maximum output,
capped at 16384 tokens, the default compaction `reserveTokens` of Pi 0.99.1. It does not follow a
configured compaction reserve or a provider's output clamp. The extension then decides:

1. If the whole request fits the model's context window, Pi sends it.
2. Otherwise, the extension removes optional memory first: note copies that a newer revision
   superseded, and the index portion of a reset baseline. This version does not present an index.
3. If the request with the complete note still does not fit, the extension records a capacity stop
   for the context window and aborts the request before any provider call, even when the
   conversation alone exceeds the window. It does not retry or compact, and status gives recovery
   guidance.

A request without a presented note is never stopped. A request that was already cancelled keeps its
cancellation and is not recorded as a capacity stop.

A physical model selection uses the selected model's limits. A virtual model is a Pi model selection
that routes each request to a physical model. A virtual selection uses the limits Pi reports. These
are the limits of the physical model behind the latest successful response since the selection that
is still in Pi's effective conversation; responses that a compaction summarized, or that a context
edit omitted or replaced, do not count. Without such a response, or when its model is not
registered, the virtual model's declared limits apply. When the virtual model declares no limits,
capacity is unknown and requests are not stopped. Virtual checks are estimates, because Pi selects
the physical model only after the extension's request hooks run. A router that chooses a smaller
model can still overflow, and Pi's native overflow handling then applies.

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

Status reads cached state and the active branch and does not write memory files. Consolidation,
recall, and custom compaction remain unavailable, and status reports each on its own line.

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

### Observer status

While storage is open, status describes the current-work note and processing coverage:

```text
Current-work note: revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40; source boundary tm1:<projectId>:<sessionId>:a41c09e2:0 (branch entry 42); 3 eligible sources not yet observed
Processing coverage: 4 gaps (2 unprocessed, 1 partially processed, 1 with unsupported attachments)
```

The note line reads `Current-work note: none` without a note, or names the revision and the reason
it is invalid. After curation, it reads
`Current-work note: none; current-work.md was edited outside tiered memory and stays excluded from generated memory.`
or
`Current-work note: none; current-work.md was deleted outside tiered memory; only evidence the deleted note did not consume can create a new note.`
Eligible sources are message entries and user shell commands with text that a context edit did not
omit, excluding `recall` results. The count of sources not yet observed excludes attachment gaps,
and it reads `unobserved sources unknown` while processing coverage is unavailable.

A freshness line follows the note line, using the outcomes under [Note freshness](#note-freshness):

```text
Current-work note freshness: verified at 2026-10-03T14:05:12.000Z by the latest completed inspection.
Current-work note freshness: unknown because the inspection did not finish within 2000 ms; the note is not presented as current until an inspection verifies it.
Current-work note freshness: not current because its file was edited outside tiered memory.
Current-work note curation: the detected edit awaits recording; memory proposals are refused until it is recorded.
```

An unknown line ends with how the note can return, which depends on the check that failed:

- File check: `the note is not presented as current until an inspection verifies it.`
- Evidence check:
  `the note is not presented as current until its evidence can be checked against the conversation; an inspection of its file does not clear this.`
- Compaction check:
  `the note is not presented as current until processing coverage can be checked; an inspection of its file does not clear this.`

While storage is not open, status prints no note or coverage line. When the branch presented a note
earlier, it prints
`Current-work note freshness: unknown because memory storage is not open; the note is not presented as current until memory storage opens. Resolve the storage error, then run /reload.`

The curation line appears only while a detected edit or deletion is not yet recorded in storage.
When recording fails, it adds `Recording failed (<error>); the next inspection retries it.`

The coverage line counts gaps by kind:

- `unprocessed`: an entry with no committed coverage.
- `partially processed`: a split entry with an unprocessed remainder.
- `changed since processing`: an entry whose processing was dropped because its revision's evidence
  no longer matches; the observer processes it again.
- `failed`: an entry whose job exhausted its attempts in the current storage session.
- `with unsupported attachments`: an entry with image blocks, which no worker processes.

Without gaps, the line reads `Processing coverage: no gaps`. When processing coverage is
unavailable, it reads `Processing coverage: unavailable (<reason>); observer scheduling is paused.`

Once the storage session's observer queue starts, status reports its jobs and provider-reported
usage:

```text
Observer jobs: 1 queued, one running, 0 deferred offers, 0 exhausted spans; last outcome: committed revision 0d6f2c1e-8a4b-4f0e-9c3d-2b7a5e1f9d40
Observer usage (provider-reported): 3 of 3 attempts reported usage; input 18240 tokens, output 1630 tokens, cache read 0 tokens, cache write 0 tokens, cost 0.0213
```

Deferred offers count jobs that a full queue refused. The last outcome is one of these:

- `none`.
- A committed revision.
- A skip with its cause, such as
  `skipped because its request no longer fits the observer input cap; its sources will be planned again`
  or
  `skipped because the current-work note's freshness was unknown; its sources will be planned again`.
- A rejection by a named commit check.
- Exhaustion with the last attempt failure, or
  `exhausted because the job deadline passed before its accepted output committed`. When earlier
  attempts failed, the second form adds `after <n> failed attempts; last failure: <failure>`.
- `cancelled`, or a failure with its error.

Usage covers every attempt in the storage session, including retries, and reads `unknown` for a
field that no response reported. Before the first attempt, the usage line reads
`Observer usage (provider-reported): no attempts`. Job outcomes and usage are kept in memory for the
storage session only: a reload, session switch, or tree navigation starts them empty. Status says so
on the line
`Observer outcomes and usage cover this session since tiered memory last loaded, switched sessions, or navigated the tree.`
Processing gaps come from committed coverage and survive reload.

While the note's freshness is unknown, status adds
`Observer planning: deferred because the current-work note's freshness is unknown: <reason>.`
followed by a recovery step for the check that failed:

- File check: `Check that current-work.md is readable, then run /reload.`
- Evidence check:
  `Navigate with /tree to a point before the conversation entry whose source metadata cannot be read.`
- Compaction check: `Resolve the processing coverage problem this status reports, then run /reload.`

When planning finds no source span that fits the observer input cap, even without a native
checkpoint, status adds a line:

```text
Observer planning: stalled; after the instructions, the previous note at its reserve, and its references, the observer input cap leaves 0 estimated tokens for sources, which no source span fits, even without a native checkpoint. Raise limits.workerInputTokens, lower limits.workNoteTokens, or select an observer model with a larger context window.
```

### Presentation status

Presentation and request-capacity lines follow the observer lines:

```text
Presentation: complete appended revisions; budget 4096 estimated tokens (default); 1350 estimated tokens presented, 0 pending, 1 unconfirmed.
Presentation resets: 1, last for budget from 4210 to 1180 estimated tokens; compactions are counted separately.
Damaged presentation records on the active branch: 1 excluded (entry 5c81d0f3 at /kind)
Request capacity: 200000 tokens for example/model-a, from the selected model.
Acting provider cache reads and writes: unknown in this version.
```

`pending` counts records sent but not yet on the branch, and `unconfirmed` counts records on the
branch that are not yet confirmed in the session file. While storage is not open or memory is
disabled, the first line ends with `not presented`. Without resets, the second line reads
`Presentation resets: 0; compactions are counted separately.` The damaged-record line appears only
when the active branch has damaged presentation records. A `Presentation confirmation error:` line
reports a failed session-file read.

After a compaction that [Compaction safety](#compaction-safety) cancelled or let proceed with a gap,
status reports the latest of each:

```text
Latest correction cancellation: the manual compaction, because the current-work note in its input is no longer current: its file was edited outside tiered memory.
Latest correction gap: the automatic threshold compaction proceeded while the correction was not durable; the current-work note in its input is no longer current: its file was edited outside tiered memory.
Correction cancellation check failed (<error>); the compaction proceeded.
```

The request-capacity line appears after the first acting request that presents memory. For a virtual
model, its source reads `the virtual model's latest response model, estimated` or
`the virtual model's declared limits, estimated`. When the limits are unknown, the line reads
`Request capacity: unknown for <model> because <reason>; requests are not stopped for capacity.`

After a capacity stop, status reports its cause, the required tokens, and the available tokens:

```text
Capacity stop: the current-work note does not fit the context window of example/model-a: 131200 tokens required, including 16384 of generation headroom, 128000 available. The aborted response 9e2b41c7 was stopped by tiered memory, not cancelled by the user. Run /compact, or select a model with a larger context window, then retry.
Capacity stop: the complete presentation baseline exceeds limits.presentationTokens: 4410 estimated tokens required, 4096 allowed. The request was stopped before dispatch. Set limits.presentationTokens to at least 4410, then retry. To restore the earlier limits.workNoteTokens instead, also set limits.presentationTokens to at least that limits.workNoteTokens plus limits.indexTokens plus 768.
```

For a virtual model, the first form reads `estimated tokens required`. The second sentence names
Pi's aborted response entry when one follows the stop, so the abort is not mistaken for a user
cancellation; otherwise it reads `The request was stopped before dispatch.` Compaction cannot shrink
a note-only baseline, so the second form's recovery changes only settings; the 768 tokens are the
three presentation headers that the settings check reserves.

When the extension records a capacity stop, it also shows the same line as a warning notification
and saves it in an `orbis-tiered-memory-report` entry, so the stop remains inspectable after the
notification disappears.

### Reports and recovery

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
remove damaged entries or reconstruct missing revisions. For a capacity stop, follow the line's
guidance and retry; the extension does not truncate the note or retry the request.
