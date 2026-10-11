# Review before delivery

Verify the accumulated change set once before a commit or PR with the global `review-changes` skill
and `mode=apply`. These rules adapt that skill to this repository; its coordinator is the
orchestrator.

## Assign reviewers

- Include the `verify-conformance` check for affected package contracts and the `write-readme` check
  for affected READMEs.
- Use the global review skill's selected profiles and assessment contracts for its ordinary review.
  Supply applicable Orbis domain rules without replacing its review procedure.
- Assign the `verify-conformance` check to `orbis-conformance-reviewer`.
- Assign a README check to the global `reviewer` with the `write-readme` `SKILL.md`.
- Follow the active skill's editing boundary for documentation and prose delegates.

## Write reviewer prompts

Give an independent reviewer only what it needs to judge the work without bias:

- The scope: the repository, branch, base, and how to read the diff.
- The contract to judge against: the SPEC, the issue, and approved decisions as constraints.
- The applicable rules files.
- The required output format.

Omit the implementer's self-assessment, the review history, expected verdicts, and lists of known
limits, unless they are constraints the reviewer must not reopen.

## Repository integration

- Run `agent-gh` wherever a global skill names `gh`.
- During `review-changes mode=apply`, the coordinator applies repairs, including implementation
  repairs. Review delegates return findings or proposed corrections without editing.
- Reuse completed review coverage for unchanged inputs. A global skill's required review satisfies
  the corresponding delivery check; new changes or findings need their affected checks.
- Follow the global skill's fallback when a profile or delegation is unavailable, and report the
  actual review coverage and limitations.

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
- For a design change, compare the approved scope with the SPEC, any files that divide its
  requirements by area, and interaction contract, even without a runtime implementation. Check that:
  - Each approved in-scope behavior has a requirement and conformance scenario in the specification
    set, including applicable cross-area invariants.
  - Resolved questions are gone from open lists, and remaining questions concern explicit deferrals.
  - Research does not add requirements, and a SPEC whose package has research links its research
    index from the Supporting evidence section.

  Report contract inconsistencies separately from runtime verification gaps. Passing repository
  checks do not establish agreement with the approved design.

## Resolve findings

1. Resolve findings within the authorized scope and apply confirmed repairs in the coordinator.
2. Recheck the affected behavior after repairs, and rerun the affected checks.

If `review-changes`, `update-docs`, or `audit-prose` is required but unavailable, review the diff,
update affected documentation, audit prose, run repository checks, and report what was skipped.
