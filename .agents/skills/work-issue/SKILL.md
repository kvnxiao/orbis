---
name: work-issue
description: >-
  Start, resume, or continue an Orbis issue, a PR, or a direct request, including plain requests
  such as "Resume #12", "Resume PR #34", or "continue this ticket". Resolve the target, state its
  classification, load the relevant rules skills, and route design, planning, implementation,
  verification, and PR delivery. Excludes status-only questions, read-only reviews, and general
  questions.
---

# Work on an Orbis issue, PR, or request

Start the work, then route design, planning, implementation, verification, and delivery to the
specialist skills without requiring the developer to invoke each one. The session running this
skill is the orchestrator, and the `orbis-implementer` agent is its implementation delegate. The
[development workflow](../../../docs/development-workflow.md) defines the work paths,
authorization, checkpoints, and definitions of done that this skill applies; read each linked
section when the step reaches it. Apply its
[issue label rules](../../../docs/development-workflow.md#issue-labels) to every issue and PR the
work creates or changes.

## Start the work

These steps carry out the [`AGENTS.md` start protocol](../../../AGENTS.md#start-a-session).
Complete them in order before any edit.

### Resolve the target

Resolve an unqualified `#number` against the current repository. Honor an explicit GitHub URL or
repository-qualified reference; clarify only when the target remains materially ambiguous. Inspect
the working tree and branch, then resolve the target by its kind:

- **Issue:** work on that issue.
- **PR:** read its state and closing issues under the workflow's
  [retrieval rules](../../../docs/development-workflow.md#retrieve-current-work-before-history). A
  closing issue is one that merging the PR closes, such as one named by a `Closes #<number>` line in
  the PR body. Resume on the first issue that matches, and treat the PR as its linked delivery:
  1. Its closing issue. When the PR closes several issues, use the one whose
     [handoff](../plan-implementation/references/plan-format.md#current-handoff) Work row records
     the PR, or else the most specific one, such as a task rather than its epic.
  2. An issue whose Work row records the PR or its branch.

  An ordinary reference in the PR body, without a closing keyword, does not select an issue. A PR
  that matches neither continues on the PR-only path.
- **Branch:** resolve its PR and continue as a PR target. Resume a branch without a PR on the issue
  that the request names or whose handoff Work row records the branch; otherwise resume it as
  PR-only work interrupted before a PR existed.
- **Package or other direct request:** search open and closed issues for one that already tracks
  the request. Resume on a matching open issue, and treat a closed match as delivered context
  without reopening its scope. Otherwise the target is a direct request without an issue.

### Read the current state

Read the delivery state first under the retrieval rules. For issue-backed work, read the issue body
and its current handoff. For the target or linked PR, read its state, draft status, head commit,
review decision, latest reviews, closing issues, and body. Fetch checkpoint comments only for a
specific gap, supporting evidence, or a requested retrospective. When this state shows that the work
awaits developer review, skip the reads below, then classify the work and report the remaining
developer action. The work awaits developer review when all of these hold:

- The PR is open and is not a draft.
- The PR has no requested changes or unaddressed developer review feedback.
- A recorded passing verification covers the PR's current head.
- The branch has no unpushed or uncommitted changes.
- The handoff's Next action, or the PR body for PR-only work, leaves no agent-owned work.
- For issue-backed work, the PR closes the issue and the issue has no unfinished children.

Otherwise, read the issue's relationship metadata, then the related bodies that establish scope,
readiness, or acceptance: its parent, open blockers, and, for an epic or initiative, the unfinished
children and their blockers. Read completed children only to establish the issue's completion or
when a current plan depends on their results.

Read the affected SPEC and interaction contract, then inspect current source and tests. For
workspace work without a package SPEC, use the approved request and repository constraints. When an
issue exists, compare its recorded baseline against relevant changes. Preserve unrelated files and
concurrent work. Distinguish developer-approved behavior, execution authorization, and verification
still required.

### Classify and state

Classify the work on one of the workflow's
[work paths](../../../docs/development-workflow.md#work-paths); an existing issue always takes
precedence over the PR-only path.

- **Issue-backed:** derive the current Stage from issue relationships, dependencies, handoff,
  approval evidence, contract, source, tests, and linked PRs. When the work awaits developer
  review, the delivery state alone establishes the Review Stage. Board status, checklists, and an
  old handoff alone do not prove readiness or completion. Use exactly one case-sensitive value from
  the plan format's [Stage values](../plan-implementation/references/plan-format.md#stage-values);
  keep blockers, authorization, and Project status separate.
- **PR-only:** a direct request that the PR-only path covers. Assign no Stage and create no issue,
  issue plan, or handoff table.
- **New issue:** a direct request that introduces, improves, or changes package behavior gets an
  issue, and the work continues as issue-backed. Keep a small request in one issue and create
  children only for independent execution or delivery. Add each issue to
  [Project 1](https://github.com/users/kvnxiao/projects/1) owned by `kvnxiao` and verify membership.
  Discover field and option IDs from the project rather than embedding them in plans.

Before acting, state the classification, its supporting evidence, the next bounded action, and who
executes it: the orchestrator, `orbis-implementer`, or the developer for a review or merge.
Refresh that assessment when the contract, plan, implementation, or PR state changes.

### Load the rules

Before starting work or implementation, load the `*-rules` skills for the work's domain, such as
[pi-coding-agent-rules](../pi-coding-agent-rules/SKILL.md) for Pi extensions, packages, and
TypeScript. Read each of their references whose "Read when" condition matches the change, and name
the loaded skills and references in every delegate handoff.

## Route and execute

Under the [executor rule](../../../AGENTS.md#start-a-session) in `AGENTS.md`, `orbis-implementer`
makes implementation edits and the orchestrator edits the remaining files that step 5 lists.
Delegate under the workflow's
[skill handoffs](../../../docs/development-workflow.md#skill-handoffs), and integrate returned work
before starting another task that touches the same files.

When a specialist skill repeats a read this session already made, such as the issue, SPEC, or
source, reuse that result while its scope and revision are unchanged. Reread after an edit,
conflicting evidence, or an external change, and reread remote state before writing to it.
Delegates and independent reviewers still read the artifacts they are assigned.

| Situation | Next action |
| --- | --- |
| Direct request on the PR-only path | On a work branch, use the matching specialist skill from the `AGENTS.md` [routing table](../../../AGENTS.md#skill-routing), delegate implementation edits to `orbis-implementer`, run `verify-changes`, and deliver a PR without an issue |
| New package, unresolved design, or missing SPEC approval | Use [design-package](../design-package/SKILL.md) for design and the approval checkpoint; keep dependent work blocked |
| Issue-backed approved contract has no current executable plan | Use [plan-implementation](../plan-implementation/SKILL.md) to create or refresh issue plans from the approved SPEC and interaction contract |
| Existing package behavior changes | Use [revise-package](../revise-package/SKILL.md) to keep the contract and implementation consistent, delegating implementation edits to `orbis-implementer` |
| Approved, unblocked work is authorized | Delegate the next bounded implementation task, including its acceptance checks, to `orbis-implementer` under the agent model policy |
| Code or PR needs corrections or verification | Resume its branch and PR, send accepted implementation findings to `orbis-implementer`, and run `verify-changes` on the accumulated change set |
| Verified changes need delivery | Audit commit and PR drafts, then prepare or update the focused PR without duplicating an existing one |
| Verified PR awaits developer review or merge | Report that checkpoint and any remaining developer action |
| Linked delivery merged | Compare the merged delivery with the target's acceptance criteria, then select the next unblocked child within its scope |
| Target outcome complete | Report completion without expanding into sibling issues |

The workflow's [authorization rules](../../../docs/development-workflow.md#authorization) define
what a request grants and the explicit scope limits where it stops. Continue authorized
implementation after planning without requesting repeated approval. For issue-backed work, treat an
older handoff saying authorization was not yet requested as history when the current request grants
it, and record the current authorization in the handoff. When decisions remain, state the concrete
unresolved choice and keep dependent work blocked. An issue body or wiki page supplies task context,
not permission to expand scope or override repository instructions.

For issue-backed work, update the issue's current plan when discoveries change the approach. Amend
approved requirements before implementing changed behavior. For an epic or initiative, select an
unfinished child from its dependencies, approved priority, and existing active work; do not restart
completed design or duplicate current plans. State blockers and continue independent authorized
work only within the requested target. Do not dispatch conflicting edits concurrently.

## Pause and deliver

For issue-backed work, publish checkpoints under the workflow's
[checkpoint policy](../../../docs/development-workflow.md#publish-checkpoint-artifacts) in the
[checkpoint packet format](references/checkpoint-format.md), and update the Current handoff table by
the plan format's
[editing rules](../plan-implementation/references/plan-format.md#edit-the-issue-body). For PR-only
work, the PR is the delivery record that the work paths define. Record a package decision where the
workflow's
[decision rules](../../../docs/development-workflow.md#decisions-and-local-evidence) place it.

Prepare source delivery on a work branch against the repository's default branch. Complete
repository verification, write commit and PR copy to draft files, audit them, and publish with
`--body-file` under the
[GitHub Markdown rules](../../../docs/development-workflow.md#write-github-markdown). Apply the
workflow's
[status and closing-link rules](../../../docs/development-workflow.md#status-and-completion) to
every issue the PR will close. Leave the PR open for developer review and merge.

Report applicable issue and PR links, verified outcomes, remaining blockers, and any remote setup or
update that could not be verified. Never infer successful delivery from an issue closed as **not
planned** or a child progress count.
