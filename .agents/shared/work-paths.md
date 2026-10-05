# Work paths and issue records

## Contents

- Work paths
- PR boundaries
- Work hierarchy and records
- Stage values
- Current handoff table
- Edit the issue body

## Work paths

Every development request follows one work path. The path determines where the plan and the shared
record live.

- The **issue-backed path** covers work that introduces, improves, or changes package behavior. An
  issue tracks the work, and its body and checkpoint comments are the shared record.
- The **PR-only path** delivers a direct request through a PR without an issue. It covers:
  - A change that keeps observable behavior within a package's approved contract, such as a fix, a
    behavior-preserving refactor, or a test change. Implementing a SPEC requirement that the code
    lacks introduces behavior and takes the issue-backed path.
  - A documentation change.
  - A workspace tooling change.

PR-only work uses the developer's request, current source, and any existing PR as inputs. It does
not create an issue, issue plan, or Current handoff. The PR body records the outcome, acceptance,
and verification, and another session resumes from the PR. If PR-only work is interrupted before a
PR exists, report the branch and next action in chat.

An existing issue always takes precedence over the PR-only path:

- Resume work that an issue already tracks on that issue, even when its remaining change would
  otherwise qualify for the PR-only path.
- Resume a PR or branch on the issue that tracks it.
- When investigation shows that a direct request changes package behavior, create or reuse an issue
  for it before dependent work.

Both paths go through the same review before delivery, so a small change is still reviewed.

## PR boundaries

- When substantive package brainstorming begins, create or reuse an issue at the intended scope once
  its outcome can be named. Save the approved SPEC before implementing behavior. A plan can include
  bounded investigations while design decisions remain open; dependent implementation stays blocked.
- For a substantial new extension, use an initial SPEC-only PR when shared design review or several
  implementation efforts need an agreed baseline, and state implementation availability in the SPEC.
  A SPEC-only PR or a later SPEC amendment does not need an implementation plan; plan only when the
  developer requests planning or authorizes implementation.
- A small delivery can combine the SPEC and implementation in one PR. A later scoped revision
  normally combines approved SPEC amendments, code, and tests. Use a separate design PR when a
  decision needs independent review.
- The delivery issue persists across these PRs. Draft PRs share unfinished work. Match each PR to
  one coherent, reviewable outcome.

## Work hierarchy and records

- An **initiative** coordinates substantial deliveries across most of the repository, such as an
  Effect overhaul.
- An **epic** delivers a substantial package or capability through coordinated tasks.
- A **task** is an independently executable, bounded outcome.

Initiatives and epics are coordinating issues. These roles describe scope, not tree depth or effort.
An epic or task can stand alone, and a parent can skip a level. A repository-wide investigation with
one bounded result is a task, and an epic can precede its children. Keep small work in one issue; do
not create issues to fill hierarchy tiers. Checklists record steps that do not need separate
ownership or delivery.

| Record                                       | Contents                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Package SPEC and linked interaction contract | Current approved behavior and conformance scenarios                                                     |
| Initiative or epic issue                     | Outcome, approved scope and contract baseline, work coverage, shared constraints, integrated acceptance |
| Owning delivery issue decision comments      | Decision records for a package without a stable release                                                 |
| Task issue                                   | Requirement contribution, design, concrete approach, dependencies, acceptance checks, Current handoff   |
| Checkpoint comments                          | Authored work summaries, findings, verification, and unresolved obligations                             |
| Project item                                 | Priority, Size, Estimate, and coarse execution status                                                   |
| Wiki decision record                         | Repository-wide constraints and decisions for packages with a stable release                            |
| PR                                           | Delivery summary and verification; the whole record for PR-only work                                    |
| Optional local files                         | Scratch work, detailed logs, and run evidence                                                           |

A package has a **stable release** once it publishes a version at 1.0.0 or later.

The SPEC belongs to the package and can support successive epics or initiatives. Link its relevant
requirements from each issue. Requirements and issues can cover each other many-to-many, so
distinguish partial contributions from full coverage. Use native sub-issues for decomposition and
blocking relationships for prerequisites; issue numbers do not imply execution order. Add each
tracked issue to the Project; a parent's membership and fields do not establish a child's.

## Stage values

The Stage records the issue's current required activity or a terminal outcome. Use exactly one of
these case-sensitive values, with no aliases, annotations, or combined values:

