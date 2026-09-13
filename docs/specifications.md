# Package specifications

Each Orbis package has a `packages/<name>/SPEC.md` that defines its architecture and system
behavior. The specification is written for developers and coding agents building an independent Pi
extension without reading the reference implementation. Orbis specifications and reference
implementations are distributed under the repository's [MIT license](../LICENSE).

## Avoid forward references

A specification must be understandable in document order without reading later sections, research,
or implementation source to decode the current passage. Its opening states the package's purpose,
audience, and scope in terms the audience already knows.

Before using a package-specific term, acronym, actor, state, artifact, interface, or named approach,
introduce its meaning and role. Define a local term at first use; put concepts shared by several
sections in a short opening explanation. Introduce each approach and its relevant constraints before
comparing trade-offs, recommending it, or asking the user to choose. Do not add a glossary of
ordinary technical vocabulary or duplicate detailed requirements in an overview.

Order sections by their knowledge prerequisites. Establish the shared concepts before describing the
workflow, define inputs and states before their transitions, and state behavior before its
exceptions and conformance scenarios. Group related responsibilities within that order. When
concepts depend on each other, explain their relationship together before their separate rules. Use
package-specific headings; this is a reading-order rule, not a mandatory outline.

A forward link may offer optional detail. It must not replace an explanation needed to understand
the current passage. Before linking to another contract document, identify its subject and explain
the shared concepts locally. Keep detailed rules in their authoritative document.

Before delivery, read the SPEC and each changed interaction section from top to bottom without
following forward links. Check that:

- Every specialized term has a definition before or at its first substantive use.
- Every comparison introduces its alternatives and decision criteria before evaluating them.
- Every procedure, table, and scenario follows the concepts, inputs, and states it assumes.
- Every requirement reference follows the explanation needed to understand the reference.
- Reordering preserves requirement IDs, obligations, exceptions, and linked heading anchors.

For a failed check, name the earliest dependent passage and move its prerequisite earlier or add the
missing introduction. A terminology search helps locate uses; it does not establish that a reader
can understand them.

## Specify a package

When research informs a package design, persist its synthesis in `packages/<name>/docs/research/`
before writing `SPEC.md`. Research docs are optional for simple packages with settled behavior, such
as `exit`. Include source links, relevant versions, findings, design implications, and evidence
gaps. Update the synthesis as research continues. Research informs the contract; it does not
independently define requirements.

Package research documents cite external sources and their inspected versions. They do not reference
Orbis implementation code. Implementation details belong in the package contract or local
implementation plans.

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

Assign requirements stable identifiers in the form `REQ-<behavior-slug>`: kebab-case, two to four
words, naming the behavior rather than its mechanism. The slug matches the requirement's title; the
requirement headings form the package index. Reject ordinals, obligation verbs such as `must-`,
implementation nouns such as a library name, and the package's own name. Prefix with an area only to
separate siblings, as in `REQ-review-cancellation` beside `REQ-round-cancellation`. Identifiers are
local to a package; cross-package references include the package name. Keep requirement identifiers
distinct from implementation task names.

Order requirements by prerequisite knowledge, grouping related responsibilities within that order.
Descriptive identifiers name the behavior; requirement text defines its conditions and outcomes.
Document order, section headings, and the conformance table define the reading path. Identifiers do
not establish sequence or completeness.

Keep each requirement focused on a behavior and its related conditions. State the trigger or
precondition, required result, and applicable failure behavior. Define exact values and formats when
compatibility depends on them. Avoid adjectives such as "fast" or "intuitive" as the sole acceptance
criterion.

Declare which text defines conformance. The SPEC's `REQ-<slug>` requirements and associated contract
tables define system behavior; its linked normative interaction document defines detailed UI
behavior under the same IDs. Label recommendations and illustrative examples separately; examples do
not silently add obligations. Conformance scenarios verify the requirements and must agree with
them.

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
reference the applicable `REQ-<slug>` identifiers.

Interaction headings name the interaction area alone and keep their anchors stable; a
`Requirements:` line in the section body lists the requirement IDs it defines. When a section gains
or loses a requirement, a heading that embeds requirement IDs breaks every inbound SPEC link.

The SPEC owns system responsibilities, public interfaces, state, persistence, ordering, and recovery
guarantees. The linked interaction document owns detailed layout, appearance, labels, key mappings,
focus, and user flows. Declare both documents normative and keep them complete together for an
independent implementer. Avoid duplicating UI rules in the SPEC; link the relevant sections under
stable requirement IDs. When moving rules, preserve their meaning and verification obligations.

The interaction document states required behavior and supplies scenarios that exercise it. Label
illustrative examples separately. Do not impose a shared layout or keymap across packages. Keep the
system and interaction contracts consistent and separate from research synthesis and execution logs.
When a UI has grouped values or configurable display variants, define its facets and scenarios in
prose, then record their concrete values in a table with facets or scenarios as rows. Add a column
for each mode or configuration; a single value column is sufficient when no matrix applies. Use the
table for symbol, color, label, and other UI values or implementation decisions instead of
enumerating those mappings in sentences. The design workflow checks the document's existence, SPEC
link, scenario coverage, and agreement with system guarantees before reporting completion.

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

