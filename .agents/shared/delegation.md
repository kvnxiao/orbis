# Delegation

The orchestrator keeps the coordination of `work-issue` and `review-changes`, decisions, obtaining
the developer's contract approval, accumulated verification, commits, and PR delivery. The active
global skill owns research and plan-execution delegation; design and planning authority does not
authorize runtime implementation.

## Agent models

Global skills select their own profiles and execution contracts, including `spec-researcher` and
`implementer`. Use those profiles without substituting an Orbis role. The table below configures the
main session and repository-specific roles for other work; it does not override a global profile.

| Role                                                                       | Codex                                                  | Claude Code                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Main-session orchestration, design, and verification coordination          | `gpt-6-astra` at `xhigh`, the main session             | `claude-opus-5-5` at `xhigh`, the main session             |
| Direct-work implementation, tests, and fixes outside global plan execution | `gpt-6.1-sol` at `xhigh`, `orbis-implementer`          | `claude-opus-5-5` at `high`, `orbis-implementer`           |
| Conformance review                                                         | `gpt-6-astra` at `xhigh`, `orbis-conformance-reviewer` | `claude-opus-5-5` at `xhigh`, `orbis-conformance-reviewer` |
| Documentation updates and prose audits that may edit files                 | `gpt-6.1-sol` at `high`, explicit model selection      | `claude-opus-5-5` at `high`, explicit model selection      |

- When the host offers custom agent selection, select the profile required by the active skill or
  repository-specific assignment.
- When the host offers model overrides instead, pass the role's exact model and, where supported,
  its reasoning effort, and include the role's responsibilities in the assignment. On a host where a
  full-history fork inherits the parent model, use a fresh or bounded-history context for an
  override.
- Do not rely on a role name in the prompt to select a model, and do not claim that a skill changes
  the active model. Configuration changes apply to new sessions only.
- Follow the active global skill's fallback for its workflows and for conformance review. Preserve
  the conformance procedure across hosts, and report when it runs without an independent delegate.
  For other repository-specific work, report an unavailable model or delegation and obtain the
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

For plan execution, follow `implement-spec-plan` and its implementer contract. Supply its required
plan, task, requirement, and discovery inputs together with the Orbis domain rules. The global skill
owns task status and review completion; GitHub tracking does not replace its state files.

For other work, resolve the contract and give `orbis-implementer`:

- The issue for issue-backed work, or the request and any existing PR for PR-only work, with the
  source revision, the authorized scope, and any approved contract.
- The relevant requirement IDs, interaction scenarios, and repository constraints. For workspace
  work without a SPEC, give the request and its acceptance criteria.
- A concrete authorized task, with the files it may edit, dependencies, and concurrent work it must
  preserve. An issue-body plan is not an executable spec-derived plan set.
- The observable outcomes, required checks, and the report needed for review.

For direct work, the implementer makes routine choices within the assignment, writes code and tests,
runs targeted checks, and repairs accepted findings. Before dependent edits, it returns unresolved
behavior, material architectural choices, authorization questions, and scope changes to the
orchestrator.

After the implementer returns, inspect its diff. Outside `review-changes mode=apply`, send later
repairs to the same implementer while it is available, with the accepted findings and any changed
facts, such as newly applicable rules references; do not resend its unchanged assignment. Integrate
returned work before starting another task that touches the same files, and do not dispatch
conflicting edits concurrently.
