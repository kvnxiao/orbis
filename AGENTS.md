# Orbis development instructions

## Project

Orbis is the Orbis agent harness: a monorepo of modular Pi agent extensions. The name refers to
Latin _orbis_, a circle or orb, and the circle constant pi. Use the name explanation in project
introductions; keep operational documentation concrete.

## Commands and skills

Use the root `justfile` for common workspace commands. Run `just` to list the available recipes, and
prefer `just install`, `just new <name>`, `just fix`, `just check`, and `just test` over their root
`pnpm` scripts. Use `pnpm` directly for package-filtered commands, dependency-manifest changes,
publication, and commands without a `just` recipe.

After editing code, run `just fix` before manually repairing formatting or fixable lint errors. It
applies safe Oxlint fixes and then formats with Oxfmt. Let these tools expand one-line blocks,
adjust whitespace, and apply supported lint corrections. When lint errors remain, the recipe stops
before formatting; resolve them and rerun `just fix`. Inspect the resulting diff, then run
`just check`. Use root `pnpm` scripts for individual formatting, linting, type-checking, or watch
commands.

Use these skills at their stated triggers. When automatic discovery is unavailable, read the linked
skill files.

| Trigger                                               | Required skill                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Before touching any package                           | [pi-coding-agent-rules](.agents/skills/pi-coding-agent-rules/SKILL.md)         |
| Package design                                        | [brainstorm-orbis-package](.agents/skills/brainstorm-orbis-package/SKILL.md)   |
| Implementation planning                               | [plan-orbis-implementation](.agents/skills/plan-orbis-implementation/SKILL.md) |
| Package contract changes                              | [revise-orbis-package](.agents/skills/revise-orbis-package/SKILL.md)           |
| Dependency refreshes or newly supported strict checks | [update-toolchain](.agents/skills/update-toolchain/SKILL.md)                   |
| Package conformance review                            | [verify-orbis-conformance](.agents/skills/verify-orbis-conformance/SKILL.md)   |
| README creation or revision                           | [write-orbis-readme](.agents/skills/write-orbis-readme/SKILL.md)               |

## Package requirements

- Scaffold extensions with `just new <name>`. Every extension package must use directory
  `packages/<name>` and npm name `@orbis/<name>`. Keep the scaffold and its tests consistent with
  package conventions.
- Publish TypeScript source with `pi.extensions` set to `./src/index.ts`, `src`, `SPEC.md`, and
  `LICENSE` included, and TypeScript `noEmit` retained. Preserve the MIT license. Do not require a
  build or transpilation step.
- Export a default factory accepting `ExtensionAPI` from the package entry point and register
  behavior through Pi's public extension API.
- Keep extensions independently installable. The root manifest discovers `packages/*/src/index.ts`
  for local `pi install .` use. Document package usage in its README.
- Use pnpm's workspace catalog and commit `pnpm-lock.yaml`. Declare dependencies in every importing
  package; use `catalog:` for pinned development dependencies and `workspace:^` for shared packages.
- Declare imported `@earendil-works/pi-*` core packages and `typebox` as `"*"` peers with matching
  development dependencies. Do not bundle Pi's runtime. Put ordinary runtime dependencies in
  `dependencies`, never only `devDependencies`.
- Use `import type` for types, explicit `.ts` extensions for relative imports, and package exports
  between workspace packages. Avoid `tsconfig.paths` aliases and relative imports into sibling
  packages.
- A package can await implementation with only `SPEC.md` and optional `docs/research/`,
  `docs/tui-interactions.md`, and `implementation/`. `just new <name>` preserves these artifacts
  while adding runtime files and does not create plan directories. It rejects other existing package
  contents and linked package, `docs`, `research`, or `implementation` directories.

## Contract workflow

### Design and approval

- When research informs a package design, persist its synthesis in `packages/<name>/docs/research/`
  before writing `SPEC.md`. Research documents are optional for simple packages with settled
  behavior.
- Before implementing package behavior, define it in `packages/<name>/SPEC.md` using
  [specification guidance](docs/specifications.md) and package-specific headings. Write a complete
  system contract for an independent Pi implementer: architecture, responsibilities, public
  interfaces, state, persistence, lifecycle guarantees, permitted implementation choices,
  conformance criteria, and explicit implementation availability.
- Keep the SPEC current with approved behavior, including failure, cancellation, recovery, and
  ordering guarantees. Exclude provenance, review history, and verification journals. Put file
  layouts, internal types, algorithms, and task decomposition in implementation plans unless an
  external compatibility contract requires them in the SPEC.