The package scaffold does not create plan directories. `SPEC.md` and its linked interaction document
remain the tracked package contract; local implementation plans record proposed work and
verification evidence. They are separate from the approved Markdown artifacts produced by
`@orbis/plan`. The [format research](implementation-plan-research.md) compares host defaults,
published recipes, and Pi package formats.

When implementation starts, run:

```sh
just new <name>
just install
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
reference implementation against the SPEC and linked interaction contract and check that they
describe its public behavior. An explicit full-package review covers every requirement;
`verify-changes` reviews affected contracts and their interactions. Reviews use clone-available
source, tests, and documentation. Ignored plans and verification journals do not supply missing
requirements or establish conformance.

Keep `SPEC.md` focused on architecture and system behavior and `docs/tui-interactions.md` on
detailed UI behavior and appearance. State implementation availability in the SPEC; a specification
does not establish that a feature is implemented or tested. Follow
[README guidance](readme-guidelines.md) for package discovery, installation, and first use. Keep
temporary publication and implementation-progress notices out of READMEs.

Before changing package code, inspect the SPEC and linked interaction contract and identify affected
requirements, including for requests that do not mention specifications. Fixes within the contract
preserve its requirements. Changes within permitted implementation choices update the implementation
and any required documentation of those choices.

When requested behavior changes the contract, use
[revise-orbis-package](../.agents/skills/revise-orbis-package/SKILL.md) to amend the affected
requirements and scenarios before implementation, then update the plan, code, tests, and usage
documentation. Explicit user direction approves the behavior it specifies; material unanswered
decisions still need resolution. For interactive changes, keep `docs/tui-interactions.md` consistent
with the SPEC. Use version control for previous revisions.

Within `verify-changes`, conformance reviewers report discrepancies without editing the contract or
implementation. The coordinator resolves authorized findings, uses the revision workflow for
approved contract changes, and reruns affected verification. Proposed amendments remain proposals
until the user authorizes their behavior; passing tests do not establish that authorization.

When code and a scenario disagree with a requirement, resolve the inconsistency against the approved
contract. A passing test does not authorize changing that contract. Follow the repository's runtime
verification and publication checks as well.

### Requirement lifecycle

Every amendment resolves to one of these operations. Use version control for history. Do not add
retirement ledgers, redirect tables, or renamed-identifier notes to the SPEC.

| Operation                                 | Rule                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Meaning unchanged                         | The slug persists verbatim.                                                                    |
| Meaning refined, behavior identity intact | The slug persists; only the requirement text changes.                                          |
| Behavior split                            | Preserve the slug for the dominant part. Assign each separated behavior a new slug.            |
| Behaviors merged                          | The surviving slug is the one that still describes the merged behavior; the other retires.     |
| Behavior defunct                          | Retire the slug and delete its requirement, conformance rows, and interaction references.      |
| Slug contradicts the behavior it names    | Rename it. Rename for a wrong name, never for tidiness or consistency with a neighboring slug. |

A retired or renamed slug leaves dangling references in tracked Markdown. Before finishing the
change set, sweep the package with `rg 'REQ-<old-slug>'` and resolve every hit. Do not reuse a
retired slug for different behavior.

### Reconcile an iterated implementation

When iteration lands in code before the contract is updated, the SPEC describes an earlier package.
When the user requests whole-package reconciliation, `revise-orbis-package` reviews the accumulated
drift in one pass. Scoped revisions reconcile affected requirements and report unrelated drift
separately. Enumerate current public behavior from source, tests, the README, and the interaction
document. Map each behavior to every applicable requirement, then classify every requirement and
uncovered behavior in scope:

| Finding                                                       | Action                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Code implements the requirement and the contract describes it | Verify the wording and keep the slug.                                                           |
| Code implements it differently and the user authorizes that   | Amend the requirement text and keep the slug.                                                   |
| Code implements behavior that no slug claims                  | Mint a slug, write the requirement and its conformance check, and have the behavior authorized. |
| No code implements it and the behavior is abandoned           | Retire the slug under the lifecycle rules.                                                      |
| No code implements it and the behavior is still wanted        | Keep the slug and record it as unimplemented.                                                   |

Existing code is evidence of implementation, not approval of behavior. Minting and retirement both
need a user decision; an absent implementation alone does not retire a requirement. Report the
minted, amended, retired, and unchanged slugs.

## References

The [research review](specification-research.md) compares Symphony, W3C guidance, Spec Kit,
OpenSpec, and executable specifications, alongside empirical studies of coding agents. Read it when
evaluating the specification workflow or template. It distinguishes published results, preprints,
and Orbis design recommendations.
