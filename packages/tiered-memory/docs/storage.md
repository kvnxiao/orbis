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
and once before each commit. Status reports the source and curated-note counts from the latest
registration, labeled with the event that produced them, and does not register again. Commit
validation projects the current effective sources without changing `sources.json`.

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
base revision. It registers sources once and checks the captured evidence before taking the project
mutation lock. Under the lock it checks that the head is the expected revision, that curation
permits every written note, that learning digests and sequences match, and that the current
effective sources, branch anchor, and configuration still support the proposal. It checks the live
evidence and configuration again just before publishing the head, without registering sources or
changing the latest status counts. A failed check returns a conflict naming both revisions and the
reason: `head`, `curation`, `learning`, `evidence`, or `configuration`. A stopped session or a
cancelled call reports cancellation, never a conflict. Concurrent sessions share the lock; an
obsolete proposal must be recomputed from the accepted revision. Project-learning updates compare
both the content digest and publication sequence, so a later publication invalidates an older
proposal even when the text is unchanged.

An accepted commit advances the project sequence and writes, in order, the revision file, the head
naming it, each changed note view, the learning views, and the learning provenance, then marks view
materialization complete. If one of several started view writes fails, the writer waits for its
siblings to settle before releasing the lock. Only a head names a current revision. The writer then
records the revision reference on the Pi branch. Pi can defer a new session file until its first
assistant response, so an in-memory custom entry alone does not prove the reference is durable; the
reference stays pending until it is confirmed in the session file, and no new proposal is captured
meanwhile.

Conversation navigation selects an immutable session snapshot in memory. It does not rewrite the
materialized note files or rewind project learnings. Curation exclusions still apply to the selected
snapshot.

## Recovery

A stop before the head is written leaves a revision file that no head names. Readers ignore it, the
previous revision stays current, and no observations are consumed for the interrupted proposal.

A pending head has not completed view materialization or recovery. When a store opens, it first
repairs pending heads whose learning names overlap those of its own pending head, including overlaps
connected through another pending head. It repairs the connected heads from newest publication
sequence to oldest. A proposal that writes a learning reconciles pending heads for overlapping
learning names before checking its expected predecessor. When a note-only proposal has no learning
in its own pending head, it does not scan other sessions. The store then repairs its own pending
head before exposing the session or accepting a proposal.

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

At startup and after tree navigation, a head revision that no session entry references is attached
to the branch only when its anchor is on the branch, its base is the selected revision, its
configuration fingerprint is current, and its evidence and curation still hold. A reference already
appended to the branch is confirmed regardless of a configuration change; it is dropped only when
the head, anchor, evidence, or curation no longer match.

Unsupported or damaged records remain unchanged; status reports the storage error. Missing expected
files or directories do not authorize reconstruction of old notes from historical snapshots.

A symbolic link at `.pi/`, `.pi/tiered-memory/`, `sessions/`, `sessions/_project/`, `learnings/`,
the session's directory, its `current/` or `revisions/` directory, or a project-lock directory makes
storage unavailable, and status reports the error. Managed ancestors are checked before the lock
creates directories. A commit or curation check based on a fork ancestor's revision also rejects a
symbolic link at the ancestor's session directories.

Commits and curation checks hold the project mutation lock at `sessions/.lock/`. Acquisition
requires filesystem hard-link support. A contender writes a complete private owner record with its
process identifier and token, then publishes an immutable numbered ticket through an atomic hard
link. Lower live tickets finish first. Completion markers and dead-process checks let later
contenders reclaim finished or abandoned tickets below the greatest number; that greatest ticket
remains as the sequence high-water mark. A delayed contender rechecks the published maximum before
waiting, so it cannot enter under a retired number. A damaged ticket is preserved and reported. Dead
private records are removed. On Windows, removal blocked by an open ticket file is retried while the
contender waits. Acquisition waits up to five seconds before reporting the lock as busy; retry after
the other writer finishes. Waiting observes cancellation. When another process has reused a dead
holder's process identifier, contenders treat its ticket as live and report busy after the deadline
until that process exits.

## Curation

External edits and deletions are treated as user curation, including changes made through shell
commands. Before accepting a proposal, the writer compares managed files with their recorded
revisions and content digests. Changed text is preserved, and proposals based on older content are
rejected. Deleted notes are excluded from current memory; the same consumed evidence cannot silently
recreate them. After new evidence supports a replacement, the earlier consumed evidence remains
excluded. Conversation navigation does not undo these exclusions.

Forks inherit their parent's curation exclusions, including those for absent notes, and save them in
the child session. Referring to the same inherited evidence through the child's source reference
does not make it new evidence. A deletion permits a replacement supported by new evidence; an edited
body remains protected from automatic replacement.

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
