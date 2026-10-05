# GitHub records

## Contents

- Labels
- Wording
- Format and publication
- Status and completion

## Labels

Every issue has exactly one `level:` label and one primary `kind:` label. Every PR has exactly one
primary `kind:` label and no `level:` label. Classify a PR by its delivered outcome instead of
copying every label from a linked issue. Apply labels when creating an issue or PR, and reconcile
them when its scope or deliverable changes. Reconcile an existing issue's labels when working on it,
and do not modify unrelated issue content.

| Level label        | Scope                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| `level:initiative` | Rare, broad effort coordinating substantial deliveries across most of the repository |
| `level:epic`       | Substantial package or capability delivery coordinated through tasks                 |
| `level:task`       | Independently executable, bounded outcome                                            |

Choose the primary kind by the deliverable, regardless of the files touched or the current Stage. A
feature issue in Design remains `kind:feature` when its deliverable is package behavior. Use design
or research as the primary kind only when that work is itself the deliverable.

| Kind label      | Deliverable                                                        |
| --------------- | ------------------------------------------------------------------ |
| `kind:feature`  | Add or change package behavior                                     |
| `kind:bug`      | Correct a deviation from approved behavior                         |
| `kind:refactor` | Improve implementation while preserving behavior                   |
| `kind:design`   | Deliver an approved contract or design                             |
| `kind:research` | Investigate or evaluate a question                                 |
| `kind:docs`     | Deliver documentation or agent guidance                            |
| `kind:tooling`  | Change workspace tooling, dependencies, scaffolding, or automation |

The repository label catalog has only these ten labels; GitHub's default labels, such as
`help wanted` and `good first issue`, are outside it. Report unexpected labels without changing
unrelated records.

## Wording

These rules apply to issue bodies, PR bodies, comments, and Project items, including checkpoints on
both work paths.

- Use descriptive decision names and explicit outcomes. Do not refer to questions by their
  conversation numbers or to choices by option letters. Translate a local answer into its meaning,
  such as "use Pi session entries as authoritative storage", and link the decision record when more
  context is needed.
- Do not cite counts or sizes of repository artifacts, even when reducing them is the goal. These
  include requirement, test, link, file, line, and word counts, and percentage changes in document
  length. State the outcome instead: write "every requirement has a conformance scenario", not
  "eight requirements have scenarios". A tally goes stale at the next push even while the outcome
  still holds.
- Identifiers, versions, and commit-pinned links are not counts. Report a runtime measurement, such
  as a benchmark, import-time, latency, or heap result, with the revision it measured.

## Format and publication

1. Prepare drafts in ignored `.artifacts/` files.
2. Write each prose paragraph or list item on one physical line and let the browser wrap it.
   Preserve structural newlines for headings, lists, tables, and code blocks. Do not insert
   column-width breaks, trailing double spaces, or HTML breaks. When adapting tracked prose, join
   its artificial line breaks without flattening Markdown structure or changing code blocks.
3. Do not run Markdown reflow or a width-enforcing formatter on drafts; Oxfmt excludes
   `.artifacts/**`. Pass the destination and this one-line rule to every prose auditor.
4. Publish with `--body-file`, preserving the draft's bytes, then verify the stored body.

Review ordinary checkpoint prose within the publishing assignment; it does not need a separate audit
assignment. Correct current bodies when needed, and do not bulk-reformat historical comments. Use
the supported CLI commands or `agent-gh api` for native sub-issues and dependencies, and check the
installed CLI's help before using a flag.

## Status and completion

| Project status | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| Backlog        | Candidate work awaiting prioritization or a decision to begin                             |
| Ready          | Approved scope and prerequisites permit execution; execution still requires authorization |
| In progress    | Design, investigation, or implementation is underway                                      |
| In review      | The issue's complete delivery is ready for developer review                               |
| Done           | Issue is closed; its completion reason distinguishes delivery from abandonment            |

Record a blocker and its resolving decision or prerequisite on the issue without adding a status. A
parent remains In progress while only some child outcomes are in review. Do not infer readiness from
a draft PR or completion from a locally passing test suite.

| Completion case    | Definition of done                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Implementation     | Scoped behavior is implemented, contracts and docs agree, required verification passes, and changes are merged                     |
| Design             | Material decisions are resolved and the approved contract is delivered in its shared destination; a repository design PR is merged |
| Investigation      | The stated question has supported findings and the consequence for dependent work is recorded; a negative result can complete it   |
| Initiative or epic | Required outcomes are delivered and integrated acceptance establishes coverage of the approved scope                               |

- Close abandoned work as **not planned**. It may appear in Done, but do not report it as delivered
  or treat it as satisfying parent acceptance. When a required child is abandoned, reassess the
  coordinating issue's scope with the developer. Child completion counts do not establish
  conformance.
- For PR-delivered work, put a separate `Closes #<number>` line in the PR body for every issue the
  merge will complete. Ordinary references describe related work. List each delivered issue
  explicitly; do not rely on parent or child closure cascading.
- A SPEC-only PR references an implementation epic or initiative without closing it. The final
  delivery PR closes that issue only when all required child outcomes are already delivered or land
  in that PR, and integrated acceptance passes.
- Merging into the default branch closes the linked issues and updates their Project status through
  the repository's automation. Do not close implementation issues manually before merge. Close a
  completed investigation without a PR after recording its accepted outcome.
- On resumption, reconcile issue state and delivery links instead of replaying completed work.
