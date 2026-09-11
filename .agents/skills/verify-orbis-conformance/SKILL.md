---
name: verify-orbis-conformance
description: Review an Orbis package's reference implementation against its SPEC.md using clone-available source, tests, and documentation. Use for full-package conformance reviews or the affected-contract check in verify-changes. Report deviations and verification gaps without repairing code or changing the contract.
---

# Verify an Orbis implementation against its specification

Assess whether the reference implementation satisfies the behavioral contract and
whether that contract describes its public behavior. Review without editing source,
tests, specifications, or configuration. A review request does not authorize fixes,
contract amendments, commits, or publication.

## Establish scope and evidence

Read project `AGENTS.md`, the [specification guidance](../../../docs/specifications.md),
and the target package's complete `SPEC.md`. Identify the package, specification
and implementation revisions, and requested scope:

- For a full-package review, account for every mandatory requirement and its
  conformance scenarios, including required interfaces and compatibility claims.
- Within `verify-changes`, use the coordinator's change set and review affected
  requirements plus their interactions with unchanged behavior. Do not infer
  full-package conformance from this scope. Return findings to the coordinator;
  do not invoke `verify-changes` recursively or delegate further.

Use `git ls-files` and Git status to establish which artifacts belong to the
reviewed revision. For a working-tree review, identify the base revision and local
modifications. Include proposed new files only when the caller places them in
scope, and state that they are not yet available from a committed clone. Do not
silently mix committed source with modified tests or a different SPEC revision.

Use clone-available specifications, source, tests, manifests, lockfiles, and
documentation as evidence. Exclude ignored implementation plans, journals, prior
chat conclusions, and private run records. Do not read them to fill gaps or accept
them as proof. Declared dependencies may be inspected through the documented
installation procedure; distinguish dependency evidence from repository artifacts.
Public external contracts may clarify a cited host API, but must not supply
undocumented package requirements.

When a SPEC or implementation is absent, report what is missing. When requirements
conflict or lack an observable acceptance condition, identify the ambiguity rather
than choosing the current implementation's behavior as the contract.

## Compare the contract and implementation

Derive expected behavior from mandatory requirements and their contract tables
before examining current output. Treat recommendations, research, and illustrative
examples as informative unless the SPEC makes them normative.

For each requirement in scope, identify:

- The required input or precondition, observable outcome, and failure boundaries.
- The source paths that implement it, including entry points and shared state.
- Tests or documented interaction steps that distinguish compliance from a
  plausible violation, with expected results independent of the code under test.
- The evidence obtained and any missing assertion, untested environment, or
  unresolved host behavior.

Inspect assertions and execution paths, not only test names or requirement labels.
Cover cancellation, stale revisions, concurrent completion, partial persistence,
retry, and teardown where the contract requires them. Passing isolated component
tests does not establish ordering or ownership across the complete interaction.
Distinguish agent-instruction obligations from behavior enforced by the extension;
schema validation alone does not verify planning quality.

Check the reverse direction by inspecting public commands, tools, configuration,
events, persisted artifacts, and user-visible failure behavior. Each must be
described by the SPEC or fall within an explicitly permitted implementation choice.
Check that required documentation records those choices. Do not require internal
types, algorithms, module layouts, or exact source-code correspondence unless an
external compatibility contract requires them.

Classify discrepancies as implementation deviations, verification gaps, or contract
ambiguities and proposed amendments. A missing test is not proof of a runtime bug;
a passing test is not authority to weaken a requirement. Report the required
behavior and the evidence for disagreement without changing either artifact.

For a proposed amendment, identify the affected requirement or undocumented public
behavior, the discrepancy, and the decision needed. Hand approved revision work
to the caller or `verify-changes` coordinator through
[revise-orbis-package](../revise-orbis-package/SKILL.md). The coordinator determines
authorization from the user's request; this review neither approves nor applies
amendments. After the coordinator resolves a finding, review the affected
requirements and their interactions against the updated artifacts.

## Obtain reproducible evidence

Use the repository's documented local checks and declared toolchain. Run safe,
relevant checks when acting as the primary reviewer. When delegated by
`verify-changes`, return the commands and expected assertions to the coordinator,
which owns test execution; distinguish inspected tests from executed results.
Reuse a result only when its reviewed inputs and environment match, and identify
its source. Historical success claims do not replace reproducible checks.

Keep verification non-mutating apart from disposable test outputs. Do not install
dependencies, generate fixtures, update snapshots, or run commands that modify
tracked files without the caller's authorization. If a check needs those actions,
report the prerequisite and continue independent inspection.

Automated tests must use local fixtures or scripted providers without real-model
charges. Real-model checks require separate explicit authorization and live
orchestrator supervision. When terminal interaction, supported-runtime testing, or
package installation checks cannot run, retain the corresponding verification gap.
Do not substitute type checking for host import or lifecycle verification.

## Report the verdict

Use a requirement coverage table with the requirement ID, status, source evidence,
check or observed result, and remaining obligation. Use these statuses:

- **Verified:** Inspected source and sufficient evidence establish the requirement
  in the stated environment. Identify whether evidence is static inspection,
  executed tests, or supervised interaction; do not imply an unrun check passed.
- **Deviation:** Concrete source or execution evidence contradicts the requirement.
- **Unverified:** Missing evidence, blocked checks, partial coverage, or contract
  ambiguity prevents a conclusion. State what would resolve it.

Report undocumented public behavior separately when it has no requirement ID.
For deviations, include expected versus actual behavior and precise file references.
Keep verification gaps distinct from confirmed defects.

When every in-scope obligation is verified and the reverse comparison has no
unresolved discrepancy, report conformance within the reviewed scope. A
full-package "conforms" verdict requires verification of every mandatory
requirement; name the revisions and environment. Otherwise report deviations or
that conformance is not established.
Conformance is an evidence-backed assessment, not a guarantee over all possible
inputs or environments.

Return the report in chat or to the coordinating reviewer. If the caller requests
a saved report, use the package's ignored `implementation/` directory unless the
caller explicitly requests tracking. Do not link public documentation to local
reports. Required tests and reusable verification instructions must be available
from a clone; local reports may record results but cannot be prerequisites for
future conformance reviews.
