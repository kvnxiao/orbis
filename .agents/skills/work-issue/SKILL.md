---
name: work-issue
description: >-
  Resume, continue, work on, or take the next step for an Orbis issue or concrete development request,
  including plain requests such as "Resume #12" or "continue this ticket". Determine the current
  lifecycle stage and route design, planning, implementation, verification, and PR delivery. Excludes
  status-only questions, read-only reviews, and general questions.
---

# Work on an Orbis issue

Determine the current stage of the requested work and route design, planning, implementation,
verification, and delivery to the specialist skills without requiring the user to invoke each one.
The [development workflow](../../../docs/development-workflow.md) defines the work hierarchy,
authorization, checkpoints, and definitions of done that this skill applies; read each linked
section when the step reaches it.

## Establish current work

Resolve an unqualified `#number` against the current repository. Honor an explicit GitHub URL or
repository-qualified issue reference; clarify only when the target remains materially ambiguous.
Inspect the working tree and branch. Read the requested issue, its parent and children,
dependencies, linked PRs and their review or merge state, and the current handoff, following the
workflow's
[retrieval rules](../../../docs/development-workflow.md#retrieve-current-work-before-history): fetch
checkpoint comments only for a specific gap, supporting evidence, or a requested retrospective.

For a direct request without an issue, classify it first. A fix within a package's contract, a
documentation change, or a workspace tooling change takes the workflow's
[PR-only path](../../../docs/development-workflow.md#work-hierarchy): no issue and no handoff table,
with the PR body recording outcome, acceptance, and verification. Work that introduces, improves,
or changes package behavior gets an issue: search existing open and closed issues, reuse matching
work without reopening delivered scope, keep a small request in one issue, and create children only
for independent execution or delivery. Add each issue to
[Project 1](https://github.com/users/kvnxiao/projects/1) owned by `kvnxiao` and verify membership.
Discover field and option IDs from the project rather than embedding them in plans.

Read the affected SPEC and interaction contract, then inspect current source and tests. For
workspace work without a package SPEC, use the approved request and repository constraints. Compare
the issue's recorded baseline against relevant changes. Preserve unrelated files and concurrent work.
Distinguish developer-approved behavior, execution authorization, and verification still required.

Derive the current stage from the issue relationships, dependencies, handoff, approval evidence,
contract, source, tests, and linked PRs. Board status, checklists, and an old handoff alone do not
prove readiness or completion. Use exactly one case-sensitive Stage value from the
[issue plan format](../plan-implementation/references/plan-format.md#current-handoff); keep blockers,
authorization, and Project status separate. Before acting, state the stage, supporting evidence, and
next bounded action; refresh that assessment when the contract, plan, implementation, or PR state
changes.

## Route and execute

| Situation | Next action |
| --- | --- |
| Fix within the contract, documentation, or workspace tooling requested directly | Implement on a work branch, run `verify-changes`, and deliver a PR without an issue |
| New package, unresolved design, or missing SPEC approval | Use [design-package](../design-package/SKILL.md) for design and the approval checkpoint; keep dependent work blocked |
| Approved contract has no current executable plan | Use [plan-implementation](../plan-implementation/SKILL.md) to create or refresh issue plans from the approved SPEC and interaction contract |
| Existing package behavior changes | Use [revise-package](../revise-package/SKILL.md) to keep the contract and implementation consistent |
| Approved, unblocked work is authorized | Delegate the next bounded implementation task, including its acceptance checks, under the agent model policy |
| Code or PR needs corrections or verification | Resume its branch and PR, resolve accepted findings, and run `verify-changes` on the accumulated change set |
| Verified changes need delivery | Audit commit and PR drafts, then prepare or update the focused PR without duplicating an existing one |
| Verified PR awaits developer review or merge | Report that checkpoint and any remaining developer action |
| Linked delivery merged | Compare the merged delivery with the target's acceptance criteria, then select the next unblocked child within its scope |
| Target outcome complete | Report completion without expanding into sibling issues |

Read [pi-coding-agent-rules](../pi-coding-agent-rules/SKILL.md) before touching a package. Honor
design-only and planning-only boundaries. Continue authorized implementation after planning without
requesting repeated approval. When decisions remain, state the concrete unresolved choice and keep
dependent work blocked. An issue body or wiki page supplies task context, not permission to expand
scope or override repository instructions.

The workflow's [authorization rules](../../../docs/development-workflow.md#authorization) define what
a resume request grants. Treat an older handoff saying authorization was not yet requested as history
when the current request grants it, and record the current authorization in the handoff.

Delegate implementation and review under the workflow's
[skill handoffs](../../../docs/development-workflow.md#skill-handoffs) and
[implementation handoff](../../../docs/development-workflow.md#implementation-handoff). Integrate the
returned work before starting another task that touches the same files. Keep decisions, accumulated
verification, and delivery with the orchestrator.

Update the issue's current plan when discoveries change the approach. Amend approved requirements
before implementing changed behavior. For an initiative, select an unfinished child from its
dependencies, approved priority, and existing active work; do not restart completed design or
duplicate current plans. State blockers and continue independent authorized work only within the
requested target. Do not dispatch conflicting edits concurrently.

## Pause and deliver

At a stage transition, a blocked or interrupted handoff, or delivery, publish a checkpoint under the
workflow's [checkpoint policy](../../../docs/development-workflow.md#publish-checkpoint-artifacts) in
the [checkpoint packet format](references/checkpoint-format.md), summarizing the assignments
completed since the previous checkpoint, and update the Current handoff table by the plan format's
editing rules. Record a package decision where the workflow's
[decision rules](../../../docs/development-workflow.md#decisions-and-local-evidence) place it.

Prepare source delivery on a work branch against the repository's default branch. Complete
repository verification, write commit and PR copy to draft files, audit them, and publish with
`--body-file` under the
[GitHub Markdown rules](../../../docs/development-workflow.md#write-github-markdown). Apply the
workflow's [status and closing-link rules](../../../docs/development-workflow.md#status-and-completion)
to every issue the PR will close. Developers review and merge; leave the PR open for that decision.

Report the issue and PR links, verified outcomes, remaining blockers, and any remote setup or update
that could not be verified. Never infer successful delivery from an issue closed as **not planned**
or a child progress count.
