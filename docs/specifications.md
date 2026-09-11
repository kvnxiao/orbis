# Package specifications

Each Orbis package has a `packages/<name>/SPEC.md` that defines its intended behavior. The
specification is written for developers and coding agents building an independent Pi extension
without reading the reference implementation. Orbis specifications and reference implementations are
distributed under the repository's [MIT license](../LICENSE).

## Specify a package

When research informs a package design, persist its synthesis in `packages/<name>/docs/research/`
before writing `SPEC.md`. Research docs are optional for simple packages with settled behavior, such
as `exit`. Include source links, relevant versions, findings, design implications, and evidence
gaps. Update the synthesis as research continues. Research informs the contract; it does not
independently define requirements.

When needed, create the research directory directly. Write the specification before implementing a
new package. A package containing research and a specification without runtime files is not an
installable extension. Use the [specification starter](../templates/extension/SPEC.md) as writing
guidance. Replace its instructional text with the package's contract.

Choose headings for the package's audience and responsibilities. A command may need a short
description and conformance scenarios. An interactive workflow may also need state transitions,
persistence rules, and interface contracts. Do not add empty sections to satisfy a universal table
of contents.

Every specification states:

- Its status, intended audience, purpose, and scope.
- Required observable behavior and applicable external contracts.
- Permitted implementation choices and boundaries.
- What a conforming implementation must satisfy, with scenarios linked to the requirements they
  verify.

Commands, tools, configuration, events, persisted artifacts, ordering rules, failure handling,
cancellation, and recovery belong in the specification when they affect the package's behavior.
Internal module names and dependency choices belong in implementation work unless compatibility
requires them.

Assign requirements stable identifiers in the form `REQ-001`, with zero-padded digits. Identifiers
are local to a package; cross-package references include the package name. Keep requirement
identifiers distinct from implementation task names. Keep each requirement focused on a behavior and
its related conditions. State the trigger or precondition, required result, and applicable failure
behavior. Define exact values and formats when compatibility depends on them. Avoid adjectives such
as "fast" or "intuitive" as the sole acceptance criterion.

Declare which text defines conformance. In Orbis specs, `REQ-###` requirements and their associated
contract tables define mandatory behavior. Label recommendations and illustrative examples
separately; examples do not silently add obligations. Conformance scenarios verify the requirements
and must agree with them.

Distinguish an implementation-defined choice from an unresolved decision. For an
implementation-defined choice, state the allowed variation and require the implementation to
document its selection. A draft can contain unresolved questions; resolve those that affect a task
before implementing it. Do not let an agent infer answers from its own recommendation or the current
implementation.

Write requirements against Pi's public capabilities. Independent implementations must satisfy the
complete package contract, including the interfaces and workflows required by Orbis. Portability to
other hosts is outside the default contract. When an external API or format defines part of the
contract, identify the relevant capability and reference. State a version or compatibility boundary
when versions change the required behavior. Background reading does not add requirements.

## Define conformance

### Terminal interaction document

Packages that own prompts, menus, forms, modals, or interactive terminal views must include
`docs/tui-interactions.md` and link it from `SPEC.md`. Commands that only execute an action or print
output do not require an empty auxiliary file.

Before design approval, explore focus, navigation, text entry, confirmation, submission,
cancellation, recovery, and applicable terminal constraints. After approval, document concrete
scenarios with initial state, user actions, and observable outcomes. Include Mermaid diagrams for
branching or multistep flows. Cover failure and interruption as well as successful completion, and
reference the applicable `REQ-###` identifiers.

The SPEC remains self-contained and defines required behavior. The auxiliary document illustrates
and exercises that contract; it does not introduce hidden requirements or prescribe a shared layout
or keymap across packages. Keep it consistent with the SPEC and separate from research synthesis and
execution logs. The design workflow checks the document's existence, SPEC reference, scenario
coverage, and agreement with requirements before reporting completion.

### Conformance evidence

A conforming implementation satisfies every mandatory requirement of the package. An implemented
slice can satisfy its assigned requirements without establishing full package conformance. Neither
task priority nor implementation difficulty changes the contract.

For each requirement, describe how to observe compliance. A short spec can put scenarios beside
requirements; a larger spec can use a coverage table. Include initial state or input, action, and
expected output or state change. Cover relevant failure, cancellation, recovery, and ordering
conditions. Plain Markdown is sufficient; a scenario DSL or separate scenario ID system is not
required.

