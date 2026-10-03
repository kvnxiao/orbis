# Tiered memory storage

The extension records private session metadata and original-source references under
`.pi/tiered-memory/sessions/`. The controlled writer is extension code that validates and commits
memory revisions containing notes and their processing metadata. Observation, consolidation, and the
public `recall` tool are unavailable in this version.

## Project and session scope

The project root is the nearest directory, starting with the session's working directory and moving
up through its ancestors, that contains a `.git` file or directory. Without one, the working
directory is the project root. Discovery does not invoke Git. The store resolves symbolic links in
that root, so a symlinked working directory and its target share one store. Nested repositories and
separate worktrees have separate stores. The stored project identity includes the root path;
matching directory names do not associate unrelated projects. Resuming a session under a different
root does not attach the previous project's memory.

Pi retains original conversation records in its session files. Source references identify a
registered project, session, entry, and span. They do not accept arbitrary filesystem paths.

The extension registers the active branch's sources when a session starts, after tree navigation,
and once before each commit. Each registration runs under the project mutation lock, which
serializes storage writers across sessions and processes. It rereads `sources.json`, merges the
branch's sources into it, and keeps the records of entries absent from the branch, so two Pi
processes that resume the same session keep each other's records. A source's recorded time always
comes from its Pi entry. Its event time and timezone on disk stay unless the registration supplies
new time context for it, which replaces both. A registration completes when its `sources.json` write
succeeds and replaces the registry's cached records under the lock. Commit validation projects the
current effective sources without changing `sources.json`.

Storage requires a persisted Pi session. Pi assigns a persisted session its file path when the
session is created, before the first write. A session that Pi keeps only in memory has no session
file, so the extension writes no identity or source records for it, and status reports that storage
needs a persisted session. The write guard still applies to that session.

Original text remains eligible for discovery independently of generated observations. Entries with
identical text retain distinct source identities. Recorded timestamps and source order remain
attached to their evidence; processing time does not supply missing dates or timezones. Replaced or
omitted text remains historical evidence rather than current instructions.

The source representation includes message text and tool-call metadata in their original block
order. Tool calls retain their identifiers, names, and arguments; results retain the matching call
identifier, tool name, error flag, and result text. Images and other non-text blocks are outside
this representation. Effective text follows the selected branch's context edits, while raw text
remains available as historical evidence.

## Records and publication

Private metadata uses versioned JSON. Identity records bind each session to its project root; notes
use UTF-8 Markdown. Session-private records stay out of model context; the extension uses Pi custom
entries for branch-selected revision references.

