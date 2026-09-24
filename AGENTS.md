# Orbis development instructions

Orbis is the Orbis agent harness: a monorepo of modular Pi agent extensions. The name refers to
Latin _orbis_, a circle or orb, and the circle constant pi. Use the name explanation in project
introductions; keep operational documentation concrete.

## Start a session

At the start of substantive repository work, read the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) once and open the records for
the affected package or mechanism. If GitHub is unavailable, report the gap and continue independent
local work.

The [development workflow](docs/development-workflow.md) defines shared work, authorization,
checkpoints, and delivery. Its [agent model policy](docs/development-workflow.md#agent-models) maps
each role to a model and effort per host.

Route requests to resume, continue, work on, or take the next step on an issue through `work-issue`,
and infer the current stage instead of asking the user to name a skill. Treat status questions and
review-only requests according to their stated scope. When a host does not discover
`.agents/skills`, read the linked `SKILL.md`. `verify-changes` and `audit-prose` are global skills;
when they are unavailable, review the diff, update affected documentation, audit prose, run
repository checks, and report what was skipped.

| Trigger                                                             | Read or invoke                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Before touching any package                                         | [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md)                    |
| Start or resume tracked development                                 | [work-issue](.agents/skills/work-issue/SKILL.md)                                          |
| Package design                                                      | [design-package](.agents/skills/design-package/SKILL.md)                                  |
| Implementation planning                                             | [plan-implementation](.agents/skills/plan-implementation/SKILL.md)                        |
| Package contract changes, or code that drifted from its SPEC        | [revise-package](.agents/skills/revise-package/SKILL.md)                                  |
| Package conformance review, including the pass in `verify-changes`  | [verify-conformance](.agents/skills/verify-conformance/SKILL.md)                          |
| README creation or revision, including the pass in `verify-changes` | [write-readme](.agents/skills/write-readme/SKILL.md)                                      |
| Dependency refreshes or newly supported strict checks               | [update-toolchain](.agents/skills/update-toolchain/SKILL.md)                              |
| Writing or amending a SPEC or interaction contract                  | [specification guidance](docs/specifications.md)                                          |
| Recording a design decision                                         | [Decisions and local evidence](docs/development-workflow.md#decisions-and-local-evidence) |
| Workspace setup, toolchain, publication, and lint rule details      | [CONTRIBUTING.md](CONTRIBUTING.md)                                                        |
| Issue bodies, PR bodies, and comments                               | [GitHub Markdown](docs/development-workflow.md#write-github-markdown)                     |

## Commands

Run `just` to list recipes. Prefer `just install`, `just new <name>`, `just fix`, `just check`, and
`just test` over the root `pnpm` scripts; use `pnpm` directly for package-filtered commands such as
`pnpm --filter @orbis/<name> test`, dependency-manifest changes, and publication.

After editing code, run `just fix` before repairing formatting or fixable lint errors by hand, and
inspect the resulting diff. When lint errors remain, the recipe stops before formatting; resolve
them and rerun. After changing a dependency manifest, run `just install`. Before completing a
change, run `just fix` and `just check`.

## Package conventions

`CONTRIBUTING.md` documents the compiler options and lint rules that `just check` enforces. Apply
these conventions as well.

- Scaffold each extension with `just new <name>` as `packages/<name>` with npm name `@orbis/<name>`.
  Publish TypeScript source with no build step, and export a default factory accepting
  `ExtensionAPI` from `src/index.ts`.
- Declare every imported dependency in the importing package: `catalog:` for pinned development
  dependencies, `workspace:^` for shared workspace packages, `"*"` peers with matching development
  dependencies for `@earendil-works/pi-*`, and ordinary runtime dependencies in `dependencies`.
  Commit `pnpm-lock.yaml`. Do not bundle Pi's runtime.
- Boundary data is any value the package did not construct in the current process, such as settings
  files, persisted records, and session entries. Validate it with typebox schemas through one
  per-package parse helper.
- Use explicit `.ts` extensions on relative imports and package exports between workspace packages;
  do not import a sibling package's source through a relative path or a `tsconfig.paths` alias.
- Keep single-use code local; extract a shared package only for behavior used by multiple packages.
- Keep each file within 500 lines and each function within 80 lines; the lint exempts `tests/`
  directories, `*.test.mts` files, `scripts/`, and `packages/plan`.
- Write scripts, tests, and Vitest configuration as `.mts`. Keep package tests in
  `tests/**/*.test.mts` with a `vitest.config.mts`; the root configuration discovers them.

## Contract before code

`packages/<name>/SPEC.md` and, for interactive packages, its linked `docs/tui-interactions.md`
define approved behavior. Before changing package code, read them and identify the affected
`REQ-<behavior-slug>` requirements, even when the request omits specifications. Make a fix within
the contract or a permitted implementation choice under the current contract. Route a contract
change through `revise-package` before implementation, and change code, tests, the SPEC, and the
interaction document in the same change set. Current code is evidence of implementation, not
approval of behavior; explicit user direction approves the behavior it specifies.

For unreleased packages, implement only the current approved SPEC. When behavior is replaced, delete
the superseded code, settings, aliases, migrations, and tests. Keep tests for current behavior and
its failure paths. Add backward compatibility only for an explicit released contract or user
requirement.

Work that introduces, improves, or changes package behavior is tracked in an issue whose body
contains the plan in the
[issue plan format](.agents/skills/plan-implementation/references/plan-format.md). A fix within the
contract, a documentation change, or a workspace tooling change goes straight to a PR whose body
records the outcome, acceptance, and verification. Keep scratch work and run evidence in ignored
`packages/<name>/implementation/` or `.artifacts/`; do not maintain a second authoritative plan.

## Tests

Automated tests, including `just test` and `just check`, must not call real models, start live agent
sessions, or incur model charges. Use local fixtures; when a test exercises an agent turn, configure
the Pi SDK session with a scripted in-process provider and block external network connections except
local fixture traffic. Run real-model checks only as separate, explicit, orchestrator-supervised
verification outside test discovery and repository check commands.

Reproduce a bug with a failing test. When changing validation, test rejected inputs. Before and
after a refactor, run the same checks. For changed extension behavior, run the package tests and
load the package through Pi; type checking does not prove import compatibility.

## Verify and deliver

Run `verify-changes` once on the accumulated change set before a commit or PR, and include
`verify-conformance` for affected contracts and `write-readme` for affected READMEs. Reviewers
report without editing; the coordinator resolves findings within authorized scope and reruns the
affected checks. Do not weaken a SPEC to make code pass; material contract changes need user
direction. Review agent instruction and configuration changes that affect routing, authorization,
delegation, checkpoints, or execution for correctness under the workflow's
[review rules](docs/development-workflow.md#review-and-delivery).

Within authorized work, create and update issues and Project items, and record decisions where the
workflow's [decision rules](docs/development-workflow.md#decisions-and-local-evidence) place them;
prepare verified commits on a work branch, push that branch, and open focused PRs. Developers review
and merge. Do not merge, push to the default branch, publish packages, or create releases without
separate explicit authorization. Honor requests limited to local or chat-only work. For issue-backed
work, publish a checkpoint comment at each stage transition, blocked or interrupted handoff, and
delivery, as described in the workflow's
[checkpoint policy](docs/development-workflow.md#publish-checkpoint-artifacts).

## Writing

- In GitHub issue and PR bodies and comments, keep each paragraph or list item on one physical line,
  draft in ignored `.artifacts/`, publish with `--body-file`, verify the stored body, and pass the
  no-reflow rule to prose auditors.
- Avoid forward references in documentation, skills, and design discussions: introduce a term,
  state, interface, or approach before using or comparing it. Before delivery, read changed
  documents top to bottom without following forward links, and apply the
  [reading-order checks](docs/specifications.md#avoid-forward-references) to SPECs and interaction
  contracts.
- Omit comments that repeat code; comment only an external contract, hazard, or ordering constraint
  the code does not state. Keep docstrings to required API contracts and name tests for their
  assertions.
- Use imperative commit subjects and concrete PR descriptions, and audit prose with `audit-prose`.
