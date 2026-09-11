# Local implementation plan format

Write ordinary Markdown that another implementer can use with the repository and linked local plans.
The approved `SPEC.md` and its linked normative interaction document define behavior; the plan
selects concrete edits and checks. System design belongs in the SPEC; detailed appearance, key
mappings, and user flows belong in `docs/tui-interactions.md`. Do not copy the entire specification
or research corpus. Include the constraints needed to execute each task and link their sources.

Verification records and run evidence belong beside the implementation plans in their default
Git-ignored directory. Use task evidence fields or sibling records; tracking or publishing them
requires explicit user opt-in. Do not create publicly referenced verification documents or link
public documentation to local evidence. Keep reusable test instructions in the package README.
Package documentation describes behavior and compatibility limits without session logs or test-run
results.

## Single plan

Use `PLAN.md` for one cohesive change. Start with its outcome and baseline, then describe the
implementation through dependency-ordered tasks. The outline below defines the information to
preserve; adapt headings and omit inapplicable sections. Use plain metadata lines rather than YAML
frontmatter unless a consumer needs a machine-readable schema. Do not wrap saved Markdown in a code
fence or host tags.

```markdown
# Implement <observable outcome>

Package: @orbis/<name> Specification: <relative link, revision, commit or content hash>
Specification approval: <confirmed scope, or pending decision> Repository baseline:
<commit and relevant uncommitted changes> Readiness: ready | blocked on
<named decision or investigation> Execution: not started | in progress | blocked | complete Evidence
location: task fields or sibling records in this local implementation directory; ignored unless
tracking is explicitly requested

## Outcome and scope

Describe the resulting behavior and how to observe it. Name excluded behavior only when it defines a
meaningful boundary of the requested work.

## Current implementation and chosen approach

State verified behavior, missing behavior, and the specific approach. Name paths, symbols, public
interfaces, reusable functions, and constraints needed for the work. Distinguish inspected code from
proposed additions. Record assumptions.

## Tasks

### T-001 — <observable outcome>

Status: pending Requirements: <REQ-###, this task's contribution, remaining obligations> Depends on:
<task or plan links, or none>

Changes: Name the existing or proposed files and symbols, the edits to make, and behavior to reuse.
State shared contracts that constrain concurrent work.

Verification: Give the working directory, exact command or repeatable interaction, input, and
expected result. Label automated checks and real Pi/manual checks. Automated tests use local
fixtures or scripted providers without real-model calls or model charges. Real-model checks require
separate supervision by a live orchestrator during an explicit verification session. Include invalid
input, interruption, and recovery cases when the behavior needs them. Name the plausible regression
that the check must reject.

Blockers: State the unanswered question and the experiment or user decision that resolves it. Omit
this field when the task has no blockers.

Evidence: Not run. During authorized implementation, replace this with observed results and
remaining checks; do not copy expectations into completion claims. Keep detailed records beside this
plan and link them only from local plans.

## Requirement coverage

| Requirement | Current evidence                       | Contributing tasks | Full-coverage check |
| ----------- | -------------------------------------- | ------------------ | ------------------- |
| REQ-###     | Absent/partial/verified, with evidence | T-001              | Task and scenario   |

Include every requirement in the requested scope. Identify exclusions explicitly.

## Final verification

Assign interaction checks across tasks and repository verification to executable tasks. Include
verify-changes after the accumulated implementation and immediately before any requested commit or
PR. List checks that require a real Pi session. Confirm that plans and evidence share the ignored
directory and are untracked unless the user explicitly opted in. Public docs must not reference run
evidence; reusable test instructions belong in the package README.

## Resume notes

Record material discoveries, changed decisions, completed verification, remaining work, and the next
unblocked task. Start with “Implementation has not started.”
```

Use stable task IDs within a plan. A cross-plan dependency names the file and task anchor, such as
`01-terminal.md#t-003--submit-a-round`. Preserve IDs when reordering tasks. Give investigation tasks
an experiment, bounded output, and a decision criterion; keep dependent implementation blocked until
the result is known.

Approval of the specification, readiness of a task, and authorization to execute are distinct.
Record existing approval accurately; do not request it again merely because the plan is saved or the
specification still says Draft. A ready plan does not authorize implementation, commits, or
publication.

Before resuming, compare the specification and relevant source with the recorded baseline. Re-read
changed areas and revise affected tasks and coverage. An unrelated commit does not invalidate the
whole plan. During implementation, mark a task complete only when its acceptance checks have
recorded results; otherwise state what is implemented and what remains unverified.

## Multiple plans

Split when executable slices need separate handoffs or substantial independent context. Keep closely
coupled edits together. Use this layout:

```text
packages/<name>/implementation/
  PLAN.md
  01-<outcome>.md
  02-<outcome>.md
  03-<outcome>.md
  verification.md  # Optional detailed run evidence; ignored with the plans
```

The index contains the shared outcome, specification approval and baseline, links to each plan,
dependency order, shared interface decisions, and the combined requirement coverage table. Assign
verification of interactions across plans and final package conformance to named tasks. Filenames
aid navigation; explicit dependencies determine execution order. Do not infer parallelism from
numbering.

Each child follows the single-plan outline for its scope. Link the index for shared context and
include task-specific constraints locally. State each prerequisite's observable output, not just its
filename. Keep task status and evidence in the child; the index links to that record instead of
maintaining a duplicate checklist. Detailed verification and evidence records remain siblings of
these plans and must not become publicly referenced package documentation. Do not create a separate
file for every small task or repeat all package requirements in every child. A completed child
establishes only its assigned contribution.

## Concrete task example

This example plans an investigation for `@orbis/plan`; it records no test results.

### T-001 — Establish how Pi reports a failed session save

Status: pending Requirements: REQ-020 and REQ-023 feasibility; does not implement persistence.
Depends on: package scaffold and its Vitest project.

Changes: Add `packages/plan/tests/session-persistence.test.mts` using a disposable Pi session and a
minimal extension that calls `pi.appendEntry()`. Exercise a fresh session, a session with an
assistant message, disabled persistence, and a write failure. Inspect both `getBranch()` and the
session file. Pi 0.85.1 appends to memory before its disk write; an in-memory record alone cannot
establish saving. Keep filesystem failure injection local to the fixture.

Verification: From the repository root, run
`pnpm --filter @orbis/plan test -- tests/session-persistence.test.mts`. Automated assertions must
distinguish a record present only in memory from a record restored after reopening the saved
session. Repeat the failed write after removing the fault and record whether retry duplicates
records. Report the observed public API behavior and the persistence mechanism available to the
extension.

Blockers: Approval saving remains blocked until the experiment establishes how to confirm a saved
session record or return a recoverable error. If public APIs cannot satisfy REQ-023, report the
limitation before implementing dependent behavior.

Evidence: Not run.
