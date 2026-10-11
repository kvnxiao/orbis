---
name: work-issue
description: >-
  Start, resume, or continue an Orbis issue, PR, or direct development request. Resolve the target,
  route authorized work to the applicable global or repository skill, and deliver through review and
  a PR. Excludes status-only questions, read-only reviews, and general questions.
---

# Work on an Orbis issue, PR, or request

Coordinate GitHub tracking, authorization, and delivery. The global `write-spec`, `plan-from-spec`,
and `implement-spec-plan` skills own specification, planning, and plan execution. Resolve their
installed paths through the host's skill catalog; do not copy their procedures into this repository.

## Work paths and handoffs

- Work follows one of two **work paths**. The **issue-backed path** uses a GitHub issue to track a
  change that introduces, improves, or changes package behavior. The **PR-only path** delivers a
  direct request through a PR alone: a change within a package's approved contract, a documentation
  change, or a workspace tooling change.
- The **Current handoff** table at the top of an issue body records its authorization, work,
  blocker, and next action. A **checkpoint** is an issue comment that records paused work, a
  delivery, or an approved brainstorm's decisions.

## 1. Find the target

- Resolve an unqualified issue or PR number against `kvnxiao/orbis`, and honor an explicit
  repository or URL.
- Read issue or PR metadata with explicit fields before requesting comments:

  ```sh
  agent-gh issue view N -R kvnxiao/orbis --json number,title,state,body,parent,subIssues,blockedBy,blocking
  agent-gh pr view N -R kvnxiao/orbis --json number,title,state,url,body,headRefName,headRefOid,isDraft,reviewDecision,latestReviews,closingIssuesReferences
  agent-gh issue list -R kvnxiao/orbis --state all --search "<terms> in:title,body" --json number,title,state,url
  ```

- Resume a PR on its closing issue or the issue whose Work row records it; otherwise use the PR-only
  path. Resolve a branch through its PR or recorded issue.
- For a direct request, search existing issues. Reuse a matching open issue and treat a closed match
  as delivered context.
- Fetch a specific comment only when its checkpoint link or a finding requires it:
  `agent-gh api repos/kvnxiao/orbis/issues/comments/ID`.

## 2. Establish scope and authorization

Read [authorization.md](../../shared/authorization.md) when the request limits scope and before
publishing. Read the issue's handoff, relevant discussion, dependencies, and linked PR. Preserve
unrelated changes.

- Keep issue-backed work on that path. For a new package behavior change, create or reuse an issue
  under [issues.md](../../shared/issues.md), unless the request is local-only or chat-only. Deliver
  other direct requests by PR alone.
- Read the package's SPEC, any declared files that divide the specification by area, and linked
  interaction contract before relying on behavior. Read
  [specifications.md](../../../docs/specifications.md) when writing or converting a contract.
- For planned implementation, locate the `.plans/<spec-slug>/README.md` that the issue names. Let
  the global skills validate its approval, specification baseline, dependencies, and task state. An
  issue checklist is not a substitute for that plan set.
- If existing work has only an issue-body plan, preserve its decisions and evidence and reconcile it
  through `plan-from-spec` before executing it. Do not infer completion or refresh a baseline from a
  historical checklist.
- If a reviewed PR has passing verification for its head and no agent-owned work remains, report the
  developer's remaining action. New user instructions can create additional work.

## 3. Route the authorized work

State the work path, next bounded action, and responsible editor. Honor an explicitly named skill
and the request's scope limits. Load domain rules before dependent work and use
[delegation.md](../../shared/delegation.md) when assigning a delegate.

| Work                                                         | Route                                            |
| ------------------------------------------------------------ | ------------------------------------------------ |
| Create, amend, reconcile, or convert a specification         | Global `write-spec`                              |
| Plan an approved specification or reconcile an existing plan | Global `plan-from-spec`                          |
| Execute or resume an approved plan set                       | Global `implement-spec-plan`                     |
| Refresh dependencies or compiler checks                      | Repository `update-toolchain`                    |
| Write or review a README                                     | Repository `write-readme`                        |
| Other bounded changes                                        | Assign each file to its editor under `AGENTS.md` |

The selected skill owns its decision rounds, approval gates, task selection, state updates, and
review. Supply Orbis rules and authorization without replacing that workflow. If a required global
skill is unavailable, report the missing skill and stop the dependent work rather than substituting
a local procedure.

Route `Needs spec` or `Needs contract` to `write-spec`, and `Needs plan` or `Needs a plan` to
`plan-from-spec`, within the authorized scope. After `Done` or `No spec change`, reassess the
remaining authorized work. A design-only or planning-only request stops at its deliverable. Continue
already-authorized implementation when the required approvals and plan checks pass; otherwise report
what is pending. Resolve returned decisions through `brainstorm` and continue independent work while
a blocker remains.

For an initiative or epic, use issue dependencies and approved priority to identify the requested
plan or slice; the execution skill selects tasks within it. Link plan files from the issue and
record shared progress there without duplicating executable tasks or agent-only state.

## 4. Pause or deliver

For an issue-backed pause, publish a checkpoint under [records.md](../../shared/records.md) and
update the handoff under [issues.md](../../shared/issues.md). Keep unapproved brainstorm decisions
in chat or private scratch. For PR-only work without a PR, report the branch and next action in
chat.

To deliver:

1. Complete `review-changes mode=apply` under [review.md](../../shared/review.md). Reuse a review
   the active global skill already completed for the same accumulated changes; resolve new changes
   and findings before delivery.
2. Draft and audit commit and PR prose with `audit-prose`, following
   [records.md](../../shared/records.md).
3. Push the work branch and open a PR against the default branch under
   [issues.md](../../shared/issues.md). Include a separate `Closes #<number>` line for each issue
   the merge completes.
4. For issue-backed work, publish the delivery checkpoint and update the handoff. Leave the PR open
   for developer review and merge.

Report links, verified outcomes, remaining obligations, and unverified remote state. Never infer
delivery from an issue closed as not planned.
