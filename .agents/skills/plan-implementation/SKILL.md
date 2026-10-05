---
name: plan-implementation
description:
  Write executable GitHub issue plans, with concrete tasks, dependencies, and acceptance checks,
  from an approved Orbis package SPEC.md and the current source. Use when planning implementation or
  vertical slices against an existing package contract.
---

# Plan implementation of an Orbis specification

This skill writes an implementation plan grounded in the approved package contract and the current
repository, and publishes it in issue bodies in the [plan format](references/plan-format.md). The
result is a plan whose tasks an implementer can execute from the repository and the issue without
the chat. A planning request authorizes shared planning records, not execution of their tasks.

## 1. Establish the approved baseline

1. Read [specifications.md](../../../docs/specifications.md) and the package's SPEC with its linked
   interaction contract.
2. Identify the package, requested scope, SPEC revision, and approval evidence from the current
   conversation or repository. Count explicit developer direction as approval even when the SPEC's
   status has not been updated. A SPEC's existence does not establish approval.
3. For a brainstormed change, verify that the developer approved the complete requested design
   before editing or publishing plans.
4. Act on the baseline:

   | Baseline                                                               | Action                                                                                                      |
   | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
   | The SPEC is missing or unapproved, or material design questions remain | Research the current implementation, identify the missing contract or approval, and return `Needs contract` |
   | The contract is approved                                               | Continue                                                                                                    |

## 2. Inspect the repository

Inspect the package source, tests, dependencies, scaffold, and relevant Pi APIs, and read
[packages.md](../../shared/packages.md). A package directory with only a SPEC is a valid starting
point.

- When package research exists, read the findings relevant to the planned behavior. Recheck an
  `Observed in` finding against the installed version when the plan depends on it. Research does not
  add requirements.
