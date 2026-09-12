---
name: brainstorm-orbis-package
description:
  Research and collaboratively design an Orbis Pi extension, then write its package SPEC.md. Use
  when brainstorming a new package or revising its design before implementation.
---

# Brainstorm an Orbis package

Develop the package with the user. When research is needed, persist its synthesis in
`packages/<name>/docs/research/` before producing `packages/<name>/SPEC.md` for an independent Pi
implementer. This workflow produces research and a specification; implementing the extension is a
separate task unless the user explicitly includes it.

## Establish context and research

Read the repository's `AGENTS.md`, `README.md`, and
[specification guidance](../../../docs/specifications.md). Inspect an existing package specification
and source when the request concerns that package. Preserve the user's settled requirements,
exclusions, and prior decisions.

Before proposing an architecture, research current relevant Pi packages and official Pi APIs when
those facts can affect the design. A simple, settled package may not need research docs; do not
create an empty folder or ceremonial report. Use primary documentation and source to compare actual
behavior, installation requirements, maintenance signals, integration boundaries, and missing
capabilities. Distinguish a shipped feature from an example or proposal, and source inspection from
runtime verification. Download counts are dated adoption signals, not evidence of quality or
community consensus.

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
it before choosing the package path or writing the spec.

Use descriptive topic filenames and a structure appropriate to the research. Record the research
date, questions investigated, source links and relevant versions, verified findings, comparisons,
implications for this package, and remaining gaps. Synthesize the evidence; do not substitute a link
list or raw tool output. Distinguish observed behavior, author claims, inference, and design
recommendations. When research includes papers, identify publication status and evaluation limits.
When online access is unavailable, persist the local evidence and limitations before drafting the
spec.

As later rounds resolve factual gaps, update the synthesis before incorporating those findings into
the spec. When revising an existing spec, read and verify the relevant research first; if research
is needed and docs are missing, gather evidence and save the synthesis before editing the contract.
Do not reconstruct missing evidence from memory or present retrospective research as preceding an
existing spec.

## Work the design tree

Map decisions and their prerequisites. Keep user decisions, proposals, and open questions distinct.
The frontier is the set of unresolved decisions the user can answer now without guessing an answer
to another open question.

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

When the package owns prompts, menus, forms, modals, or interactive terminal views, require
`packages/<name>/docs/tui-interactions.md`. A command that only executes an action or prints output
does not require an empty interaction document.

Before confirming the design, walk through its user interactions with the user. Resolve focus,
navigation, text entry, confirmation versus submission, back and cancel behavior, recovery, and
relevant narrow-terminal, resize, and SSH behavior. Distinguish highlighted controls, local drafts,
submitted input, and completed actions. Explore failure and interruption paths as well as successful
completion; do not infer an interaction merely from a proposed widget or hotkey.

After shared design confirmation, write the auxiliary document with concrete initial states, user
actions, and observable outcomes. Include Mermaid diagrams for branching or multistep flows and link
scenarios to package requirement IDs. Name the interaction area alone in each heading and list its
requirement IDs in a `Requirements:` line inside the section body; when a section gains or loses a
requirement, a heading that embeds requirement IDs breaks inbound SPEC links. Scale detail to the
package. Use the agreed interaction in examples; do not impose another package's keybindings, modal
layout, or approval workflow.

Link `docs/tui-interactions.md` from `SPEC.md` as the normative interaction contract. Keep system
responsibilities, interfaces, state, persistence, and ordering guarantees in the SPEC. Put detailed
layout, appearance, labels, key mappings, and user flows in the interaction document under the same
requirement IDs. The linked documents form the complete package contract; avoid duplicating UI rules
in the SPEC. Keep research and execution evidence separate from required behavior.

## Write the specification

When research informed the design, confirm that its synthesis exists on disk and reflects the
evidence used. Existing design approval does not waive persistence of research performed during the
brainstorm. Keep the system and interaction contracts complete together; link supporting research
without making it an additional source of requirements.

Once the decisions are settled, summarize the resulting contract and confirm shared understanding.
Existing explicit agreement is sufficient; do not ask for the same decision again. When uncertainty
remains, mark the document as a draft and name the unresolved questions instead of claiming an
approved contract.

Write `packages/<name>/SPEC.md` using headings appropriate to the package. Define observable
requirements, applicable interfaces, ordering and failure behavior, implementation choices, and
conformance scenarios. Assign stable package-local requirement IDs in the form
`REQ-<behavior-slug>`: kebab-case, two to four words, matching the requirement's title and naming
the behavior rather than its mechanism, as in `REQ-planning-entry`, `REQ-approval-event`, or
`REQ-recoverable-failures`. Reject ordinals, obligation verbs, library names, and the package name;
prefix with an area only to separate siblings. These identify requirements, not vertical tasks; task
names remain separate. Link every requirement to a conformance check with observable expected
results.

Because slugs have no position, section headings and document order define the reading path, and
the requirement headings index the package. Group requirements by responsibility rather
than by minting order. Apply the specification guide's distinctions between mandatory text,
examples, permitted choices, and unresolved decisions. Readers must be able to implement the package
without reading the reference source.

Use the repository's specification starter as guidance, not a mandatory outline. Write original
prose under the repository license and cite external contracts that implementers need. Describe
implementation availability separately from intended behavior. Do not create runtime stubs or
package-local plan directories merely to store a specification.

Follow the repository verification requirements for changed files. Report the research,
specification, and applicable interaction-document paths, any unresolved decisions, and verification
limits. For an interactive package, check that `docs/tui-interactions.md` exists, the SPEC links to
it, and its scenarios cover the agreed flows and match the requirements. Do not report a settled
interaction design while required scenarios or material interaction decisions are missing. When the
user requests implementation planning, continue with
[plan-orbis-implementation](../plan-orbis-implementation/SKILL.md) against the approved
specification.
