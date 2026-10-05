# Package specifications

Each Orbis package has a `packages/<name>/SPEC.md` that defines its architecture and system behavior
for developers and coding agents building an independent Pi extension without reading the reference
implementation. The SPEC states requirements, each named by a `REQ-<behavior-slug>` identifier, and
conformance scenarios that show how to observe each requirement. A package that owns interactive
terminal views also has `docs/tui-interactions.md`, linked from the SPEC; the two documents together
are the normative package contract. Research under `docs/research/` and issue plans are informative:
they explain and schedule the contract without adding requirements. Orbis specifications and
reference implementations are distributed under the repository's MIT license.

## Specify a package

Write the specification before implementing a new package, and keep it current with approved
behavior afterwards. `just new <name>` adds runtime files only to a package whose `SPEC.md` exists;
a package containing research and a specification without runtime files is not an installable
extension. Before drafting, plan the reading order as
[Avoid forward references](#avoid-forward-references) describes.

Choose headings for the package's audience and responsibilities. A command may need a short
description and conformance scenarios. An interactive workflow may also need state transitions,
persistence rules, and interface contracts. Do not add empty sections to satisfy a universal table
of contents. This outline is a starting point:

| Section               | Contents                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title and status      | `# @orbis/<name> specification`, then a `Status:` line stating approval and implementation                                                                                 |
| Purpose               | The user problem, audience, Pi integration, scope, and exclusions                                                                                                          |
| Concepts and workflow | Package-specific terms, actors, states, artifacts, and interfaces, introduced before requirements use them; a small package puts them in its purpose                       |
| Required behavior     | [Requirements](#requirement-identifiers) with triggers, results, failures, and permitted choices, and a link to any [interaction document](#terminal-interaction-document) |
| Conformance           | A check for each requirement, as [Define conformance](#define-conformance) describes                                                                                       |
| Explored alternatives | [Optional](#explored-alternatives): ideas the design rejected or abandoned                                                                                                 |
| Supporting evidence   | [Required when the package has research](#supporting-evidence): a link to `docs/research/README.md`, with optional rows from requirements to research                      |
| References            | Optional: external contracts, such as Pi API documentation                                                                                                                 |

Every specification states:

- Its status, intended audience, purpose, and scope.
- Whether the described behavior is implemented. A specification does not establish that a feature
  is implemented or tested.
- Required observable behavior and applicable external contracts.
- Permitted implementation choices and boundaries.
- What a conforming implementation must satisfy, with scenarios linked to the requirements they
  verify.

Place each kind of content by its role:

- Commands, tools, configuration, events, persisted artifacts, ordering rules, failure handling,
  cancellation, and recovery belong in the specification when they affect the package's behavior.
- Internal module names, file layouts, algorithms, dependency choices, and task decomposition belong
  in implementation plans unless an external compatibility contract requires them.
- Provenance, review history, and verification journals do not belong in the specification. Its one
  permitted record of abandoned ideas is the optional
  [Explored alternatives](#explored-alternatives) section, and the
  [Supporting evidence](#supporting-evidence) section links requirements to package research.

Declare which text defines conformance. The `REQ-<behavior-slug>` requirements, including any tables
they reference, define system behavior; the linked interaction document defines detailed UI behavior
under the same IDs. Label recommendations and illustrative examples separately; examples do not
silently add obligations. Research and background reading do not add requirements. Conformance
scenarios verify the requirements and must agree with them.

Distinguish an implementation-defined choice from an unresolved decision:

- For an implementation-defined choice, state the allowed variation and require the implementation
  to document its selection.
- A draft can contain unresolved questions. Resolve those that affect a task before implementing it.
  Do not let an agent infer answers from its own recommendation or the current implementation.
- When a design change is approved, update all affected requirements and scenarios together, and
  remove the open questions it resolves in that update.

Write requirements against Pi's public capabilities. Independent implementations must satisfy the
complete package contract, including the interfaces and workflows required by Orbis. Portability to
other hosts is outside the default contract. When an external API or format defines part of the
contract, identify the relevant capability and reference. State a version or compatibility boundary
when versions change the required behavior. When a SPEC names the Pi release whose public
capabilities the contract was checked against, present it as a reference baseline, not a minimum
version.

### Requirement identifiers

Assign each requirement a stable identifier in the form `REQ-<behavior-slug>`:

- Use kebab-case and two to four words that name the behavior rather than its mechanism and match
  the requirement's title.
- Reject ordinals, obligation verbs such as `must-`, implementation nouns such as a library name,
  and the package's own name.
- Prefix with an area only to separate siblings, as in `REQ-review-cancellation` beside
  `REQ-round-cancellation`.
- Identifiers are local to a package; cross-package references include the package name.
- Keep requirement identifiers distinct from implementation task names.

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
change set, sweep the package with `rg -i 'req-<old-slug>'`, which also matches heading anchors, and
resolve every hit. Do not reuse a retired slug for different behavior. Amend the affected
requirements and their conformance scenarios before implementing changed behavior.

### Explored alternatives

This short informative section is optional. Include it whenever the design rejected an option. List
each idea explored or trialed and abandoned during design, implementation, or dogfooding, with one
entry per idea. Each entry gives the idea, the reason it was dropped, and optionally a link to the
issue comment that records the decision. Later planning sessions read it before proposing
approaches. Reconsider a recorded idea only when new evidence or changed constraints invalidate its
stated rejection reason; name what changed. The current approved behavior and its approval
requirements still apply. The section does not add requirements or record other history; the full
decision records live outside the SPEC.

### Supporting evidence

A SPEC whose package has research under `docs/research/` ends with one informative section with this
heading. The section first links the research index, `docs/research/README.md`. Add a row for a
requirement when readers need to trace it to research, with these columns:

- A link to the requirement.
- Links to its supporting research. Prefix a link with `**Observed in <version or conditions>:**`
  when the linked finding was inspected, probed, or measured at that version and can be rechecked;
  leave a link to reasoning or to others' claims unmarked.
- The outcome that the linked research does not establish.

Keep findings and comparisons in the research documents and link to them rather than restating them.
The section does not add requirements. When a requirement is added, renamed, or retired, add,
relink, or delete its row in the same change. When later research establishes an open outcome, link
that research and remove the open item; keep the results in the research document. List external
contracts, such as Pi API documentation, in an optional References section instead.

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
successful completion, and reference the applicable `REQ-<behavior-slug>` identifiers. Label
illustrative examples separately. Do not impose a shared layout or keymap across packages.

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
the developer to choose. Do not add a glossary of ordinary technical vocabulary or duplicate
detailed requirements in an overview.

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

## References

The research review in `docs/research/specifications.md` compares Symphony, W3C guidance, Spec Kit,
OpenSpec, and executable specifications, alongside empirical studies of coding agents. Read it when
evaluating the specification workflow or this guide. It distinguishes published results, preprints,
and Orbis design recommendations.
