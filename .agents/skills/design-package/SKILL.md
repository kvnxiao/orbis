---
name: design-package
description:
  Research and collaboratively design an Orbis Pi extension, then write its package SPEC.md. Use
  when brainstorming a new package or revising its design before implementation.
---

# Brainstorm an Orbis package

Develop the package design with the developer, save any research synthesis, and write
`packages/<name>/SPEC.md` for an independent Pi implementer. This workflow produces research and a
specification; implementing the extension is a separate task unless the developer explicitly
includes it.

When the global `brainstorm` skill is available, load its advertised `SKILL.md` and use it for the
brainstorming interaction: decision-tree rounds, question format, factual research delegation, and
confirmation of shared understanding. Resolve it through the host's available skills rather than a
machine-specific path, and keep this skill's Orbis research, contract, and delivery
responsibilities. [Work the design tree](#work-the-design-tree) defines the fallback interaction.

For issue-backed PR work, follow the
[brainstorm publication policy](../../../docs/development-workflow.md#publish-brainstorm-records)
with either interaction method. Apply the
[full-design approval gate](../../../docs/development-workflow.md#approve-the-complete-design-before-edits)
before repository edits or decision publication. Read relevant prior decisions before exploring a
topic again. When composing a brainstorm checkpoint, load the
[record guide and example](../work-issue/references/brainstorm-records.md).

## Establish context and research

When the intended outcome can be named, create or reuse an issue at the appropriate scope under the
workflow's [work hierarchy](../../../docs/development-workflow.md#work-hierarchy),
[issue labels](../../../docs/development-workflow.md#issue-labels), and
[design and PR boundaries](../../../docs/development-workflow.md#design-and-pr-boundaries). Add it
to the Project. Keep provisional decisions in chat or private scratch until full-design approval.
A package-delivery epic remains open after design approval; a design-only issue has its own design
deliverable. Do not create implementation children for unsettled behavior.

Read the [specification guidance](../../../docs/specifications.md) and the repository `README.md`.
When the request concerns an existing package, inspect its specification and source. Read its
`Explored alternatives` section when present and apply the guide's
[reconsideration rule](../../../docs/specifications.md#explored-alternatives). Preserve the
developer's settled requirements, exclusions, and prior decisions.

Before proposing an architecture, research current relevant Pi packages and official Pi APIs when
those facts can affect the design. Use primary documentation and source to compare actual behavior,
installation requirements, maintenance signals, integration boundaries, and missing capabilities.
Distinguish a shipped feature from an example or proposal, and source inspection from runtime
verification. Download counts are dated adoption signals, not evidence of quality or community
consensus.

Compare other coding agents when the developer's requested experience makes them relevant. Do not
turn every brainstorm into an exhaustive market survey. Focus research on facts that can change the
available choices. Use bounded factual subagents when available; otherwise research directly. Wait
for relevant factual work before presenting the decision round. Ask the developer for preferences
and constraints, not facts available in the repository or documentation. When online research is
unavailable, report the gap and continue from installed documentation and verified local context;
defer decisions that require missing evidence.

## Work the design tree

Keep the package focused on the developer's intended responsibility. Explore relevant boundaries
such as commands, skills, model-callable tools, UI, persistence, and events without assuming every
package needs all of them. Let current requirements determine conformance; portability and
hypothetical consumers are secondary unless the developer asks for them.

When the global `brainstorm` skill is unavailable or unreadable, state that limitation and use the
fallback interaction below; do not require installation or stop package design.

Map decisions and their prerequisites. Keep developer decisions, proposals, and open questions
distinct. The frontier is the set of unresolved decisions the developer can answer now without
guessing an answer to another open question. Before comparing approaches or presenting a decision,
introduce the terminology, each approach, and the constraints needed to assess it.

Present the whole frontier in one numbered round. Explain the trade-offs, offer two to four
meaningful options when alternatives exist, and put the recommended option first with its reason.
Consider an unconventional option when it serves the problem; do not manufacture choices to fill a
quota. Use a structured question tool when available, or numbered questions in chat. Then wait for
the developer's answers.

After a reply, preserve settled choices in chat or private scratch and recompute the frontier.
Defer dependent decisions to the next round. A recommendation or an unanswered question is not a
developer decision. Research new factual gaps before asking the next round; wait for complete-design
confirmation before editing or publishing.

## Explore terminal interactions

When the package owns prompts, menus, forms, modals, or interactive terminal views, it requires
`docs/tui-interactions.md` as the guide's
[terminal interaction document](../../../docs/specifications.md#terminal-interaction-document)
section defines it. Before confirming the design, walk through its user interactions with the
developer. Resolve focus, navigation, text entry, confirmation versus submission, back and cancel
behavior, recovery, and relevant narrow-terminal, resize, and SSH behavior. Distinguish highlighted
controls, local drafts, submitted input, and completed actions. Explore failure and interruption
paths as well as successful completion; do not infer an interaction merely from a proposed widget or
hotkey.

After full-design approval, record the agreed interactions in the document and its examples. Do not
impose another package's keybindings, modal layout, or approval workflow. Before reporting
completion, check that the document exists, the SPEC links to it, and its scenarios cover the agreed
flows and match the requirements.

## Confirm the complete design

When the frontier is empty, present the integrated design and obtain confirmation under the
[full-design approval gate](../../../docs/development-workflow.md#approve-the-complete-design-before-edits).
An answer selecting an individual option does not confirm the complete design. Existing explicit
approval of the complete requested scope is sufficient; do not request it again.

## Persist the research synthesis

After full-design approval, save any research synthesis as Markdown in
`packages/<name>/docs/research/` before writing any `SPEC.md`, including a draft or starter. Create
that directory directly without scaffolding runtime files. If the package name is undecided, settle
it before choosing the package path or writing the spec. A simple, settled package may not need
research documents; do not create an empty folder or ceremonial report.

Use descriptive topic filenames and a structure appropriate to the research. Record the research
date, questions investigated, source links and relevant versions, verified findings, comparisons,
implications for this package, and remaining gaps. Synthesize the evidence; do not substitute a link
list or raw tool output. Distinguish observed behavior, author claims, inference, and design
recommendations. When research includes papers, identify publication status and evaluation limits.
When online access is unavailable, persist the local evidence and limitations before drafting the
spec. Research documents cite external sources, not Orbis implementation code. Persist research
performed during the brainstorm even when the design is already approved.

When revising an existing spec, read and verify relevant research during investigation. Keep new
findings in chat or private scratch until approval, then save them before editing the contract.
Do not reconstruct missing evidence from memory or present retrospective research as preceding an
existing spec.

## Write the specification

After full-design approval, confirm that any research synthesis exists on disk and reflects the
evidence used. Update the requirements and conformance scenarios together, including the linked
interaction contract, and remove resolved open questions.

Write `packages/<name>/SPEC.md` as the guide's
[Specify a package](../../../docs/specifications.md#specify-a-package) section requires, with
headings appropriate to the package, requirements identified by `REQ-<behavior-slug>`, and every
requirement linked to a conformance check. Record each option the brainstorm rejected in the SPEC's
[Explored alternatives](../../../docs/specifications.md#explored-alternatives) section with the
reason. Write original prose under the repository license and cite external contracts that
implementers need. Describe implementation availability separately from intended behavior. Do not
create runtime stubs or package-local plan directories merely to store a specification.

Link the SPEC and approved scope from the owning issue, and record decisions where the workflow's
[decision rules](../../../docs/development-workflow.md#decisions-and-local-evidence) place them.
Follow the repository verification requirements for changed files. Report the research,
specification, and applicable interaction-document paths, any unresolved decisions, and
verification limits. When the developer requests implementation planning, continue with
[plan-implementation](../plan-implementation/SKILL.md) against the approved specification.
