# Orbis development instructions

## Project

Orbis is the Orbis agent harness: a monorepo of modular Pi agent extensions.
The name refers to Latin _orbis_, a circle or orb, and the circle constant pi.
Use the name explanation in project introductions; keep operational
documentation concrete.

## Package contract

- Scaffold extensions with `pnpm new:extension <name>`. Every extension package
  must use the npm name `@orbis/<name>` and directory `packages/<name>`.
- Publish TypeScript source. Keep `pi.extensions` pointed at `./src/index.ts`,
  include `src` in the published files, and retain `noEmit` in TypeScript
  configuration. Do not introduce a build or transpilation requirement.
- Export a default factory accepting `ExtensionAPI` from the package entry
  point. Register behavior through Pi's public extension API.
- Keep each extension independently installable. The root manifest discovers
  `packages/*/src/index.ts` for local `pi install .` use.
- Preserve the repository's MIT license and include `LICENSE` in each
  published package. Keep package-specific usage in its README.

## Dependencies and imports

- Use pnpm and its workspace catalog. Keep `pnpm-lock.yaml` committed.
- Declare dependencies in every package that imports them. Use `catalog:` for
  pinned development dependencies and `workspace:^` for shared packages.
- Declare imported `@earendil-works/pi-*` core packages and `typebox` as `"*"`
  peers with matching development dependencies. Do not bundle Pi's runtime.
- Put ordinary runtime dependencies in `dependencies`, never only in
  `devDependencies`.
- Use `import type` for types, explicit `.ts` extensions for relative imports,
  and package exports for imports between workspace packages. Avoid
  `tsconfig.paths` aliases and relative imports into sibling packages.
- Keep TypeScript as a checker. Compatibility depends on Pi's loader and the
  Node.js runtime, not the installed compiler version. Test new syntax and
  APIs on the package's supported runtimes before changing their requirements.

## Toolchain updates

- For dependency refreshes and newly supported strict checks, use
  [update-toolchain](.agents/skills/update-toolchain/SKILL.md). Read its workflow
  when automatic skill discovery is unavailable.

## Implementation

- Write local scripts, test files, and Vitest configuration as `.mts` files.
  Run scripts directly with Node.js native type stripping and run tests with
  Vitest. Include all of them in workspace type checking and linting.
- Keep package tests in `tests/**/*.test.mts` and configure each package in
  `vitest.config.mts`. The root Vitest configuration discovers package projects
  automatically. Use `pnpm --filter @orbis/<name> test` for package tests and
  `pnpm test` for the workspace suite.
- Preserve strict compiler and type-aware lint settings. Narrow unchecked
  indexed reads before use, and omit optional properties unless their types
  accept the assigned value.
- Compare strings and numbers explicitly in conditions. Await or return
  promises and thenables, or attach rejection handlers; `void` does not satisfy
  the promise check. When local error handling depends on settlement, use
  `return await`.
- Throw and reject with `Error` objects; direct rethrows of caught values are
  allowed. Avoid deprecated APIs and remove unnecessary conditions.
- State the behavior and its verification before implementing a change.
- Keep single-use code local. Extract shared packages only for behavior used by
  multiple packages.
- Reproduce bugs with a failing test. Test rejected inputs when changing
  validation. Before and after refactoring, run the same checks.
- Defer background processes and watchers to a session event or explicit
  command. Release session resources in a shutdown handler.
- Keep the scaffold and its tests consistent with package conventions.

## Verification

- Run `pnpm install` after changing dependency manifests.
- Run `pnpm format` and `pnpm check` before completing a change. Use targeted
  package tests and Pi loading checks for changed extension behavior.
- Before publication, use `pnpm pack` and test the tarball outside the
  workspace. Check that runtime imports resolve without workspace symlinks or
  development dependencies and that Pi registers the expected behavior.
- Test supported Node.js and Pi versions; test the standalone Pi binary when
  claiming support for it. A successful type check does not prove import
  compatibility.
- Run the `verify-changes` skill once on the accumulated change set when the
  skill is available. Otherwise review the diff, update affected docs, audit
  prose, and run repository checks. Report skipped or blocked checks.
- Do not publish packages, push commits, or create releases unless the user
  requests those actions.

## Writing

- Open with the result or constraint. Put prerequisites before their actions.
- Use direct execution verbs and preserve exact package names and runtime
  requirements. Distinguish verified behavior from recommendations.
- Omit comments that repeat code. Add a comment only for an external contract,
  hazard, or ordering constraint that the code does not express.
- Keep docstrings to required API contracts. Name tests for their assertions.
- Use imperative commit subjects and concrete PR descriptions. Audit prose
  with `audit-prose-via-codex` when available, or `audit-prose` otherwise.
