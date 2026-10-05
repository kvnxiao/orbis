# Issues, PRs, and the Project

Read this file before creating, editing, labeling, or closing an issue or PR.

## Contents

- Hierarchy and scope
- PR boundaries
- Current handoff table
- Edit the issue body
- Labels
- Project status and completion

## Hierarchy and scope

- An **initiative** coordinates substantial deliveries across most of the repository. An **epic**
  delivers a substantial package or capability through tasks. A **task** is an independently
  executable, bounded outcome. These roles describe scope, not tree depth; a parent can skip a
  level.
- Keep small work in one issue, and use checklists for steps without separate ownership. Create a
  child only for independent execution or delivery.
- Before creating an issue, search open and closed issues, and confirm that the new deliverable
  differs from existing contracts and plans.
- Use native sub-issues for decomposition and blocking relationships for prerequisites; issue
  numbers do not imply order. Use the CLI or `agent-gh api` for them, and check the installed CLI's
  help before using a flag.
- Add each new issue to [Project 1](https://github.com/users/kvnxiao/projects/1), discover its field
  and option IDs instead of embedding them, and verify membership. A parent's membership does not
  cover its children.
- Link the SPEC requirements an issue covers, and distinguish partial contributions from full
  coverage.

## PR boundaries

- Once substantive package brainstorming can name its outcome, create or reuse an issue at that
  scope. Save the approved SPEC before implementing behavior.
- Use a SPEC-only PR when a substantial new extension needs an agreed baseline. A small delivery
  combines the SPEC and implementation, and a later revision combines approved amendments, code, and
  tests. Use a separate design PR when a decision needs independent review.
- The delivery issue persists across its PRs. Match each PR to one coherent, reviewable outcome.

## Current handoff table

Start every issue body with this table. Keep the heading, markers, labels, and row order, and write
each row on one physical line:

```markdown
<!-- orbis:handoff:start -->

## Current handoff

| Field         | Current value                                  |
| ------------- | ---------------------------------------------- |
| Authorization | Pending developer direction                    |
| Work          | Not started                                    |
| Blocker       | None                                           |
| Next action   | Resolve the scope and execution authorization. |
| Checkpoint    | None                                           |

<!-- orbis:handoff:end -->
```

| Field         | Contents                                                                             |
| ------------- | ------------------------------------------------------------------------------------ |
| Authorization | Approved scope and execution permission, with restrictions and an approval link      |
| Work          | Active child, branch or PR, and source revision; state uncommitted or unstarted work |
| Blocker       | The obstacle and the decision or prerequisite that resolves it, or None              |
| Next action   | One bounded action and its responsible role                                          |
| Checkpoint    | A link to the packet the next session needs, or None                                 |

Put the outcome, approved baseline, approach, and acceptance criteria below the table. Update the
table when work pauses, when a PR opens, and when authorization changes. When an issue still has an
older table with Stage or Verification rows, remove those rows in your next edit; do not migrate
idle or closed issues in bulk.

## Edit the issue body

1. Reread the remote body before every edit. Preserve contributor text, and skip unchanged writes.
2. For a routine update, change only the value cells between exactly one pair of handoff markers.
   GitHub receives the whole body, so inspect the draft's diff and reconcile concurrent changes.
3. Edit the plan sections only when the scope, approach, dependencies, acceptance criteria, or task
   checklists change.
4. Batch pending changes before a pause or delivery, or update sooner when another worker needs the
   changed plan.
5. After an uncertain write, check the remote state before retrying.

If the markers are missing, duplicated, or malformed, reconcile the structure before a routine
update.

## Labels

Every issue has exactly one `level:` label and one `kind:` label. Every PR has one `kind:` label and
no `level:` label. Choose the kind by the deliverable, not by the files touched, and reconcile
labels when the scope changes. Report labels outside this catalog without changing unrelated
records.

| Label              | Use                                                                |
| ------------------ | ------------------------------------------------------------------ |
| `level:initiative` | Rare, broad effort across most of the repository                   |
| `level:epic`       | Substantial package or capability delivered through tasks          |
| `level:task`       | Independently executable, bounded outcome                          |
| `kind:feature`     | Add or change package behavior                                     |
| `kind:bug`         | Correct a deviation from approved behavior                         |
| `kind:refactor`    | Improve implementation while preserving behavior                   |
| `kind:design`      | Deliver an approved contract or design as the deliverable itself   |
| `kind:research`    | Investigate or evaluate a question as the deliverable itself       |
| `kind:docs`        | Deliver documentation or agent guidance                            |
| `kind:tooling`     | Change workspace tooling, dependencies, scaffolding, or automation |

## Project status and completion

| Status      | Meaning                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| Backlog     | Candidate work awaiting prioritization or a decision to begin                      |
| Ready       | Approved scope and prerequisites permit execution, pending authorization           |
| In progress | Design, investigation, or implementation is underway                               |
| In review   | The issue's complete delivery is ready for developer review                        |
| Done        | The issue is closed; its completion reason distinguishes delivery from abandonment |

| Issue kind         | Done when                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Implementation     | Scoped behavior is implemented, contracts and docs agree, verification passes, and the PR is merged |
| Design             | Material decisions are resolved and the approved contract is merged in its destination              |
| Investigation      | The question has supported findings and their consequence for dependent work is recorded            |
| Initiative or epic | Required outcomes are delivered and integrated acceptance covers the approved scope                 |

- Close abandoned work as **not planned**, and never report it as delivered or as satisfying a
  parent's acceptance. Reassess a parent's scope with the developer when a required child is
  abandoned.
- Put a separate `Closes #<number>` line in a PR body for every issue its merge completes. A
  SPEC-only PR references its implementation epic without closing it.
- Merging closes the linked issues and updates their status through repository automation. Do not
  close implementation issues manually before merge. Close a completed investigation without a PR
  after recording its outcome.
- Record a blocker on the issue without adding a status. Do not infer readiness from a draft PR or
  completion from a local test run or a child count.
