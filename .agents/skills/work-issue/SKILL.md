---
name: work-issue
description:
  Start, resume, or continue an Orbis issue, a PR, or a direct request, including plain requests
  such as "Resume #12", "Resume PR #34", or "continue this ticket", and requests that name a
  specialist skill. Resolve and classify the target, route it to a specialist skill or delegate,
  and deliver through review and a PR. Excludes status-only questions, read-only reviews, and
  general questions.
---

# Work on an Orbis issue, PR, or request

Every development request starts here. This skill finds the target, classifies it, routes it to one
specialist skill or delegate, and delivers the result. It is the only skill that starts another
repository skill. Read each shared file at the step that names it, not up front.

## 1. Find the target

- Resolve an unqualified `#number` against `kvnxiao/orbis`, and honor an explicit URL or
  repository-qualified reference.
- Query GitHub with explicit fields, and do not request comments while finding or resuming work:

  ```sh
  agent-gh issue view N -R kvnxiao/orbis --json number,title,state,body,parent,subIssues,blockedBy,blocking
  agent-gh pr view N -R kvnxiao/orbis --json number,title,state,url,body,headRefName,headRefOid,isDraft,reviewDecision,latestReviews,closingIssuesReferences
  agent-gh issue list -R kvnxiao/orbis --state all --search "<terms> in:title,body" --json number,title,state,url
  ```

  Fetch a single comment with `agent-gh api repos/kvnxiao/orbis/issues/comments/ID` only when the
  handoff's Checkpoint link or a specific finding needs it.

- A PR resumes on the issue it closes, or on the issue whose Work row records it; otherwise it is
  PR-only work. A branch resumes through its PR, or through the issue that records the branch.
- For a direct request, search open and closed issues. Resume a matching open issue, and treat a
  closed match as delivered context.

## 2. Read the state

1. Read the issue body, its handoff table and plan, the parent and open blockers that set its scope,
   and any linked PR's state, head, review decision, and body.
2. If the PR is open and not a draft, has no unaddressed feedback, has passing verification recorded
   for its head, and no agent-owned work remains, report the developer's remaining action and stop.
3. For package work, read the SPEC and its interaction document before relying on behavior. Preserve
   unrelated files and concurrent work.

## 3. Classify and route

When the request limits scope, read [authorization.md](../../shared/authorization.md) first. Then
classify the work on a work path as `AGENTS.md` defines it:

- Work that an issue already tracks stays issue-backed, even when its remaining change would qualify
  for the PR-only path.
- For new issue-backed work, create or reuse an issue under [issues.md](../../shared/issues.md) once
  its outcome can be named, unless the request is local-only or chat-only.
- PR-only work does not create an issue.

State the classification, the next bounded action, and who executes it. When the request names a
specialist skill, invoke it within the request's scope. Otherwise, act on the first matching row:

| Situation                                                                                             | Next action                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The requested scope is complete                                                                       | Deliver undelivered changes in step 4, or report the results and the authorization the next activity needs |
| Code or a PR needs corrections                                                                        | Resume its branch, send accepted findings to each file's editor, then deliver                              |
| Dependency refresh or newly supported strict checks                                                   | Invoke `update-toolchain`                                                                                  |
| A README to write or review                                                                           | Invoke `write-readme`                                                                                      |
| A SPEC is missing, unfinished, or unapproved, package behavior changes, or code drifted from its SPEC | Invoke `specify-package`                                                                                   |
| An approved contract without a current plan, and planning requested or implementation authorized      | Invoke `plan-implementation`                                                                               |
| A plan's Design section awaits approval                                                               | Present the section, and keep implementation blocked until the developer approves it                       |
| An approved contract and current plan, with implementation authorized                                 | Delegate the next unblocked task to `orbis-implementer` under [delegation.md](../../shared/delegation.md)  |
| Any other change                                                                                      | Have each file's editor make the edits, then deliver                                                       |

When a specialist skill returns, act on its outcome:

| Outcome        | Next action                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Done           | Reclassify from the new state and the skill's report, and route again                                 |
| Needs contract | Invoke `specify-package`                                                                              |
| Needs a plan   | Invoke `plan-implementation`                                                                          |
| Blocked        | Settle a developer decision through `brainstorm`, or report the blocker and continue independent work |

While routing:

- Read [authorization.md](../../shared/authorization.md) before pushing or publishing. Continue
  authorized implementation after planning without asking again.
- Load the rules skills for the domain before any edit.
- For an epic or initiative, select an unfinished child by its dependencies and approved priority.
  Do not redo completed design or duplicate current plans.

## 4. Pause or deliver

When work pauses before delivery, publish a checkpoint for issue-backed work under
[records.md](../../shared/records.md), and update the handoff table under
[issues.md](../../shared/issues.md). For an unapproved brainstorm, report the pending approval in
chat, and keep its provisional decisions out of the checkpoint. For PR-only work without a PR,
report the branch and next action in chat.

To deliver:

1. Run the global `review-changes` skill with `mode=apply` on the accumulated change set, under
   [review.md](../../shared/review.md).
2. Draft the commit message and PR body in `.artifacts/` under
   [records.md](../../shared/records.md), and audit them with `audit-prose`.
3. Open the PR against the default branch from a work branch, with labels and a `Closes #<number>`
   line for each completed issue under [issues.md](../../shared/issues.md).
4. For issue-backed work, publish the delivery checkpoint and update the handoff table.
5. Leave the PR open for developer review and merge.

Report the issue and PR links, verified outcomes, remaining blockers, and any remote state that
could not be verified. Never infer delivery from an issue closed as not planned.
