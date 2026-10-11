# Orbis development instructions

Orbis is an agent harness built from modular Pi extensions in a monorepo. Every agent session in
this repository loads this file, including delegates.

## Roles and terms

- The **developer** approves designs, authorizes work, resolves material decisions, and merges PRs.
- The **orchestrator** is the main agent session. It owns decisions, coordination, verification, and
  delivery, and gives bounded work to delegates.
- A **delegate** is an agent that the orchestrator starts for bounded work under the active skill,
  such as a researcher, implementer, reviewer, or documentation editor. A delegate follows its
  **assignment**, the message that gives it its work, and returns results to the orchestrator. It
  does not start other agents or run `work-issue` or `review-changes`.
- A **direct request** asks for a development change without naming an issue or PR.
- A package's **SPEC**, `packages/<name>/SPEC.md` with any declared area files that divide the
  specification by responsibility, defines its behavior, and `REQ-<behavior-slug>` identifies each
  requirement.
- To **approve** a document, such as a design, a SPEC, or an implementation plan, the developer
  confirms it as final and ready for work. To **authorize** work, the developer permits its
  implementation or execution to begin. Approval does not authorize execution, and a SPEC or SPEC
  amendment can be approved before any implementation plan exists.
- A **specialist skill** owns one kind of work and returns an outcome to the orchestrator. Global
  skills own specification, planning, and plan execution; repository skills supply Orbis
  integration.

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

Only the orchestrator settles decisions with the developer, through the global `brainstorm` skill.
Follow the active global skill's research, decision, and approval workflow. Resolve factual
questions through investigation, preserve settled decisions, and return unresolved choices from
delegates to the orchestrator. Do not substitute repository procedures for a global skill's
workflow.

Explicit developer direction establishes the decisions and authorization within its scope. Approval
of a SPEC or plan does not by itself authorize runtime implementation. If the required skill is
unavailable, report the missing capability and stop dependent work; do not silently recreate it.

## Who edits each file

Assign one editor to each file and preserve concurrent work. Follow
[delegation.md](.agents/shared/delegation.md) when starting a delegate. Keep repository profiles
only for direct implementation and package conformance; supply repository rules in global
assignments.

- For work governed by a global skill, use that skill's research and implementation profiles,
  ownership rules, and permission for the orchestrator to work without a delegate. Supply the
  applicable Orbis domain rules.
- For other direct work, assign TypeScript, tests, templates, scripts, reusable harnesses, toolchain
  configuration, manifests, `justfile`, and `.gitignore` to `orbis-implementer`. The orchestrator or
  a documentation delegate edits prose, instructions, agent definitions, and host configuration.
- The orchestrator owns GitHub artifacts, commits, and delivery. A delegate does not publish them.
- Keep one-off investigation probes in ignored `.artifacts/`, ignored package `implementation/`, or
  outside the repository, subject to a global skill's narrower probe-location rule.
- Whoever changes a dependency manifest runs `just install` and owns the resulting `pnpm-lock.yaml`.
- Have the assigned editor inspect implementation changes made by formatting or lint-fix tools.

## Specification and plan workflows

Use global `write-spec`, `plan-from-spec`, and `implement-spec-plan` for their respective work.
Resolve their installed paths through the host's skill catalog. Their formats, approval gates,
structural validation, specification fingerprints in plans, and task-state rules are authoritative.
Keep executable plans in `.plans/<spec-slug>/`; issues link to them and record shared tracking.
Before migrating or writing a package contract, read [specifications.md](docs/specifications.md) for
repository locations and Pi interaction conventions. Do not copy global formats or maintain local
alternatives.

## Rules skills

Before working on or reviewing a domain, load its `*-rules` skill and read each of its references
whose "Read when" condition matches the change. Load
[pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md) for Pi extensions, packages,
and TypeScript. Name the loaded skills and references in every delegate assignment.

When selecting an implementation approach, planning reference implementations or scripts, or working
on Effect code, read [effect-adoption.md](.agents/shared/effect-adoption.md). Include that policy in
affected implementation and review assignments.

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

Before changing package code, read `packages/<name>/SPEC.md`, its applicable area files, and, for a
package with prompts, menus, or other terminal interactions, its linked `docs/tui-interactions.md`.
Identify the affected `REQ-<behavior-slug>` requirements even when the request omits specifications.
These documents define approved behavior; current code does not.

- Make fixes and implementation choices within the approved contract.
- Explicit developer direction approves the behavior it specifies; do not request the same approval
  again.
- For a change to a contract's observable behavior, amend the contract with global `write-spec`
  before implementation, and deliver the code, tests, SPEC, and interaction document in the same
  change set.
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
