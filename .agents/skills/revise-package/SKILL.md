---
name: revise-package
description:
  Revise an existing Orbis package's behavior while keeping its SPEC, interaction scenarios,
  implementation plans, code, and tests consistent. Use when user feedback or a code-change request
  alters the package contract, when an approved amendment needs implementation, or when iteration
  has already landed in code and the SPEC must be reconciled with the current package.
---

# Revise an Orbis package

Carry a requested behavior change through the package contract and authorized implementation work.
A design-only or planning-only request stops at its requested deliverable. A request to change
package code includes synchronizing its affected contract; the user does not need to invoke this
skill explicitly. For affected READMEs, use [write-readme](../write-readme/SKILL.md); moving
documentation does not change the package contract.

## Identify the affected contract

A direct fix within the contract that has no issue takes the workflow's
[PR-only path](../../../docs/development-workflow.md#work-hierarchy); a contract change gets an
issue for the bounded revision, linked to its parent initiative when one exists. Resume work
already tracked by an issue on that issue. Read the
[specification guidance](../../../docs/specifications.md) and the package's complete `SPEC.md`.
Inspect relevant source, tests, README, and `docs/tui-interactions.md` when present. Establish the
current Git revision and working-tree changes; preserve unrelated work. Treat current code as
evidence of implementation, not approval of its behavior.

Map the request to affected requirement IDs, conformance scenarios, and interactions with unchanged
behavior. State the required behavior, observed implementation, requested outcome, and checks that
would distinguish success from a plausible violation. Keep unverified behavior explicit. For
documentation reordering, preserve requirement IDs, behavior, and linked heading anchors, and apply
the [forward-reference checks](../../../docs/specifications.md#avoid-forward-references);
presentation-only edits do not require a behavioral amendment or implementation plan.

Classify each affected behavior:

| Situation                                                             | Action                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Code violates an approved requirement                                 | Fix code and tests against that requirement.                                             |
| The change stays within an explicitly permitted implementation choice | Change the implementation and update required documentation of its choice.               |
| Requested behavior changes the contract                               | Resolve the intended behavior and amend the affected requirements before implementation. |
| The contract is missing, conflicting, or ambiguous                    | Resolve the missing behavioral decision before implementing dependent work.              |

For fixes and permitted choices, proceed under the existing contract without inventing an amendment.
When a visual adjustment changes prescribed behavior or exceeds permitted variation, amend the
contract. Keep unrelated deviations separate from the requested revision.

## Reconcile an iterated implementation

When iteration lands in code before the contract is updated, the SPEC describes an earlier package.
When the user requests whole-package reconciliation, review the accumulated drift in one pass. For a
scoped revision, reconcile affected requirements and report unrelated drift separately.

Enumerate current public behavior from source, tests, README, and the interaction document. Map
commands, tools, configuration, events, persisted artifacts, ordering rules, and user-visible
failure behavior to every applicable requirement. Identify behavior without requirement coverage.
Then classify every requirement and uncovered behavior in scope:

| Finding                                                       | Action                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Code implements the requirement and the contract describes it | Verify the wording against observed behavior and keep the slug.                                 |
| Code implements it differently and the user authorizes that   | Amend the requirement text and keep the slug.                                                   |
| Code implements behavior that no slug claims                  | Mint a slug, write the requirement and its conformance check, and have the behavior authorized. |
| No code implements it and the behavior is abandoned           | Retire the slug under the requirement lifecycle rules.                                          |
| No code implements it and the behavior is still wanted        | Keep the slug and record it as unimplemented in the package status.                             |

Minting and retirement both need a user decision. An absent implementation does not retire a
requirement, and existing code does not approve the behavior it implements. Present the proposed
mints, amendments, and retirements together with the behavior each one covers, then apply the
authorized set under the
[requirement lifecycle](../../../docs/specifications.md#requirement-lifecycle). Report the minted,
amended, retired, and unchanged slugs.

## Resolve and amend behavior

Explicit user direction approves the behavior it specifies. Do not request the same approval again.
Ask only about material unanswered decisions; continue independent inspection while waiting. A
request to improve an experience does not settle its submission, cancellation, or persistence
behavior.

When design decisions remain, use [design-package](../design-package/SKILL.md) for the affected
design. Preserve settled requirements and keep research proportional to factual uncertainty; when
research informs the revision, persist its synthesis before editing the SPEC.

Before implementing changed behavior, update the approved requirements and their conformance
scenarios under the [requirement lifecycle](../../../docs/specifications.md#requirement-lifecycle),
including the reference sweep after a retirement or rename. Describe observable behavior without
prescribing internal files or algorithms, and preserve unaffected requirements and identifiers. When a
definition changes, inspect its earlier uses and affected interaction sections; no passage may depend
on a later introduction. When an approach or requirement is abandoned, add it to the SPEC's
[Explored alternatives](../../../docs/specifications.md#explored-alternatives) section with the
reason, and record the decision where the workflow's
[decision rules](../../../docs/development-workflow.md#decisions-and-local-evidence) place it.

For interactive changes, resolve affected focus, navigation, submission, back, cancel, and recovery
behavior, and update `docs/tui-interactions.md`, its requirement references, and affected diagrams
to agree with the SPEC's system guarantees.

When implementation changes already exist, compare them with the approved request and contract
before continuing. Amend only behavior the user has authorized, or correct the implementation within
the existing contract. Passing tests and current output do not authorize a contract change.

## Plan and implement the revision

For work tracked by an issue, use
[plan-implementation](../plan-implementation/SKILL.md) to derive tasks from the approved contract
and current source. Keep a small, settled revision in a concise issue plan; do not restart
full-package planning. Update authoritative issue plans, preserving unrelated scope, contributor
edits, and completed work. Revise affected dependencies and coverage claims. Evidence for previous
behavior does not verify a changed requirement. For a direct fix or permitted choice within the
contract that has no issue,
use the [PR-only path](../../../docs/development-workflow.md#work-hierarchy): work from the approved
request and current source without creating an issue plan.

When code changes are authorized, continue through implementation and verification without stopping
at the amended SPEC or plan. Update code, tests, package usage, and interaction scenarios within the
same change set. Derive expected results from the approved requirements. Cover affected failure and
ordering boundaries and interactions with preserved behavior; reproduce defects with failing tests.
Delegate bounded implementation tasks after the contract and, for issue-backed work, plan are
approved.

## Verify the accumulated revision

When this skill resolves a finding within an active `verify-changes` run, return to that coordinator
without starting a nested verification workflow. Otherwise, run `verify-changes` once on the
accumulated change set, including [verify-conformance](../verify-conformance/SKILL.md) for affected
requirements and their interactions with unchanged behavior.

Review both directions: code must satisfy the revised requirements, and changed public behavior must
be specified or explicitly permitted. Check tests and documentation for obsolete expectations and
references. Report changed requirement IDs, affected artifacts, executed checks, and remaining
obligations, separating implementation deviations from verification gaps and proposed amendments.
For design-only or planning-only work, state that implementation remains pending. Deliver under the
workflow's
[design and PR boundaries](../../../docs/development-workflow.md#design-and-pr-boundaries);
verified local work is not a delivered issue.
