# Codex, Claude Code, and the Orbis planning contract

Research date: 2026-09-08. Findings come from freshly retrieved official
documentation and local skill files. Hosted documentation is a dated snapshot;
the products were not exercised in an interactive comparison.

## Codex

Codex CLI documents `/plan` with an optional inline request. It changes the active
chat's mode; the command is temporarily unavailable while Codex is working.
[Command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)

Codex's App Server documents structured user-input requests and plan output.
These are host capabilities, not proof that every UI exposes the same controls.
[App Server reference](https://learn.chatgpt.com/docs/app-server)

**Design implication:** Explicit mode entry and structured user input are useful
reference behaviors. Orbis supplies its own revision-aware question and approval
records, and does not convert elapsed time into an answer. The retrieved pages do
not establish Codex CLI's complete question-navigation behavior, default plan-file
storage, or an approval-only extension event equivalent to Orbis's proposed event.

## Claude Code

Claude Code documents plan entry through `/plan`, Shift+Tab, and
`--permission-mode plan`. Planning permits exploration and plan writing while
source edits are normally blocked; sessions with bypass permissions have different
enforcement. The review prompt supports approval or continued planning, and
Ctrl+G opens the plan in an editor. Approval exits planning and starts editing
under the selected permission mode.
[Permission-mode documentation](https://code.claude.com/docs/en/permission-modes#analyze-before-you-edit-with-plan-mode)

The Agent SDK documents `AskUserQuestion` with question text, short headers,
described options, and optional multiple selection. Calls support one to four
questions with two to four options each. A host can render terminal prompts or a
web form and return selected or custom answers through the callback. The SDK
currently excludes this tool from Agent-tool subagents. This describes an SDK
input contract; it does not establish identical behavior in the CLI.
[User-input documentation](https://code.claude.com/docs/en/agent-sdk/user-input)

**Design implication:** Structured questions and review-before-action match the
requested interaction. Orbis's approval completes planning and emits a handoff
event; the plan package does not start editing. Command filtering and permission
enforcement remain outside its responsibility.

## Frontier planning

The locally inspected `brainstorm` skill at
`~/.agents/skills/brainstorm/SKILL.md` defines a design tree and asks the currently
answerable decisions together. Dependent decisions wait for prerequisites. Its
instructions require factual investigation before user decisions and recomputing
the frontier after replies. This is a local workflow instruction, not an official
Pi feature or an evaluated agent benchmark.

The repository's [brainstorm skill](../../../../.agents/skills/brainstorm-orbis-package/SKILL.md)
adapts that process to package design. The plan spec defines the intended runtime
experience separately from this development-time skill.

**Design implication:** A frontier can contain related questions that users need
to revisit. Whole-round navigation and explicit submission preserve that freedom.
Per-question clarification returns to the main agent with selected, confirmed
context marked unsubmitted; unfinished drafts remain local. Form rendering does
not establish the research and clarification process.

[HumanEvalComm](https://arxiv.org/abs/2406.00215) studies clarification for ambiguous,
inconsistent, and incomplete small coding tasks. It supplies relevant evidence
about questioning, but does not validate frontier batching or browser-versus-terminal
interaction. The repository's [scholarly review](../../../../docs/specification-research.md)
records its findings and limitations alongside related studies.

## Comparison with the specified Orbis behavior

| Concern     | External evidence                                                                                      | Orbis contract                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Entry       | Codex and Claude Code document explicit plan entry.                                                    | `/plan` plus a model-callable entry operation share state and instructions.                              |
| Questions   | Both expose structured input mechanisms. SDK or protocol support does not imply identical UI behavior. | Complete frontier rounds, stable identities, custom text, recommendations, and main-agent clarification. |
| Navigation  | The inspected documentation does not establish the entire requested draft-preservation behavior.       | Terminal Tab/Shift+Tab preserve unfinished answers.                                                      |
| Approval    | Claude Code explicitly continues into editing after approval.                                          | Save the reviewed Markdown, finish planning, and notify subscribers.                                     |
| Permissions | Claude Code's planning enforcement depends on session permission settings.                             | Planning instructions govern workflow; Orbis does not implement shell filtering or a sandbox.            |
| Remote use  | Host protocols allow externally rendered input, but require client implementations.                    | The complete workflow works in an SSH terminal.                                                          |

The [package specification](../../SPEC.md) defines the chosen behavior. This
comparison explains relevant alternatives and verification gaps; it does not add
requirements or establish conformance of an implementation.
