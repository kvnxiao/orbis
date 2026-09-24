# Package specifications

Each Orbis package has a `packages/<name>/SPEC.md` that defines its architecture and system behavior
for developers and coding agents building an independent Pi extension without reading the reference
implementation. A package that owns interactive terminal views also has `docs/tui-interactions.md`,
linked from the SPEC; the two documents together are the normative package contract. Research under
`docs/research/` and issue plans are informative: they explain and schedule the contract without
adding requirements. Orbis specifications and reference implementations are distributed under the
repository's [MIT license](../LICENSE).

## Specify a package

Write the specification before implementing a new package, and keep it current with approved
behavior afterwards. A package containing research and a specification without runtime files is not
an installable extension. Use the [specification starter](../templates/extension/SPEC.md) as writing
guidance and replace its instructional text with the package's contract. When research informs the
design, the [design-package](../.agents/skills/design-package/SKILL.md) skill persists its synthesis
in `packages/<name>/docs/research/` before the SPEC is written. Research documents cite external
sources and their inspected versions and do not reference Orbis implementation code.

Choose headings for the package's audience and responsibilities. A command may need a short
description and conformance scenarios. An interactive workflow may also need state transitions,
persistence rules, and interface contracts. Do not add empty sections to satisfy a universal table
of contents.

Every specification states:

- Its status, intended audience, purpose, and scope.
- Whether the described behavior is implemented. A specification does not establish that a feature
  is implemented or tested.
- Required observable behavior and applicable external contracts.
- Permitted implementation choices and boundaries.
- What a conforming implementation must satisfy, with scenarios linked to the requirements they
  verify.

