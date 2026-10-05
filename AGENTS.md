# Orbis development instructions

Orbis is an agent harness built from modular Pi extensions in a monorepo. Every agent session in
this repository loads this file, including delegates.

## Roles and terms

- The **developer** approves designs, authorizes work, resolves material decisions, and merges PRs.
- The **orchestrator** is the main agent session. It owns decisions, coordination, verification, and
  delivery, and gives bounded work to delegates.
- A **delegate** is an agent that the orchestrator starts for bounded work: `orbis-implementer`,
  `orbis-reviewer`, `orbis-conformance-reviewer`, or a documentation delegate. A delegate follows
  its **assignment**, the message that gives it its work, and returns results to the orchestrator.
  It does not start other agents or run `work-issue` or `review-changes`.
- A **direct request** asks for a development change without naming an issue or PR.
- A package's **SPEC**, `packages/<name>/SPEC.md`, defines its approved behavior, and
  `REQ-<behavior-slug>` identifies each requirement.
- To **approve** a document, such as a design, a SPEC, or a plan's Design section, the developer
  confirms it as final and ready for work. To **authorize** work, the developer permits its
  implementation or execution to begin. Approval does not authorize execution, and a SPEC or SPEC
  amendment can be approved before any implementation plan exists.
- Work follows one of two **work paths**. The **issue-backed path** uses a GitHub issue to track a
  change that introduces, improves, or changes package behavior. The **PR-only path** delivers a
  direct request through a PR alone: a change within a package's approved contract, a documentation
  change, or a workspace tooling change.
- The **Current handoff** table at the top of an issue body records its authorization, work,
  blocker, and next action. A **checkpoint** is an issue comment that records paused work, a
  delivery, or an approved brainstorm's decisions.
- A **specialist skill** is a repository skill for one kind of work, such as `specify-package`. It
  returns an outcome to its caller and does not start another repository skill.

## Start work

Delegates, status questions, read-only reviews, and general questions skip this section.

1. For any development request, including one that names a specialist skill, invoke `work-issue`.
2. Stop at every scope limit the request sets, as the
   [authorization rules](.agents/shared/authorization.md) define.

## Hard limits

- Do not merge, push to the default branch, publish packages, or create releases without separate
  explicit authorization. Developers review and merge PRs.
