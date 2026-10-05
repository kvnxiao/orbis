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
- An issue's **Stage** is its current required activity, such as Design, Planning, or
  Implementation. The **Current handoff** table at the top of the issue body records it.
- A **checkpoint** is an issue comment that records completed work or an interrupted handoff.
- A **specialist skill** is a repository skill for one kind of work, such as `design-package`. It
  returns an outcome to its caller and does not start another repository skill.

## Start work

Delegates, status questions, read-only reviews, and general questions skip this section.

1. For a request that starts, resumes, or continues an issue, a PR, or a direct request, invoke
   `work-issue`. The request does not need a skill name or Stage.
2. When the developer invokes a specialist skill that edits files, such as `design-package` or
   `update-toolchain`, run that skill instead. It runs the shared start steps itself.
3. Stop at every scope limit the request sets, as the
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

## Developer decisions

Only the orchestrator runs the global `brainstorm` skill with the developer. A delegate may use the
`brainstorm` method to frame a decision, but returns the decision to the orchestrator instead of
asking the developer.

Resolve facts through read-only investigation, and do not ask the developer for facts that the
repository, documentation, or tools can answer. When work needs the developer's input, the
orchestrator invokes `brainstorm` and settles it with the developer:

- An unknown that investigation cannot resolve.
- An open or deferred product or implementation decision, even when the choice is easy to reverse.
- An ambiguity whose interpretations diverge materially.
- A decision that remains or surfaces during implementation, review, or integration, including an
  open question that a delegate or reviewer reports.

Always use `brainstorm` for these decisions, including after implementation. Collect the decisions
that surface during the work and settle them in `brainstorm` rounds before delivery; do not list
them as ad hoc options in a status reply or summary.

