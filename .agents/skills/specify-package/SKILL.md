---
name: specify-package
description:
  Design a new Orbis Pi extension or change an existing package's contract with the developer
  through the global brainstorm skill, then write its SPEC.md, any terminal interaction document,
  and any research. Use when starting or continuing a SPEC, when a request changes package behavior,
  or when code drifted from its SPEC.
---

# Specify an Orbis package

This skill produces an approved package contract: `packages/<name>/SPEC.md`, any linked
`docs/tui-interactions.md`, and any research behind them. It starts a new or unfinished SPEC, amends
an existing one, or reconciles a SPEC with code that changed first. It stops at the approved
contract; `work-issue` routes planning, implementation, and verification, and approving a contract
does not authorize implementing it.

## 1. Establish the baseline

1. Read the [specification guide](../../../docs/specifications.md). For an existing package, read
   its complete SPEC and interaction document, and the README, source, and tests the request
   affects.
2. Read the SPEC's Explored alternatives section and apply the guide's
   [reconsideration rule](../../../docs/specifications.md#explored-alternatives). Before proposing
   options on a recorded topic, read its decision records under
   [records.md](../../shared/records.md).
3. Keep a package-delivery epic open after design approval, and do not create implementation
   children for unsettled behavior.
4. For an existing package, map the request to the affected requirement IDs, conformance scenarios,
   and interactions with unchanged behavior, and classify each affected behavior:

   | Situation                                                     | Action                                                            |
   | ------------------------------------------------------------- | ----------------------------------------------------------------- |
   | Code violates an approved requirement                         | Return `Done` with the required fix; the contract does not change |
   | The change stays within a permitted implementation choice     | Return `Done`; the implementation documents its choice            |
   | The request changes observable behavior or prescribed visuals | Amend the contract through steps 2–6                              |
   | The contract is missing, conflicting, or ambiguous            | Settle the missing decision through steps 2–6                     |

   Keep unrelated deviations separate from the request. A reorder or rewording of documentation
   preserves requirement IDs, behavior, and linked heading anchors, applies the guide's
   [forward-reference checks](../../../docs/specifications.md#avoid-forward-references), and needs
   no amendment.

## 2. Research the facts

Before proposing options, research the facts that can change them: current Pi packages and official
Pi APIs, and other coding agents when the requested experience makes them relevant. Use primary
documentation and source, and do not turn a design into an exhaustive market survey. Finish the
relevant research before a decision round, and ask the developer for preferences, not facts. If
online research is unavailable, report the gap and defer the decisions that need the missing
evidence.

## 3. Reconcile code that changed first

Skip this step unless code changed before its contract. Enumerate current public behavior from the
source, tests, README, and interaction document: commands, tools, configuration, events, persisted
artifacts, ordering rules, and user-visible failures. Map each behavior to its requirements, then
propose one action for each requirement or uncovered behavior:

| Finding                                                   | Proposal                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Code implements the requirement as the contract states it | Keep the slug                                               |
| Code differs and the developer approves the difference    | Amend the requirement text and keep the slug                |
| Code implements behavior that no slug claims              | Mint a slug with a requirement and conformance scenario     |
| No code implements it and the behavior is abandoned       | Retire the slug                                             |
| No code implements it and the behavior is still wanted    | Keep the slug, and record it as unimplemented in the status |

For a scoped revision, reconcile only the affected requirements and report unrelated drift
separately. Minting and retiring need the developer's decision; an absent implementation does not
retire a requirement.

## 4. Settle the decisions

Use the global `brainstorm` skill for every decision round, including proposed mints and
retirements. Keep the package focused on the developer's intended responsibility. Explore commands,
skills, model-callable tools, UI, persistence, and events only where they apply, and let current
requirements outweigh portability and hypothetical consumers. A request to improve an experience
does not settle its submission, cancellation, or persistence behavior.

For a
[terminal interaction document](../../../docs/specifications.md#terminal-interaction-document), walk
through the interactions with the developer:

- Resolve focus, navigation, text entry, confirmation versus submission, back and cancel, recovery,
  and narrow-terminal, resize, and SSH behavior where relevant.
- Distinguish highlighted controls, local drafts, submitted input, and completed actions.
- Cover failure and interruption as well as successful completion.
- Do not infer an interaction from a proposed widget or hotkey, and do not impose another package's
  keybindings, layout, or approval workflow.

## 5. Confirm the complete design

When no decision remains open, present the integrated design: scope, behavior and interfaces, state
and lifecycle, failure and recovery, limits, verification, and explicit deferrals. Ask the developer
to confirm it, and wait.

## 6. Write the research and the contract

1. Settle the package name before choosing its path.
2. Save the research worth keeping under [research-format.md](references/research-format.md) before
   writing or amending the SPEC. Create `packages/<name>/docs/research/` directly, without
   scaffolding runtime files. When revising, save new findings before editing the contract, and do
   not reconstruct missing evidence from memory. A simple, settled package needs no research.
3. Write or amend the SPEC under the guide's
   [Specify a package](../../../docs/specifications.md#specify-a-package) section:
   - Update all affected requirements and conformance scenarios together, and remove the open
     questions they resolve.
   - Change identifiers only under the
     [requirement lifecycle](../../../docs/specifications.md#requirement-lifecycle), including its
     reference sweep after a retirement or rename.
   - Add each rejected or abandoned option to
     [Explored alternatives](../../../docs/specifications.md#explored-alternatives).
   - When the package has research, keep the
     [Supporting evidence](../../../docs/specifications.md#supporting-evidence) section current.
   - Describe observable behavior without prescribing internal files or algorithms, write original
     prose, and cite the external contracts implementers need.
4. Record agreed interactions in `docs/tui-interactions.md`, and check that the SPEC links it and
   that its scenarios, requirement references, and diagrams match the requirements.
5. Apply the forward-reference checks to earlier uses of each new or changed definition.
6. Do not create runtime stubs or plan directories to hold a specification.

## 7. Record the decisions

For issue-backed work, publish one consolidated decision record under
[records.md](../../shared/records.md).

## Return

- `Done`: the developer approved the contract and its files are saved, or step 1 found that the
  request needs no contract change and proceeds as a fix or permitted choice within the approved
  contract. Report the paths, changed requirement IDs, explicit deferrals, and verification limits.
  For a reconciliation, report the minted, amended, retired, and unchanged slugs.
- `Needs a plan`: implementation is authorized, and the issue's plan does not cover the amended
  contract. Report the amended requirement IDs.
- `Blocked`: approval of the complete design, a developer decision, or unavailable evidence is
  outstanding. Report what resolves it.