Choose evidence appropriate to the behavior: an automated assertion, a real Pi integration check, or
a repeatable user interaction. Define the expected result from the approved contract before
examining what the implementation happens to return. Check that tests distinguish compliant behavior
from plausible violations; successful execution or code coverage alone does not establish
correctness.

Passing the listed scenarios is evidence of conformance, not proof that every possible input
satisfies the contract. When reporting conformance, name the spec revision, implementation revision,
tested environment, and verification gaps. Keep execution results in test reports or implementation
documentation; the spec states the checks an implementation must satisfy.

## Implement a specification

Before implementation, review the specification with the user and resolve the requirements in scope.
Derive one implementation plan or several vertical tasks from that contract. Each task identifies
its requirements, dependencies, observable outcome, and verification. A vertical task delivers a
behavior through the layers it needs; a list of modules alone does not define its completion.

The planning skill saves local Markdown plans to `packages/<name>/implementation/PLAN.md` by
default. Git ignores these directories. For large work, `PLAN.md` indexes dependency-ordered sibling
plans and assigns requirement coverage across them. Each task states concrete edits, prerequisites,
verification commands or interaction steps, and expected results. Follow the
[plan format](../.agents/skills/plan-orbis-implementation/references/plan-format.md). The user can
request another destination, tracked plans, or chat-only output.

The package scaffold does not create plan directories. `SPEC.md` remains the tracked package
contract; local implementation plans record proposed work and verification evidence. They are
separate from the approved Markdown artifacts produced by `@orbis/plan`. The
[format research](implementation-plan-research.md) compares host defaults, published recipes, and Pi
package formats.

When implementation starts, run:

```sh
pnpm new:extension <name>
pnpm install
```

The scaffold accepts a new package name or an existing real directory containing a regular `SPEC.md`
file and optional `docs/research/`, `docs/tui-interactions.md`, and `implementation/`. In an
existing package, `docs` may contain only the real `research` directory and the regular
`tui-interactions.md` file, separately or together. The scaffold preserves specification,
interaction, research, and plan bytes and adds the runtime template. It rejects other existing
directory contents and linked package, `docs`, `research`, or `implementation` directories. For a
new directory, it includes the specification starter; complete that contract before replacing the
runtime example with package behavior.

## Maintain the contract

Use [verify-orbis-conformance](../.agents/skills/verify-orbis-conformance/SKILL.md) to review the
reference implementation against the SPEC and check that the SPEC describes its public behavior. An
explicit full-package review covers every requirement; `verify-changes` reviews affected contracts
and their interactions. Reviews use clone-available source, tests, and documentation. Ignored plans
and verification journals do not supply missing requirements or establish conformance.

Keep `SPEC.md` focused on required behavior and the README focused on the available reference
implementation. A specification does not establish that a feature is implemented or tested. State
implementation availability in the repository package index and package README.

Before changing package code, inspect the SPEC and identify affected requirements, including for
requests that do not mention specifications. Fixes within the contract preserve its requirements.
Changes within permitted implementation choices update the implementation and any required
documentation of those choices.

When requested behavior changes the contract, use
[revise-orbis-package](../.agents/skills/revise-orbis-package/SKILL.md) to amend the affected
requirements and scenarios before implementation, then update the plan, code, tests, and usage
documentation. Explicit user direction approves the behavior it specifies; material unanswered
decisions still need resolution. For interactive changes, keep `docs/tui-interactions.md` consistent
with the SPEC. Preserve requirement identifiers when their meaning is unchanged. Use version control
for previous revisions.

Within `verify-changes`, conformance reviewers report discrepancies without editing the contract or
implementation. The coordinator resolves authorized findings, uses the revision workflow for
approved contract changes, and reruns affected verification. Proposed amendments remain proposals
until the user authorizes their behavior; passing tests do not establish that authorization.

When code and a scenario disagree with a requirement, resolve the inconsistency against the approved
contract. A passing test does not authorize changing that contract. Follow the repository's runtime
verification and publication checks as well.

## References

The [research review](specification-research.md) compares Symphony, W3C guidance, Spec Kit,
OpenSpec, and executable specifications, alongside empirical studies of coding agents. Read it when
evaluating the specification workflow or template. It distinguishes published results, preprints,
and Orbis design recommendations.