- Use package-local requirement IDs in the form `REQ-<behavior-slug>`, written in kebab-case as a
  two-to-four-word noun phrase matching the requirement's title, such as `REQ-approval-event`. Never
  use ordinals, obligation verbs, library names, or the package name. Implementation tasks reference
  these IDs and have separate names; cross-package references also name the package.
- A slug implies no order or completeness, so document order and section headings define the reading
  path. Amend requirements through the lifecycle rules in
  [specification guidance](docs/specifications.md): keep the slug when the behavior's identity
  survives, mint one for separated behavior, retire one for defunct behavior, and rename only a slug
  that contradicts what it names. After a retirement or rename, sweep the package for the old slug
  and resolve every reference. Do not reuse a retired slug.
- For prompts, menus, forms, modals, or interactive terminal views, link `docs/tui-interactions.md`
  from the SPEC as the normative interaction contract. Put detailed appearance, labels, key
  mappings, focus, and user flows there under the same requirement IDs; do not duplicate detailed UI
  details in the SPEC. Headings there name the interaction area alone and keep stable anchors; a
  `Requirements:` line in the section body lists its requirement IDs. Together, the documents define
  the complete package contract. Before design approval, explore user flows and document scenarios
  and branching or multistep diagrams. When UI values or implementation decisions form a group,
  define the facets and scenarios in prose and put their concrete values in a table with facets or
  scenarios as rows. Add columns for modes or configurations; use one value column when no matrix
  applies. Use the table for symbol, emoji, color, label, and other variant mappings. Commands that
  only execute an action or print output do not need an empty interaction document.
- Before deriving implementation work, review relevant specification requirements with the user.
  Existing session approval is sufficient; explicit user direction approves the behavior it
  specifies. Resolve only material unanswered decisions.

### Changes and planning

- Before changing package code, read its SPEC and linked interaction contract and identify affected
  requirements, even when the request omits specifications. Distinguish fixes within the contract,
  permitted implementation choices, and contract changes. Before implementing contract changes,
  update affected requirements and scenarios through `revise-orbis-package`. Keep the contract,
  interaction documentation, code, and tests consistent within the same change set.
- When iteration has already landed in code without a contract update, reconcile the drift through
  `revise-orbis-package`. Enumerate current public behavior, then keep, amend, mint, or retire each
  slug. Minting and retirement need a user decision; existing code is evidence of implementation,
  not approval of behavior.
- Derive tasks from the approved contract and current source. Each task identifies requirements,
  dependencies, observable outcomes, and verification. Before implementing a change, state its
  behavior and verification. Save plans under `packages/<name>/implementation/` by default; Git
  ignores these directories.

## Implementation

- For unreleased packages, implement only the current approved SPEC. When behavior is replaced,
  delete obsolete code, settings, aliases, migrations, and tests for the superseded behavior. Add
  backward compatibility only for an explicit released contract or user requirement. Keep tests for
  current behavior and its failure paths.
- Keep single-use code local. Extract shared packages only for behavior used by multiple packages.
- Preserve strict compiler and type-aware lint settings. Before use, narrow unchecked indexed reads.
  Omit optional properties unless their types accept the assigned value.
- Compare strings and numbers explicitly in conditions. Await or return promises and thenables, or
  attach rejection handlers; `void` does not satisfy the promise check. When local error handling
  depends on settlement, use `return await`.
- Throw and reject with `Error` objects; direct rethrows of caught values are allowed. Avoid
  deprecated APIs and remove unnecessary conditions.
- Defer background processes and watchers to a session event or explicit command. Release session
  resources in a shutdown handler.
- Write local scripts, tests, and Vitest configuration as `.mts` files; include them in workspace
  type checking and linting. Run scripts directly with Node.js native type stripping and tests with
  Vitest.
- Keep package tests in `tests/**/*.test.mts` and configuration in `vitest.config.mts`. The root
  Vitest configuration discovers package projects automatically. Use
  `pnpm --filter @orbis/<name> test` for package tests and `just test` for the workspace suite.
- Reproduce bugs with a failing test. When changing validation, test rejected inputs. Before and
  after refactoring, run the same checks.

## Verification and delivery

### Tests and compatibility

- Automated local tests, including Vitest, `just test`, and `just check`, must not invoke real
  models, start autonomous live-agent sessions, or incur model charges. Use local unit and
  integration fixtures. When a test exercises an agent turn, Pi SDK sessions must use scripted
  in-process providers. Block external network connections in those tests and allow only local
  fixture traffic.
- Run real-agent checks with real models only as separate, explicit in-session verification
  supervised by the active orchestrator. Do not include them in test discovery or ordinary
  repository check commands.
