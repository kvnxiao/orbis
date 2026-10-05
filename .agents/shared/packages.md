# Package rules

Read this file before writing, planning, or reviewing package code, tests, manifests, or
dependencies.

## Scope of an implementation

Before a package's first published release, implement only its current approved SPEC. Delete
superseded code, settings, aliases, migrations, and tests, and keep tests for current behavior and
failure paths. Add backward compatibility only for a published release's contract or an explicit
developer requirement.

## Code design

Apply the generated `pi-coding-agent-rules` references for TypeScript architecture, TypeScript code
organization, and TypeScript domain boundaries during implementation and review.

## Package conventions

- After the package's `SPEC.md` exists, scaffold the extension with `just new <name>` as
  `packages/<name>` with npm name `@orbis/<name>`. Publish TypeScript source without a build step,
  and export a default factory accepting `ExtensionAPI` from `src/index.ts`.
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

Use local fixtures in automated tests. For tests of agent turns, configure the Pi SDK session with a
scripted in-process provider, and block network traffic except to local fixtures. Keep real-model
checks separate from test discovery and repository check commands.

- Reproduce a bug with a failing test.
- When changing validation, test rejected inputs.
- Before and after a refactor, run the same checks.
- Add runtime tests for new or changed extension behavior, run the package tests, and load the
  package through Pi; type checking does not prove import compatibility.
