# @orbis/example specification

Status: Draft; requirements not yet defined.

Replace this starter with the package contract before implementing behavior.
Write for someone implementing the package from this document without reading
the reference source. Choose headings that fit the package; the headings below
are a starting point.

## Purpose

Describe the user problem, intended audience, Pi integration, and scope.
State exclusions that define the package's responsibility.

## Required behavior

Define observable behavior and any commands, tools, events, configuration,
persistent artifacts, ordering constraints, and failure cases the package needs.
Identify each requirement as `REQ-001`, `REQ-002`, and so on. These identifiers are
local to the package and remain stable when task names or implementation plans
change. Keep each requirement focused on a behavior and its related conditions:
state the precondition or trigger, required result, and applicable failure path.

Declare that requirement text and associated contract tables are mandatory. Label
illustrative examples and recommendations separately. Reference external contracts
and relevant version boundaries when compatibility depends on them.

State which choices an independent implementation may make and must document.
Record unresolved decisions separately from permitted choices; resolve decisions
that affect an implementation task before starting it.

For prompts, menus, forms, modals, or interactive terminal views, define the
required interaction behavior here and link `docs/tui-interactions.md`. Write that
file with user scenarios, observable outcomes, and Mermaid diagrams for branching
or multistep flows. Reference the requirements without adding hidden obligations.
Commands that only execute an action or print output do not need an empty file.

## Conformance

State that conformance requires every mandatory requirement, including every
required interface. A completed implementation task establishes only its covered
behavior.

Link each `REQ-###` to a check with an initial state or input, an action, and an
observable expected result. Include applicable cancellation, invalid-input,
ordering, and recovery cases. Identify checks that require real Pi or user
interaction. Use inline scenarios or a table appropriate to the package.

Derive expected results from the contract independently of implementation details.
Passing scenarios supplies evidence of conformance; it does not prove correctness
for every possible input. Record actual test results and verification gaps in
implementation documentation or reports.
