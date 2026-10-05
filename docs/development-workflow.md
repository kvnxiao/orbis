# Development workflow

Orbis tracks shared work in [GitHub Issues](https://github.com/kvnxiao/orbis/issues) and the
[Orbis Project](https://github.com/users/kvnxiao/projects/1). Package SPECs define approved
behavior, issues record implementation plans, and the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki) records repository-wide constraints and
their rationale. Coding agents do most of the work under instructions in this repository.

This page explains, for human contributors, how that agent workflow runs and where each instruction
lives. Agents do not read it: they start at [`AGENTS.md`](../AGENTS.md) and follow its links.

## Roles

- The **developer** approves designs, authorizes work, resolves material decisions, and merges PRs.
  To **approve** a document, such as the complete design, a SPEC, or a plan's Design section, is to
  confirm it as final and ready for work. To **authorize** work is to set a request's scope and
  permit its implementation or other execution to begin. Approval does not authorize execution.
- The **orchestrator** is the main agent session. It owns decisions, coordination, verification, and
  delivery.
- A **delegate** is an agent that the orchestrator starts for bounded work and that reports back to
  it: `orbis-implementer` edits code and tests, `orbis-reviewer` and `orbis-conformance-reviewer`
  review read-only, and a documentation delegate edits documentation.

## Ask for work

In a new Codex or Claude Code session in the updated, trusted repository, send a request such as:

```text
Resume #<number>
```

The same entry point resumes a PR (`Resume PR #<number>`) or takes a direct request that does not
name an issue or PR, such as a package fix or a documentation update. The request does not need a
skill name or lifecycle stage.

- To limit the work, add a scope limit, such as `Resume #<number>, planning only`.
- To inspect without execution, ask `What is the status of #<number>?`.
- To select a skill explicitly, invoke `$<skill>` in Codex, `/skill:<skill>` in Pi, or `/<skill>` in
  Claude Code, such as `$work-issue` or `/design-package`. After project trust is established, Pi
  discovers the repository's `.agents/skills`. When a host does not discover these skills, ask it to
  read the skill's `SKILL.md` directly.

## How a request runs

Every development request follows one of two work paths:

- The **issue-backed path** covers work that introduces, improves, or changes package behavior. An
  issue tracks it, and its body and checkpoint comments are the shared record.
- The **PR-only path** delivers a change within a package's approved contract, a documentation
  change, or a workspace tooling change through a PR alone. The PR is the shared record.

An existing issue always takes precedence over the PR-only path. An issue-backed request moves
through these stages, skipping any that are already satisfied:

1. **Start.** The orchestrator runs `work-issue`, which resolves the target, classifies it on a work
   path, and states the next action and who executes it.
2. **Design.** `design-package` starts or continues a SPEC: it researches the package and
   brainstorms the open decisions with you. You approve the complete design before any repository
   edit or publication, and the orchestrator writes the SPEC. A SPEC can be approved and delivered
   without an implementation plan.
3. **Planning.** When you request planning or authorize implementation, `plan-implementation` writes
   the issue plan. When the plan introduces a persisted format or new module boundaries, you approve
   its Design section before implementation.
4. **Implementation.** `orbis-implementer` edits code and tests one bounded task at a time.
5. **Verification.** The orchestrator runs the global `review-changes` skill, which assigns
   `orbis-reviewer` and, for affected contracts, `orbis-conformance-reviewer`. Accepted fixes go
   back to `orbis-implementer`.
6. **Delivery.** The orchestrator opens a PR and leaves it for your review and merge.

A behavior change to an existing package goes through `revise-package`, which keeps the SPEC, plans,
code, and tests consistent. The orchestrator publishes a checkpoint comment on the issue at each
stage transition, at an interruption, and at delivery, and keeps the issue's Current handoff table
current.

Whenever a decision needs your input, the orchestrator settles it with you through the global
`brainstorm` skill; delegates return such decisions to the orchestrator instead of asking you.
Agents never merge, push to the default branch, publish packages, create releases, or write to
repositories other than `kvnxiao/orbis`.

## How the instructions are organized

The instructions form a tree, and links point only down it:

```text
docs/development-workflow.md       this page; human overview and map; no agent reads it
AGENTS.md                          loaded by every agent session
├─ .agents/skills/<skill>/         procedures
│  ├─ SKILL.md
│  └─ references/                  files that only this skill uses
├─ .agents/shared/                 agent-only rules that several skills or agents use
├─ docs/specifications.md          content standards that humans also apply
├─ docs/readme-guidelines.md
└─ .claude/agents/, .codex/agents/ delegate definitions
```

- `AGENTS.md` defines the shared terms, roles, hard limits, file editors, skill routing, commands,
  and package and test rules.
- A `SKILL.md` links the reference, shared, and standard files that its steps need. Reference files,
  shared files, and the two content standards do not link to other repository files.
- `work-issue` is the only skill that starts another repository skill. Each specialist skill returns
  an outcome, and `work-issue` chooses the next step from it.
- `docs/` has documentation that humans read. Agent-only procedures live under `.agents/`.

## Map

### Skills

| Skill                                                                     | Use for                                                    | Started by                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| [work-issue](../.agents/skills/work-issue/SKILL.md)                       | Starting, resuming, or continuing an issue, PR, or request | Any development request           |
| [design-package](../.agents/skills/design-package/SKILL.md)               | Starting or continuing a package design and its SPEC       | `work-issue` or the developer     |
| [plan-implementation](../.agents/skills/plan-implementation/SKILL.md)     | Writing issue plans from an approved SPEC                  | `work-issue` or the developer     |
| [revise-package](../.agents/skills/revise-package/SKILL.md)               | Changing an existing package's contract and code together  | `work-issue` or the developer     |
| [update-toolchain](../.agents/skills/update-toolchain/SKILL.md)           | Refreshing Node.js, pnpm, TypeScript, Pi, and dependencies | `work-issue` or the developer     |
| [verify-conformance](../.agents/skills/verify-conformance/SKILL.md)       | Reviewing a package implementation against its SPEC        | `review-changes` or the developer |
| [write-readme](../.agents/skills/write-readme/SKILL.md)                   | Writing or reviewing READMEs                               | `review-changes` or the developer |
| [pi-coding-agent-rules](../.agents/skills/pi-coding-agent-rules/SKILL.md) | Rules for Pi extensions, packages, and TypeScript          | Any Pi or TypeScript work         |

`pi-coding-agent-rules` and the matching `.claude/rules/` file are generated by `ruleskill` and are
not edited in this repository. The global skills `review-changes`, `update-docs`, `audit-prose`, and
`brainstorm` are installed outside the repository; the shared review rules adapt `review-changes` to
Orbis.

A specialist skill returns one of these outcomes, and `work-issue` routes from it:

| Outcome                 | Next step in `work-issue`                                             |
| ----------------------- | --------------------------------------------------------------------- |
| Done                    | Reclassify the work and route again                                   |
| Needs design            | Start `design-package`                                                |
| Needs contract revision | Start `revise-package`                                                |
| Needs a plan            | Start `plan-implementation`                                           |
| Blocked                 | Settle a pending decision through `brainstorm`, or report the blocker |

### Shared files

| File                                                             | Contents                                                                                    | Used by                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [starting-work.md](../.agents/shared/starting-work.md)           | Resolving the target, reading its state, classifying the work, and loading rules            | `work-issue`; each specialist skill that edits files, when invoked directly                                              |
| [work-paths.md](../.agents/shared/work-paths.md)                 | Work paths, PR boundaries, the issue hierarchy, Stage values, and the Current handoff table | `work-issue`, `design-package`, `plan-implementation`, `revise-package`, `update-toolchain`, `write-readme`              |
| [authorization.md](../.agents/shared/authorization.md)           | What a request grants and where scope limits stop the work                                  | `AGENTS.md`, `work-issue`, `design-package`, `revise-package`                                                            |
| [delegation.md](../.agents/shared/delegation.md)                 | Each role's model per host and what each delegate's assignment includes                     | `AGENTS.md`, `work-issue`, `revise-package`, `update-toolchain`                                                          |
| [review.md](../.agents/shared/review.md)                         | Reviewer assignment, reviewer prompts, `review-changes` overrides, and the review lens      | `AGENTS.md`, `work-issue`, `revise-package`, `update-toolchain`, `orbis-reviewer`                                        |
| [github-markdown.md](../.agents/shared/github-markdown.md)       | Labels, wording and format rules, and status and completion                                 | `AGENTS.md`, `work-issue`, `design-package`, `plan-implementation`, `revise-package`, `update-toolchain`, `write-readme` |
| [checkpoints.md](../.agents/shared/checkpoints.md)               | When and how to publish a checkpoint, and its packet format                                 | `work-issue`, `design-package`                                                                                           |
| [brainstorm-records.md](../.agents/shared/brainstorm-records.md) | The full-design approval gate and the brainstorm record format                              | `work-issue`, `design-package`, `plan-implementation`, `revise-package`                                                  |
| [decisions.md](../.agents/shared/decisions.md)                   | Decision records, wiki publishing, and local evidence                                       | `AGENTS.md`, `work-issue`, `design-package`, `plan-implementation`, `revise-package`                                     |
| [effect-adoption.md](../.agents/shared/effect-adoption.md)       | When to use Effect v4 in reference implementations and scripts                              | `plan-implementation`, `orbis-implementer`, `orbis-reviewer`                                                             |

### Agents

| Agent                        | Role                                              | Definitions                                                                                                               | Access                                                              |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `orbis-implementer`          | Implementation, tests, and accepted fixes         | [Claude Code](../.claude/agents/orbis-implementer.md), [Codex](../.codex/agents/orbis-implementer.toml)                   | Host default tools and sandbox                                      |
| `orbis-reviewer`             | Correctness, rules, simplification, README checks | [Claude Code](../.claude/agents/orbis-reviewer.md), [Codex](../.codex/agents/orbis-reviewer.toml)                         | Read-only: no edit tools on Claude Code, read-only sandbox on Codex |
| `orbis-conformance-reviewer` | Package conformance review                        | [Claude Code](../.claude/agents/orbis-conformance-reviewer.md), [Codex](../.codex/agents/orbis-conformance-reviewer.toml) | Read-only: no edit tools on Claude Code, read-only sandbox on Codex |
| Documentation delegate       | Documentation edits and prose audits              | None; started with an explicit model selection                                                                            | Scoped write permission                                             |

Each definition file sets its agent's model and reasoning effort, and `delegation.md` lists every
role's model on both hosts. The main session's model comes from
[`.claude/settings.json`](../.claude/settings.json) and
[`.codex/config.toml`](../.codex/config.toml), which also set the default Codex subagent model. Both
hosts' hooks route GitHub CLI calls through `agent-gh`. Host configuration changes apply to new
sessions.
