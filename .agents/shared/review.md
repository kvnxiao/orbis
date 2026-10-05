# Review before delivery

Verify the accumulated change set once before a commit or PR with the global `review-changes` skill
and `mode=apply`. These rules adapt that skill to this repository; its coordinator is the
orchestrator.

## Assign reviewers

- Include the `verify-conformance` check for affected package contracts and the `write-readme` check
  for affected READMEs.
- Assign `orbis-reviewer` wherever `review-changes` selects `reviewer` or `reviewer-deep`, including
  a focused deep follow-up. Name the skill's reviewer contract, `references/review-execution.md`,
  and the assigned assessment references in those assignments.
- Assign the `verify-conformance` check to `orbis-conformance-reviewer`.
- Assign a README check to `orbis-reviewer` with the `write-readme` `SKILL.md`.
- Give documentation and prose delegates scoped write permission instead of a read-only role.

## Write reviewer prompts

Give an independent reviewer only what it needs to judge the work without bias:

- The scope: the repository, branch, base, and how to read the diff.
- The contract to judge against: the SPEC, the issue, and approved decisions as constraints.
- The applicable rules files.
- The required output format.

Omit the implementer's self-assessment, the review history, expected verdicts, and lists of known
limits, unless they are constraints the reviewer must not reopen.

## Overrides of review-changes

These rules replace the matching `review-changes` rules in this repository:

- `orbis-implementer` applies accepted implementation fixes, because it edits all implementation
  files.
- A documentation delegate may run `update-docs` and `audit-prose` with `mode=apply` within its
  scoped write permission. This replaces the skill's rules that only the coordinator edits files in
  apply mode, including on its fast path, and that delegated documentation investigation uses
  `mode=report`.
- Run `agent-gh` wherever the skill runs `gh`.
- If a named reviewer profile or delegation is unavailable, report the limitation and obtain the
  developer's choice before substituting another reviewer or reviewing in-session.

## Judge the work

- Judge code on maintainability, standard practice, conformance to the rules skills, and legibility
  at a glance. Treat legibility as the measure of simplicity and of avoiding over-engineering.
- Lead a review with the architecture-shape verdict and measurable legibility facts, such as
  function length, field count, or duplicated helpers, before rule-by-rule findings.
- When a finding traces to a plan or skill rather than to the implementer, say so and propose the
  skill change.
- Before reporting that work skipped a repository rule, compare the rule's merge date with the
  work's creation date, for example with `git log -S'<rule phrase>'`. Report the rule as applicable
  only when it predates the work.
- Review changes to agent instructions and configuration for correctness when they affect routing,
  authorization, delegation, checkpoints, or execution, whatever their file extension.
- For a design change, compare the approved scope with the SPEC and interaction contract, even
  without a runtime implementation. Check that:
  - Each approved in-scope behavior has a requirement and conformance scenario.
  - Resolved questions are gone from open lists, and remaining questions concern explicit deferrals.
  - Research does not add requirements, and a SPEC whose package has research links its research
    index from the Supporting evidence section.

  Report contract inconsistencies separately from runtime verification gaps. Passing repository
  checks do not establish agreement with the approved design.

## Resolve findings

1. Resolve findings within the authorized scope, and send bounded implementation repairs to
   `orbis-implementer`.
2. Recheck the affected behavior after repairs, and rerun the affected checks.

If `review-changes`, `update-docs`, or `audit-prose` is required but unavailable, review the diff,
update affected documentation, audit prose, run repository checks, and report what was skipped.
