# Issue implementation plans

Keep current executable plans in GitHub issue bodies. The SPEC and interaction contract define
behavior; issues select concrete edits and checks. Follow the
[development workflow](../../../../docs/development-workflow.md) for hierarchy and completion.

For a small change, cover the applicable information in a few paragraphs. Do not add empty sections
or copy these tables into every issue.

## Initiative

An initiative tracks a bounded delivery across one or more PRs. Keep small work in one issue.
Create native sub-issues only for independently executable outcomes.

| Section | Required information |
| --- | --- |
| Outcome and scope | Observable delivery, package, boundaries, and approved requirements |
| Baseline | SPEC and interaction-contract links and reviewed revision; repository baseline; developer approval reference or pending decisions |
| Shared approach | Verified current behavior, proposed additions, selected approach, and shared constraints |
| Coverage and integrated acceptance | Requirement IDs, contributing issues and partial contributions, cross-child checks, and full scoped coverage checks |
| Current handoff | Delivered outcomes, actual verification, unresolved decisions, and next unblocked action |

Use native child relationships rather than a duplicate child-status checklist. Record blocking links
and the prerequisite's observable output. Issue numbers do not imply execution order. SPEC approval
does not itself authorize execution or establish readiness.

## Work issue

Make each work issue executable from the repository and linked issues without the original chat.
Refer to the parent for shared context rather than copying its contract or coverage table.

| Section | Required information |
| --- | --- |
| Outcome | Observable result, requirement contribution, and obligations left to other work |
| Prerequisites | Blocking issue links, required outputs, and unresolved decisions |
| Implementation | Files or symbols, intended edits, existing behavior to reuse, constraints, and small-step checklists |
| Acceptance | Working directory, command or interaction, inputs, expected results, and applicable failure or recovery cases |
| Current handoff | Implemented behavior, observed verification, remaining checks or blockers, and next action |

Initially state that implementation has not started. Replace that handoff with observed results as
work progresses. Keep expected checks separate from actual results. Identify plausible regressions
that the checks must reject. Separate local automated checks from explicitly authorized real-model
checks. Verification and PR delivery normally belong in acceptance criteria rather than separate
issues. A completed slice establishes only its assigned contribution.

For an investigation, state the question, bounded experiment, and result needed to unblock dependent
work. A negative finding can complete the investigation without making the dependent design viable.

## Resume and publication

Compare the recorded baseline with current SPEC and source changes before resuming. Revise affected
tasks and coverage; unrelated commits do not invalidate the whole plan. Preserve completed work and
contributor edits. Check remote state before retrying an uncertain write.

Keep raw logs and scratch files in ignored `packages/<name>/implementation/`, or `.artifacts/` for
workspace work. Issue handoffs contain concise results and next actions, not local file links or
transcripts. Keep reusable tests and instructions in the repository. Do not maintain a second
authoritative local plan.

For explicit local or chat-only requests, preserve the same outcome, approach, acceptance, and
handoff information in that destination. Local drafts during a GitHub outage remain unpublished
until the issue update succeeds. Reconcile old local plans against current scope before publication.

This format governs repository development, not the exact reviewed Markdown saved by `@orbis/plan`.
