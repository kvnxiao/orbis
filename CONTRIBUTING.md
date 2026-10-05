# Contributing to Orbis

Orbis extensions publish TypeScript source and use Pi's public extension API. Pi loads their `.ts`
entry points through Jiti; publication does not require a build step. [`AGENTS.md`](AGENTS.md)
contains the instructions coding agents follow and the package conventions every contributor
follows; this guide covers the workspace, the package lifecycle, and the checks.

## Requirements

| Component                 | Workspace version                    |
| ------------------------- | ------------------------------------ |
| Node.js for development   | `26.10.0`, pinned in `.node-version` |
| pnpm                      | `12.8.1`, pinned in `package.json`   |
| TypeScript                | `7.0.2`, used for type checking      |
| Pi coding agent           | `0.99.1`                             |
| Oxfmt                     | `0.71.0`                             |
| Oxlint                    | `1.86.0`                             |
| Oxlint type-aware checker | `oxlint-tsgolint@7.0.2003`           |
| Vitest                    | `5.0.2`                              |
| Effect                    | `4.0.0-rc.118`, approved v4 track    |
| Extension runtime minimum | Node.js `22.19.0`                    |

`pnpm-workspace.yaml` pins dependency versions in a shared catalog.

## Repository layout

```text
packages/                      Package specifications and available implementations
templates/extension/           Source-only package template
docs/development-workflow.md   How the agent workflow runs, with a map of its instructions
docs/specifications.md         Package specification guidance
docs/readme-guidelines.md      README guidance
docs/research/                 Research behind repository standards
.agents/skills/                Repository-local agent skills
.agents/shared/                Agent-only rules shared by several skills and agents
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

`just check` runs the formatting, lint, type, and test [checks](#checks). The root Pi manifest
discovers `packages/*/src/index.ts`. `pi install .` registers the local repository in Pi's user
settings without copying source. After changing extension source, use `/reload` in Pi.

To try one package for a single run, use `pi -e ./packages/<name>`. To register only that package,
use `pi install ./packages/<name>`; from inside the package directory, `pi install .` registers that
package.

## Design a package

Define a package's behavior in `packages/<name>/SPEC.md` before implementing it, following the
[specification guide](docs/specifications.md). A package that owns prompts, menus, forms, modals, or
interactive terminal views also documents its user flows in `docs/tui-interactions.md`, linked from
the SPEC. For packages with configurable behavior, follow the generated
[Pi settings and commands rules](.agents/skills/pi-coding-agent-rules/references/pi-settings-and-commands.md)
for the native menu boundary, reusable settings components, and command design.

The [development workflow](docs/development-workflow.md) explains how shared work is tracked and
delivered.

## Work with agents

The [development workflow](docs/development-workflow.md) explains how to ask the agents for work,
what each stage produces, and where you approve it. It also maps every skill, agent, and shared
instruction file.

## GitHub setup

The repository's Claude Code and Codex `PreToolUse` hooks block direct `gh` commands and point the
agent to [`agent-gh`](https://github.com/kvnxiao/agent-gh). `agent-gh` runs commands with your `gh`
login unless its profile routes them to a bot. Before your first agent session:

1. Authenticate `gh` with `gh auth login`, then add project access with
   `gh auth refresh --hostname github.com --scopes project`.
2. Install `agent-gh` and a GitHub App with Issues and Pull requests write access on the repository.
   Define a profile for the App with the
   [comments configuration](https://github.com/kvnxiao/agent-gh#comments-configuration) as its
   `run_as_bot` rules, so checkpoint comments show your bot as their author while issue, PR, and
   Project changes stay with your login.
3. Run `agent-gh self setup <profile>` in your clone to select the profile.
4. Run `agent-gh self status` and confirm that it prints the profile and its `run_as_bot` rules.
5. Trust the repository in Codex so it loads the project configuration. Configuration changes apply
   to new sessions.

The repository owner keeps these GitHub settings:

- The existing Project columns. Native auto-add for `repo:kvnxiao/orbis is:issue` is optional,
  because agents add their issues explicitly and verify membership.
- In the Project menu, **Workflows** → **Item closed** enabled with Status **Done**.
- In repository **Settings → General → Issues**, **Auto-close issues with merged linked pull
  requests** enabled.
- The repository wiki, enabled with its first page created on GitHub and editing restricted to
  collaborators. Agents clone it over SSH from `git@github.com:kvnxiao/orbis.wiki.git`.

Verify these settings in GitHub rather than assuming their defaults. GitHub documents
[sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues),
[PR closing links](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue),
[Project workflows](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations),
and
[wiki editing](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages).

## Add an extension

1. Write and review `packages/<name>/SPEC.md`, then derive implementation tasks from its
   requirements. Use a lowercase name such as `review` or `session-notes`; names must fit npm's
   length limit and avoid Windows device names.
2. When implementation starts, run `just new <name>` and then `just install`. The recipe adds the
   runtime files to `packages/<name>` with npm name `@orbis/<name>` and registers an example
   `/orbis-<name>` command. It requires an existing real directory containing `SPEC.md`, with
   optional `docs/research/`, `docs/tui-interactions.md`, and `implementation/`; it preserves those
   artifacts and rejects a missing SPEC, other existing contents, and linked directories without
   creating anything. The scaffold copies the repository license.
3. Implement `packages/<name>/src/index.ts` as a default factory that receives `ExtensionAPI` and
   registers commands, tools, and handlers. Keep runtime imports resolvable from the published
   package under the import rules in the [package conventions](AGENTS.md#package-conventions).
4. Declare dependencies and validate boundary data as the
   [package conventions](AGENTS.md#package-conventions) require. Validation goes through the
   scaffold's `src/records.ts`.
5. Add tests in `packages/<name>/tests/**/*.test.mts`. The scaffold includes a Pi loading test and a
   `vitest.config.mts` project named `@orbis/<name>`; the root Vitest configuration discovers it
   automatically.
6. Write the README with [write-readme](.agents/skills/write-readme/SKILL.md), following the
   [README guidance](docs/readme-guidelines.md).
7. Run `just install`, `just fix`, and `just check`, then load the extension through Pi and exercise
   its commands or tools.

The root package is private; individual extension packages publish independently, and each required
shared workspace library publishes before its consumers.

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
source through Pi and check command registration; the [test policy](AGENTS.md#tests) requires
runtime tests for new or changed extension behavior.

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
It remains enabled because dependency declarations fail under NodeNext:

- Pi AI has JSON imports without import attributes.
- Google GenAI references unavailable MCP and browser types.
- Tinybench references `DOMHighResTimeStamp` without a DOM library.

Node.js 22 type definitions constrain extension code to the supported runtime generation, and a
newer API still needs a test on the minimum supported runtime. Before adopting new JavaScript
syntax, decorators, or Node.js APIs, load the packed extension through every supported Pi
distribution and runtime.

## Lint rules

Oxlint enables type-aware checking in its configuration and treats correctness, suspicious-code, and
performance findings as errors. Rules reject unsafe `any` operations, unnecessary type assertions
and conditions, deprecated API use, and non-exhaustive switches. The type-aware
`typescript/no-generated-empty-object-type` rule also rejects types that resolve to an empty object
through type operations. Additional rules require type-only imports, braces, strict equality, and
constant declarations where possible.

- Compare strings and numbers explicitly in conditions, such as `name !== ""` or `count > 0`. Narrow
  nullable objects with explicit null or undefined comparisons.
- Await or return promises and thenables, or attach rejection handlers. Prefixing a discarded
  promise with `void` does not suppress the check.
- Return promises with `return await`; the `return-await` rule is configured as `always`.
- Throw and reject with `Error` objects. Direct rethrows of caught values are allowed; empty
  rejections and newly thrown or rejected `any` or `unknown` values are rejected.

Lint also enforces the file and function size limits and the `records.ts` parsing rule in the
[package conventions](AGENTS.md#package-conventions). In `packages/tiered-memory/src/`, lint also
rejects `AbortSignal.any` and `.throwIfAborted`: a composite signal reports different reasons on
Node 22 and on Node 24 and later, so decide cancellation from the fiber's exit and the first
recorded cancellation reason. Extensions must use Pi's UI or messaging APIs instead of writing to
the console. CLI scripts may print results and errors. Lint checks reject unused suppression
directives. Keep exceptions limited to the code that needs them.

## Checks

Run `just` to list the public workspace recipes: `install`, `new`, `fix`, `check`, and `test`.
[Commands](AGENTS.md#commands) in `AGENTS.md` states when to use a recipe or `pnpm` directly; root
`pnpm` scripts also run individual checks and watch mode.

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
load that installed package through Pi and test its behavior. Include the minimum Node.js version
and the tested Pi version in release checks. If the package supports Pi's standalone binary, test
that distribution too. Review the README against the
[README guidance](docs/readme-guidelines.md#review), including the npm description and `pi-package`
keyword that the catalog uses.

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

Effect follows the approved v4 track. Release discovery prefers the newest stable `4.x` release that
satisfies the same 24-hour age policy as other non-exempt dependencies. Until a stable v4 release is
eligible, it selects the highest eligible numeric `4.0.0-rc.N` release. Other major versions and
preview tracks are excluded. Migration from an RC to stable v4 is authorized, subject to
compatibility checks. Review the selected release's notes and installed guidance, then verify the
memory package's lifecycle and storage checks.

## References

- [Pi extensions](https://pi.dev/docs/latest/extensions)
- [Pi packages](https://pi.dev/docs/latest/packages)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [pnpm catalogs](https://pnpm.io/catalogs)
