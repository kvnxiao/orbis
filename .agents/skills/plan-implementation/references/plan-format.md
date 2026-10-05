# Issue implementation plans

An issue plan is the current executable plan for issue-backed work. It lives in the GitHub issue
body, below the Current handoff table. The SPEC and its interaction contract define behavior; the
plan selects concrete edits and checks. The work paths determine which work has an issue, and the
work hierarchy of initiatives, epics, and tasks sets each issue's scope.

For a small change, cover the plan in a few paragraphs. Do not add empty plan sections or copy the
section tables below into issues.

## Initiatives and epics

An initiative or epic tracks coordinated delivery across one or more PRs. Its plan has these
sections:

| Section                            | Required information                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome and scope                  | Observable delivery, affected packages or mechanisms, boundaries, and approved requirements when applicable                                   |
| Baseline                           | Applicable SPEC and interaction-contract links and reviewed revisions; repository baseline; developer approval reference or pending decisions |
| Shared approach                    | Verified current behavior, proposed additions, selected approach, and shared constraints                                                      |
| Coverage and integrated acceptance | Applicable requirement IDs, contributing issues and partial contributions, cross-child checks, and full scoped coverage checks                |

- Use native child relationships instead of a duplicate child-status checklist.
- Record blocking links and the prerequisite's observable output.

## Work issue

A work issue is a `level:task` issue. When it has a parent, refer to the parent for shared context
instead of copying its contract or coverage table. Its plan has these sections:

| Section        | Required information                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome        | Observable result, requirement contribution, and obligations left to other work                                                                             |
| Prerequisites  | Blocking issue links, required outputs, and unresolved decisions                                                                                            |
| Design         | Only when a [Design section](#design-section) trigger applies                                                                                               |
| Implementation | Files or symbols, intended edits, existing behavior to reuse, constraints, and small-step checklists                                                        |
| Acceptance     | Working directory, command or interaction, inputs, expected results, applicable failure or recovery cases, and plausible regressions the checks must reject |

- Separate local automated checks from explicitly authorized real-model checks.
- Verification and PR delivery normally belong in acceptance criteria, not in separate issues.
- For an investigation, state the question, the bounded experiment, and the result needed to unblock
  dependent work. A negative finding that completes the investigation does not make the dependent
  design viable.

### Design section

Add a Design section when the plan introduces any of these:

- A persisted format.
- A new module boundary.
- More than one new module.

The section records:

- Each module, with its one-line ownership and the permitted import direction.
- Each persisted record, with its schema, atomic unit, and owner.
- Each multi-step lifecycle, as a state table.
- For each mechanism, the requirement that forces it and the simpler mechanism that fails that
  requirement.

A plan without these triggers states its approach in the Implementation section and does not need
separate approval. When the Design section is present:

1. During planning, drop each mechanism that has no forcing requirement.
2. Obtain the developer's approval of the section before implementation begins. Approval does not
   authorize implementation.
3. Record each persisted format as a decision record.
4. Make the first implementation assignment a skeleton: types, schemas, module boundaries, exported
   signatures, and test names, with no bodies.
5. Before bodies are written, the orchestrator runs a `review-changes` simplification review on the
   skeleton.

## Resume and publication

- When the recorded baseline differs from the current SPEC or source, revise the affected tasks and
  coverage, and preserve completed work. Unrelated commits do not invalidate the whole plan.
- A local draft saved during a GitHub outage stays unpublished until the issue update succeeds.
- This format governs repository development, not the exact reviewed Markdown that `@orbis/plan`
  saves.
