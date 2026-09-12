# @orbis/example specification

Status: Draft; requirements not yet defined.

Replace this starter with the package contract before implementing behavior. Write for someone
implementing the package from this document and its linked interaction contract without reading the
reference source. Choose headings that fit the package; the headings below are a starting point.

## Purpose

Describe the user problem, intended audience, Pi integration, and scope. State exclusions that
define the package's responsibility.

## Required behavior

Define observable behavior and any commands, tools, events, configuration, persistent artifacts,
ordering constraints, and failure cases the package needs. Identify each requirement by a behavior
slug, such as `REQ-planning-entry`, `REQ-approval-event`, or `REQ-recoverable-failures`: kebab-case,
two to four words, matching the requirement's title and naming the behavior rather than its
mechanism. Reject ordinals, obligation verbs, library names, and the package name. These identifiers
are local to the package and remain stable when task names, implementation plans, or the document's
own order change. Keep each requirement focused on a behavior and its related conditions: state the
precondition or trigger, required result, and applicable failure path.

A slug implies no sequence, so section headings and document order define the reading path. Amend
requirements through the lifecycle rules in the specification guidance: keep the slug when the
behavior's identity survives, mint one for separated behavior, retire one for defunct behavior, and
rename only a slug that contradicts what it names.

Declare that requirement text and associated contract tables are mandatory. Label illustrative
examples and recommendations separately. Reference external contracts and relevant version
boundaries when compatibility depends on them.

State which choices an independent implementation may make and must document. Record unresolved
decisions separately from permitted choices; resolve decisions that affect an implementation task
before starting it.

Keep architecture, responsibilities, public interfaces, state, and lifecycle guarantees here. For
prompts, menus, forms, modals, or interactive terminal views, link `docs/tui-interactions.md` as the
normative contract for detailed appearance, labels, key mappings, focus, and user flows. Use the
same requirement IDs, add scenarios and branching or multistep diagrams, and label illustrative
examples. Headings in that document name the interaction area alone and keep stable anchors; list
the requirement IDs a section defines in a `Requirements:` line inside its body. The documents must
define the complete contract together without duplicating detailed UI rules. Commands that only
execute an action or print output do not need an empty interaction file.

## Conformance

State that conformance requires every mandatory requirement, including every required interface. A
completed implementation task establishes only its covered behavior.

Link each `REQ-<slug>` to a check with an initial state or input, an action, and an observable
expected result. Include applicable cancellation, invalid-input, ordering, and recovery cases.
Identify checks that require real Pi or user interaction. Use inline scenarios or a table
appropriate to the package.

Derive expected results from the contract independently of implementation details. Passing scenarios
supplies evidence of conformance; it does not prove correctness for every possible input. Record
actual test results and verification gaps in implementation documentation or reports.
