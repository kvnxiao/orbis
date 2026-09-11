---
name: revise-orbis-package
description:
  Revise an existing Orbis package's behavior while keeping its SPEC, interaction scenarios,
  implementation plans, code, and tests consistent. Use when user feedback or a code-change request
  alters the package contract, or when an approved amendment needs implementation.
---

# Revise an Orbis package

Carry a requested behavior change through the package contract and authorized implementation work. A
design-only or planning-only request stops at its requested deliverable. A request to change package
code includes synchronizing its affected contract; the user does not need to invoke this skill
explicitly.

## Identify the affected contract

Read `AGENTS.md`, the [specification guidance](../../../docs/specifications.md), and the package's
complete `SPEC.md`. Inspect relevant source, tests, README, and `docs/tui-interactions.md` when
present. Establish the current Git revision and working-tree changes; preserve unrelated work. Treat
current code as evidence of implementation, not approval of its behavior.

Map the request to affected requirement IDs, conformance scenarios, and interactions with unchanged
behavior. State the required behavior, observed implementation, requested outcome, and checks that
would distinguish success from a plausible violation. Keep unverified behavior explicit.

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

## Resolve and amend behavior

Explicit user direction approves the behavior it specifies. Do not request the same approval again.
Ask only about material unanswered decisions; continue independent inspection while waiting. A
request to improve an experience does not settle its submission, cancellation, or persistence
behavior.

When design decisions remain, use [brainstorm-orbis-package](../brainstorm-orbis-package/SKILL.md)
for the affected design. Preserve settled requirements and keep research proportional to factual
uncertainty. When research informs the revision, persist its synthesis before editing the SPEC as
that workflow requires.

Before implementing changed behavior, update the approved requirements and their conformance
scenarios. Keep the SPEC self-contained and describe observable behavior without prescribing
internal files or algorithms. Preserve unaffected requirements and identifiers. Retain identifiers
for requirements whose meaning is unchanged; for replaced or removed requirements, update dependent
references without reusing an identifier for unrelated behavior. Use Git for prior revisions.

For interactive changes, resolve affected focus, navigation, submission, back, cancel, and recovery
behavior. Update `docs/tui-interactions.md`, its requirement references, and affected diagrams to
agree with the SPEC. The interaction document must not introduce requirements absent from the SPEC.

When implementation changes already exist, compare them with the approved request and contract
before continuing. Amend only behavior the user has authorized, or correct the implementation within
the existing contract. Passing tests and current output do not authorize a contract change.

## Plan and implement the revision

Use [plan-orbis-implementation](../plan-orbis-implementation/SKILL.md) to derive tasks from the
approved contract and current source. Keep a small, settled revision in a concise plan; do not
restart full-package planning. Inspect existing plans before choosing a destination, preserve
unrelated tasks, and revise affected dependencies and coverage claims. Keep plans and run evidence
in the package's ignored `implementation/` directory unless the user requests another destination.
Evidence for previous behavior does not verify a changed requirement.

When code changes are authorized, continue through implementation and verification without stopping
at the amended SPEC or plan. Update code, tests, package usage, and interaction scenarios within the
same change set. Derive expected results from the approved requirements. Cover affected failure and
ordering boundaries and interactions with preserved behavior; reproduce defects with failing tests.

## Verify the accumulated revision

When this skill resolves a finding within an active `verify-changes` run, return to that coordinator
without starting a nested verification workflow. Otherwise, run `verify-changes` once on the
accumulated change set. Include [verify-orbis-conformance](../verify-orbis-conformance/SKILL.md) for
affected requirements and their interactions with unchanged behavior. The conformance reviewer
reports findings without editing source, tests, or the contract; the coordinator resolves authorized
findings and reruns affected checks.

Review both directions: code must satisfy the revised requirements, and changed public behavior must
be specified or explicitly permitted. Check tests and documentation for obsolete expectations and
references. Report implementation deviations separately from verification gaps and proposed
amendments. A scoped review does not establish full-package conformance.

Report changed requirement IDs, affected artifacts, executed checks, and remaining obligations. Keep
saved evidence local and reusable checks available from a clone. For design-only or planning-only
work, state that implementation remains pending.
