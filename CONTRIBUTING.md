# Contributing to Orbis

Orbis extensions publish TypeScript source and use Pi's public extension API. Pi loads their `.ts`
entry points through Jiti; publication does not require a build step. `AGENTS.md` contains the
instructions coding agents follow in this repository; this guide covers the workspace, the package
lifecycle, and the checks.

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

`pnpm-workspace.yaml` pins dependency versions in a shared catalog.

## Repository layout

```text
packages/                      Package specifications and available implementations
templates/extension/           Source-only package template and specification starter
docs/development-workflow.md   Shared work, authorization, checkpoints, and delivery
docs/specifications.md         Package specification guidance
docs/readme-guidelines.md      README guidance
docs/pi-extension-settings.md  Research on settings menus for extensions
.agents/skills/                Repository-local design and development skills
.codex/                        Codex session defaults and custom agents
.claude/                       Claude Code session settings and custom agents
scripts/                       Scaffolding and toolchain scripts
justfile                       Common workspace recipes
package.json                   Root scripts, pnpm version, and Pi extension discovery
pnpm-workspace.yaml            Workspace discovery and dependency catalog
.node-version                  Development Node.js version
tsconfig.base.json             Shared TypeScript constraints
tsconfig.json                  Root scripts, configuration, and template type checking
oxlint.config.ts               Lint rules
oxfmt.config.ts                Formatting rules
vitest.config.mts              Workspace, template, and package test projects
AGENTS.md                      Instructions for coding agents
CONTRIBUTING.md                This guide
README.md                      Package catalog for users
pnpm-lock.yaml                 Resolved dependency versions
.gitignore                     Ignored scratch, artifact, and build paths
LICENSE                        MIT license, copied into each package
```

## Local development

With Pi installed globally and `pi` available on `PATH`, run from the repository root:

```sh
just install
just check
pi install .
pi
```

The root Pi manifest discovers `packages/*/src/index.ts`. `pi install .` registers the local
repository in Pi's user settings without copying source. After changing extension source, use
`/reload` in Pi.

To try one package for a single run, use `pi -e ./packages/<name>`. To register only that package,
use `pi install ./packages/<name>`; from inside the package directory, `pi install .` registers that
package.

## Design a package

Define a package's behavior in `packages/<name>/SPEC.md` before implementing it, following the
[specification guide](docs/specifications.md). A package that owns prompts, menus, forms, modals, or
interactive terminal views also documents its user flows in `docs/tui-interactions.md`, linked from
the SPEC. For packages with configurable behavior, consult
[Pi settings integration](docs/pi-extension-settings.md) for the native menu boundary, reusable
settings components, and command design.

The [development workflow](docs/development-workflow.md) defines how shared work is tracked: an
initiative issue for each bounded delivery, work issues whose bodies hold the implementation plan,
checkpoint comments that preserve completed work, a PR-only path for fixes and documentation, and
PRs that developers review and merge.

## Work with agents

`AGENTS.md` lists the repository skills under `.agents/skills/` with the trigger for each. The
design and delivery skills are:

- [work-issue](.agents/skills/work-issue/SKILL.md) starts or resumes work from an issue or concrete
  request and coordinates the specialist skills.
- [design-package](.agents/skills/design-package/SKILL.md) researches existing packages and Pi APIs,
  works through decision rounds, saves research synthesis, and writes a specification. When the
  global `brainstorm` skill can be loaded, it defines the conversation format; otherwise, the
  package skill uses its built-in interaction instructions.
- [plan-implementation](.agents/skills/plan-implementation/SKILL.md) turns an approved specification
  into issue implementation plans with concrete edits, dependencies, and verification against the
  current code.
- [revise-package](.agents/skills/revise-package/SKILL.md) coordinates approved behavior changes
  across the SPEC, interaction scenarios, plans, code, and tests.

