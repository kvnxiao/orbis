# @orbis/example specification

Status: Draft; requirements not yet defined. Implementation: not started.

Replace this starter with the package contract before implementing behavior, following the
[specification guide](../../docs/specifications.md). Write for someone implementing the package from
this document and its linked interaction contract without reading the reference source. Choose
headings that fit the package; the headings below are a starting point.

## Purpose

Describe the user problem, intended audience, Pi integration, and scope. State exclusions that
define the package's responsibility.

## Concepts and workflow

Introduce package-specific terms, actors, states, artifacts, and interfaces before requirements use
them, and explain how they relate in the ordinary workflow. For a small package, put these
introductions in the purpose section instead. The guide's
[reading-order rules](../../docs/specifications.md#avoid-forward-references) apply to the whole
document.

## Required behavior

Define observable behavior and any commands, tools, events, configuration, persistent artifacts,
ordering constraints, and failure cases the package needs. Identify each requirement by a
[`REQ-<behavior-slug>` identifier](../../docs/specifications.md#requirement-identifiers) and change
identifiers only through the
[requirement lifecycle](../../docs/specifications.md#requirement-lifecycle). Declare requirement
text and contract tables mandatory; label illustrative examples and recommendations separately.
State which choices an independent implementation may make and must document, and record unresolved
decisions separately from permitted choices.

For prompts, menus, forms, modals, or interactive terminal views, link `docs/tui-interactions.md` as
the normative contract for detailed appearance, labels, key mappings, focus, and user flows, as the
guide's [terminal interaction document](../../docs/specifications.md#terminal-interaction-document)
section requires.

## Conformance

State that conformance requires every mandatory requirement, including every required interface.
Link each `REQ-<slug>` to a check with an initial state or input, an action, and an observable
expected result, including applicable cancellation, invalid-input, ordering, and recovery cases, and
identify checks that require real Pi or user interaction. Derive expected results from the contract,
not from the implementation.

## Explored alternatives

Optional. List each idea explored or trialed and abandoned, one entry per idea, with the reason it
was dropped and an optional link to the initiative issue comment that records the decision. Remove
this section while the package has no abandoned ideas.
