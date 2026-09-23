---
name: plan-implementation
description:
  Write GitHub issue implementation plans with concrete tasks and verification from an approved
  Orbis package SPEC.md. Use when planning implementation or vertical slices against an existing
  package contract.
---

# Plan implementation of an Orbis specification

Write an implementation plan grounded in the approved package contract and the current repository.
Keep it in issue bodies by default. A planning request authorizes shared planning records, not
execution of their tasks. Follow the [development workflow](../../../docs/development-workflow.md)
and its [agent model policy](../../../docs/development-workflow.md#agent-models) for planning and any
later implementation. Read the wiki decision index once per working session, opening relevant records.

## Establish the approved baseline

Read `AGENTS.md`, the [specification guidance](../../../docs/specifications.md), and the target
`packages/<name>/SPEC.md`. Identify the package, requested scope, specification revision, and
approval evidence from the current conversation or repository. Explicit user approval in the current
session is sufficient even when the file's status has not yet been updated. The existence of a
specification does not establish approval.

When the specification is missing or material design questions remain, research the current
implementation and identify the missing contract. Use
[design-package](../design-package/SKILL.md) for design work. When only approval
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

Read the [plan format](references/plan-format.md) before drafting. Use one issue when the work is
cohesive. When separate tasks are useful, divide them into vertical slices with observable outcomes,
each implementing the layers needed for that behavior. Split large work into native sub-issues when a
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

Apply the [forward-reference checks](../../../docs/specifications.md#avoid-forward-references)
to the plan's explanations as well as its task order. Introduce shared terms, proposed interfaces,
and implementation approaches before tasks use or compare them. Before delivery, read the plan
without following forward links and repair missing prerequisite context.

Assign verification of interactions across slices, such as cancellation during persistence or
interface switching with unfinished input, to concrete tasks. Passing isolated component checks does
not establish the complete workflow. For delayed operations and persistence, include checks at the
boundary where the operation completes: identify which session or revision may accept its result,
what survives interruption, and what an explicit retry may change. Select these checks from the
package's requirements rather than imposing them on unrelated tasks.

When an implementation decision changes observable behavior, treat it as a specification decision
and obtain the user's direction. Do not add requirements, weaken acceptance criteria, or treat a
proposed change as already approved.

## Publish and verify the plan

Search existing issues before creating plans. Reuse a bounded initiative for the requested delivery
and create native sub-issues only for independently executable outcomes. Keep small work in one
issue. Store shared scope, the SPEC baseline, coverage, and integrated acceptance on the initiative;
keep each child's concrete plan and handoff in its body. Use native blocking relationships and add
every tracked issue to the Project. Do not mirror every requirement or checklist step as an issue.

Use the issue plan format's fixed Current handoff table at the top of each body, with the plan below
it. Confine routine state updates to changed table values; preserve the rest of the body. Migrate
legacy handoffs only when a plan or handoff update is needed.

Use the workflow's authorization boundaries. Reread issues before editing,
preserve contributor changes, and check remote state after an uncertain write before retrying.
Publish current scope and decisions without uploading raw transcripts or old local plans. When
resuming local plans, reconcile their baseline and publish the current executable work. Do not
maintain two authoritative copies. Explicit local or chat-only requests override the shared default.
If GitHub is unavailable, save a local draft and report that publication remains pending.

Keep detailed run evidence in ignored `packages/<name>/implementation/` directories. Check ignore
and tracking status before writing local evidence. Publish authored results through the workflow's
[checkpoint policy](../../../docs/development-workflow.md#publish-checkpoint-artifacts). Keep the
body's current handoff compact and batch necessary edits; put findings and verification details in
append-only comments. Apply the [GitHub Markdown rules](../../../docs/development-workflow.md#write-github-markdown)
to every body and comment draft, including prose audits. Keep reusable tests and instructions in the repository.
This workflow does not change the `@orbis/plan` runtime's exact reviewed Markdown artifact contract.

For affected READMEs, plan the purpose, installation, and first use through
[write-readme](../write-readme/SKILL.md). When evidence invalidates an assumption, revise
affected issue plans, dependencies, and coverage while preserving unaffected work. Resolve proposed
behavioral changes through [revise-package](../revise-package/SKILL.md).

Place `verify-changes` after accumulated implementation and before commit or PR delivery. Include
[verify-conformance](../verify-conformance/SKILL.md) for affected contracts. Verification
and delivery usually belong in acceptance criteria, not separate issues. Follow the workflow's
definitions of done and explicit PR closing links. A passing test suite or completed child count does
not establish full conformance.

If implementation is authorized, continue with the next ready task. Otherwise report issue links,
approved scope, readiness, and blockers. Verify remote issue contents, hierarchy, dependencies, and
Project membership. Distinguish a saved local draft from a published issue plan.