- When the SPEC has an Explored alternatives section, read it and apply its
  [reconsideration rule](../../../docs/specifications.md#explored-alternatives).
- Distinguish implemented and verified behavior from absent, partial, or unverified requirements. Do
  not assume the reference implementation conforms to its SPEC.

## 3. Map the scope to requirements

Map the requested scope to SPEC requirements and conformance scenarios.

- Reference requirements by their `REQ-<behavior-slug>` identifiers, and keep task names separate.
  If the SPEC lacks identifiers, identify the missing references before presenting the plan as
  ready. Do not silently invent, rename, or retire requirements.
- Keep complete, partial, remaining, and out-of-scope requirements visible.
- Separate proposed checks from recorded results, and identify the evidence behind each completion
  claim.
- When a requirement lacks a check, derive one from its approved behavior or flag the ambiguity for
  resolution.

## 4. Select the approach

Select files, internal types, algorithms, library approaches, and task boundaries within the
contract. Assess Effect v4 for a library approach under
[effect-adoption.md](../../shared/effect-adoption.md); the
[Effect research](../../../docs/research/effect-ts-v4.md) records v4 patterns, host constraints, and
measured costs. Translate failure, cancellation, recovery, and ordering guarantees into concrete
edits and checks; do not require the SPEC to prescribe the mechanism.

Before planning work that depends on a behavioral decision:

- When a missing behavioral decision would change acceptance, settle it with the developer through
  the global `brainstorm` skill.
- When an implementation decision would change observable behavior, treat it as a contract change,
  obtain the developer's direction through `brainstorm`, and return `Needs contract`.
- Do not add requirements, weaken acceptance criteria, or treat a proposed change as approved.

## 5. Divide the work

Use one issue when the work is cohesive. When separate tasks help, divide the work into vertical
slices: each slice has an observable outcome and implements the layers that its behavior needs.

- Split a slice into a native sub-issue when it needs separate ownership, a prerequisite
  investigation, or substantial context unrelated to other slices. Do not split solely by file
  count, and do not make every layer a separate task.
- Add an infrastructure task only when a concrete prerequisite cannot form a useful independent
  slice, and name the behavior that depends on it.
- When several tasks contribute to one requirement, name each task's contribution and remaining
  obligations, and assign the check that establishes full coverage to one task. A requirement
  reference alone does not show that a slice satisfies the whole requirement.
- When an uncertain API or runtime behavior could invalidate dependent work, schedule a bounded
  investigation before that work, in the form the plan format's
  [work issue](references/plan-format.md#work-issue) section gives. Keep dependent tasks conditional
  until the result is known. Do not add an investigation to settled, routine work.

## 6. Write the tasks

When a plan format [Design section](references/plan-format.md#design-section) trigger applies, write
that section and follow its approval and recording steps. Place each decision record under
[records.md](../../shared/records.md).

For each task, provide:

- The outcome, the requirements it contributes to, and the boundaries of that contribution.
- Dependencies, and any shared state, files, or contracts that constrain parallel work.
- The relevant repository areas and the implementation decisions that the inspected source supports.
  Link the applicable SPEC sections and research findings, and include the shared constraints that
  affect the task, without copying the whole SPEC or research into every task.
- Acceptance criteria and checks, including applicable invalid-input, cancellation, persistence, and
  real Pi integration scenarios:
  - Derive expected results from the contract.
  - Distinguish automated assertions from checks that need real Pi or user interaction.
  - Do not use a successful render or test run alone as an acceptance criterion.
- Remaining uncertainties, and the research or experiment that resolves each one.

Make each task executable from the repository and the issue plan without the chat:

- Name the files or symbols to change, the existing behavior to reuse, the intended edits, and the
  commands or interaction steps that establish acceptance.
- State each command's working directory and expected observable result.
- Label proposed paths and interfaces as additions; do not claim they already exist.
- Resolve routine implementation choices from inspected code, and document the selection.
- Keep material unknowns in bounded investigation tasks, with dependent work blocked.

For affected READMEs, plan the purpose, installation, and first use under the
[README guidelines](../../../docs/readme-guidelines.md).

## 7. Order the tasks

Order tasks by their prerequisites, not by requirement identifier.

- Identify parallel work only when it does not depend on unresolved decisions or incompatible
  changes to shared contracts.
- In a partial implementation plan, distinguish a completed slice from full package conformance. In
  a full implementation plan, account for every required interface and conformance obligation; do
  not make required behavior optional to simplify scheduling.
- Assign verification of interactions across slices, such as cancellation during persistence or
  interface switching with unfinished input, to concrete tasks. Passing isolated component checks
  does not establish the complete workflow.
- For delayed operations and persistence, include checks at the boundary where the operation
  completes: which session or revision may accept its result, what survives interruption, and what
  an explicit retry may change. Select these checks from the package's requirements; do not impose
  them on unrelated tasks.
- Place the `review-changes` verification of the accumulated change set after the implementation
  tasks and before commit or PR delivery.

Apply the [forward-reference checks](../../../docs/specifications.md#avoid-forward-references) to
the plan's explanations and task order: introduce shared terms, proposed interfaces, and approaches
before tasks use or compare them.

## 8. Publish and verify the plan

1. When updating an existing plan, apply the plan format's
   [resume and publication](references/plan-format.md#resume-and-publication) rules. When evidence
   invalidates an assumption, revise the affected issue plans, dependencies, and coverage, and
   preserve unaffected work. Reconcile an older local plan under the local evidence rules in
   [records.md](../../shared/records.md).
2. Search existing issues before creating one, and reuse the issue that matches the requested scope.
   Create native sub-issues only for independently executable outcomes, under the hierarchy in
   [issues.md](../../shared/issues.md). Do not mirror every requirement or checklist step as an
   issue.
3. Write each issue's plan in the plan format's
   [initiatives and epics](references/plan-format.md#initiatives-and-epics) or
   [work issue](references/plan-format.md#work-issue) section. Start each issue body with the
   Current handoff table, and apply the labels and issue-body editing rules in
   [issues.md](../../shared/issues.md).
4. Write the issue prose under [records.md](../../shared/records.md).
5. If GitHub is unavailable, save a local draft and report that publication remains pending.
   Otherwise, verify the remote issue contents, hierarchy, dependencies, and Project membership.

## Return

Return one outcome to the caller:

- `Done`: the plan is published, or saved as a local draft whose publication remains pending. Report
  the issue links, approved scope, readiness, and blockers, including a Design section that awaits
  developer approval. When implementation is authorized, name the next unblocked task.
- `Needs contract`: the SPEC is missing or unapproved, material design questions remain, or a
  planning decision or new evidence requires a change to observable behavior. Report the missing
  contract or approval, or the proposed change, any developer direction, and the tasks it blocks.
- `Blocked`: a behavioral decision that changes acceptance remains unanswered. Report the decision
  needed and the independent planning already completed.
