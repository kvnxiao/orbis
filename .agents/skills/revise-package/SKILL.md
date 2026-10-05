---
name: revise-package
description:
  Revise an existing Orbis package's behavior while keeping its SPEC, interaction contract, code,
  and tests consistent. Use when developer feedback or a code-change request alters the package
  contract, when an approved amendment needs implementation, or when iteration has already landed in
  code and the SPEC must be reconciled with the current package.
---

# Revise an Orbis package

This skill applies a requested behavior change to the package contract and then to authorized
implementation work. The result is a SPEC, interaction contract, code, and tests that agree. A
request to change package code includes synchronizing its affected contract; the developer does not
need to invoke this skill explicitly.

If `work-issue` did not start this work, first follow
[starting-work.md](../../shared/starting-work.md), with the Stage values in
[work-paths.md](../../shared/work-paths.md) and the labels in
[github-markdown.md](../../shared/github-markdown.md). Stop at the request's scope limits under
[authorization.md](../../shared/authorization.md).

## 1. Identify the affected contract

1. When the revision needs a new issue, scope it to the bounded revision, make it a sub-issue of the
   existing parent when one exists, and label it under
   [github-markdown.md](../../shared/github-markdown.md).
2. Read [specifications.md](../../../docs/specifications.md) and the package's complete SPEC.
   Inspect the relevant source, tests, README, and `docs/tui-interactions.md` when present.
3. When implementation changes already exist, compare them with the request and the approved
   contract. Amend only behavior the developer has approved, or correct the implementation within
   the existing contract.
4. Map the request to the affected requirement IDs, conformance scenarios, and interactions with
   unchanged behavior. State the required behavior, observed implementation, requested outcome, and
   the checks that distinguish success from a plausible violation. Keep unverified behavior
   explicit.