The [agent model policy](docs/development-workflow.md#agent-models) maps each role to a model per
host.

In a new Codex or Claude Code session in the updated, trusted repository, send:

```text
Resume #<number>
```

An issue URL also works. The orchestrator loads `work-issue`, reports the issue's stage and next
action, and continues within the issue's approved scope, as
[Start or resume work](docs/development-workflow.md#start-or-resume-work) describes. To limit the
work, say `Resume #<number>, planning only`; to inspect without execution, ask
`What is the status of #<number>?`.

Explicit skill selection remains available. In Codex, invoke `$work-issue`, `$design-package`,
`$plan-implementation`, or `$revise-package`. In Pi, use `/skill:work-issue`,
`/skill:design-package`, `/skill:plan-implementation`, or `/skill:revise-package`. In Claude Code,
use `/work-issue`, `/design-package`, `/plan-implementation`, or `/revise-package`. After project
trust is established, Pi discovers the repository's `.agents/skills`. When a host does not discover
these skills, ask it to read the linked `SKILL.md` directly.

## Add an extension

1. Write and review `packages/<name>/SPEC.md`, then derive implementation tasks from its
   requirements. Use a lowercase name such as `review` or `session-notes`; names must fit npm's
   length limit and avoid Windows device names.
2. When implementation starts, run `just new <name>` and then `just install`. The recipe creates
   `packages/<name>` with npm name `@orbis/<name>` and registers an example `/orbis-<name>` command.
   It accepts a new directory or an existing real directory containing `SPEC.md` and optional
   `docs/research/`, `docs/tui-interactions.md`, and `implementation/`; it preserves those
   artifacts, adds the runtime files, and rejects other existing contents and linked directories.
   For a new directory it includes the specification starter; complete that contract before
   replacing the example command. The scaffold copies the repository license.
3. Implement `packages/<name>/src/index.ts` as a default factory that receives `ExtensionAPI` and
   registers commands, tools, and handlers. Keep runtime imports resolvable from the published
   package; [TypeScript compatibility](#typescript-compatibility) and [Lint rules](#lint-rules)
   describe the enforced import rules.
4. Declare every imported dependency in the package's `package.json`. Use `catalog:` for centrally
   pinned development dependencies and `workspace:^` for shared workspace libraries. Declare
   imported Pi core packages as `"*"` peers with matching development dependencies. In every package
   that reads or writes boundary data (values the package did not construct in the current process,
   such as settings files, persisted records, and session entries), declare `typebox` as a `"*"`
   peer with a `catalog:` development dependency and validate that data with typebox schemas through
   one per-package parse helper. Pin the catalog `typebox` to the `typebox` dependency version in
   the supported Pi release's `package.json`. Put ordinary runtime dependencies in `dependencies`.
   The scaffold's `src/records.ts` is that helper: it exports `parseRecord` and `readOptional`. Keep
   each package's copy identical to the template; the root convention test compares them.
5. Add tests in `packages/<name>/tests/**/*.test.mts`. The scaffold includes a Pi loading test and a
   `vitest.config.mts` project named `@orbis/<name>`; the root Vitest configuration discovers it
   automatically.
6. Write the README with [write-readme](.agents/skills/write-readme/SKILL.md), following the
   [README guidance](docs/readme-guidelines.md).
7. Run `just install`, `just fix`, and `just check`, then load the extension through Pi and exercise
   its commands or tools.

Every extension package uses the `@orbis/*` npm scope. The root package is private; individual
extension packages publish independently. For shared workspace libraries, export the library's
TypeScript source through its package `exports` and publish each required shared library before its
consumers. Keep imports within package boundaries; do not import a sibling's source through `../../`
paths or TypeScript path aliases.

## Package checks

From the repository root, load one package from source and run its tests with the package's npm
name:

```sh
pi -e ./packages/exit
pnpm --filter @orbis/exit test
```

The Exit test loads the package through Pi and checks that `/exit` requests shutdown. The template
test checks that `/orbis-<name>` registers. For Plan's fixtures, benchmarks, and terminal checks,
see [package development](packages/plan/docs/development.md). Use `pnpm test:watch` for workspace
watch mode; each package also provides `test:watch`. The scaffold and template tests load TypeScript
source through Pi and check command registration; new extension behavior still needs its own runtime
tests.

## TypeScript compatibility

`pnpm typecheck` runs `typecheck:*` scripts in the workspace root and every package through pnpm's
recursive script runner. The root `typecheck:root` checks repository scripts, the root Vitest
configuration, and the extension template. Each package's `typecheck:node` checks its source, tests,
and Vitest configuration. To add another TypeScript configuration, add a `typecheck:<name>` script
to its package; the root command includes it automatically. Use `pnpm --filter @orbis/<name> check`
to run only that package's `typecheck:*` scripts.

`tsc` checks source with `noEmit`. Pi's Jiti loader determines runtime syntax support; the workspace
compiler version does not upgrade that loader. `erasableSyntaxOnly`, `isolatedModules`, and
`verbatimModuleSyntax` restrict transform-sensitive constructs and require explicit type imports.

`noUncheckedIndexedAccess` includes `undefined` in unchecked array and index signature reads; narrow
those results before use. `exactOptionalPropertyTypes` distinguishes an omitted property from an
explicit `undefined`: omit optional properties unless their declared type accepts the assigned
value.

The TypeScript `target` and `lib` settings do not downlevel source or supply runtime APIs.
`skipLibCheck` skips checking dependency declaration files; workspace source remains type-checked.
Node.js 22 type definitions constrain extension code to the supported runtime generation, and a
newer API still needs a test on the minimum supported runtime. Before adopting new JavaScript
syntax, decorators, or Node.js APIs, load the packed extension through every supported Pi
distribution and runtime. Keep Pi and TypeBox runtime imports external to the package.

## Lint rules

Oxlint enables type-aware checking in its configuration and treats correctness, suspicious-code, and
performance findings as errors. Rules reject unsafe `any` operations, unnecessary type assertions
and conditions, deprecated API use, and non-exhaustive switches. Additional rules require type-only
imports, braces, strict equality, and constant declarations where possible.

- Compare strings and numbers explicitly in conditions, such as `name !== ""` or `count > 0`. Narrow
  nullable objects with explicit null or undefined comparisons.
- Await or return promises and thenables, or attach rejection handlers. Prefixing a discarded
  promise with `void` does not suppress the check.
- Return promises with `return await`; the `return-await` rule is configured as `always`.
- Throw and reject with `Error` objects. Direct rethrows of caught values are allowed; empty
  rejections and newly thrown or rejected `any` or `unknown` values are rejected.
- Keep each file within 500 lines and each function within 80 lines; both counts include blank and
  comment lines. Files under `tests/` directories, `*.test.mts` files, `scripts/`, and
  `packages/plan` are exempt.
- Parse JSON boundary data through the package's `records.ts`. `JSON.parse` elsewhere under a
  package's `src/` is a lint error; `@orbis/plan` is exempt until it adopts the module, which
  [#41](https://github.com/kvnxiao/orbis/issues/41) tracks.

Extensions must use Pi's UI or messaging APIs instead of writing to the console. CLI scripts may
print results and errors. Lint checks reject unused suppression directives. Keep exceptions limited
to the code that needs them.

## Checks

Run `just` to list common workspace commands. Use its recipes for root workspace operations; use
`pnpm` directly for package-filtered commands and publication. The public recipes are `install`,
`new`, `fix`, `check`, and `test`; use root `pnpm` scripts for individual checks or watch mode.

`just fix` applies safe Oxlint fixes, then formats with Oxfmt. When lint errors remain, the recipe
stops before formatting; correct them and rerun `just fix`.

`just check` checks formatting with Oxfmt, lints with Oxlint, checks types, and runs Vitest across
the workspace scripts, extension template, and extension packages. The workspace project includes
`scripts/package-conventions.test.mts`. It requires every package manifest to declare
`pi.extensions` as `./src/index.ts` and an `exports` field, requires `typebox` as a peer and
development dependency when the package source imports it or reads or writes boundary data, and
requires each package's `records.ts` to equal the template copy. Local scripts use `.mts` and run
directly with Node.js native type stripping. Vitest runs `.test.mts` files; test execution does not
emit files for publication.

## Publication

Before publishing, pack the package and inspect the tarball for `src/index.ts`, every imported
source file, `SPEC.md`, the package README, and `LICENSE`:

```sh
pnpm --filter @orbis/review pack --pack-destination .artifacts
```

Install the tarball and its runtime dependencies in a temporary project outside this workspace, then
load that installed package through Pi and test its behavior. Include the minimum supported Node.js
and Pi versions in release checks. If the package supports Pi's standalone binary, test that
distribution too. Review the README against the [README guidance](docs/readme-guidelines.md#review),
including the npm description and `pi-package` keyword that the catalog uses.

`pnpm pack` and `pnpm publish` convert `workspace:` and `catalog:` references to ordinary npm
versions and preserve TypeScript source. After the checks pass and the npm account has publish
access to the `@orbis` scope, publish the selected package:

```sh
pnpm --filter @orbis/review publish --access public
```

Users can then install the published extension:

```sh
pi install npm:@orbis/review
```

## Update the toolchain

The workspace sets
[`minimumReleaseAge: 1440`](https://pnpm.io/settings/dependency-resolution#minimumreleaseage) to
delay new direct and transitive dependency releases for one day. `pnpm-workspace.yaml` lists the
exact package-name exclusions, which apply to every version of the named `@earendil-works` packages,
and any temporary exact `package@version` exclusions. Toolchain updates retain the package-name
exclusions and remove temporary exact-version exclusions once their releases qualify.

In a fresh agent session, invoke the [update-toolchain](.agents/skills/update-toolchain/SKILL.md)
skill to refresh Node.js, pnpm, TypeScript, Pi, and workspace dependencies and evaluate newly
supported strict checks. The skill runs
[`scripts/update-toolchain.mts`](scripts/update-toolchain.mts) for dependency inventory, release
candidates selected under the release-age policy, and installation, scaffolding, packaging, and Pi
loading checks. Commands emit JSON reports; compatibility decisions and new compiler or lint checks
remain agent tasks.

## References

- [Pi extensions](https://pi.dev/docs/latest/extensions)
- [Pi packages](https://pi.dev/docs/latest/packages)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [pnpm catalogs](https://pnpm.io/catalogs)
