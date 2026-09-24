---
name: plan-implementation
description:
  Write GitHub issue implementation plans with concrete tasks and verification from an approved
  Orbis package SPEC.md. Use when planning implementation or vertical slices against an existing
  package contract.
---

# Plan implementation of an Orbis specification

Write an implementation plan grounded in the approved package contract and the current repository,
and keep it in issue bodies in the [plan format](references/plan-format.md). A planning request
authorizes shared planning records, not execution of their tasks.

## Establish the approved baseline

Read the [specification guidance](../../../docs/specifications.md) and the target
`packages/<name>/SPEC.md` with its linked interaction document. Identify the package, requested
scope, specification revision, and approval evidence from the current conversation or repository.
Explicit user approval in the current session is sufficient even when the file's status has not yet
been updated. The existence of a specification does not establish approval.

When the specification is missing or material design questions remain, research the current
implementation and identify the missing contract. Use [design-package](../design-package/SKILL.md)
for design work. When only approval is missing, present the concrete specification for review and
request that missing decision. Continue independent repository inspection while waiting; do not
present dependent tasks as ready for implementation.

Inspect the package source, tests, dependencies, scaffold, and relevant Pi APIs. When package
research exists, read the findings relevant to the planned behavior and verify assumptions that
affect feasibility; research recommendations do not add requirements. Read the SPEC's
`Explored alternatives` section when present and apply the guide's
[reconsideration rule](../../../docs/specifications.md#explored-alternatives). Distinguish
implemented and verified behavior from absent, partial, or unverified requirements. A
specification-only directory is a valid starting point. Do not assume the reference implementation
already conforms to its specification.

## Derive tasks from requirements

Map the requested scope to specification requirements and conformance scenarios. Keep complete,
partial, remaining, and out-of-scope requirements visible. Separate proposed checks from recorded
results; identify the evidence behind completion claims. When a requirement lacks a check, derive
one from its approved behavior or flag the ambiguity for resolution. Reference requirements by their
`REQ-<behavior-slug>` identifiers and keep task names separate. If an existing spec lacks these IDs,
identify the missing references before presenting the plan as ready; do not silently invent, rename,
or retire requirements. Derive task order from dependencies, not from identifier order.

In the plan, select files, internal types, algorithms, and task boundaries within the contract.
Translate failure, cancellation, recovery, and ordering guarantees into concrete edits and checks;
do not require the SPEC to prescribe the mechanism. When a missing behavioral decision would change
acceptance, resolve it with the user before planning dependent work. When an implementation decision
changes observable behavior, treat it as a specification decision and obtain the user's direction;
do not add requirements, weaken acceptance criteria, or treat a proposed change as already approved.

When several tasks contribute to a requirement, name each task's contribution and remaining
obligations, and assign the check that establishes full coverage to a task. A requirement reference
alone does not establish that a slice satisfies the whole requirement.

Use one issue when the work is cohesive. When separate tasks are useful, divide them into vertical
slices with observable outcomes, each implementing the layers needed for that behavior. Split large
work into native sub-issues when a slice needs an independent handoff, prerequisite investigation,
or substantial context unrelated to other slices. Do not split solely by file count or make every
layer a separate task. Infrastructure tasks are appropriate when a concrete prerequisite cannot form
a useful independent slice; name the dependent behavior.

Write the work issue's Design section, as the [plan format](references/plan-format.md#work-issue)
defines it, when the plan introduces a persisted format, a new module boundary, or more than one new
module; the developer approves that section before implementation authorization. A plan without
those triggers states its approach in the Implementation section and needs no separate approval.

When an uncertain API or runtime behavior could invalidate dependent work, schedule a bounded
investigation before that work. State the question, experiment, and observable result needed to
proceed. Keep dependent tasks conditional until the result is known. Do not add an investigation
phase to settled, routine work.

For each task, provide:

- The outcome, requirements it contributes to, and boundaries of that contribution.
- Dependencies and any shared state, files, or contracts that constrain parallel work.
- The relevant repository areas and implementation decisions supported by the inspected source. Link
  the applicable spec sections and research findings; include shared constraints that affect the
  task without copying the entire specification or research corpus into every task.
- Acceptance criteria and checks, including applicable invalid-input, cancellation, persistence, and
  real Pi integration scenarios. Derive expected results from the contract, and distinguish
  automated assertions from checks that require real Pi or user interaction. Where useful, name a
  plausible incorrect behavior the check must reject. A successful render or test run alone is not
  an acceptance criterion.
- Remaining uncertainties and the specific research or experiment that resolves them.

Make each task executable from the repository and issue plan without the chat. Name the files or
symbols to change, the existing behavior to reuse, the intended edits, and the commands or
interaction steps that establish acceptance. State each command's working directory and expected
observable result. Label proposed paths and interfaces as additions; do not claim they already
exist. Resolve routine implementation choices from inspected code and document the selection. Keep
material unknowns in bounded investigation tasks with dependent work blocked.

Order tasks by prerequisites. Identify parallel work only when it does not depend on unresolved
decisions or incompatible changes to shared contracts. In a partial implementation, distinguish a
completed slice from full package conformance. In a full implementation plan, account for every
required interface and conformance obligation; do not make required behavior optional to simplify
scheduling.

Assign verification of interactions across slices, such as cancellation during persistence or
interface switching with unfinished input, to concrete tasks. Passing isolated component checks does
not establish the complete workflow. For delayed operations and persistence, include checks at the
boundary where the operation completes: identify which session or revision may accept its result,
what survives interruption, and what an explicit retry may change. Select these checks from the
package's requirements rather than imposing them on unrelated tasks.

Apply the [forward-reference checks](../../../docs/specifications.md#avoid-forward-references) to
the plan's explanations and task order: introduce shared terms, proposed interfaces, and approaches
before tasks use or compare them.

## Publish and verify the plan

Search existing issues before creating plans. Reuse a bounded initiative for the requested delivery
and create native sub-issues only for independently executable outcomes, following the workflow's
[work hierarchy](../../../docs/development-workflow.md#work-hierarchy) and the plan format's
[initiative](references/plan-format.md#initiative) and
[work issue](references/plan-format.md#work-issue) sections. Do not mirror every requirement or
checklist step as an issue. If GitHub is unavailable, save a local draft and report that publication
remains pending.

For affected READMEs, plan the purpose, installation, and first use through
[write-readme](../write-readme/SKILL.md). When evidence invalidates an assumption, revise affected
issue plans, dependencies, and coverage while preserving unaffected work. Resolve proposed
behavioral changes through [revise-package](../revise-package/SKILL.md).

Place `verify-changes` after accumulated implementation and before commit or PR delivery, including
[verify-conformance](../verify-conformance/SKILL.md) for affected contracts. Verification and
delivery belong in acceptance criteria, not separate issues. A passing test suite or completed child
count does not establish full conformance.

When the plan has a Design section, make the first implementation assignment a skeleton: types,
schemas, module boundaries, exported signatures, and test names with no bodies. The orchestrator
runs the simplification review on that skeleton before bodies are written. Otherwise the first
assignment implements the task directly.

If implementation is authorized, continue with the next ready task. Otherwise report issue links,
approved scope, readiness, and blockers. Verify remote issue contents, hierarchy, dependencies, and
Project membership. Distinguish a saved local draft from a published issue plan.
