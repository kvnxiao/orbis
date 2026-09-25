# Orbis development instructions

Orbis is an agent harness built from modular Pi extensions in a monorepo. In project introductions,
explain the name: Latin _orbis_, a circle or orb, and the circle constant pi. Keep operational
documentation concrete.

## Start a session

For small changes with settled scope, use the
[lightweight path](docs/development-workflow.md#lightweight-path). It overrides the procedural
requirements below and in repository skills; preserve contracts and authorization boundaries.

At the start of substantive work, read the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) once and open the records for
the affected package or mechanism. If GitHub is unavailable, report the gap and continue independent
local work.

The [development workflow](docs/development-workflow.md) defines shared work, authorization,
checkpoints, and delivery. Its [agent model policy](docs/development-workflow.md#agent-models) maps
each role to a model and effort per host.

For issue work, infer the current stage rather than asking the user to select a skill. Keep status
and review-only requests within their stated scope. If the host does not discover `.agents/skills`,
read the linked `SKILL.md`.

| Trigger                                               | Read or invoke                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Before touching any package                           | [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md)                    |
| Start, resume, or continue issue work                 | [work-issue](.agents/skills/work-issue/SKILL.md)                                          |
| Package design                                        | [design-package](.agents/skills/design-package/SKILL.md)                                  |
| Implementation planning                               | [plan-implementation](.agents/skills/plan-implementation/SKILL.md)                        |
| Contract changes or code that drifted from a SPEC     | [revise-package](.agents/skills/revise-package/SKILL.md)                                  |
| Package conformance review                            | [verify-conformance](.agents/skills/verify-conformance/SKILL.md)                          |
| README creation or revision                           | [write-readme](.agents/skills/write-readme/SKILL.md)                                      |
| Dependency refreshes or newly supported strict checks | [update-toolchain](.agents/skills/update-toolchain/SKILL.md)                              |
| Write or amend a SPEC or interaction contract         | [specification guidance](docs/specifications.md)                                          |
| Recording a design decision                           | [Decisions and local evidence](docs/development-workflow.md#decisions-and-local-evidence) |
| Setup, toolchain, publication, and lint details       | [CONTRIBUTING.md](CONTRIBUTING.md)                                                        |
| GitHub issue and PR bodies and comments               | [GitHub Markdown](docs/development-workflow.md#write-github-markdown)                     |

## Commands

Run `just --list` to list recipes. Prefer `just install`, `just new <name>`, `just fix`, `just check`, and
`just test` over the root `pnpm` scripts; use `pnpm` directly for package-filtered commands such as
`pnpm --filter @orbis/<name> test`, dependency-manifest changes, and publication.

Before completing a change, run `just fix` and `just check`. After code edits, use `just fix` before
manual formatting or fixable lint repairs and inspect its diff. If lint errors stop formatting,
resolve them and rerun. After changing a dependency manifest, run `just install`.

## Code design

Before adding or extending a TypeScript workflow, read the architecture and code organization
references in `pi-coding-agent-rules` and apply them during implementation and review.

- Use concrete names, straightforward control flow, and the smallest design that satisfies the
  current contract. Name intermediate decisions and use early returns when they clarify the main path.
- Before writing or extending a workflow, identify its decisions, effects, and owners. Keep operation
  order, dependencies, and failure paths visible; delegate transformation, I/O, and presentation
  details when they obscure that sequence. Separate decisions and transformations from execution
  when their rules can be understood and tested independently. Pass data in and return decisions or
  values; keep reads, writes, and lifecycle handling with their owners.
- Extract a local private helper, even for one caller, when its name, inputs, and result simplify
  the caller's reasoning. Keep short, clear operations and trivial forwarding inline. Introduce
  shared or configurable abstractions only for an established common contract or caller requirement.
- Organize modules around cohesive responsibilities and owned invariants; separate those with
  different dependencies or lifetimes. Give each shared rule one authoritative owner without
  coupling code that merely looks similar.
- Allow loops and mutation of locally owned values when they express the algorithm clearly. Keep
  borrowed data unchanged; give mutable state shared across operations an explicit owner and
  controlled update points.
- Express correlated states and outcomes as variants that carry the data each case requires. Keep
  independent optional data and retained history independent; validate relationships that types
  cannot express at the appropriate boundary.
- Pass only the data and capabilities an operation needs. Keep task ownership, cancellation,
  synchronization, and cleanup visible in the owning scope, including after extraction. Preserve
  transaction boundaries and revalidate potentially stale inputs before committing.

During implementation and review, examine workflows and helpers together for clear responsibilities
and data flow. Require each extraction to remove a specific reasoning burden; line counts and helper
counts do not establish a clear design.

## Package conventions

- Scaffold each extension with `just new <name>` as `packages/<name>` with npm name `@orbis/<name>`.
  Publish TypeScript source without a build step, and export a default factory accepting
  `ExtensionAPI` from `src/index.ts`.
- Declare every imported dependency in the importing package: `catalog:` for pinned development
  dependencies, `workspace:^` for shared workspace packages, `"*"` peers with matching development
  dependencies for `@earendil-works/pi-*`, and ordinary runtime dependencies in `dependencies`.
  Commit `pnpm-lock.yaml`. Do not bundle Pi's runtime.
- Validate data the package did not construct in the current process, including settings,
  persisted records, and session entries, with typebox schemas through one per-package parse helper.
- Use explicit `.ts` extensions on relative imports and package exports between workspace packages;
  do not import a sibling package's source through a relative path or a `tsconfig.paths` alias.
- Extract a shared package only for behavior used by multiple packages.
- Keep each file within 500 lines and each function within 80 lines; the lint exempts `tests/`
  directories, `*.test.mts` files, `scripts/`, and `packages/plan`.
- Write scripts, tests, and Vitest configuration as `.mts`. Keep package tests in
  `tests/**/*.test.mts` with a `vitest.config.mts`; the root configuration discovers them.

## Contract before code

Before changing package code, read `packages/<name>/SPEC.md` and, for interactive packages, its
linked `docs/tui-interactions.md`. Identify affected `REQ-<behavior-slug>` requirements even when
the request omits specifications. These documents define approved behavior; current code does not.
Explicit user direction approves the behavior it specifies. Make fixes and implementation choices
within the approved contract. For contract changes, use `revise-package` before implementation and
update code, tests, the SPEC, and interaction document in the same change set; material changes
require user direction. Do not weaken a SPEC to make code pass.

For unreleased packages, implement only the current approved SPEC. Delete superseded code, settings,
aliases, migrations, and tests; retain tests for current behavior and failure paths. Add backward
compatibility only for an explicit released contract or user requirement.

Track new or changed package behavior in an issue whose body contains the plan in the
[issue plan format](.agents/skills/plan-implementation/references/plan-format.md). Within-contract
fixes, documentation, and workspace tooling changes go directly to a PR recording outcome,
acceptance, and verification. Keep scratch work and run evidence in ignored
`packages/<name>/implementation/` or `.artifacts/`; do not maintain a second authoritative plan.

## Tests

Automated tests, including `just test` and `just check`, must not call real models, start live agent
sessions, or incur model charges. Use local fixtures. For tests of agent turns, configure the Pi SDK
session with a scripted in-process provider and block network traffic except to local fixtures.
Keep real-model checks separate, explicit, and orchestrator-supervised, outside test discovery and
repository check commands.

Reproduce a bug with a failing test. When changing validation, test rejected inputs. Before and
after a refactor, run the same checks. For changed extension behavior, run the package tests and
load the package through Pi; type checking does not prove import compatibility.

## Verify and deliver

Run `verify-changes` once on the accumulated change set before a commit or PR, and include
`verify-conformance` for affected contracts and `write-readme` for affected READMEs. Reviewers
report without editing; the coordinator resolves findings within authorized scope and reruns affected
checks. Review instruction and configuration changes affecting routing, authorization, delegation,
checkpoints, or execution under the workflow's
[review rules](docs/development-workflow.md#review-and-delivery).

If the global `verify-changes` or `audit-prose` skill is required but unavailable, review the diff,
update affected documentation, audit prose, run repository checks, and report what was skipped.

Within authorized work, create and update issues and Project items, record decisions under the
[decision rules](docs/development-workflow.md#decisions-and-local-evidence), and prepare verified
commits on a work branch, push it, and open focused PRs. Developers review and merge. Honor local-only
and chat-only requests. Do not merge, push to the default branch, publish packages, or create releases
without separate explicit authorization.

For issue-backed work, publish checkpoint comments at stage transitions, blocked or interrupted
handoffs, and delivery under the
[checkpoint policy](docs/development-workflow.md#publish-checkpoint-artifacts).

## Writing

- Draft GitHub bodies and comments in ignored `.artifacts/`, keep each paragraph or list item on one
  physical line, publish with `--body-file`, and verify the stored body. Pass the no-reflow rule to
  prose auditors.
- In documentation, skills, and design discussions, introduce terms and concepts before using or
  comparing them. Before delivery, read changed documents top to bottom without following forward
  links; apply the
  [reading-order checks](docs/specifications.md#avoid-forward-references) to SPECs and interaction
  contracts.
- Omit comments that repeat code; comment only an external contract, hazard, or ordering constraint
  the code does not state. Keep docstrings to required API contracts and name tests for their
  assertions.
- Use imperative commit subjects and concrete PR descriptions, and audit prose with `audit-prose`.