- Run every GitHub CLI command through [`agent-gh`](https://github.com/kvnxiao/agent-gh), which
  accepts the same arguments as `gh`. Do not invoke `gh` directly, even when a global skill names
  it; the repository hooks block it.
- Treat every repository except `kvnxiao/orbis` as external, including upstream Pi
  (`earendil-works/pi`). Never open, edit, close, label, review, or comment on an issue or PR in an
  external repository. Never @-mention an external repository's maintainers or contributors in
  issues, PRs, comments, or commit messages. Report an external bug or gap and its evidence to the
  developer instead. Reading external repositories is allowed.
- Never edit a generated `*-rules` skill, its references, or a `.claude/rules/*-rules.md` file, even
  during documentation or cleanup work; `ruleskill` generates them. Exclude them from every
  delegate's write scope. When a repository file conflicts with a generated reference, change the
  repository file or report the conflict.
- Automated tests and repository checks must not call real models, start live agent sessions, or
  incur model charges. A real-model check needs explicit authorization and orchestrator supervision.

## Developer decisions

Resolve facts through read-only investigation, and do not ask the developer for facts that the
repository, documentation, or tools can answer. Only the orchestrator settles decisions with the
developer, through the global `brainstorm` skill. It gathers each round's facts itself or in a fork
of its session, instead of starting the research agent that `brainstorm` suggests. Settle these
through `brainstorm`:

- An unknown that investigation cannot resolve.
- An open or deferred product or implementation decision, even when the choice is easy to reverse.
- An ambiguity whose interpretations diverge materially.
- A decision that surfaces during implementation, review, or integration, including one that a
  delegate or reviewer returns.

Collect the decisions that surface during the work and settle them before delivery; do not list them
as options in a status reply or summary.

Before editing affected files or publishing decisions, present the complete design for the requested
scope, ask the developer to confirm it, and wait. Individual answers do not approve the design. Keep
provisional decisions in chat or private scratch until then, and pause affected work when new
evidence reopens a decision. A delegate frames a decision and returns it to the orchestrator. If
`brainstorm` is unavailable, report the limitation and ask the developer directly.

## Who edits each file

Every file has one editor on both work paths. Start each delegate and write its assignment under the
[delegation rules](.agents/shared/delegation.md).

| Editor                                                     | Files                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orbis-implementer`                                        | TypeScript source and tests; `templates/` and package `tests/` directories, including fixtures, regardless of file type; `scripts/`; reusable harnesses, benchmarks, and scripts, including those in ignored `packages/<name>/implementation/`; toolchain configuration, such as `tsconfig*.json`, Oxlint, Oxfmt, and Vitest configuration, package manifests, `justfile`, and `.gitignore` |
| Orchestrator, directly or through a documentation delegate | Markdown documentation and instructions, agent definitions (`.claude/agents/`, `.codex/agents/`), host configuration (`.claude/settings.json`, `.codex/config.toml`, `.codex/hooks.json`), and GitHub artifacts                                                                                                                                                                             |

- The orchestrator runs one-off investigation probes, which answer one question and are then
  discarded, only in ignored `.artifacts/`, ignored `packages/<name>/implementation/`, or outside
  the repository.
- Whoever changes a dependency manifest runs `just install` and owns the resulting `pnpm-lock.yaml`.
- When a tool the orchestrator runs, such as `just fix`, rewrites implementation files, hand those
  changes to `orbis-implementer`.

## Rules skills

Before working on or reviewing a domain, load its `*-rules` skill and read each of its references
whose "Read when" condition matches the change. Load
[pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md) for Pi extensions, packages,
and TypeScript. Name the loaded skills and references in every delegate assignment.

## Where rules live

Read each file when its trigger applies, not up front. If the host does not discover
`.agents/skills`, read the skill's `SKILL.md` directly.

| Trigger                                                                                                                | File                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Any development request                                                                                                | [work-issue](.agents/skills/work-issue/SKILL.md)                              |
| Writing issue or PR text, checkpoints, or decision records, reading the wiki, or keeping scratch work and run evidence | [records.md](.agents/shared/records.md)                                       |
| Creating, editing, labeling, or closing an issue or PR                                                                 | [issues.md](.agents/shared/issues.md)                                         |
| Writing, planning, or reviewing package code, tests, manifests, or dependencies                                        | [packages.md](.agents/shared/packages.md)                                     |
| A review-only request, or review before a commit or PR                                                                 | The global `review-changes` skill under [review.md](.agents/shared/review.md) |
| Editing instruction files, agent definitions, or host configuration                                                    | [instructions.md](.agents/shared/instructions.md)                             |
| Writing or amending a SPEC or interaction contract                                                                     | [Specification guide](docs/specifications.md)                                 |
| Setup, toolchain, publication, and lint details                                                                        | `CONTRIBUTING.md`                                                             |

## Commands

Run `just --list` to list recipes. Prefer `just install`, `just new <name>`, `just fix`,
`just check`, and `just test` over the root `pnpm` scripts. Use `pnpm` directly for package-filtered
commands, such as `pnpm --filter @orbis/<name> test`, dependency-manifest changes, and publication.

1. After changing a dependency manifest, run `just install`.
2. After code edits, run `just fix` before manual formatting or fixable lint repairs, and inspect
   its diff. If lint errors stop formatting, resolve them and rerun `just fix`.
3. Before completing any change, run `just fix`, then `just check`.

## Contract before code

Before changing package code, read `packages/<name>/SPEC.md` and, for a package with prompts, menus,
or other terminal interactions, its linked `docs/tui-interactions.md`. Identify the affected
`REQ-<behavior-slug>` requirements even when the request omits specifications. These documents
define approved behavior; current code does not.

- Make fixes and implementation choices within the approved contract.
- Explicit developer direction approves the behavior it specifies; do not request the same approval
  again.
- For a change to a contract's observable behavior, amend the contract with `specify-package` before
  implementation, and deliver the code, tests, SPEC, and interaction document in the same change
  set.
- Do not weaken a SPEC to make code pass.

## Writing

- Keep operational documentation concrete.
- In documentation, skills, and design discussions, introduce terms and concepts before using or
  comparing them. Before delivery, read each changed document top to bottom without following
  forward links.
- Omit comments that repeat code. Comment only an external contract, hazard, or ordering constraint
  the code does not state. Keep docstrings to required API contracts, and name tests for their
  assertions.
- Use imperative commit subjects and concrete PR descriptions, and audit commit and PR prose with
  `audit-prose`.
