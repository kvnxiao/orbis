---
name: plan-orbis-implementation
description:
  Write local Markdown implementation plans with concrete tasks and verification from an approved
  Orbis package SPEC.md. Use when planning implementation or vertical slices against an existing
  package contract.
---

# Plan implementation of an Orbis specification

Write an implementation plan grounded in the approved package contract and the current repository.
Save it locally by default. A planning request authorizes the plan files, not execution of their
tasks.

## Establish the approved baseline

Read `AGENTS.md`, the [specification guidance](../../../docs/specifications.md), and the target
`packages/<name>/SPEC.md`. Identify the package, requested scope, specification revision, and
approval evidence from the current conversation or repository. Explicit user approval in the current
session is sufficient even when the file's status has not yet been updated. The existence of a
specification does not establish approval.

When the specification is missing or material design questions remain, research the current
implementation and identify the missing contract. Use
[brainstorm-orbis-package](../brainstorm-orbis-package/SKILL.md) for design work. When only approval
is missing, present the concrete specification for review and request that missing decision.
Continue independent repository inspection while waiting; do not present dependent tasks as ready
for implementation.

Inspect the package source, tests, dependencies, scaffold, and relevant Pi APIs. When package
research exists, read the findings relevant to the planned behavior and verify assumptions that
affect feasibility. Research docs remain optional; their recommendations do not add requirements to
the approved contract. Distinguish implemented and verified behavior from absent, partial, or
unverified requirements. A specification-only directory is a valid starting point. Do not assume the
reference implementation already conforms to its specification.

## Derive tasks from requirements

Read the SPEC and its linked normative interaction document as the approved contract. Keep system
design in the SPEC and detailed UI behavior, appearance, and key mappings in
`docs/tui-interactions.md`. Derive interaction tasks and expected checks from that document without
copying UI rules into the SPEC. In the plan, select files, internal types, algorithms, and task
boundaries within that contract. Translate failure, cancellation, recovery, and ordering guarantees
into concrete edits and checks; do not require the SPEC to prescribe the mechanism. When a missing
behavioral decision would change acceptance, resolve it with the user before planning dependent
work.

Map the requested scope to specification requirements and conformance scenarios. Keep complete,
partial, remaining, and out-of-scope requirements visible. Separate proposed checks from recorded
results; identify the evidence behind completion claims. When a requirement lacks a check, derive
one from its approved behavior or flag the ambiguity for resolution. Reference the package-local
`REQ-<behavior-slug>` identifier format and keep task names separate from requirement IDs.
Cross-package references include the package name. If an existing spec lacks these IDs, identify the
missing references before presenting the plan as ready; do not silently invent, rename, or retire
requirements. A slug implies no sequence, so derive task order from dependencies rather than from
identifier order.

When several tasks contribute to a requirement, name each task's contribution and remaining
obligations. Assign the check that establishes full coverage to a task. A requirement reference
alone does not establish that a slice satisfies the whole requirement.

Read the [plan format](references/plan-format.md) before drafting. Use one plan when the work is
cohesive. When separate tasks are useful, divide them into vertical slices with observable outcomes,
each implementing the layers needed for that behavior. Split large work into linked plans when a
slice needs an independent handoff, prerequisite investigation, or substantial context unrelated to
other slices. Do not split solely by file count or make every layer a separate task. Infrastructure
tasks are appropriate when a concrete prerequisite cannot form a useful independent slice; name the
dependent behavior.

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
- Automated checks use local fixtures or scripted in-process providers and must not call real models
  or incur model charges. Schedule real-model checks as separate in-session verification supervised
  by a live orchestrator.
- Remaining uncertainties and the specific research or experiment that resolves them.

Make each task executable from the repository and saved plan without the chat. Name the files or
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

When an implementation decision changes observable behavior, treat it as a specification decision
and obtain the user's direction. Do not add requirements, weaken acceptance criteria, or treat a
proposed change as already approved.

## Deliver and verify the plan

Unless the user specifies another destination or requests chat-only output, write the
dependency-ordered plan to `packages/<name>/implementation/PLAN.md` relative to the repository root.
Use a descriptive title. Inspect existing plans before creating a directory; revise the matching
plan without overwriting unrelated work. For multiple plans, make `PLAN.md` the index and use
descriptive numbered sibling files as described in the format reference. Create directories only
when writing their contents.

Verify that Git ignores the default destination with `git check-ignore -v` and that no plan files
there are tracked. Orbis ignores `/packages/*/implementation/`; do not add a blanket `PLAN.md`
ignore rule or force-add local plans. When a user selects another local destination, check its
ignore status and add a narrowly scoped ignore rule if needed. An explicit request for tracked plans
overrides the local default.

Keep the reusable format in the tracked skill and the generated plans in the chosen local directory.
The package scaffold does not create plan directories. These files guide implementation work; they
are not approved artifacts emitted by the `@orbis/plan` runtime. Preserve its requirement to save
the exact reviewed Markdown.

Colocate verification records and run evidence with the implementation plans. Record results in task
evidence fields or sibling files under the same default Git-ignored directory. Keep session logs,
environment details, command results, and remaining checks there; do not create publicly referenced
verification documents or link package documentation to these local records. Tracking or publishing
evidence requires an explicit user opt-in. Keep reusable test instructions in the root
`CONTRIBUTING.md` or package `docs/development.md`.
Package documentation describes behavior and compatibility limits without session logs or test-run
results.

For affected READMEs, plan the purpose, installation, and first-use example through
[write-orbis-readme](../write-orbis-readme/SKILL.md). Link advanced usage and integration details
from focused package documents instead of adding them to the README.

When evidence invalidates an assumption, revise the affected tasks, dependencies, and coverage
claims. Preserve unaffected work and settled requirements. Distinguish a task adjustment within the
contract from a proposed specification change that requires the user's direction.

Include the repository's applicable verification in the implementation work. Place `verify-changes`
after the accumulated implementation and before a requested commit or PR. Do not infer permission to
commit, push, or publish from a planning request. Assign
[verify-orbis-conformance](../verify-orbis-conformance/SKILL.md) to final verification through
`verify-changes`, including requirements affected by review fixes. Plan tracked tests and reusable
verification instructions that a fresh clone can use without the ignored plans or evidence journals.
Keep missing tests and implementation defects separate from contract amendments that require
approval. A completed plan or passing test suite does not establish package conformance.

If the user also authorized implementation, use the agreed plan to continue that work. Otherwise
finish with links to the saved plan or index, its approval and readiness state, and explicit
blockers. Check links, requirement coverage, task dependencies, and the separation between expected
checks and recorded results. Verify that evidence is colocated with the plans and that public
documentation does not reference it. Check ignore and tracking status for evidence as well as plans.
Report the saved paths and ignore status without repeating the entire plan in chat. If saving fails,
report the failure and provide the plan in chat without claiming it was persisted.