Commands, tools, configuration, events, persisted artifacts, ordering rules, failure handling,
cancellation, and recovery belong in the specification when they affect the package's behavior.
Internal module names, file layouts, algorithms, dependency choices, and task decomposition belong
in implementation plans unless an external compatibility contract requires them. Exclude provenance,
review history, and verification journals; the one permitted record of abandoned ideas is the
[Explored alternatives](#explored-alternatives) section.

Declare which text defines conformance. The `REQ-<slug>` requirements and associated contract tables
define system behavior; the linked interaction document defines detailed UI behavior under the same
IDs. Label recommendations and illustrative examples separately; examples do not silently add
obligations. Research and background reading do not add requirements. Conformance scenarios verify
the requirements and must agree with them.

Distinguish an implementation-defined choice from an unresolved decision. For an
implementation-defined choice, state the allowed variation and require the implementation to
document its selection. A draft can contain unresolved questions; resolve those that affect a task
before implementing it. Do not let an agent infer answers from its own recommendation or the current
implementation.

Write requirements against Pi's public capabilities. Independent implementations must satisfy the
complete package contract, including the interfaces and workflows required by Orbis. Portability to
other hosts is outside the default contract. When an external API or format defines part of the
contract, identify the relevant capability and reference. State a version or compatibility boundary
when versions change the required behavior.

### Requirement identifiers

Assign requirements stable identifiers in the form `REQ-<behavior-slug>`: kebab-case, two to four
words, naming the behavior rather than its mechanism, and matching the requirement's title. Reject
ordinals, obligation verbs such as `must-`, implementation nouns such as a library name, and the
package's own name. Prefix with an area only to separate siblings, as in `REQ-review-cancellation`
beside `REQ-round-cancellation`. Identifiers are local to a package; cross-package references
include the package name. Keep requirement identifiers distinct from implementation task names.

Identifiers do not establish sequence or completeness. Document order, section headings, and the
conformance table define the reading path, and the requirement headings form the package index.
Order requirements by prerequisite knowledge and group related responsibilities within that order.

Keep each requirement focused on a behavior and its related conditions. State the trigger or
precondition, required result, and applicable failure behavior. Define exact values and formats when
compatibility depends on them. Avoid adjectives such as "fast" or "intuitive" as the sole acceptance
criterion.

### Requirement lifecycle

Every amendment resolves to one of these operations. Use version control for history; do not add
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
retired slug for different behavior. Amend the affected requirements and their conformance scenarios
before implementing changed behavior.

### Explored alternatives

A SPEC may contain one short informative section with this heading. List each idea explored or
trialed and abandoned during design, implementation, or dogfooding, one entry per idea: the idea,
the reason it was dropped, and optionally a link to the initiative issue comment that records the
decision. Later planning sessions read it before proposing approaches. Reconsider a recorded idea
only when new evidence or changed constraints invalidate its stated rejection reason; name what
changed. The current approved behavior and its approval requirements still apply. The section adds
no requirements and records no other history; the
[development workflow](development-workflow.md#decisions-and-local-evidence) defines where the full
decision records live.

## Terminal interaction document

Packages that own prompts, menus, forms, modals, or interactive terminal views must include
`docs/tui-interactions.md` and link it from `SPEC.md` as the normative interaction contract.
Commands that only execute an action or print output do not require an empty auxiliary file.

The SPEC owns system responsibilities, public interfaces, state, persistence, ordering, and recovery
guarantees. The interaction document owns detailed layout, appearance, labels, key mappings, focus,
and user flows under the same requirement IDs. Declare both documents normative and keep them
complete together for an independent implementer. Do not duplicate UI rules in the SPEC, and when
moving rules between the documents, preserve their meaning and verification obligations.

Document concrete scenarios with initial state, user actions, and observable outcomes. Include
Mermaid diagrams for branching or multistep flows. Cover failure and interruption as well as
successful completion, and reference the applicable `REQ-<slug>` identifiers. Label illustrative
examples separately. Do not impose a shared layout or keymap across packages.

Interaction headings name the interaction area alone and keep their anchors stable; a
`Requirements:` line in the section body lists the requirement IDs it defines. When a section gains
or loses a requirement, a heading that embeds requirement IDs breaks every inbound SPEC link.

When a UI has grouped values or configurable display variants, define its facets and scenarios in
prose, then record their concrete values in a table with facets or scenarios as rows. Add a column
for each mode or configuration; a single value column is sufficient when no matrix applies. Use the
table for symbol, color, label, and other UI values or implementation decisions instead of
enumerating those mappings in sentences.

## Define conformance

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
correctness. Passing the listed scenarios is evidence of conformance, not proof that every possible
input satisfies the contract. Keep execution results in test reports or implementation
documentation; the spec states the checks an implementation must satisfy.

## Avoid forward references

A specification must be understandable in document order without reading later sections, research,
or implementation source to decode the current passage. Its opening states the package's purpose,
audience, and scope in terms the audience already knows.

Before using a package-specific term, acronym, actor, state, artifact, interface, or named approach,
introduce its meaning and role. Put concepts shared by several sections in a short opening
explanation, and define a term used in one section at its first substantive use there. Introduce
each approach and its relevant constraints before comparing trade-offs, recommending it, or asking
the user to choose. Do not add a glossary of ordinary technical vocabulary or duplicate detailed
requirements in an overview.

Order sections by their knowledge prerequisites: shared concepts before the workflow, inputs and
states before their transitions, behavior before its exceptions and conformance scenarios, with
related responsibilities grouped within that order. When concepts depend on each other, explain
their relationship together before their separate rules. A forward link may offer optional detail;
it must not replace an explanation needed to understand the current passage. Before linking to
another contract document, identify its subject and explain the shared concepts locally.

Before drafting or amending, identify the concepts each planned section assumes and place their
introductions first. When revising, check earlier passages affected by a new or changed definition.
Before delivery, read the SPEC and each changed interaction section from top to bottom without
following forward links and check that:

- Every specialized term has a definition before or at its first substantive use.
- Every comparison introduces its alternatives and decision criteria before evaluating them.
- Every procedure, table, and scenario follows the concepts, inputs, and states it assumes.
- Every requirement reference follows the explanation needed to understand the reference.
- Reordering preserves requirement IDs, obligations, exceptions, and linked heading anchors.

For a failed check, name the earliest dependent passage and move its prerequisite earlier or add the
missing introduction. A terminology search locates uses; it does not establish that a reader can
understand them.

## Related workflow

- [design-package](../.agents/skills/design-package/SKILL.md) researches and writes a new SPEC.
  [revise-package](../.agents/skills/revise-package/SKILL.md) amends an existing one, including
  [code that drifted from its contract](../.agents/skills/revise-package/SKILL.md#reconcile-an-iterated-implementation).
- [plan-implementation](../.agents/skills/plan-implementation/SKILL.md) derives issue plans from an
  approved SPEC in the
  [issue plan format](../.agents/skills/plan-implementation/references/plan-format.md).
- [verify-conformance](../.agents/skills/verify-conformance/SKILL.md) reviews an implementation
  against the contract. A full-package review covers every requirement; within `verify-changes` it
  covers the affected requirements and their interactions with unchanged behavior.
- The development workflow's
  [design and PR boundaries](development-workflow.md#design-and-pr-boundaries) define SPEC-only and
  combined PRs, [Add an extension](../CONTRIBUTING.md#add-an-extension) describes the scaffold, and
  [README guidance](readme-guidelines.md) covers package READMEs.

## References

The [research review](specification-research.md) compares Symphony, W3C guidance, Spec Kit,
OpenSpec, and executable specifications, alongside empirical studies of coding agents. Read it when
evaluating the specification workflow or template. It distinguishes published results, preprints,
and Orbis design recommendations.