| Path below `.pi/tiered-memory/`                      | Contents                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sessions/<session-id>/identity.json`                | Project root and session identity, written when the session's store first opens.                     |
| `sessions/<session-id>/sources.json`                 | Registered source identities, digests, order, role, and time context.                                |
| `sessions/<session-id>/revisions/<revision-id>.json` | One immutable revision: the committed proposal, its parent and sequence, and the full note snapshot. |
| `sessions/<session-id>/head.json`                    | The current revision, view digests, and whether its view materialization or recovery completed.      |
| `sessions/<session-id>/curation.json`                | External note edits and deletion exclusions, independent of the selected branch.                     |
| `sessions/<session-id>/current/`                     | Human-readable session notes.                                                                        |
| `sessions/_project/state.json`                       | Generated learning digests, sequences, and consumed evidence, and project-wide curation exclusions.  |
| `sessions/_project/sequence.json`                    | The last publication sequence issued across sessions.                                                |
| `sessions/.lock/private/`                            | Complete owner records written before their tickets are published.                                   |
| `sessions/.lock/tickets/`                            | Numbered, immutable owner tickets; the greatest ticket also preserves the sequence high-water mark.  |
| `sessions/.lock/done/`                               | Completion markers for published tickets.                                                            |
| `learnings/`                                         | Shareable Markdown learning files and their index.                                                   |

The `current/` directory contains `current-work.md`, `journey.md`, `topics-index.md`, and
`topic-<name>.md` files when those notes have been committed. Project learnings use individual
Markdown files and `index.md`.

Format version `1` uses JSON objects with a `version` field. Readers validate each record against
its schema and reject other versions. Project identifiers are SHA-256 digests of canonical root
paths; revision identifiers are UUIDs. Revision records contain note bodies, source identifiers,
consumed observation identifiers, captured publication dependencies, and the project sequence their
commit advanced to. Content digests use SHA-256.

Each note's `noteDependencies` retains its source references and a fingerprint of their raw text,
effective text, and omission status. Later revisions preserve those dependencies when carrying the
note forward. The newly processed source interval remains separate; retaining an older note does not
mark additional evidence as processed.

Source references use `tm1:<projectId>:<sessionId>:<entryId>:<span>`, separated by colons; none of
the components can contain a colon. The current text representation uses span `0` for an entry.
Registry records preserve raw and effective text digests, omission status, source order, role, and
optional `recordedAt`, `eventTime`, and `timezone` values.

A proposal may name a registered Pi entry by its bare entry ID or full `tm1` reference. Proposal
capture converts registered bare IDs to full references. For curation checks, a bare ID belongs to
the proposal's session; a full reference retains its encoded session, so equal entry IDs in
independent sessions remain distinct. Fork curation rebinds inherited exclusions to the child
session, including project-learning exclusions, without treating unrelated sessions as the same
source.

The writer captures source identities, the effective-context fingerprint, the configuration
revision, a fingerprint of the settings, memory roles, and project root, the expected head, and the
base revision. It registers sources once, then checks the captured evidence before taking the
project mutation lock for the commit. Under the lock it checks that:

- The head is the expected revision.
- Curation permits every written note.
- Learning digests and sequences match.
- The current effective sources, branch anchor, and configuration still support the proposal.
- No damaged revision reference on the branch can hide a revision newer than the selected one, as
  described under [Recovery](#recovery).
- The branch's revision selection still matches the proposal:
  - The selected revision is available.
  - No committed revision's branch reference is still pending.
  - The selected revision is the proposal's base revision. A proposal captured with no revision
    selected passes only while no revision is selected.
  - Storage is ready for proposals: the latest reconciliation ran for the current configuration, did
    not fail, and did not leave a head with a missing branch reference unresolved, as described
    under [Recovery](#recovery).

The writer checks the live evidence, configuration, and lineage again just before publishing the
head, without registering sources or changing the latest status counts. A failed check returns a
conflict naming both revisions and the reason: `head`, `curation`, `learning`, `configuration`,
`lineage`, or `evidence`. The store checks run first, in stages: the head, then note curation, then
each proposed learning in turn. A learning check can return `curation` or `learning`, and the first
learning that fails sets the reason. Once the store checks pass, the conflict names the first
failure in the order `configuration`, `lineage`, `evidence`. When a disable, a session stop, or a
call cancellation comes before the head is written, the commit reports cancellation, never a
conflict. Concurrent sessions share the lock; an obsolete proposal must be recomputed from the
accepted revision. Project-learning updates compare both the content digest and publication
sequence, so a later publication invalidates an older proposal even when the text is unchanged.

An accepted commit advances the project sequence and writes, in order, the revision file, the head
naming it, each changed note view, the learning views, and the learning provenance, then marks view
materialization complete. If one of several started view writes fails, the writer waits for its
siblings to settle before releasing the lock. Only a head names a current revision. Once the head is
written, the commit reports the revision as committed even if the call is cancelled or the session
stops, and the writer still finishes the remaining writes. If one of those writes fails, the commit
rejects with that error although the head is durable. The next storage startup, or the next
reconciliation in the same session, repairs the pending head and reconciles it with the branch.

As soon as the head is durable, storage records it as the latest head with a pending branch
reference, before the commit ends, so a proposal cannot be captured against the previous selection,
even if a later view write fails. The writer then records the revision reference on the Pi branch.
Pi can defer a new session file until its first assistant response, so an in-memory custom entry
alone does not prove the reference is durable; the reference stays pending until it is confirmed in
the session file, and no new proposal is captured meanwhile. Disabling memory does not cancel this
step. Tree navigation, a session change, or shutdown discards it, and the next storage startup
reconciles the head with the branch as described under [Recovery](#recovery). If recording the
reference fails, the commit still reports committed, and status reports the storage error.

Each storage session keeps its newest completed registration, starting with the one from session
start or tree navigation. A commit that registered its sources refreshes storage state once it
commits, conflicts, or is cancelled; a committed commit refreshes after recording its reference. A
commit that rejects does not refresh, and its completed registration stays available to the next
refresh. Each refresh reads the storage session's newest completed registration once, when it
starts, so an older attempt's refresh never replaces counts computed from a newer registration.
Commits and refreshes take turns, as the next paragraph describes, so a registration cannot complete
while a refresh runs. The refresh:

- Reads the latest head, so a proposal captured afterward expects the accepted revision.
- Projects the active branch's current effective sources without registering them, so a context edit
  made since the newest registration applies. It rechecks the selected revision's notes against
  those sources and the current curation.
- Reconciles the head with the branch as described under [Recovery](#recovery), judging an orphan
  head's evidence against the same sources. Reconciliation can attach a head whose reference is
  missing from the branch or leave it unresolved.
- Updates the counts that status reports without registering again: the source count of that
  registration, labeled `commit`, and the curated-note count of the curation it inspected.

Commits, refreshes, and reference recording for one storage session run one at a time, so none of
them validates against or overwrites lineage state that another changes while it runs. A commit
takes its turn before it acquires the project lock and keeps that turn until the commit ends; its
reference recording and refresh take a later turn. A disable, a call cancellation, tree navigation,
a session change, or shutdown cancels a commit still waiting for its turn, as it cancels one before
its head is written. Refreshes and reference recording merge their results into the storage state
current when they finish. Disabling memory or cancelling the call does not stop a refresh. Tree
navigation, a session change, or shutdown discards it. If a refresh fails, the commit keeps its
result, and status reports the storage error.

A disable or call cancellation that arrives while the commit's registration writes `sources.json`
lets that write finish. If the write succeeds, the registration completes, and the commit returns
cancelled and refreshes. If the write fails, the commit rejects with the write's error, even when
the cancellation races the failure, and does not refresh.

The selection checks under the lock cover selection changes that leave the head unchanged. Tree
navigation can select another revision while the head stays the same, and reconciliation can attach
an already durable head without writing a new one. A commit from a base that the branch no longer
selects would either drop the notes committed after that base or replace the selected snapshot with
content from an abandoned branch. While a reference is pending, the selection does not yet name the
revision that reference records, so a commit could drop that revision's notes. Reconciliation can
also change the selection, or leave storage unready, while a captured proposal waits for its turn.
In each case the commit returns a `lineage` conflict, and the caller must capture a new proposal.

Conversation navigation selects an immutable session snapshot in memory. It does not rewrite the
materialized note files or rewind project learnings. Curation exclusions still apply to the selected
snapshot.

## Recovery

Tree navigation, a session change, reload, and shutdown stop the current storage session. The
extension cancels pending work at once but lets each file write already in progress finish,
including the remaining writes of a commit whose head is written and the reads and writes of a view
repair step already started. The next storage session opens only after that work settles, and
shutdown waits for it without a timeout.

A stop before the head is written leaves a revision file that no head names. Readers ignore it, the
previous revision stays current, and no observations are consumed for the interrupted proposal.

A pending head has not completed view materialization or recovery. When a store opens or inspects
curation, it first repairs pending heads whose learning names overlap those of its own pending head,
including overlaps connected through another pending head. It repairs the connected heads from
newest publication sequence to oldest. A proposal that writes a learning reconciles pending heads
for overlapping learning names before checking its expected predecessor. When a note-only proposal
has no learning in its own pending head, it does not scan other sessions. The store then repairs its
own pending head before exposing the session, inspecting curation, or accepting a proposal, so
curation does not mistake a view that a failed commit never wrote for a user deletion.

A note view whose digest matches the head needs nothing. An absent note view, or one whose bytes
equal the parent revision's rendering of the same note, is rewritten from the head's revision; any
other content is an external edit and is kept. Repair replaces a learning file only when its content
and project provenance match the predecessor digest and sequence recorded by that revision, or when
the revision expected an absent file and it remains absent. A newer publication or external edit or
deletion is kept. Repair records provenance separately for each learning file that holds the
committed content and does not replace newer provenance. The head is then marked as materialized:
recovery has completed, though curated or newer files may differ from the head's rendered views. A
head already marked as materialized is not repaired, so a note deleted after a completed commit
stays deleted.

A curation check or commit based on a fork ancestor's revision also repairs that ancestor's pending
head before it inspects the curation of either session. Under the project lock that the check or
commit already holds, it:

1. Rejects a symbolic link at the ancestor's session directories.
2. Confirms that the ancestor's identity names this project and that the base revision exists. When
   the identity names another project or the revision is missing, it does not repair anything: a
   curation check does not inherit curation from that base, and a commit rejects it as unavailable.
3. Repairs pending heads whose learning names overlap those of the ancestor's pending head, newest
   publication sequence first, then the ancestor's own views, under the rules above.
4. Inspects the child's curation, then the ancestor's, and merges the ancestor's records into the
   child's.

A commit reads its base revision before step 1, as it does for any base, so a commit with a missing
base is rejected as unavailable before the symbolic-link check.

Once step 2 confirms the base, the pending head of the session that the base names is repaired.
Another session's pending head, including one further up the base's lineage, is repaired only when
its learning names overlap, as step 3 describes. Repair does not change which revision the child
inherits: the child keeps its selected base even when the ancestor's head is a newer revision. If a
repair write fails, the check or commit rejects with that error before either curation file is
written, and the commit does not write a revision. Repair writes that finished before the failure
remain, and the next repair of that head continues from them.

Unsupported or damaged storage records remain unchanged; status reports the storage error. Missing
expected files or directories do not authorize reconstruction of old notes from historical
snapshots.

A revision reference entry on the Pi branch whose data fails its schema is damaged. Lineage
selection excludes it, the extension never rewrites or removes it, and status lists every damaged
entry on the active branch. A damaged entry can hide a revision newer than the selected one, and a
commit based on the older selection would discard that revision's changes. The lineage is therefore
ambiguous while the active branch has a damaged entry after the last valid reference to the selected
revision. That reference must name the current project and the selected revision's session and
revision. Every damaged entry makes the lineage ambiguous when any of these holds:

- No revision is selected.
- The selected revision is unavailable.
- No reference to the selected revision is on the branch.

While the lineage is ambiguous:

- The selection stays on the revision that the valid references select.
- Proposal capture refuses and names the first damaged entry that blocks commits.
- When no earlier check fails, a commit returns a `lineage` conflict. The commit reads the current
  branch under the project lock and again just before publishing the head, so a proposal captured
  before navigation onto a damaged branch, or before a damaged entry was appended, is also rejected.

Nothing records the ambiguity; each check derives it from the branch.

### Orphan heads

An orphan head is the latest durable head when no valid revision reference entry anywhere in the Pi
session names it. An interruption between the head write and its reference append, or a damaged
reference, leaves one. A head that a valid reference on another branch names is not an orphan: it
belongs to that branch and does not change this branch's selection. A head whose reference is
already appended to the active branch is not an orphan either. That reference stays pending until it
is confirmed in the session file, regardless of a configuration change, and it is dropped only when
the head, anchor, evidence, or curation no longer match.

At startup, after tree navigation, and in every refresh, reconciliation decides whether an orphan
head continues the branch's selection. Three revision fields take part, and none alone proves that
the head belongs to this branch:

- The base revision names the revision whose notes the head inherited.
- The parent revision names the head that the commit expected: the previous publication in this
  memory session, which can be on another branch.
- The anchor names the Pi entry where the proposal was captured. Sibling branches can share it.

Reconciliation attaches an orphan head, appending its reference, only when every condition holds:

- A revision is selected and available, or no revision is selected. An unavailable selection stays
  unavailable, with its diagnostic, even when the head names that revision as its base.
- The head's anchor is on the branch, its configuration fingerprint is current, and its evidence and
  curation still hold.
- Its base, its parent, and the damaged references that block commits match one row of this table:

| Selection                                 | Base and parent                                                     | Blocking damaged references |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------------------- |
| A revision of this memory session         | The base is the selected revision, and the parent is that revision. | At most one                 |
| No revision                               | Both are null.                                                      | None                        |
| A revision inherited from a fork ancestor | The base is the inherited revision, and the parent is null.         | None                        |

Permitting one damaged reference recovers a head that directly follows the selected revision when
only the head's own reference is damaged. The bound limits recovery; it does not prove that the
damaged entry names the head. Two or more blocking damaged references, including duplicates for one
head, leave the head unattached. Reconciliation never reads a damaged entry's data and never treats
parent revisions as content ancestry.

An orphan head that reconciliation does not attach is either unrelated or unresolved:

- It is unrelated when its anchor is not on the branch, or when the selected revision is available,
  no damaged reference blocks commits, and the head's base is a different revision. An unrelated
  head does not change the selection or block memory work on this branch. A proposal there expects
  it as the head and keeps the branch's own base.
- Otherwise it is unresolved. The selection, the head, and their records stay unchanged. Status
  names the head and why it cannot be attached, proposal capture refuses, and a commit returns a
  `lineage` conflict when no earlier check fails. A later refresh attaches the head once every
  condition holds, for example after the models it was committed with are selected again. Tree
  navigation to a point where the head is unrelated, such as an entry before its anchor, removes the
  block.

Some valid histories stay unresolved, such as a head committed after tree navigation whose reference
was lost, because its parent is not the revision the branch selects. Its revision and notes remain
stored. Recovery does not reconstruct a missing base revision.

The lineage stops being ambiguous in two ways:

- Reconciliation attaches an orphan head after the damaged entries and confirms its new reference.
  It does so only for a head that directly follows the selected revision while at most one damaged
  entry blocks commits.
- Tree navigation reaches a point where no damaged entry follows the selected revision's reference,
  such as the entry just before the first damaged entry that blocks commits. Other storage or
  selection failures can still prevent a commit there.

### Reconciliation readiness

Proposals use a selection only after reconciliation completed for the current storage session and
configuration. Storage is ready for proposals once the latest reconciliation ran for the current
configuration revision and dependency fingerprint without failing or leaving an orphan head
unresolved. Session start and tree navigation reconcile before storage opens. Readiness then changes
as follows:

- A settings or role change makes storage unready before a proposal can be captured with the old
  selection. This includes the role check after a model selection or `/tiered-memory on`, and a
  change back to earlier settings or models.
- The change completes only after a reconciliation for the new configuration revision and
  fingerprint, which runs as storage-session work. Like the refresh after a commit, it judges the
  selected revision and any orphan head against the branch's current effective sources. A
  reconciliation whose configuration changed while it ran does not append a reference or make
  storage ready; the newer change runs its own. A reference that a superseded reconciliation already
  appended stays pending, and a later reconciliation confirms it without appending another.
- A change that begins while storage opens still gets a reconciliation for its configuration. When
  its role check finishes after the new storage scope exists, the change's own reconciliation runs
  after the startup finishes. When the check finishes earlier, the startup's reconciliation already
  uses the change's configuration. Until the change's role check succeeds, the startup does not
  append a reference for an orphan head, and it leaves storage unready, or failed when that role
  check fails.
- A failed reconciliation or role check keeps the previous selection and records, reports the
  storage error, and leaves storage unready until a reconciliation started by `/reload`, tree
  navigation, a model selection, or `/tiered-memory on` succeeds.
- The refresh after a commit does not run while a change's reconciliation is pending or after a
  reconciliation or role check failed. Otherwise it keeps storage ready only when it succeeds and
  leaves no orphan head unresolved.

While storage is unready, capture refuses, and a commit returns a `lineage` conflict when no earlier
check fails. A proposal captured before the change can wait for running reconciliation, then
validates against its result.

### Symbolic links and the project lock

A symbolic link at `.pi/`, `.pi/tiered-memory/`, `sessions/`, `sessions/_project/`, `learnings/`,
the session's directory, its `current/` or `revisions/` directory, or a project-lock directory makes
storage unavailable, and status reports the error. Managed ancestors are checked before the lock
creates directories. A commit or curation check based on a fork ancestor's revision also rejects a
symbolic link at the ancestor's session directories.

Opening a store, commits, curation checks, and source registration hold the project mutation lock at
`sessions/.lock/`. Acquisition requires filesystem hard-link support. A contender writes a complete
private owner record with its process identifier and token, then publishes an immutable numbered
ticket through an atomic hard link. Lower live tickets finish first. Completion markers and
dead-process checks let later contenders reclaim finished or abandoned tickets below the greatest
number; that greatest ticket remains as the sequence high-water mark. A delayed contender rechecks
the published maximum before waiting, so it cannot enter under a retired number. A damaged ticket is
preserved and reported. Dead private records are removed. Acquisition waits up to five seconds
before reporting the lock as busy; retry after the other writer finishes. If the lock stays busy
while storage opens at session start or after tree navigation, storage stays unavailable for that
session and status reports the busy error; `/reload` or another tree navigation retries. Waiting
observes cancellation. When another process has reused a dead holder's process identifier,
contenders treat its ticket as live and report busy after the deadline until that process exits.

On Windows, concurrent removal by another contender can make a lock file operation fail with `EPERM`
or `EBUSY`. The contender skips that file instead of failing:

- A skipped ticket stays listed, so the contender keeps waiting and retries it on its next check.
- A skipped dead private record is removed by a later acquisition.
- A skipped completion marker stays in `sessions/.lock/done/`. It is inert, because its name
  includes its ticket's random token and no later ticket reuses that token.

If the final check before the deadline skips a ticket, the busy error carries the last skipped
failure as its cause.

## Curation

External edits and deletions are treated as user curation, including changes made through shell
commands. Before accepting a proposal, the writer compares managed files with their recorded
revisions and content digests. Changed text is preserved, and proposals based on older content are
rejected. Deleted notes are excluded from current memory; the same consumed evidence cannot silently
recreate them. After new evidence supports a replacement, the earlier consumed evidence remains
excluded. Conversation navigation does not undo these exclusions.

Forks inherit their parent's curation exclusions, including those for absent notes, and save them in
the child session. The store first repairs the pending head of the ancestor session that the fork's
base revision names, as described under [Recovery](#recovery). Views that an interrupted ancestor
commit never wrote are therefore not recorded as edits or deletions in either session. Referring to
the same inherited evidence through the child's source reference does not make it new evidence. A
deletion permits a replacement supported by new evidence; an edited body remains protected from
automatic replacement.

Fork lineages have no fixed revision-count cutoff. Cycles and unavailable ancestors in a traversed
lineage are reported as damaged instead of making inherited evidence eligible again.

Deleting a note does not delete the original Pi transcript or all historical revisions. Git can
restore only content that was previously committed. The extension does not change ignore rules,
stage files, commit, push, or synchronize memory. A parent `.pi/` ignore rule can also exclude
`.pi/tiered-memory/learnings/`; users choose which learning files to track.

## Acting-agent writes

The extension blocks ordinary `write` and `edit` calls into managed memory paths, including while
memory is disabled or storage failed to open. The blocked-call explanation directs the acting agent
to automatic observation and leaves direct file maintenance to user curation. Shell commands and
tools that do not participate in these hooks can still change files; detected changes receive the
curation policy.

The guard covers `.pi/tiered-memory/sessions/` and `.pi/tiered-memory/learnings/` under the project
root found for the working directory. It leaves `settings.json` editable. It resolves relative and
absolute paths, Pi's leading `@` form, `~`, `file://` URLs, and the Unicode spaces normalized by Pi.
Existing symlink ancestors and dangling symlinks into missing managed targets are checked.
Unresolvable paths, empty paths, and symlink loops are blocked; a path that fails resolution for any
other reason blocks the call through Pi's extension-failure handling.

Hard links, mount aliases, and path changes between the check and the tool's write are outside this
guard's boundary. The guard does not provide filesystem isolation.
