# Contributing to Orbis

Orbis extensions publish TypeScript source and use Pi's public extension API. Pi loads their `.ts`
entry points through Jiti; publication does not require a build step.

## Requirements

| Component                 | Workspace version                   |
| ------------------------- | ----------------------------------- |
| Node.js for development   | `26.9.0`, pinned in `.node-version` |
| pnpm                      | `12.5.1`, pinned in `package.json`  |
| TypeScript                | `7.0.2`, used for type checking     |
| Pi coding agent           | `0.87.0`                            |
| Oxfmt                     | `0.68.0`                            |
| Oxlint                    | `1.83.0`                            |
| Oxlint type-aware checker | `oxlint-tsgolint@7.0.2002`          |
| Vitest                    | `5.0.1`                             |
| Extension runtime minimum | Node.js `22.19.0`                   |

`pnpm-workspace.yaml` pins dependency versions in a shared catalog. Node.js 22 type definitions
constrain extension code to the supported runtime generation. Newer APIs still need tests on the
minimum supported runtime.

The workspace sets
[`minimumReleaseAge: 1440`](https://pnpm.io/settings/dependency-resolution#minimumreleaseage) to
delay new direct and transitive dependency releases for one day. Exact package-name exclusions
exempt `@earendil-works/chord`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`,
`@earendil-works/pi-coding-agent`, `@earendil-works/pi-telemetry`, and `@earendil-works/pi-tui` from
that delay. Each exclusion applies to every version of its package. Temporary exclusions use exact
`package@version` entries. Toolchain updates retain the six package-name exclusions and remove
temporary exact-version exclusions once their releases qualify.

## Local development

With Pi installed globally and `pi` available on `PATH`, run from the repository root:

```sh
just install
just new review
just install
just check
pi install .
pi
```

The scaffold creates `packages/review` as `@orbis/review` and registers an example `/orbis-review`
command. When the directory contains `SPEC.md` and optional `docs/research/`,
`docs/tui-interactions.md`, and `implementation/`, the scaffold preserves those artifacts and adds
runtime files. For a new directory, it includes a specification starter. Define and review the
contract before replacing the example command with the extension's intended behavior.

The root Pi manifest discovers `packages/*/src/index.ts`. `pi install .` registers the local
repository in Pi's user settings without copying source. After changing extension source, use
`/reload` in Pi.

To try a package for one run, use:

```sh
pi -e ./packages/review
```

To register only that package, use `pi install ./packages/review`. From inside the package
directory, `pi install .` registers that package.

## Design a package

When the design needs research, save its synthesis in `packages/<name>/docs/research/` before
writing `SPEC.md`. Simple packages can omit research docs. Review the spec's requirements, then
derive implementation tasks from the approved contract. The
[specification guide](docs/specifications.md) defines this workflow and how to write
package-specific contracts. Follow the [development workflow](docs/development-workflow.md) to
create a bounded initiative, plan work through GitHub sub-issues, and deliver focused PRs. Issue
bodies contain the authoritative implementation plans. Local scratch work and detailed evidence
remain optional and ignored.

For packages that own prompts, menus, forms, modals, or interactive terminal views, explore the user
flows before approving the design and document them in `docs/tui-interactions.md`, linked from the
SPEC. Commands that only execute an action or print output do not need this file.

For packages with configurable behavior, consult
[Pi settings integration](docs/pi-extension-settings.md) for the native menu boundary, reusable
settings components, and command design.

Repository-local skills support package design, implementation planning, and revision:

- [work-orbis-issue](.agents/skills/work-orbis-issue/SKILL.md) starts or resumes work from an issue
  or concrete request, reads relevant wiki decisions, and coordinates the specialist skills.

- [brainstorm-orbis-package](.agents/skills/brainstorm-orbis-package/SKILL.md) researches existing
  packages and Pi APIs, works through decision rounds, saves research synthesis, and writes a
  specification. When the global `brainstorm` skill can be loaded, it defines the conversation
  format; otherwise, the package skill uses its built-in interaction instructions.
- [plan-orbis-implementation](.agents/skills/plan-orbis-implementation/SKILL.md) turns an approved
  specification into issue implementation plans with concrete edits, dependencies, and verification
  against the current code.
- [revise-orbis-package](.agents/skills/revise-orbis-package/SKILL.md) coordinates approved behavior
  changes across the SPEC, interaction scenarios, plans, code, and tests. Package code requests
  require contract inspection even without an explicit skill invocation.

For example, ask `$work-orbis-issue resume https://github.com/kvnxiao/orbis/issues/<number>`. The
agent inspects the issue and current repository, identifies the next unblocked action, and continues
within the task's authorization. It leaves verified PRs for developer review and merge.

Follow the [agent model policy](docs/development-workflow.md#agent-models) for model selection and
implementation handoffs.

To start implementation, open a new Codex session in the updated, trusted repository and send:

```text
$work-orbis-issue implement https://github.com/kvnxiao/orbis/issues/<number>
```

This request authorizes implementation of that issue. The Astra orchestrator checks its contract and
dependencies, assigns the required skills, delegates bounded implementation to Sol, and coordinates
Astra reviews and PR delivery. The orchestrator launches the delegates; the developer reviews and
merges the PR. For planning without implementation, invoke `$plan-orbis-implementation` with the
package or issue instead.

In Codex, invoke `$work-orbis-issue`, `$brainstorm-orbis-package`, `$plan-orbis-implementation`, or
`$revise-orbis-package`. In Pi, use `/skill:work-orbis-issue`, `/skill:brainstorm-orbis-package`,
`/skill:plan-orbis-implementation`, or `/skill:revise-orbis-package`. After project trust is
established, Pi discovers the repository's `.agents/skills`. When a host does not discover these
skills, ask it to read the linked `SKILL.md` directly.

## Repository layout

```text
packages/                 Package specifications and available implementations
templates/extension/      Source-only package template and specification starter
docs/specifications.md    Specification and implementation-planning workflow
.agents/skills/           Repository-local design and development skills
.codex/                   Codex session defaults and custom agents
scripts/                  Scaffolding and verification scripts
pnpm-workspace.yaml       Workspace discovery and dependency catalog
tsconfig.base.json        Shared TypeScript constraints
tsconfig.json             Root scripts, configuration, and template type checking
vitest.config.mts         Workspace, template, and package test projects
AGENTS.md                 Instructions for coding agents
```

## Add an extension

1. Write and review `packages/<name>/SPEC.md`, then derive implementation tasks from its
   requirements. Use a lowercase name such as `review` or `session-notes`; names must fit npm's
   length limit and avoid Windows device names.
2. When implementation starts, run `just new <name>`. The recipe creates the npm name
   `@orbis/<name>`, preserves an existing `SPEC.md` and optional `docs/research/`,
   `docs/tui-interactions.md`, and `implementation/`, and rejects other existing package contents.
   The package, `docs`, `research`, and `implementation` directories must be real directories.
   Implement `packages/<name>/src/index.ts` as a default factory that receives `ExtensionAPI`. Use
   the factory to register commands, tools, and handlers.
3. Use `import type` for types and explicit `.ts` extensions on relative imports. Keep runtime
   imports resolvable from the published package.
4. Declare every imported dependency in the package's `package.json`. Use `catalog:` for centrally
   pinned development dependencies. Declare imported Pi core packages and `typebox` as `"*"` peers
   with matching development dependencies. Put ordinary runtime dependencies in `dependencies`.
5. Add tests in `packages/<name>/tests/*.test.mts`. The scaffold includes a Pi loading test and a
   `vitest.config.mts` project named `@orbis/<name>`; the root Vitest configuration discovers it
   automatically.
6. Use [write-orbis-readme](.agents/skills/write-orbis-readme/SKILL.md) to describe purpose,
   installation, and first use. Keep material requirements and side effects visible; link detailed
   usage and development documentation. The scaffold copies the repository license.
7. Run `just install`, `just fix`, and `just check`, then load the extension through Pi and exercise
   its commands or tools.

Every extension package uses the `@orbis/*` npm scope. The root package is private; individual
extension packages publish independently.

For shared workspace libraries, use `workspace:^` in consuming packages and export the library's
TypeScript source through its package `exports`. Publish each required shared library before its
consumers. Keep imports within package boundaries; do not import a sibling's source through `../../`
paths or TypeScript path aliases.

## Package checks

From the repository root, load one package from source:

```sh
pi -e ./packages/exit
```

Run its tests with the package's npm name:

```sh
pnpm --filter @orbis/exit test
```

The Exit test loads the package through Pi and checks that `/exit` requests shutdown. For Plan's
fixtures, benchmarks, and terminal checks, see
[package development](packages/plan/docs/development.md). Use the same filtered commands with a new
package's name. The template test checks that `/orbis-<name>` registers and reports the loaded
package. Package tests also support `test:watch`.

## TypeScript compatibility

`pnpm typecheck` runs `typecheck:*` scripts in the workspace root and every package through pnpm's
recursive script runner. The root `typecheck:root` checks repository scripts, the root Vitest
configuration, and the extension template. Each package's `typecheck:node` checks its source, tests,
and Vitest configuration.

The extension scaffold includes `typecheck:node`. To add another TypeScript configuration, add a
`typecheck:<name>` script to its package. The root command includes it automatically. Use
`pnpm --filter @orbis/<name> check` to run only that package's `typecheck:*` scripts.

`tsc` checks source with `noEmit`. Pi's Jiti loader determines runtime syntax support; the workspace
compiler version does not upgrade that loader. `erasableSyntaxOnly`, `isolatedModules`, and
`verbatimModuleSyntax` restrict transform-sensitive constructs and require explicit type imports.

`noUncheckedIndexedAccess` includes `undefined` in unchecked array and index signature reads; narrow
those results before use. `exactOptionalPropertyTypes` distinguishes an omitted property from an
explicit `undefined`: omit optional properties unless their declared type accepts the assigned
value.

The TypeScript `target` and `lib` settings do not downlevel source or supply runtime APIs.
`skipLibCheck` skips checking dependency declaration files; workspace source remains type-checked.
Before adopting new JavaScript syntax, decorators, or Node.js APIs, load the packed extension
through every supported Pi distribution and runtime. Keep Pi and TypeBox runtime imports external to
the package.

## Lint rules

Oxlint enables type-aware checking in its configuration and treats correctness, suspicious-code, and
performance findings as errors. Rules reject unsafe `any` operations, unnecessary type assertions
and conditions, deprecated API use, and non-exhaustive switches. Additional rules require type-only
imports, braces, strict equality, and constant declarations where possible.

- Compare strings and numbers explicitly in conditions, such as `name !== ""` or `count > 0`. Narrow
  nullable objects with explicit null or undefined comparisons.
- Await or return promises and thenables, or attach rejection handlers. Prefixing a discarded
  promise with `void` does not suppress the check.
- When local error handling depends on promise settlement, use `return await`.
- Throw and reject with `Error` objects. Direct rethrows of caught values are allowed; empty
  rejections and newly thrown or rejected `any` or `unknown` values are rejected.

Extensions must use Pi's UI or messaging APIs instead of writing to the console. CLI scripts may
print results and errors. Lint checks reject unused suppression directives. Keep exceptions limited
to the code that needs them.

## Checks and publication

Run `just` to list common workspace commands. Use its recipes for root workspace operations; use
`pnpm` directly for package-filtered commands and publication.

```sh
just fix
just check
pnpm --filter @orbis/review pack --pack-destination .artifacts
```

`just fix` applies safe Oxlint fixes, then formats with Oxfmt. When lint errors remain, the recipe
stops before formatting; correct them and rerun `just fix`. The public recipes are `install`, `new`,
`fix`, `check`, and `test`; use root `pnpm` scripts for individual checks or watch mode.

`just check` checks formatting with Oxfmt, lints with Oxlint, checks types, and runs Vitest across
the workspace scripts, extension template, and extension packages. Local scripts use `.mts` and run
directly with Node.js native type stripping. Vitest runs `.test.mts` files; test execution does not
emit files for publication.

Use `pnpm test:watch` for watch mode, or `pnpm --filter @orbis/review test` to run one package's
tests. Each package also provides `test:watch`. The scaffold and template tests load TypeScript
source through Pi and check command registration. New extension behavior still needs its own runtime
tests.

Before publishing, inspect the tarball for `src/index.ts`, every imported source file, `SPEC.md`,
the package README, and `LICENSE`. Install the tarball and its runtime dependencies in a temporary
project outside this workspace, then load that installed package through Pi and test its behavior.
Include the minimum supported Node.js and Pi versions in release checks. If the package supports
Pi's standalone binary, test that distribution too.

Follow [README guidance](docs/readme-guidelines.md) to check the installation and first-use
examples, package-relative links, and documentation included in the tarball. Keep the npm
description focused on the package's purpose and include the `pi-package` keyword for catalog
discovery. When published pages are available, inspect the README on npm and pi.dev, including
images and links to repository documents. Package READMEs contain npm install commands without
temporary publication notices.

Use `pnpm pack` and `pnpm publish` to convert `workspace:` and `catalog:` references to ordinary npm
versions. These commands preserve TypeScript source. After the checks pass and the npm account has
publish access to the `@orbis` scope, publish the selected package:

```sh
pnpm --filter @orbis/review publish --access public
```

Users can then install the published extension:

```sh
pi install npm:@orbis/review
```

## Update the toolchain

In a fresh agent session, invoke `$update-toolchain` to refresh Node.js, pnpm, TypeScript, Pi, and
workspace dependencies and evaluate newly supported strict checks. The repository-local
[skill](.agents/skills/update-toolchain/SKILL.md) includes source-only package compatibility and
runtime verification. If the session does not discover local skills, ask it to read and follow that
file.

The skill runs [`scripts/update-toolchain.mts`](scripts/update-toolchain.mts) for dependency
inventory, release candidates selected under the workspace release-age policy, and installation,
scaffolding, packaging, and Pi loading checks. Commands emit JSON reports; compatibility decisions
and new compiler or lint checks remain agent tasks.

## References

- [Pi extensions](https://pi.dev/docs/latest/extensions)
- [Pi packages](https://pi.dev/docs/latest/packages)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [pnpm catalogs](https://pnpm.io/catalogs)
