---
name: verify-conformance
description:
  Review an Orbis package's reference implementation against its SPEC.md using clone-available
  source, tests, and documentation. Use for full-package conformance reviews or the
  affected-contract check in review-changes. Report deviations and verification gaps without
  repairing code or changing the contract.
---

# Verify an Orbis implementation against its specification

This skill assesses whether a package's reference implementation satisfies its behavioral contract
and whether that contract describes the implementation's public behavior. It is read-only: it
reports findings without editing source, tests, specifications, or configuration, and it does not
approve or apply contract amendments, commit, or publish. The result is a report with a requirement
coverage table and a verdict. The report classifies each discrepancy as an implementation deviation,
a verification gap, or a contract ambiguity with a proposed amendment.

## Inputs

The caller provides:

- The target package and its existing SPEC, which, with its linked interaction document, defines the
  contract.
- The scope: a full-package review, the affected-contract check within `review-changes` with the
  orchestrator's change set, or a re-review after the orchestrator resolves a finding.
- The specification and implementation revisions, or, for a working-tree review, the base revision.

If the implementation is absent, run steps 1 through 3, record the missing implementation as a
verification gap, skip the implementation comparisons, and report the verdict as not established.

## 1. Read the contract

Read the [specification guide](../../../docs/specifications.md), then the target package's complete
SPEC and its linked interaction document.

## 2. Establish the scope and evidence

Review the requirements the scope selects:

| Scope                   | Requirements to review                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Full-package review     | Every mandatory requirement and its conformance scenarios, including required interfaces and compatibility claims                |
| Affected-contract check | The affected requirements and their interactions with unchanged behavior. Do not infer full-package conformance from this scope. |
| Re-review               | The affected requirements and their interactions, against the updated artifacts                                                  |

Establish which artifacts belong to the reviewed revision:

- Use `git ls-files` and Git status to identify the artifacts.
- For a working-tree review, identify the base revision and local modifications.
- Include proposed new files only when the caller places them in scope, and state that they are not
  yet available from a committed clone.
- Do not silently mix committed source with modified tests or a different SPEC revision.

Apply these evidence rules:

- Use clone-available specifications, source, tests, manifests, lockfiles, and documentation.
- Exclude ignored implementation plans, journals, prior chat conclusions, and private run records.
  Do not read them to fill gaps or accept them as proof.
- Inspect declared dependencies through the documented installation procedure when needed, and
  distinguish dependency evidence from repository artifacts.
- Public external contracts may clarify a cited host API, but they do not supply undocumented
  package requirements.

## 3. Check the contract text

Check the package's requirement identifiers. Every `REQ-<behavior-slug>` cited in the SPEC,
interaction document, README, and tracked tests must resolve to a requirement the SPEC defines.
Every defined slug must be unique within the package and have at least one conformance scenario, and
a cross-package reference must name its package. Report each of these as a finding:

- An ordinal identifier.
- A duplicate slug.
- A dangling reference left by a retirement or rename.
- A requirement without a conformance scenario.

