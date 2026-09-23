# Issue implementation plans

Keep current executable plans in GitHub issue bodies. The SPEC and interaction contract define
behavior; issues select concrete edits and checks. Follow the
[development workflow](../../../../docs/development-workflow.md) for hierarchy and completion.

Start each initiative or work issue with the Current handoff block below. For a small change, cover
the remaining plan information in a few paragraphs. Do not add empty plan sections or copy the
section-guidance tables into issues.

## Current handoff

The Stage row records the issue's current required activity or a terminal outcome. Use exactly one of these
case-sensitive values, with no aliases, annotations, or combined values:

| Stage | Use when |
| --- | --- |
| Investigation | A bounded factual question or experiment still needs supported findings before the next decision or to deliver an investigation issue's outcome. |
| Design | Behavior, scope, or a contract needs definition or revision, or a design decision or approval blocks later work within the issue's scope. |
| Planning | Approved behavior or scope needs executable tasks, dependencies, or acceptance checks. |
| Implementation | An approved plan still needs code, tests, documentation, or other scoped deliverables. Use this stage even when execution has not started or is blocked; record progress in Work and permission in Authorization. |
| Verification | The accumulated deliverable needs checks or agent reviews, findings are being resolved, or verified delivery is being prepared for publication. |
| Review | The issue's complete scoped deliverable is published and ready for developer review, approval, or merge, with no outstanding agent-owned delivery work. A draft PR alone does not qualify. |
| Complete | Evidence establishes the workflow's definition of done for this issue's role. PR-delivered work must be merged; passing checks or finishing a child issue is insufficient. |
| Abandoned | The issue is closed as not planned. Do not count it as delivered or as satisfying parent acceptance. |

Use the stage of the issue's current required activity even when that activity has not started;
record readiness in Work, permission in Authorization, and impediments in Blocker. An investigation
or planning subtask within an ongoing activity does not by itself change Stage. These stages are not
a mandatory linear sequence. Skip activities already satisfied and return to the appropriate stage
when the issue's required activity changes. Agent review and fixes within an accumulated verification pass remain Verification;
preparing a commit, publishing a PR, and writing its handoff also remain Verification until the
complete delivery is ready for developer review.

For a design-only issue, use Review once its complete deliverable is published and only developer
approval remains. When design approval blocks later work within the same issue, retain Design.

Keep the current stage while work is blocked or paused, and put the cause and resumption condition
in Blocker and Next action. Do not use Blocked, Paused, Ready, In progress, In review, Done, or Handoff
as Stage values. Project status is a separate coarse execution field. For an initiative, derive
Stage from its remaining work and integrated acceptance; a child reaching Review or Complete does
not move the whole initiative to that stage. A negative investigation result can be Complete when
its supported findings answer the issue's question, the effect on dependent work is recorded, and
the investigation's acceptance criteria are met.

Use this Markdown table at the top of the body. Keep the heading, boundary markers, field labels,
and row order fixed; replace the example values with current facts. Use one physical line per row.

```markdown
<!-- orbis:handoff:start -->
## Current handoff

| Field | Current value |
| --- | --- |
| Stage | Design |
| Authorization | Pending developer direction |
| Work | Not started |
| Verification | Not run |
| Blocker | None |
| Next action | Resolve the scope and execution authorization. |
| Checkpoint | None |
<!-- orbis:handoff:end -->
```

Keep these values concise:

| Field | Contents |
| --- | --- |
| Stage | One exact value from the Stage enum above, derived from current evidence |
| Authorization | Current approval and execution scope, including restrictions and an approval reference when available |
| Work | Active child, branch or PR, and relevant source revision; state when work is uncommitted or has not started |
| Verification | Concise actual result or remaining verification; keep commands and detailed findings in checkpoint comments |
| Blocker | Current obstacle and the decision or prerequisite that resolves it, or None |
| Next action | One bounded action and its responsible role when ownership matters |
| Checkpoint | A direct link to the artifact needed for the current handoff, or None; do not accumulate links or replace the link for every new comment |

Put the outcome, approved baseline, approach, and acceptance criteria below the block. Do not repeat
the current handoff there. The approved baseline stays in the plan; the Work row records the current
revision. For rows other than Stage, use explicit values such as Pending, Not run, None, or Not
applicable instead of empty cells.

For a routine state update, reread the remote body and locate exactly one ordered marker pair around
the top handoff block. Change only the affected value cells, preserving labels, row order, and all
bytes outside the block. Skip publication when no value changes. GitHub still receives a whole-body
update; inspect the draft diff before publishing and reconcile concurrent changes rather than
overwriting them. Keep the workflow's batching rules: a new checkpoint alone does not trigger a body
edit.

When an existing issue needs a plan or handoff update, migrate its current handoff into this block and
remove only the superseded handoff section. Preserve the remaining plan and contributor text; do
not bulk-migrate idle or closed issues. If markers are missing, duplicated, or malformed, reconcile
the structure explicitly before applying a routine block replacement. Treat changes to scope,
approach, dependencies, acceptance criteria, or task checklists as separate plan edits.

## Initiative

An initiative tracks a bounded delivery across one or more PRs. Keep small work in one issue.
Create native sub-issues only for independently executable outcomes.

| Section | Required information |
| --- | --- |
| Outcome and scope | Observable delivery, package, boundaries, and approved requirements |
| Baseline | SPEC and interaction-contract links and reviewed revision; repository baseline; developer approval reference or pending decisions |
| Shared approach | Verified current behavior, proposed additions, selected approach, and shared constraints |
| Coverage and integrated acceptance | Requirement IDs, contributing issues and partial contributions, cross-child checks, and full scoped coverage checks |

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

Initially state that implementation has not started. Update the handoff from observed results and
relevant contract and source revisions as work progresses. Keep expected checks separate from actual
results. Identify plausible regressions
that the checks must reject. Separate local automated checks from explicitly authorized real-model
checks. Verification and PR delivery normally belong in acceptance criteria rather than separate
issues. A completed slice establishes only its assigned contribution.

For an investigation, state the question, bounded experiment, and result needed to unblock dependent
work. A negative finding can complete the investigation without making the dependent design viable.

## Resume and publication

Compare the recorded baseline with current SPEC and source changes before resuming. Revise affected
tasks and coverage; unrelated commits do not invalidate the whole plan. Preserve completed work and
contributor edits. Check remote state before retrying an uncertain write.

Keep the body compact and current. Batch edits when the executable plan or handoff changes; skip
unchanged writes and per-agent progress narratives. Publish authored checkpoint artifacts in
append-only issue comments under the
[checkpoint policy](../../../../docs/development-workflow.md#publish-checkpoint-artifacts).
Keep only links needed for current execution in the body; do not accumulate a history index.

Keep raw logs and scratch files in ignored `packages/<name>/implementation/`, or `.artifacts/` for
workspace work. Checkpoint summaries must be understandable without local file links or transcripts.
Keep reusable tests and instructions in the repository. Do not maintain a second authoritative local
plan. For GitHub bodies and comments, write each prose paragraph or list item on one physical line,
preserve Markdown structure, and prohibit formatter or audit reflow of publication drafts.

For explicit local or chat-only requests, preserve the same outcome, approach, acceptance, and
handoff information in that destination. Local drafts during a GitHub outage remain unpublished
until the issue update succeeds. Reconcile old local plans against current scope before publication.

This format governs repository development, not the exact reviewed Markdown saved by `@orbis/plan`.
