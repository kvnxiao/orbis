# Development workflow

Orbis stores approved package behavior in specifications and executable implementation tasks in
`.plans/`. [GitHub Issues](https://github.com/kvnxiao/orbis/issues) and the
[Orbis Project](https://github.com/users/kvnxiao/projects/1) record scope, authorization,
dependencies, and handoffs. The [wiki](https://github.com/kvnxiao/orbis/wiki) stores repository-wide
decision records.

This page explains how contributors request work and where its instructions are stored. Agents start
at [`AGENTS.md`](../AGENTS.md) and follow the files it names at each step.

## Roles and authorization

The **developer** approves designs, authorizes work, resolves material decisions, and merges PRs.
Approving a SPEC or plan confirms that document; authorizing execution permits work within the
stated scope. Approval alone does not authorize runtime implementation.

The **orchestrator** is the main agent session. It coordinates decisions, verification, tracking,
and delivery. A **delegate** performs a bounded assignment and returns its results. The active skill
selects research, implementation, and review profiles; repository-specific profiles handle other
direct work.

## Ask for work

In a Codex or Claude Code session in the trusted repository, send a request such as:

```text
Resume #<number>
```

The same entry point resumes a PR (`Resume PR #<number>`) or takes a direct development request. The
request does not need a skill name.

- To limit work, add a scope such as `Resume #<number>, planning only`.
- To inspect without execution, ask `What is the status of #<number>?`.
- To select a skill, invoke `$<skill>` in Codex, `/skill:<skill>` in Pi, or `/<skill>` in Claude
  Code, such as `$write-spec`.

Development requests start in `work-issue`, which resolves the target and routes authorized work to
the applicable skill. A change to package behavior gets an issue. A fix within an approved contract,
a documentation change, or a tooling change can go straight to a PR.

Agents settle open decisions with you through `brainstorm` and follow the active skill's approval
gates. They leave PRs open for developer review and merge. Merging, pushing to the default branch,
publishing packages, and creating releases require separate explicit authorization. Agents do not
write to repositories other than `kvnxiao/orbis`.

## Specifications, plans, and execution

The host environment supplies the global skills. Install them where the host discovers skills; the
repository refers to them by name without copying their formats or procedures.

| Work                                  | Skill                 | Result                                                                                         |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| Write, amend, or reconcile a contract | `write-spec`          | `packages/<name>/SPEC.md`, any files that divide requirements by area, and supporting research |
| Plan approved behavior                | `plan-from-spec`      | An executable plan set under `.plans/<spec-slug>/`                                             |
| Execute or resume a plan              | `implement-spec-plan` | Implementation and task state in the plan set                                                  |

Each skill defines its format, validation, approval, and delegation rules. `work-issue` supplies
GitHub tracking, scope limits, and PR delivery. Issues link to plans without repeating their
executable tasks or agent-only state. Existing issue-body plans must be reconciled through the
planning skill before execution.

[Specification conventions](specifications.md) define Orbis document locations and Pi interaction
contracts. Package research is stored in `packages/<name>/docs/research/`; repository research is
stored in `docs/research/`. Convert a contract before work that depends on the installed
specification format, and preserve its approved behavior and requirement identities.

## Repository instructions

The repository's instructions supplement the global skills with Orbis constraints. Files are read
when their instructions apply.

| Location                                                 | Purpose                                               |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `AGENTS.md`                                              | Shared instructions for every session and delegate    |
| `.agents/skills/<skill>/SKILL.md`                        | Repository procedures and generated domain rules      |
| `.agents/skills/<skill>/references/`                     | References used by one skill                          |
| `.agents/shared/`                                        | Agent instructions used by several skills or profiles |
| `docs/specifications.md` and `docs/readme-guidelines.md` | Documentation standards for contributors and agents   |
| `.claude/agents/` and `.codex/agents/`                   | Repository-specific delegate definitions              |

`verify-conformance` checks implementations against their complete specification sets.
`write-readme` handles extension documentation, and `update-toolchain` refreshes dependencies.
Global `review-changes`, `update-docs`, and `audit-prose` provide delivery checks. The generated
`pi-coding-agent-rules` skill and its matching Claude rules file supply domain constraints;
`ruleskill` generates these files, so agents do not edit them.

Host configuration sets model defaults and routes GitHub CLI commands through `agent-gh`. Checkpoint
authors identify the model from current runtime metadata, because defaults do not establish which
model ran a session. If that metadata is unavailable, the record states that limitation and work
continues without a confirmation request.

Install personal Codex agent definitions as regular TOML files in `~/.codex/agents/`; Codex can
discover a symlinked definition but refuses it when spawning. Keep their source files and deployment
process in the host configuration. Repository agent definitions are regular files under
`.codex/agents/`. Global profiles cover research, plan implementation, and ordinary review. Orbis
defines only direct implementation without a spec-derived plan and full package-conformance review.