| Stage          | Use when                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Investigation  | A bounded factual question or experiment still needs supported findings before the next decision, or the work delivers an investigation issue's outcome.                                                                   |
| Design         | Behavior, scope, or a contract needs definition or revision, or a design decision or approval blocks later work within the issue's scope.                                                                                  |
| Planning       | Approved behavior or scope needs executable tasks, dependencies, or acceptance checks.                                                                                                                                     |
| Implementation | A current executable plan still needs code, tests, documentation, or other scoped deliverables. Use this Stage even when execution has not started or is blocked; record progress in Work and permission in Authorization. |
| Verification   | The accumulated deliverable needs checks or agent reviews, findings are being resolved, or verified delivery is being prepared for publication.                                                                            |
| Review         | The issue's complete scoped deliverable is published and ready for developer review, approval, or merge, with no outstanding agent-owned delivery work. A draft PR alone does not qualify.                                 |
| Complete       | Evidence establishes the definition of done for this issue's role. PR-delivered work must be merged; passing checks or finishing a child issue is insufficient.                                                            |
| Abandoned      | The issue is closed as not planned. Do not count it as delivered or as satisfying parent acceptance.                                                                                                                       |

- Use the Stage of the current required activity even when that activity has not started. Record
  readiness in Work, permission in Authorization, and impediments in Blocker.
- An investigation or planning subtask within an ongoing activity does not change the Stage by
  itself.
- The Stages are not a mandatory sequence. Skip activities already satisfied, and return to the
  matching Stage when the required activity changes.
- Agent review and fixes within an accumulated verification pass remain Verification. Preparing a
  commit, publishing a PR, and writing its handoff also remain Verification until the complete
  delivery is ready for developer review.
- For a design-only issue, use Review once its complete deliverable is published and only developer
  review and merge remain. When design approval blocks later work within the same issue, keep
  Design.
- Keep the current Stage while work is blocked or paused, and put the cause and resumption condition
  in Blocker and Next action. Do not use Blocked, Paused, Ready, In progress, In review, Done, or
  Handoff as Stage values; Project status is a separate, coarse field.
- For an initiative or epic, derive the Stage from its remaining work and integrated acceptance. A
  child reaching Review or Complete does not move the whole parent to that Stage.
- A negative investigation result can be Complete when its supported findings answer the issue's
  question, the effect on dependent work is recorded, and the investigation's acceptance criteria
  are met.

## Current handoff table

Start every issue body with this table. Keep the heading, boundary markers, field labels, and row
order fixed, replace the example values with current facts, and use one physical line per row.

```markdown
<!-- orbis:handoff:start -->

## Current handoff

| Field         | Current value                                  |
| ------------- | ---------------------------------------------- |
| Stage         | Design                                         |
| Authorization | Pending developer direction                    |
| Work          | Not started                                    |
| Verification  | Not run                                        |
| Blocker       | None                                           |
| Next action   | Resolve the scope and execution authorization. |
| Checkpoint    | None                                           |

<!-- orbis:handoff:end -->
```

Keep these values concise:

| Field         | Contents                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Stage         | One exact Stage value, derived from current evidence                                                                                     |
| Authorization | Current approval and execution scope, including restrictions and an approval reference when available                                    |
| Work          | Active child, branch or PR, and relevant source revision; state when work is uncommitted or has not started                              |
| Verification  | Concise actual result or remaining verification; keep commands and detailed findings in checkpoint comments                              |
| Blocker       | Current obstacle and the decision or prerequisite that resolves it, or None                                                              |
| Next action   | One bounded action and its responsible role when ownership matters                                                                       |
| Checkpoint    | A direct link to the artifact needed for the current handoff, or None; do not accumulate links or replace the link for every new comment |

For rows other than Stage, use explicit values such as Pending, Not run, None, or Not applicable
instead of empty cells. Put the outcome, approved baseline, approach, and acceptance criteria below
the table without repeating it. The approved baseline stays in the plan; the Work row records the
current revision.

## Edit the issue body

1. Reread the remote body before every edit. Preserve contributor text, and skip unchanged writes.
2. Confine routine state updates to the Current handoff table. Locate exactly one ordered marker
   pair around the table, change only the affected value cells, and preserve labels, row order, and
   every byte outside the table. GitHub still receives a whole-body update, so inspect the draft
   diff and reconcile concurrent changes instead of overwriting them.
3. Edit plan sections only when the plan changes. Treat changes to scope, approach, dependencies,
   acceptance criteria, or task checklists as plan edits, separate from routine state updates.
4. Batch pending body changes before a Stage transition, pause, or delivery. Update sooner when
   another worker needs the changed plan. Do not rewrite the body after every delegate returns or
   merely to refresh a timestamp.
5. After an uncertain write, check remote state before retrying or creating another issue.

Record findings and progress in checkpoint comments even when the body does not need to change.

When an existing issue needs a plan or handoff update, migrate its current handoff into this table
and remove only the superseded handoff section. Preserve the remaining plan and contributor text,
and do not bulk-migrate idle or closed issues. If markers are missing, duplicated, or malformed,
reconcile the structure explicitly before a routine table update.
