---
name: design-package
description:
  Research and collaboratively design an Orbis Pi extension, then write its package SPEC.md. Use
  when brainstorming a new package or revising its design before implementation.
---

# Brainstorm an Orbis package

Develop the package with the user and write `packages/<name>/SPEC.md` for an independent Pi
implementer, persisting any research synthesis in `packages/<name>/docs/research/` first. This
workflow produces research and a specification; implementing the extension is a separate task unless
the user explicitly includes it.

When the global `brainstorm` skill is available, load its advertised `SKILL.md` and use it for the
brainstorming interaction: decision-tree rounds, question format, factual research delegation, and
confirmation of shared understanding. Resolve it through the host's available skills rather than a
machine-specific path, and keep this skill's Orbis research, contract, and delivery
responsibilities. If the global skill is unavailable or unreadable, state that limitation and use
the fallback in [Work the design tree](#work-the-design-tree); do not require installation or stop
package design.

## Establish context and research

When the intended outcome can be named, create or reuse a bounded initiative under the workflow's
[design and PR boundaries](../../../docs/development-workflow.md#design-and-pr-boundaries) and add
it to the Project. Keep unresolved decisions visible there. A package-delivery initiative remains
open after design approval; a design-only initiative has its own design deliverable. Do not create
implementation children for unsettled behavior.

Read the [specification guidance](../../../docs/specifications.md) and the repository `README.md`.
When the request concerns an existing package, inspect its specification and source and read its
`Explored alternatives` section and do not propose an idea it records. Preserve the user's
settled requirements, exclusions, and prior decisions.

Before proposing an architecture, research current relevant Pi packages and official Pi APIs when
those facts can affect the design. Use primary documentation and source to compare actual behavior,
installation requirements, maintenance signals, integration boundaries, and missing capabilities.
Distinguish a shipped feature from an example or proposal, and source inspection from runtime
verification. Download counts are dated adoption signals, not evidence of quality or community
consensus.

Compare other coding agents when the user's requested experience makes them relevant. Do not turn
every brainstorm into an exhaustive market survey. Focus research on facts that can change the
available choices. Use bounded factual subagents when available; otherwise research directly. Wait
for relevant factual work before presenting the decision round. Ask the user for preferences and
constraints, not facts available in the repository or documentation. When online research is
unavailable, report the gap and continue from installed documentation and verified local context;
defer decisions that require missing evidence.

## Persist the research synthesis

When the session conducts research, save its synthesis as Markdown in
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
spec. Research documents cite external sources, not Orbis implementation code.

As later rounds resolve factual gaps, update the synthesis before incorporating those findings into
the spec. When revising an existing spec, read and verify the relevant research first; if research
is needed and docs are missing, gather evidence and save the synthesis before editing the contract.
Do not reconstruct missing evidence from memory or present retrospective research as preceding an
existing spec.

## Work the design tree

Use this section as the interaction fallback when the global `brainstorm` skill cannot be loaded.
When it is loaded, follow its interaction instructions, including question presentation, rather than
the fallback's choice of a structured question tool or chat format.

Map decisions and their prerequisites. Keep user decisions, proposals, and open questions distinct.
The frontier is the set of unresolved decisions the user can answer now without guessing an answer
to another open question. Before comparing approaches or presenting a decision, introduce the
terminology, each approach, and the constraints needed to assess it.

Present the whole frontier in one numbered round. Explain the trade-offs, offer two to four
meaningful options when alternatives exist, and put the recommended option first with its reason.
Consider an unconventional option when it serves the problem; do not manufacture choices to fill a
quota. Use a structured question tool when available, or numbered questions in chat. Then wait for
the user's answers.

After a reply, incorporate additions and corrections, preserve settled choices, and recompute the
frontier. Defer dependent decisions to the next round. A recommendation or an unanswered question is
not a user decision. Research new factual gaps before asking the next round.

Keep the package focused on the user's intended responsibility. Explore relevant boundaries such as
commands, skills, model-callable tools, UI, persistence, and events without assuming every package
needs all of them. Let current requirements determine conformance; portability and hypothetical
consumers are secondary unless the user asks for them.

## Explore terminal interactions

When the package owns prompts, menus, forms, modals, or interactive terminal views, it requires
`docs/tui-interactions.md` as the guide's
[terminal interaction document](../../../docs/specifications.md#terminal-interaction-document)
section defines it. Before confirming the design, walk through its user interactions with the user.
Resolve focus, navigation, text entry, confirmation versus submission, back and cancel behavior,
recovery, and relevant narrow-terminal, resize, and SSH behavior. Distinguish highlighted controls,
local drafts, submitted input, and completed actions. Explore failure and interruption paths as well
as successful completion; do not infer an interaction merely from a proposed widget or hotkey.

After shared design confirmation, write the document with the agreed interaction in its examples;
do not impose another package's keybindings, modal layout, or approval workflow. Before reporting
completion, check that the document exists, the SPEC links to it, and its scenarios cover the agreed
flows and match the requirements.

## Write the specification

When research informed the design, confirm that its synthesis exists on disk and reflects the
evidence used. Existing design approval does not waive persistence of research performed during the
brainstorm.

Once the decisions are settled, summarize the resulting contract and confirm shared understanding.
Existing explicit agreement is sufficient; do not ask for the same decision again. When uncertainty
remains, mark the document as a draft and name the unresolved questions instead of claiming an
approved contract.

Write `packages/<name>/SPEC.md` as the guide's
[Specify a package](../../../docs/specifications.md#specify-a-package) section requires, with
headings appropriate to the package, requirements identified by `REQ-<behavior-slug>`, and every
requirement linked to a conformance check. Record each option the brainstorm rejected in the SPEC's
[Explored alternatives](../../../docs/specifications.md#explored-alternatives) section with the
reason. Write original prose under the repository license and cite external contracts that
implementers need. Describe implementation availability separately from intended behavior. Do not
create runtime stubs or package-local plan directories merely to store a specification.

Link the SPEC and approved scope from the initiative, and record decisions where the workflow's
[decision rules](../../../docs/development-workflow.md#decisions-and-local-evidence) place them.
Follow the repository verification requirements for changed files. Report the research,
specification, and applicable interaction-document paths, any unresolved decisions, and
verification limits. When the user requests implementation planning, continue with
[plan-implementation](../plan-implementation/SKILL.md) against the approved specification.