- Keep TypeScript as a checker. Runtime compatibility depends on Pi's loader and Node.js, not the
  installed compiler version. Test supported Node.js and Pi versions. Before changing runtime
  requirements, test new syntax and APIs on the package's supported runtimes. When claiming
  standalone Pi binary support, test that binary. Type checking does not prove import compatibility.

### Change review

- After changing dependency manifests, run `just install`. Before completing a change, run
  `just fix` and `just check`. For changed extension behavior, run targeted package tests and Pi
  loading checks.
- When available, run `verify-changes` once on the accumulated change set. Otherwise review the
  diff, update affected documentation, audit prose, and run repository checks. Report skipped or
  blocked checks.
- Within `verify-changes`, use `verify-orbis-conformance` for affected package contracts and
  interactions with unchanged behavior, including SPEC-only changes against available source and
  tests. For an explicit package conformance review, use full-package scope; scoped review does not
  establish full conformance.
- Conformance reviewers use clone-available artifacts, exclude ignored plans, journals, and prior
  chat conclusions, and report without editing reviewed artifacts. Derive expected results from the
  approved contract, not current output. Required behavior must be implemented and verified; public
  behavior must be described by the system or interaction contract or explicitly permitted as an
  implementation choice. UI details belong in the interaction document and need not be repeated in
  the SPEC. Moving rules between documents preserves their meaning and verification obligations.
- Report requirement IDs and supporting checks; separate confirmed deviations from unverified
  obligations. Classify discrepancies as implementation defects, missing verification, or proposed
  contract amendments.
- When conformance review finds a discrepancy, the `verify-changes` coordinator resolves it within
  authorized scope, rechecks affected requirements, and reruns affected verification. Apply the
  contract-change workflow to approved behavior changes. After review fixes, update approved
  contract wording without adding implementation mechanics or provenance to the SPEC. For unresolved
  behavior, obtain the missing user decision. Do not weaken the SPEC to make code pass; material
  contract changes require user direction.

### Evidence and publication

- Colocate verification records and run evidence, including real-agent checks, with plans in the
  default Git-ignored implementation directory. Tracking or publishing evidence requires explicit
  user opt-in. Do not create publicly referenced verification documents or link package
  documentation to local evidence. Keep reusable test instructions in `CONTRIBUTING.md` or package
  `docs/development.md`; package documentation describes behavior and compatibility limits without
  session logs or test-run results.
- Before publication, use `pnpm pack` and test the tarball outside the workspace. Check that runtime
  imports resolve without workspace symlinks or development dependencies and that Pi registers the
  expected behavior.
- Do not publish packages, push commits, or create releases unless the user requests those actions.

## Writing

- Avoid forward references in documentation, skills, and design discussions. Before using a
  package-specific term, acronym, state, interface, or named approach, introduce its meaning and
  role. Before comparing approaches or asking the user to choose, explain each approach and the
  context needed to assess it.
- Order sections and paragraphs by knowledge prerequisites: purpose and scope, shared concepts,
  behavior, then dependent details and verification. Adapt headings to the artifact; a short
  document can introduce a term in its first sentence of use instead of adding a glossary.
- Links to later sections may supply optional detail, but must not supply context needed to
  understand the current passage. When concepts depend on each other, introduce their shared model
  before describing their separate rules. Preserve requirement IDs and obligations when moving text.
- Before delivery, read changed documents from top to bottom without following forward links. Move
  or introduce missing prerequisites at the earliest dependent passage. Apply the
  [specification reading-order checks](docs/specifications.md#avoid-forward-references) to SPECs and
  their linked interaction contracts.
- Follow [README guidance](docs/readme-guidelines.md) for repository and package READMEs. Before
  advanced reference or contributor material, state the purpose, required setup, installation, and a
  realistic first use with its expected result. Keep npm installation commands without temporary
  publication or repository-visibility notices.
- Put workspace development and toolchain documentation in `CONTRIBUTING.md`. Put detailed package
  usage, integrations, and development in focused package docs when needed; preserve complete
  contracts in the SPEC and interaction document. Use the extension README template as an example,
  not a mandatory section list or word limit.
- During `verify-changes`, apply `write-orbis-readme` to affected READMEs and review their links and
  published file inclusion. Conformance review checks behavioral claims; README review checks the
  path from installation to first use.

- Open with the result or constraint. Put prerequisites before their actions.
- Use direct execution verbs and preserve exact package names and runtime requirements. Distinguish
  verified behavior from recommendations.
- Omit comments that repeat code. Add a comment only for an external contract, hazard, or ordering
  constraint that the code does not express.
- Keep docstrings to required API contracts. Name tests for their assertions.
- Use imperative commit subjects and concrete PR descriptions. Audit prose with
  `audit-prose-via-codex` when available, or `audit-prose` otherwise.