Read the affected contract in order without following forward links, applying the guide's
[forward-reference checks](../../../docs/specifications.md#avoid-forward-references). For an
unexplained term, approach, state, or interface, report the earliest dependent passage and the
missing or later introduction. Report a reading-order defect separately from an implementation
deviation; moving an unchanged requirement does not amend its behavior. Check that reordered text
preserves IDs, obligations, exceptions, and linked heading anchors.

When requirements conflict or lack an observable acceptance condition, report the ambiguity.

## 4. Compare each requirement with the implementation

Derive expected behavior from the SPEC's system requirements and the normative interaction document
before examining current output. Verify detailed UI behavior and appearance against the interaction
document under the same requirement IDs, and check that both documents agree on state, submission,
cancellation, and recovery. Treat recommendations, research, the `Explored alternatives` and
`Supporting evidence` sections, and explicitly illustrative examples as informative.

For each requirement in scope, identify:

- The required input or precondition, observable outcome, and failure boundaries.
- The source paths that implement it, including entry points and shared state.
- Tests or documented interaction steps that distinguish compliance from a plausible violation, with
  expected results independent of the code under test.
- The evidence obtained and any missing assertion, untested environment, or unresolved host
  behavior.

Inspect assertions and execution paths, not only test names or requirement labels. Cover
cancellation, stale revisions, concurrent completion, partial persistence, retry, and teardown where
the contract requires them. Passing isolated component tests does not establish ordering or
ownership across the complete interaction. Distinguish agent-instruction obligations from behavior
that the extension enforces; schema validation alone does not verify planning quality.

## 5. Obtain reproducible evidence

- Use the repository's documented local checks and declared toolchain.
- Outside `review-changes`, run safe, relevant checks, unless a read-only delegate runs this skill.
  Within `review-changes` or in a read-only delegate, return the commands and expected assertions to
  the orchestrator, which runs the checks. Distinguish inspected tests from executed results.
- Reuse a result only when its reviewed inputs and environment match, and identify its source.
  Historical success claims do not replace reproducible checks.
- Keep verification non-mutating apart from disposable test outputs. Do not install dependencies,
  generate fixtures, update snapshots, or run commands that modify tracked files without the
  caller's authorization. If a check needs those actions, report the prerequisite and continue
  independent inspection.
- When terminal interaction, supported-runtime testing, or package installation checks cannot run,
  keep the corresponding verification gap. Type checking does not close a host import or lifecycle
  gap.

## 6. Check the reverse direction

Inspect public commands, tools, configuration, events, persisted artifacts, and user-visible failure
behavior. The system or interaction contract must describe each one, or it must fall within an
explicitly permitted implementation choice. Check that required documentation records those choices.
Do not require internal types, algorithms, module layouts, or exact source-code correspondence
unless an external compatibility contract requires them.

## 7. Classify discrepancies

Classify each discrepancy as an implementation deviation, a verification gap, or a contract
ambiguity with a proposed amendment. A missing test is not proof of a runtime bug. Report the
required behavior and the evidence for disagreement without changing either artifact.

For a proposed amendment, identify the affected requirement or undocumented public behavior, the
discrepancy, and the decision it needs.

## 8. Report the verdict

Use a requirement coverage table with the requirement ID, status, source evidence, check or observed
result, and remaining obligation. Order rows by responsibility or by the SPEC's own section order;
requirement slugs have no sequence to sort by. Use these statuses:

- **Verified:** Inspected source and sufficient evidence establish the requirement in the stated
  environment. Identify whether the evidence is static inspection, executed tests, or supervised
  interaction; do not imply that an unrun check passed.
- **Deviation:** Concrete source or execution evidence contradicts the requirement.
- **Unverified:** Missing evidence, blocked checks, partial coverage, or contract ambiguity prevents
  a conclusion. State what would resolve it.

Report undocumented public behavior separately when it has no requirement ID. For a deviation,
include expected versus actual behavior and precise file references. Keep verification gaps distinct
from confirmed defects.

When every in-scope obligation is verified and the reverse comparison has no unresolved discrepancy,
report conformance within the reviewed scope. A full-package "conforms" verdict requires
verification of every mandatory requirement; name the revisions and environment. Otherwise, report
the deviations or that conformance is not established. Conformance is an evidence-backed assessment,
not a guarantee over all possible inputs or environments.

## Return

Return the report to the caller: the orchestrator, or the developer in chat. If the caller requests
a saved report, save it in the package's ignored `implementation/` directory, unless the caller
explicitly requests a tracked report. When a read-only delegate runs this skill, the orchestrator
saves it instead. A local report may record results but cannot be a prerequisite for a future
review.

Return one outcome:

- `Done`, with the report: the review completed within its scope, whatever the verdict.
- `Needs contract revision`, with the proposed amendment, the affected requirements, and the
  decision it needs: the report proposes an amendment. Return the decision to the caller instead of
  asking the developer.
