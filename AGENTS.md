# Orbis development instructions

Orbis is an agent harness built from modular Pi extensions in a monorepo. In project introductions,
explain the name: Latin _orbis_, a circle or orb, and the circle constant pi. Keep operational
documentation concrete.

## Start a session

The main session is the **orchestrator**: it owns decisions, coordination, verification, and
delivery, and assigns bounded work to delegate agents. Before any edit, the orchestrator completes
this start protocol in order:

1. Invoke [work-issue](.agents/skills/work-issue/SKILL.md) for every request that starts, resumes,
   or continues an issue, a PR, or a [direct request](docs/development-workflow.md#roles-and-terms),
   which asks for a development change without naming an issue or PR. The request needs no skill
   name or lifecycle stage. A directly invoked specialist skill that edits files, such as
   `design-package` or `update-toolchain`, replaces this step and runs after steps 2 through 4.
2. Resolve the target, which is an issue, a PR, a branch, a package, or another direct request,
   through the `work-issue`
   [target resolution](.agents/skills/work-issue/SKILL.md#resolve-the-target) steps.
3. State the classification, its evidence, the next bounded action, and who executes it. The
   classification is the issue's
   [Stage](.agents/skills/plan-implementation/references/plan-format.md#stage-values) or the PR-only
   path. The workflow's [work paths](docs/development-workflow.md#work-paths) define the
   issue-backed and PR-only paths. An existing issue always takes precedence over the PR-only path.
4. Before starting work or implementation, load the `*-rules` skills for the work's domain, such as
   [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md) for Pi extensions,
   packages, and TypeScript. Read each of their references whose "Read when" condition matches the
   change.
5. Assign each edit, including a small fix, under the **executor rule**, which gives every file one
   editor on both work paths. Name the loaded rules skills and references in each handoff. The
   executor rule assigns these editors:
   - The `orbis-implementer` agent makes implementation edits:
     - All TypeScript source and tests.
     - The scaffold templates (`templates/`) and package `tests/` directories, including fixtures,
       regardless of file type.
     - Repository scripts (`scripts/`).
     - Toolchain configuration, such as `tsconfig*.json`, the oxlint, oxfmt, and Vitest
       configuration, package manifests, `justfile`, and `.gitignore`.
   - The orchestrator edits Markdown documentation and instructions, agent definitions
     (`.claude/agents/`, `.codex/agents/`), host configuration (`.claude/settings.json`,
     `.codex/config.toml`, `.codex/hooks.json`), and GitHub artifacts. It edits them directly or
     through a documentation delegate, which runs on the explicit model selection in the workflow's
     [agent model table](docs/development-workflow.md#agent-models). It runs investigation probes
     only in ignored `.artifacts/`, ignored `packages/<name>/implementation/`, or outside the
     repository.
   - Whoever changes a dependency manifest runs `just install` and owns the resulting
     `pnpm-lock.yaml`. When a tool the orchestrator runs, such as `just fix`, rewrites
     implementation files, hand those changes to `orbis-implementer`.

Delegates skip this protocol and follow their handoff. Status questions, read-only reviews, and
general questions also skip it, but a review still loads the rules skills in step 4. Every request
stops at the explicit scope limits that the workflow's
[authorization rules](docs/development-workflow.md#authorization) define.

At the start of substantive work, read the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) once, open the records for
the affected package or mechanism, and compare their constraints with current source and runtime
versions before relying on them. If GitHub is unavailable, report the gap and continue independent
local work.

The [development workflow](docs/development-workflow.md) defines the procedures for shared work,
authorization, delegation, checkpoints, and delivery. Its
[agent model policy](docs/development-workflow.md#agent-models) maps each role to a model and effort
per host.

## Skill routing

Invoke or read the entry that matches the work. If the host does not discover `.agents/skills`, read
the linked `SKILL.md`.

| Trigger                                                        | Read or invoke                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pi extension, package, or TypeScript work or review            | [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md)                                                              |
| Start, resume, or continue an issue, a PR, or a direct request | [work-issue](.agents/skills/work-issue/SKILL.md)                                                                                    |
| Package design                                                 | [design-package](.agents/skills/design-package/SKILL.md)                                                                            |
| Implementation planning                                        | [plan-implementation](.agents/skills/plan-implementation/SKILL.md)                                                                  |
| Contract changes or code that drifted from a SPEC              | [revise-package](.agents/skills/revise-package/SKILL.md)                                                                            |
| Package conformance review                                     | [verify-conformance](.agents/skills/verify-conformance/SKILL.md)                                                                    |
| README creation or revision                                    | [write-readme](.agents/skills/write-readme/SKILL.md)                                                                                |
| Dependency refreshes or newly supported strict checks          | [update-toolchain](.agents/skills/update-toolchain/SKILL.md)                                                                        |
| Write or amend a SPEC or interaction contract                  | [specification guidance](docs/specifications.md)                                                                                    |
| Recording a design decision                                    | [Decisions and local evidence](docs/development-workflow.md#decisions-and-local-evidence)                                           |
| Setup, toolchain, publication, and lint details                | [CONTRIBUTING.md](CONTRIBUTING.md)                                                                                                  |
| GitHub issue and PR labels, bodies, and comments               | [Issue labels](docs/development-workflow.md#issue-labels) and [GitHub Markdown](docs/development-workflow.md#write-github-markdown) |

## Commands

Run `just --list` to list recipes. Prefer `just install`, `just new <name>`, `just fix`,
`just check`, and `just test` over the root `pnpm` scripts; use `pnpm` directly for package-filtered
commands such as `pnpm --filter @orbis/<name> test`, dependency-manifest changes, and publication.
Run every GitHub CLI command through [`agent-gh`](https://github.com/kvnxiao/agent-gh), which
accepts the same arguments as `gh`; do not invoke `gh` directly.

Before completing a change, run `just fix` and `just check`. After code edits, use `just fix` before
manual formatting or fixable lint repairs and inspect its diff. If lint errors stop formatting,
resolve them and rerun. After changing a dependency manifest, run `just install`.

## Contract before code

Before changing package code, read `packages/<name>/SPEC.md` and, for interactive packages, its
linked `docs/tui-interactions.md`. Identify affected `REQ-<behavior-slug>` requirements even when
the request omits specifications. These documents define approved behavior; current code does not.
Explicit developer direction approves the behavior it specifies; do not request the same approval
again. Make fixes and implementation choices within the approved contract. For contract changes, use
`revise-package` before implementation and update code, tests, the SPEC, and interaction document in
the same change set; material changes require developer direction. Do not weaken a SPEC to make code
pass.

Before a package's first published release, implement only the current approved SPEC. Delete
superseded code, settings, aliases, migrations, and tests; retain tests for current behavior and
failure paths. Add backward compatibility only for a published release's contract or an explicit
developer requirement.

The workflow's [work paths](docs/development-workflow.md#work-paths) determine whether a change
needs an issue plan or goes directly to a PR. Keep scratch work and run evidence where the
workflow's [local evidence rules](docs/development-workflow.md#decisions-and-local-evidence) place
them.

## Code design

The generated
[TypeScript architecture](.agents/skills/pi-coding-agent-rules/references/typescript-architecture.md),
[TypeScript code organization](.agents/skills/pi-coding-agent-rules/references/typescript-code-organization.md),
and
[TypeScript domain boundaries](.agents/skills/pi-coding-agent-rules/references/typescript-domain-boundaries.md)
references define the code design rules. Apply them during implementation and review.

## Effect in reference implementations

Prefer Effect v4 for reference implementations and repository scripts when it improves:

- Code quality and high-level legibility.
- Separation of concerns.
- Maintainability.

Use it when these gains outweigh added complexity and nonzero runtime costs. Assess synchronous
operations and data modeling too. Reject uses that worsen quality or legibility; uniform syntax
alone does not justify adoption.

Before implementing or reviewing Effect code, or assessing its adoption, follow the generated
[Effect v4 integration reference](.agents/skills/pi-coding-agent-rules/references/effect-v4-integration.md),
which defines how to read the installed guidance and preserve Pi host contracts. For adoption
assessment, the workspace documentation dependency is the root `effect` development dependency at
`node_modules/effect`. Select library approaches and verification in implementation plans. Do not
name Effect as a library choice or requirement in package SPECs or the SPEC template.

## Package conventions

- Scaffold each extension with `just new <name>` as `packages/<name>` with npm name `@orbis/<name>`.
  Publish TypeScript source without a build step, and export a default factory accepting
  `ExtensionAPI` from `src/index.ts`.
- Declare every imported dependency in the importing package: `catalog:` for pinned development
  dependencies, `workspace:^` for shared workspace packages, `"*"` peers with matching development
  dependencies for `@earendil-works/pi-*`, and ordinary runtime dependencies in `dependencies`.
  Commit `pnpm-lock.yaml`. Do not bundle Pi's runtime.
- Boundary data is any value the package did not construct in the current process, such as settings
  files, persisted records, and session entries. In a package that reads or writes boundary data,
  declare `typebox` as a `"*"` peer with a `catalog:` development dependency. Pin the catalog's
  `typebox` entry to the version in the supported Pi release's `package.json`.
- Validate boundary data with typebox schemas through the package's `src/records.ts`, which exports
  `parseRecord` and `readOptional`. Keep each package's copy identical to
  `templates/extension/src/records.ts`. Lint rejects `JSON.parse` elsewhere under a package's
  `src/`; `packages/plan` is exempt until it adopts `records.ts`.
- Use explicit `.ts` extensions on relative imports and package exports between workspace packages;
  do not import a sibling package's source through a relative path or a `tsconfig.paths` alias.
- Extract a shared package only for behavior used by multiple packages, and export its TypeScript
  source through its package `exports`.
- Keep each file within 500 lines and each function within 80 lines, counting blank and comment
  lines; the lint exempts `tests/` directories, `*.test.mts` files, `scripts/`, and `packages/plan`.
- Write scripts, tests, and Vitest configuration as `.mts`. Keep package tests in
  `tests/**/*.test.mts` with a `vitest.config.mts`; the root configuration discovers them.

## Tests

Automated tests, including `just test` and `just check`, must not call real models, start live agent
sessions, or incur model charges. Use local fixtures. For tests of agent turns, configure the Pi SDK
session with a scripted in-process provider and block network traffic except to local fixtures. Keep
real-model checks separate, explicit, and orchestrator-supervised, outside test discovery and
repository check commands.

Reproduce a bug with a failing test. When changing validation, test rejected inputs. Before and
after a refactor, run the same checks. Add runtime tests for new or changed extension behavior, run
the package tests, and load the package through Pi; type checking does not prove import
compatibility.

## Verify and deliver

Run `verify-changes`, a global skill, once on the accumulated change set before a commit or PR, and
include `verify-conformance` for affected contracts and `write-readme` for affected READMEs.
Reviewers report without editing; the orchestrator resolves findings within authorized scope and
reruns affected checks. Within `verify-changes`, `orbis-implementer` applies accepted implementation
fixes under step 5 of the start protocol; this overrides that skill's coordinator-only tree-mutation
scope and its fast-path limit on subagents. Review changes to agent instructions and configuration
under the workflow's [review rules](docs/development-workflow.md#review-and-delivery).

If the global `verify-changes` or `audit-prose` skill is required but unavailable, review the diff,
update affected documentation, audit prose, run repository checks, and report what was skipped.

The workflow's [authorization rules](docs/development-workflow.md#authorization) define what
authorized work may create, commit, push, and open. Do not merge, push to the default branch,
publish packages, or create releases without separate explicit authorization; developers review and
merge PRs. For issue-backed work, publish checkpoints under the workflow's
[checkpoint policy](docs/development-workflow.md#publish-checkpoint-artifacts).

## Writing

- Draft and publish GitHub issue and PR bodies and comments under the workflow's
  [GitHub Markdown rules](docs/development-workflow.md#write-github-markdown).
- In documentation, skills, and design discussions, introduce terms and concepts before using or
  comparing them. Before delivery, read changed documents top to bottom without following forward
  links; apply the [reading-order checks](docs/specifications.md#avoid-forward-references) to SPECs
  and interaction contracts.
- Omit comments that repeat code; comment only an external contract, hazard, or ordering constraint
  the code does not state. Keep docstrings to required API contracts and name tests for their
  assertions.
- Use imperative commit subjects and concrete PR descriptions, and audit prose with `audit-prose`.
