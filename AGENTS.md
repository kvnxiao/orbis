# Orbis development instructions

## Project

Orbis is the Orbis agent harness: a monorepo of modular Pi agent extensions.
The name refers to Latin _orbis_, a circle or orb, and the circle constant pi.
Use the name explanation in project introductions; keep operational
documentation concrete.

## Package contract

- Before touching any package, ensure that the
  [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md) skill
  is used.
- Scaffold extensions with `just new <name>`. Every extension package
  must use the npm name `@orbis/<name>` and directory `packages/<name>`.
- Publish TypeScript source. Keep `pi.extensions` pointed at `./src/index.ts`,
  include `src` in the published files, and retain `noEmit` in TypeScript
  configuration. Do not introduce a build or transpilation requirement.
- Export a default factory accepting `ExtensionAPI` from the package entry
  point. Register behavior through Pi's public extension API.
- Keep each extension independently installable. The root manifest discovers
  `packages/*/src/index.ts` for local `pi install .` use.
- Preserve the repository's MIT license and include `LICENSE` in each
  published package. Include `SPEC.md` with published source and keep
  package-specific usage in its README.

Use the root `justfile` for common workspace commands. Run `just` to list the
available recipes, and prefer `just install`, `just new <name>`, `just format`,
`just check`, `just typecheck`, and `just test` over their root `pnpm` scripts.
Use `pnpm` directly for package-filtered commands, dependency-manifest changes,
publication, and commands without a `just` recipe.

## Specifications and implementation planning

- When research informs a package design, persist its synthesis in
  `packages/<name>/docs/research/` before writing `SPEC.md`. Research docs are
  optional for simple packages with settled behavior.
- Define each package in `packages/<name>/SPEC.md` before implementing its
  behavior. Follow [specification guidance](docs/specifications.md); choose
  headings for the package instead of imposing a common table of contents.
- Write specifications for an independent Pi implementer. State the complete
  required behavior, public contracts, permitted implementation choices, and
  conformance criteria. Keep implementation availability explicit.
- For packages with prompts, menus, forms, modals, or interactive terminal views,
  require `docs/tui-interactions.md` linked from `SPEC.md`. Explore user flows
  before design approval; document scenarios and branching or multistep diagrams
  against requirement IDs. Keep the SPEC self-contained. Commands that only
  execute an action or print output do not need an empty interaction document.
- Keep specifications current with approved behavior, including failure,
  cancellation, recovery, and ordering guarantees. Put file layouts, internal
  types, algorithms, and task decomposition in implementation plans unless an
  external compatibility contract requires them. Specifications contain the
  contract, not review history or verification journals.
- Use package-local requirement IDs in the form `REQ-001`. Implementation tasks
  reference these IDs and have separate names; cross-package references name the
  package as well.
- Review the relevant specification requirements with the user before deriving
  implementation work. Existing approval in the session is sufficient.
- Before changing package code, read its SPEC and identify affected requirements,
  even when the request does not mention specifications. Distinguish fixes within
  the contract, permitted implementation choices, and contract changes. For
  contract changes, follow
  [revise-orbis-package](.agents/skills/revise-orbis-package/SKILL.md) and update
  affected requirements and scenarios before implementation. Explicit user
  direction approves the behavior it specifies; resolve only material unanswered
  decisions. Keep the contract, interaction documentation, code, and tests
  consistent within the same change set.
- Derive implementation tasks from the approved contract and current source.
  Each task identifies requirements, dependencies, observable outcomes, and
  verification. Save local implementation plans under
  `packages/<name>/implementation/` by default; Git ignores these directories.
  The package scaffold does not create plan directories.
- Colocate verification records and run evidence with implementation plans in
  the default Git-ignored directory. Tracking or publishing evidence requires
  explicit user opt-in. Do not create publicly referenced verification documents
  or link package documentation to local evidence. Keep reusable test instructions
  in the package README; package documentation describes behavior and compatibility
  limits without session logs or test-run results.
- For package design, use
  [brainstorm-orbis-package](.agents/skills/brainstorm-orbis-package/SKILL.md).
  For implementation planning, use
  [plan-orbis-implementation](.agents/skills/plan-orbis-implementation/SKILL.md).
  Read their files when automatic discovery is unavailable.
- A package containing `SPEC.md` and optional `docs/research/`,
  `docs/tui-interactions.md`, and
  `implementation/` can await implementation. `just new <name>` preserves those artifacts while
  adding runtime files; it rejects other existing package contents and linked
  package, `docs`, `research`, or `implementation` directories.

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
  `just test` for the workspace suite.
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

- Automated local tests, including Vitest, `just test`, and `just check`, must not
  invoke real models, start autonomous live-agent sessions, or incur model charges.
  Use local unit and integration fixtures; Pi SDK sessions must use scripted
  in-process providers when a test exercises an agent turn. Block external network
  connections in those tests and allow only local fixture traffic.
- Run real-agent checks with real models only as separate, explicit in-session
  verification supervised by the active orchestrator. Do not include them in test
  discovery or ordinary repository check commands. Store their evidence beside
  the ignored implementation plans.
- Run `just install` after changing dependency manifests.
- Run `just format` and `just check` before completing a change. Use targeted
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
- As part of `verify-changes`, use
  [verify-orbis-conformance](.agents/skills/verify-orbis-conformance/SKILL.md)
  for affected package contracts and their interactions with unchanged behavior.
  Use its full-package scope for an explicit package conformance review. Read the
  skill file when automatic discovery is unavailable. Review SPEC-only changes
  against available source and tests as well.
- When conformance review finds a discrepancy, the `verify-changes` coordinator
  resolves it within the authorized scope and reruns affected verification.
  For approved behavior changes, use `revise-orbis-package` to synchronize the
  contract and implementation. For unresolved behavior, obtain the missing user
  decision. Conformance reviewers report findings without editing the artifacts
  under review.
- Conformance reviews use clone-available artifacts, not ignored plans, journals,
  or prior chat conclusions. Required behavior must be implemented and verified;
  public behavior must be described by the SPEC or fall within an explicitly
  permitted implementation choice. Report confirmed deviations separately from
  unverified obligations. A scoped review does not establish full conformance.
- Derive expected results from the approved contract, not the current output.
  Report requirement IDs, supporting checks, and unverified obligations. Keep
  saved run evidence local unless tracking is explicitly requested. Classify
  discrepancies as implementation defects, missing verification, or proposed
  contract amendments. Do not weaken the SPEC to make code pass; obtain user
  direction for material contract changes. After review fixes, recheck affected
  requirements and update approved contract wording
  without adding implementation mechanics or provenance to the SPEC.
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
