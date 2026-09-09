---
name: plan-orbis-implementation
description: Derive verifiable implementation tasks from an approved Orbis package SPEC.md. Use when planning implementation or vertical slices against an existing package contract.
---

# Plan implementation of an Orbis specification

Produce an implementation plan grounded in the approved package contract and the
current repository. A planning request does not authorize implementing the tasks.

## Establish the approved baseline

Read `AGENTS.md`, the [specification guidance](../../../docs/specifications.md),
and the target `packages/<name>/SPEC.md`. Identify the package, requested scope,
specification revision, and approval evidence from the current conversation or
repository. Explicit user approval in the current session is sufficient even when
the file's status has not yet been updated. The existence of a specification does
not establish approval.

When the specification is missing or material design questions remain, research
the current implementation and identify the missing contract. Use
[brainstorm-orbis-package](../brainstorm-orbis-package/SKILL.md) for design work.
When only approval is missing, present the concrete specification for review and
request that missing decision. Continue independent repository inspection while
waiting; do not present dependent tasks as ready for implementation.

Inspect the package source, tests, dependencies, scaffold, and relevant Pi APIs.
When package research exists, read the findings relevant to the planned behavior
and verify assumptions that affect feasibility. Research docs remain optional;
their recommendations do not add requirements to the approved contract.
Distinguish implemented and verified behavior from absent, partial, or unverified
requirements. A specification-only directory is a valid starting point. Do not
assume the reference implementation already conforms to its specification.

## Derive tasks from requirements

Map the requested scope to specification requirements and conformance scenarios.
Keep complete, partial, remaining, and out-of-scope requirements visible. Separate proposed
checks from recorded results; identify the evidence behind completion claims.
When a requirement lacks a check, derive one from its approved behavior or flag
the ambiguity for resolution. Reference the package-local `REQ-001` identifier
format and keep task names separate from
requirement IDs. Cross-package references include the package name. If an existing
spec lacks these IDs, identify the missing references before presenting the plan
as ready; do not silently invent or renumber requirements.

When several tasks contribute to a requirement, name each task's contribution and
remaining obligations. Assign the check that establishes full coverage to a task.
A requirement reference alone does not establish that a slice satisfies the whole
requirement.

Use one plan when the work is cohesive. When separate tasks are useful, divide
them into vertical slices with observable outcomes, each implementing the layers
needed for that behavior. Do not make every layer a separate task by default.
Infrastructure tasks are appropriate when a concrete prerequisite cannot form a
useful independent slice; name the dependent behavior.

When an uncertain API or runtime behavior could invalidate dependent work, schedule
a bounded investigation before that work. State the question, experiment, and
observable result needed to proceed. Keep dependent tasks conditional until the
result is known. Do not add an investigation phase to settled, routine work.

For each task, provide:

- The outcome, requirements it contributes to, and boundaries of that contribution.
- Dependencies and any shared state, files, or contracts that constrain parallel
  work.
- The relevant repository areas and implementation decisions supported by the
  inspected source. Link the applicable spec sections and research findings;
  include shared constraints that affect the task without copying the entire
  specification or research corpus into every task.
- Acceptance criteria and checks, including applicable invalid-input,
  cancellation, persistence, and real Pi integration scenarios. Derive expected
  results from the contract, and distinguish automated assertions from checks that
  require real Pi or user interaction. Where useful, name a plausible incorrect
  behavior the check must reject. A successful render or test run alone is not an
  acceptance criterion.
- Remaining uncertainties and the specific research or experiment that resolves
  them.

Order tasks by prerequisites. Identify parallel work only when it does not depend
on unresolved decisions or incompatible changes to shared contracts. In a partial
implementation, distinguish a completed slice from full package conformance. In a
full implementation plan, account for every required interface and conformance
obligation; do not make required behavior optional to simplify scheduling.

Assign verification of interactions across slices, such as cancellation during
persistence or interface switching with unfinished input, to concrete tasks.
Passing isolated component checks does not establish the complete workflow.

When an implementation decision changes observable behavior, treat it as a
specification decision and obtain the user's direction. Do not add requirements,
weaken acceptance criteria, or treat a proposed change as already approved.

## Deliver and verify the plan

Present a dependency-ordered plan with requirement coverage and remaining gaps.
Keep plans in the current conversation unless the user specifies a destination.
Do not create package-local plan directories or modify source merely to deliver a
plan. Name the specification revision the plan targets and record any uncommitted
specification changes that affect that baseline.

When evidence invalidates an assumption, revise the affected tasks, dependencies,
and coverage claims. Preserve unaffected work and settled requirements. Distinguish
a task adjustment within the contract from a proposed specification change that
requires the user's direction.

Include the repository's applicable verification in the implementation work. Place
`verify-changes` after the accumulated implementation and before a requested commit
or PR. Do not infer permission to commit, push, or publish from a planning request.

If the user also authorized implementation, use the agreed plan to continue that
work. Otherwise finish with the plan and explicit blockers, without claiming its
tasks have been executed.