If the change only reorders or rewords documentation, preserve requirement IDs, behavior, and linked
heading anchors, and apply the
[forward-reference checks](../../../docs/specifications.md#avoid-forward-references). A
presentation-only edit, or a move of documentation between destinations, does not change the package
contract or need a behavioral amendment or implementation plan.

## 2. Classify each affected behavior

| Situation                                                             | Action                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Code violates an approved requirement                                 | Fix code and tests against that requirement.                                             |
| The change stays within an explicitly permitted implementation choice | Change the implementation and update the required documentation of its choice.           |
| Requested behavior changes the contract                               | Resolve the intended behavior and amend the affected requirements before implementation. |
| The contract is missing, conflicting, or ambiguous                    | Resolve the missing behavioral decision before implementing dependent work.              |

- For fixes and permitted choices, proceed under the existing contract without inventing an
  amendment.
- When a visual adjustment changes prescribed behavior or exceeds permitted variation, amend the
  contract.
- Keep unrelated deviations separate from the requested revision.

## 3. Reconcile an iterated implementation

When iteration landed in code before the contract was updated, the SPEC describes an earlier
package. Otherwise, skip this step.

- When the developer requests whole-package reconciliation, review the accumulated drift in one
  pass.
- For a scoped revision, reconcile the affected requirements and report unrelated drift separately.

Enumerate current public behavior from source, tests, README, and the interaction contract. Map
commands, tools, configuration, events, persisted artifacts, ordering rules, and user-visible
failure behavior to every applicable requirement, and identify behavior without requirement
coverage. Then classify every requirement and uncovered behavior in scope. In the table below, a
slug is a requirement's `REQ-<behavior-slug>` identifier, and the
[requirement lifecycle](../../../docs/specifications.md#requirement-lifecycle) governs minting,
amending, and retiring slugs.

| Finding                                                        | Action                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Code implements the requirement and the contract describes it  | Verify the wording against observed behavior and keep the slug.                                  |
| Code implements it differently and the developer approves that | Amend the requirement text and keep the slug.                                                    |
| Code implements behavior that no slug claims                   | Mint a slug, write the requirement and its conformance scenario, and have the behavior approved. |
| No code implements it and the behavior is abandoned            | Retire the slug under the requirement lifecycle.                                                 |
| No code implements it and the behavior is still wanted         | Keep the slug and record it as unimplemented in the SPEC's status.                               |

Minting and retirement both need a developer decision, and an absent implementation does not retire
a requirement. Present the proposed mints, amendments, and retirements through the global
`brainstorm` skill, together with the behavior each one covers, then apply the approved set under
the requirement lifecycle.

## 4. Resolve and amend behavior

1. Settle material behavioral decisions with the developer through the global `brainstorm` skill,
   under [authorization.md](../../shared/authorization.md). A request to improve an experience does
   not settle its submission, cancellation, or persistence behavior.
2. If design decisions remain, return `Needs design`.
3. For a brainstormed change, verify that the developer approved the complete design under
   [brainstorm-records.md](../../shared/brainstorm-records.md) before any contract edit or decision
   publication.
4. Amend the requirements and their conformance scenarios under the
   [requirement lifecycle](../../../docs/specifications.md#requirement-lifecycle), including its
   reference sweep after a retirement or rename. Describe observable behavior without prescribing
   internal files or algorithms, and preserve unaffected requirements and identifiers.
5. When a definition changes, apply the forward-reference checks to its earlier uses and the
   affected interaction sections.
6. When an approach or requirement is abandoned, add it to the SPEC's
   [Explored alternatives](../../../docs/specifications.md#explored-alternatives) section with the
   reason, and record the decision under [decisions.md](../../shared/decisions.md).
7. When the SPEC has a [Supporting evidence](../../../docs/specifications.md#supporting-evidence)
   section, add, relink, or delete the rows of added, renamed, or retired requirements.
8. For an interactive change, resolve the affected focus, navigation, submission, back, cancel, and
   recovery behavior. Update `docs/tui-interactions.md`, its requirement references, and affected
   diagrams to agree with the SPEC's system guarantees.

## 5. Implement the revision

1. If implementation is not authorized, go to step 6.
2. If an issue tracks the revision and its plan does not cover the amended contract, return
   `Needs a plan`.
3. Once the developer has approved the amended contract, and the plan's Design section when the plan
   has one, continue through implementation and verification without stopping at the amended SPEC or
   plan.
4. Delegate bounded implementation tasks to `orbis-implementer` under
   [delegation.md](../../shared/delegation.md). In each assignment, require expected results derived
   from the approved requirements, and checks that cover the affected failure and ordering
   boundaries and the interactions with preserved behavior.
5. Update affected package usage documentation in the same change set. Update affected READMEs under
   the [README guidelines](../../../docs/readme-guidelines.md).

## 6. Verify the accumulated revision

If this skill resolves a finding within an active `review-changes` run, return to the caller without
starting a nested review. Otherwise:

1. Review both directions: code must satisfy the revised requirements, and changed public behavior
   must be specified or explicitly permitted. Evidence for previous behavior does not verify a
   changed requirement.
2. Check tests and documentation for obsolete expectations and references.
3. If `work-issue` started this work, return `Done`; `work-issue` runs the review and delivers.
4. Otherwise, run the global `review-changes` skill with `mode=apply` on the accumulated change set,
   under [review.md](../../shared/review.md). Deliver under the PR boundaries in
   [work-paths.md](../../shared/work-paths.md) and the publication rules in
   [github-markdown.md](../../shared/github-markdown.md).

## Return

Return one outcome to the caller:

- `Done`: the revision is verified or delivered within the authorized scope, or a finding from an
  active `review-changes` run is resolved. Report the changed requirement IDs, affected artifacts,
  executed checks, and remaining obligations, separating implementation deviations from verification
  gaps and proposed amendments. For a reconciliation, report the minted, amended, retired, and
  unchanged slugs. When implementation is not authorized, state that it remains pending.
- `Needs design`: design decisions remain for the affected behavior. Report the affected design and
  the settled requirements to preserve.
- `Needs a plan`: implementation is authorized, an issue tracks the revision, and its plan does not
  cover the amended contract. Report the amended requirement IDs. A small, settled revision needs a
  concise issue plan, not full-package planning.
- `Blocked`: a material behavioral decision, the developer's decision on proposed mints, amendments,
  or retirements, or approval of the complete design remains outstanding. Report the decision or
  approval needed.
