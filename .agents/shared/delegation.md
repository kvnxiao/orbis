# Delegation

The orchestrator keeps the coordination of `work-issue` and `review-changes`, decisions, obtaining
the developer's contract approval, accumulated verification, commits, and PR delivery. Design-only
and planning-only work stays with the orchestrator until implementation is authorized.

## Agent models

Each role runs on this model and reasoning effort. The host settings and custom agent definitions
select these values; a role without a custom agent needs an explicit model selection.

| Role                                                                                              | Codex                                                  | Claude Code                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Orchestration, research, design, SPECs, implementation plans, and verification coordination       | `gpt-6-astra` at `xhigh`, the main session             | `claude-opus-5-5` at `xhigh`, the main session             |
| Authorized implementation, tests, and fixes from accepted review findings                         | `gpt-6.1-sol` at `xhigh`, `orbis-implementer`          | `claude-opus-5-5` at `high`, `orbis-implementer`           |
| Conformance review                                                                                | `gpt-6-astra` at `xhigh`, `orbis-conformance-reviewer` | `claude-opus-5-5` at `xhigh`, `orbis-conformance-reviewer` |
| Correctness, repository-rule, simplification, and other read-only reviews, such as a README check | `gpt-6-astra` at `xhigh`, `orbis-reviewer`             | `claude-opus-5-5` at `xhigh`, `orbis-reviewer`             |
| Documentation updates and prose audits that may edit files                                        | `gpt-6.1-sol` at `high`, explicit model selection      | `claude-opus-5-5` at `high`, explicit model selection      |

- When the host offers custom agent selection, select the role's agent.
- When the host offers model overrides instead, pass the role's exact model and, where supported,
  its reasoning effort, and include the role's responsibilities in the assignment. On a host where a
  full-history fork inherits the parent model, use a fresh or bounded-history context for an
  override.
- Do not rely on a role name in the prompt to select a model, and do not claim that a skill changes
  the active model. Configuration changes apply to new sessions only.
- If the required model or delegation is unavailable, report the limitation and obtain the
  developer's choice before substituting another model for that role.

## Assignment contents

Give each delegate an assignment instead of the full conversation. Every assignment names:

- The applicable skills and their resolved `SKILL.md` locations, including the rules skills and the
  matching references loaded at the start. Resolve shared skills through the host's skill catalog,
  and do not assume another session loaded their instructions.
- The assigned scope and the files the delegate may edit.

The delegate reads the assigned skills and references before dependent work, and reads the files
directly when automatic skill invocation is unavailable. If it cannot load a required skill, it
reports the gap, and the orchestrator supplies the missing instructions or resolves the blocker.

## Implementation assignment

Before delegating implementation, resolve the contract and select authorized, unblocked work. Give
`orbis-implementer`:

- The issue for issue-backed work, or the request and any existing PR for PR-only work, with the
  repository baseline, the authorized scope, and any approved contract.
- The relevant requirement IDs, interaction scenarios, and repository constraints. For workspace
  work without a SPEC, give the request and its acceptance criteria.
- The issue plan, or a concrete task for PR-only work, with the files it may edit, dependencies, and
  concurrent work it must preserve.
- The observable outcomes, required checks, and the report needed for review.

The implementer makes routine choices within the assignment, writes code and tests, runs targeted
checks, and repairs accepted findings. Before dependent edits, it returns unresolved behavior,
material architectural choices, authorization questions, and scope changes to the orchestrator.

After the implementer returns, inspect its diff. Send later repairs to the same implementer while it
is available, with the accepted findings and any changed facts, such as newly applicable rules
references; do not resend its unchanged assignment. Integrate returned work before starting another
task that touches the same files, and do not dispatch conflicting edits concurrently.
