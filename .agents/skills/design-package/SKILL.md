---
name: design-package
description:
  Brainstorm, research, and design an Orbis Pi extension with the developer through the global
  brainstorm skill, then write its package SPEC.md, any terminal interaction document, and any
  research synthesis. Use when starting a package SPEC, continuing an unfinished one, or revising a
  package's design before implementation.
---

# Brainstorm and design an Orbis package

Develop a package design with the developer, save the research that informs it, and write
`packages/<name>/SPEC.md` for an independent Pi implementer. The work can start a SPEC, continue an
unfinished one, or settle design questions that another skill returned as `Needs design`. The result
is research and an approved specification, which does not need an implementation plan; planning and
implementation are separate work that the developer requests or authorizes.

If `work-issue` did not start this work, first follow
[starting-work.md](../../shared/starting-work.md), with the Stage values in
[work-paths.md](../../shared/work-paths.md) and the labels in
[github-markdown.md](../../shared/github-markdown.md).

The
[full-design approval gate](../../shared/brainstorm-records.md#approve-the-complete-design-before-edits)
governs every step: until the developer approves the complete design in step 6, keep provisional
decisions in chat or private scratch, and do not change affected repository files or publish
decisions.

## 1. Choose the interaction method

Invoke the global `brainstorm` skill for the brainstorming interaction. Load its advertised
`SKILL.md` and use it for every decision round: decision-tree rounds, question format, and
confirmation of shared understanding. Resolve it through the host's available skills, not a
machine-specific path. This skill keeps the Orbis research, contract, and record steps.

If `brainstorm` is unavailable or unreadable, state that limitation and continue package design. Do
not require its installation.

## 2. Establish context

1. If the request's scope limits restrict its results to local files or chat, record what an issue
   would record in that destination, as [authorization.md](../../shared/authorization.md) requires,
   and skip the issue steps below.
2. When the intended outcome can be named, create or reuse an issue for it. Choose its scope from
   the work hierarchy and PR boundaries in [work-paths.md](../../shared/work-paths.md). Give a new
   issue the labels in [github-markdown.md](../../shared/github-markdown.md), and add it to the
   Project as the classification step in `starting-work.md` requires.
3. Keep a package-delivery epic open after design approval. An issue whose only deliverable is the
   design is complete once that design is delivered. Do not create implementation children for
   unsettled behavior.
4. Read the [specification guide](../../../docs/specifications.md) and the repository `README.md`.
5. For an existing package, read its SPEC's Explored alternatives section when present, and apply
   the guide's [reconsideration rule](../../../docs/specifications.md#explored-alternatives). When
   revising its SPEC, read and verify the relevant research. Preserve the developer's settled
   requirements, exclusions, and prior decisions.

## 3. Research the facts

Before proposing an architecture, research the facts that can change the available choices:

- Research current relevant Pi packages and official Pi APIs when those facts can affect the design.
  Use primary documentation and source to compare actual behavior, installation requirements,
  maintenance signals, integration boundaries, and missing capabilities.
- Compare other coding agents when the developer's requested experience makes them relevant. Do not
  turn every brainstorm into an exhaustive market survey.
- Distinguish a shipped feature from an example or proposal, and source inspection from runtime
  verification. Treat download counts as dated adoption signals, not evidence of quality or
  community consensus.
- Finish the relevant research before presenting a decision round.
- Ask the developer for preferences and constraints through `brainstorm`, not for facts available in
  the repository or documentation.

If online research is unavailable, report the gap and continue from installed documentation and
verified local context. Defer the decisions that require the missing evidence.

## 4. Work the design tree

The design tree maps the package's design decisions and the prerequisites each one depends on. Keep
the package focused on the developer's intended responsibility:

- Explore relevant boundaries, such as commands, skills, model-callable tools, UI, persistence, and
  events, without assuming every package needs all of them.
- Let current requirements determine conformance. Portability and hypothetical consumers are
  secondary unless the developer asks for them.

With `brainstorm`, work the tree in its rounds. Without it, use this fallback interaction:

1. Map the decisions and their prerequisites. Keep developer decisions, proposals, and open
   questions distinct. The frontier is the set of unresolved decisions the developer can answer now
   without guessing an answer to another open question.
2. Present the whole frontier in one numbered round. Explain the trade-offs, offer two to four
   meaningful options when alternatives exist, and put the recommended option first with its reason.
   Consider an unconventional option when it serves the problem; do not manufacture choices to fill
   a quota.
3. Use a structured question tool when available, or numbered questions in chat. Then wait for the
   developer's answers.
4. After a reply, recompute the frontier, and defer dependent decisions to the next round. Research
   new factual gaps before asking the next round.

Repeat the rounds until the frontier is empty.

## 5. Walk through terminal interactions

If the package needs a
[terminal interaction document](../../../docs/specifications.md#terminal-interaction-document), walk
through its user interactions with the developer before confirming the design:

- Resolve focus, navigation, text entry, confirmation versus submission, back and cancel behavior,
  recovery, and relevant narrow-terminal, resize, and SSH behavior.
- Distinguish highlighted controls, local drafts, submitted input, and completed actions.
- Explore failure and interruption paths as well as successful completion.
- Do not infer an interaction merely from a proposed widget or hotkey, and do not impose another
  package's keybindings, modal layout, or approval workflow.

## 6. Confirm the complete design

When the frontier is empty and any terminal interactions are resolved, present the integrated design
and obtain the developer's approval as the approval gate defines.

## 7. Persist the research synthesis

A research synthesis is a Markdown document that records the research behind the design. A simple,
settled package may not need one; do not create an empty folder or a ceremonial report.

1. If the package name is undecided, settle it before choosing the package path or writing the SPEC.
2. Save each research synthesis in `packages/<name>/docs/research/` before writing any `SPEC.md`,
   including a draft or starter. Create that directory directly, without scaffolding runtime files.
   Persist research performed during the brainstorm even when the design is already approved.
3. Use descriptive topic filenames and a structure that fits the research. Record:
   - The research date and the questions investigated.
   - Source links and relevant versions.
   - Verified findings and comparisons.
   - Implications for this package and remaining gaps.
4. Synthesize the evidence instead of substituting a link list or raw tool output. Distinguish
   observed behavior, author claims, inference, and design recommendations. For papers, identify
   publication status and evaluation limits. Cite external sources, not Orbis implementation code.
5. If online access was unavailable, persist the local evidence and its limitations before drafting
   the SPEC.

When revising an existing SPEC, save new findings before editing the contract. Do not reconstruct
missing evidence from memory or present retrospective research as preceding an existing SPEC.

## 8. Write the specification

1. Confirm that each research synthesis exists on disk and reflects the evidence used.
2. Write or amend `packages/<name>/SPEC.md` as the guide's
   [Specify a package](../../../docs/specifications.md#specify-a-package) section requires.
3. Record each option the brainstorm rejected, with the reason, in the SPEC's
   [Explored alternatives](../../../docs/specifications.md#explored-alternatives) section.
4. When package research supports the contract, add the optional
   [Supporting evidence](../../../docs/specifications.md#supporting-evidence) section.
5. Write original prose under the repository license, and cite the external contracts that
   implementers need.
6. If the package needs a terminal interaction document, record the agreed interactions and their
   examples in `docs/tui-interactions.md`. Check that the document exists, the SPEC links to it, and
   its scenarios cover the agreed flows and match the requirements.
7. Do not create runtime stubs or package-local plan directories merely to store a specification.

## 9. Link and publish the records

1. Link the SPEC and the approved scope from the issue that owns the design.
2. Record lasting decisions where [decisions.md](../../shared/decisions.md) places them.
3. For issue-backed work that produces or updates a PR, publish the brainstorm records under
   [brainstorm-records.md](../../shared/brainstorm-records.md#publish-brainstorm-records), with
   either interaction method. Each record is a checkpoint packet in the format that
   [checkpoints.md](../../shared/checkpoints.md) defines.

## Return

Return one outcome to the caller:

- `Done`: the developer approved the complete design, and the SPEC, any interaction document, and
  any research synthesis are saved and linked. Report their paths, explicit deferrals, and
  verification limits.
- `Blocked`: the developer has not approved the complete design, or a decision within the requested
  scope needs evidence that is unavailable. Report the pending approval or decision and what
  resolves it.