Gather the facts for each round in the orchestrator session, or in a fork of it for a broad search,
instead of starting the fresh-context research agent that `brainstorm` suggests. If `brainstorm` is
unavailable, the orchestrator reports the limitation and asks the developer directly.

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
- Keep scratch work and run evidence under the
  [local evidence rules](.agents/shared/decisions.md#local-evidence).

## Rules skills

Before working on or reviewing a domain, load its `*-rules` skill and read each of its references
whose "Read when" condition matches the change. Load
[pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md) for Pi extensions, packages,
and TypeScript. Name the loaded skills and references in every delegate assignment.

## Skill routing

Invoke or read the entry that matches the work. If the host does not discover `.agents/skills`, read
the linked `SKILL.md` directly.

| Trigger                                                        | Skill or file                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Start, resume, or continue an issue, a PR, or a direct request | [work-issue](.agents/skills/work-issue/SKILL.md)                                      |
| Package design                                                 | [design-package](.agents/skills/design-package/SKILL.md)                              |
| Implementation planning                                        | [plan-implementation](.agents/skills/plan-implementation/SKILL.md)                    |
| Contract changes, or code that drifted from its SPEC           | [revise-package](.agents/skills/revise-package/SKILL.md)                              |
| Package conformance review                                     | [verify-conformance](.agents/skills/verify-conformance/SKILL.md)                      |
| README creation or revision                                    | [write-readme](.agents/skills/write-readme/SKILL.md)                                  |
| Dependency refreshes or newly supported strict checks          | [update-toolchain](.agents/skills/update-toolchain/SKILL.md)                          |
| Writing or amending a SPEC or interaction contract             | [specification guide](docs/specifications.md)                                         |
| Recording a design decision                                    | [decision records](.agents/shared/decisions.md)                                       |
| Writing GitHub issue and PR bodies, comments, and labels       | [GitHub records](.agents/shared/github-markdown.md)                                   |
| Reviewing a change set before a commit or PR                   | The global `review-changes` skill, under the [review rules](.agents/shared/review.md) |
| Setup, toolchain, publication, and lint details                | `CONTRIBUTING.md`                                                                     |

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
- For a change to a contract's observable behavior, use `revise-package` before implementation, and
  update code, tests, the SPEC, and the interaction document in the same change set.
  `revise-package` settles material decisions with the developer.
- Do not weaken a SPEC to make code pass.

Before a package's first published release, implement only its current approved SPEC. Delete
superseded code, settings, aliases, migrations, and tests, and keep tests for current behavior and
failure paths. Add backward compatibility only for a published release's contract or an explicit
developer requirement.

## Code design

Apply the generated
[TypeScript architecture](.agents/skills/pi-coding-agent-rules/references/typescript-architecture.md),
[TypeScript code organization](.agents/skills/pi-coding-agent-rules/references/typescript-code-organization.md),
and
[TypeScript domain boundaries](.agents/skills/pi-coding-agent-rules/references/typescript-domain-boundaries.md)
references during implementation and review.

## Package conventions

- Scaffold each extension with `just new <name>` as `packages/<name>` with npm name `@orbis/<name>`.
  Publish TypeScript source without a build step, and export a default factory accepting
  `ExtensionAPI` from `src/index.ts`.
- Declare every imported dependency in the importing package:
  - `catalog:` for pinned development dependencies.
  - `workspace:^` for shared workspace packages.
  - `"*"` peers with matching development dependencies for `@earendil-works/pi-*`.
  - Ordinary runtime dependencies in `dependencies`.

  Commit `pnpm-lock.yaml`. Do not bundle Pi's runtime.

- Describe a Pi version as tested, never as required, because the `"*"` peers do not constrain the
  Pi release. In READMEs, package documentation, and PR bodies, write `Tested with Pi X.Y.Z`, not
  `Requires Pi X.Y.Z`. Keep the Node.js minimum a requirement, such as `Requires Node.js >=22.19.0`,
  because `engines.node` declares it.
- Boundary data is any value the package did not construct in the current process, such as settings
  files, persisted records, and session entries. A package that reads or writes boundary data
  declares `typebox` as a `"*"` peer with a `catalog:` development dependency. Pin the catalog's
  `typebox` entry to the version in the tested Pi release's `package.json`.
- Validate boundary data with typebox schemas through the package's `src/records.ts`, which exports
  `parseRecord` and `readOptional`. Keep each package's copy identical to
  `templates/extension/src/records.ts`. Lint rejects `JSON.parse` elsewhere under a package's
  `src/`; `packages/plan` is exempt until it adopts `records.ts`.
- Use explicit `.ts` extensions on relative imports and package exports between workspace packages.
  Do not import a sibling package's source through a relative path or a `tsconfig.paths` alias.
- Extract a shared package only for behavior used by multiple packages, and export its TypeScript
  source through its package `exports`.
- Keep each file within 500 lines and each function within 80 lines, counting blank and comment
  lines. The lint exempts `tests/` directories, `*.test.mts` files, `scripts/`, and `packages/plan`.
- Write scripts, tests, and Vitest configuration as `.mts`. Keep package tests in
  `tests/**/*.test.mts` with a `vitest.config.mts`; the root configuration discovers them.

## Tests

Automated tests, including `just test` and `just check`, must not call real models, start live agent
sessions, or incur model charges. Use local fixtures. For tests of agent turns, configure the Pi SDK
session with a scripted in-process provider, and block network traffic except to local fixtures.
Keep real-model checks separate, explicit, and orchestrator-supervised, outside test discovery and
repository check commands.

- Reproduce a bug with a failing test.
- When changing validation, test rejected inputs.
- Before and after a refactor, run the same checks.
- Add runtime tests for new or changed extension behavior, run the package tests, and load the
  package through Pi; type checking does not prove import compatibility.

## Verify and deliver

Before a commit or PR, run the global `review-changes` skill with `mode=apply` once on the
accumulated change set, under the [review rules](.agents/shared/review.md).

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

## Instruction files

- Treat `docs/` as documentation that humans read, and put agent-only procedures under `.agents/`.
  Place agent behavior in `docs/` only for a standard that humans also apply, such as the SPEC
  format or the README guidelines.
- Put a file that one skill uses in that skill's `references/` directory, and a file that two or
  more skills or agents use in `.agents/shared/`. Link only downward:
  - This file links to skills and shared files.
  - A `SKILL.md` or agent definition links to the files it needs.
  - Reference and shared files do not link to other repository files.
- Do not add lint rules or check scripts that enforce the structure of skill, agent, or workflow
  instruction files.
- Record lasting developer preferences for this repository in its instruction files, not in
  host-specific memory, so every host follows them.
