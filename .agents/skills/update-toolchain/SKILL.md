---
name: update-toolchain
description:
  Update the Orbis workspace to current stable Node.js, pnpm, TypeScript, Pi, and development
  dependencies, including the approved Effect v4 release-candidate track. Use when refreshing the
  toolchain or adopting newly supported compiler and type-aware lint checks while preserving
  source-only Pi packages.
---

# Update the Orbis toolchain

Use `scripts/update-toolchain.mts` from the repository root for inventory, release selection, and
mechanical verification. Read its implementation only when a command fails or the repository
contract changes. Reserve agent judgment for compatibility, package migrations, new correctness
checks, and code fixes. In compatibility proposals, introduce runtime targets, package roles, and
migration approaches before comparing or selecting them.

## Capture the baseline

```sh
mkdir -p .artifacts
node scripts/update-toolchain.mts baseline > .artifacts/toolchain-before.json
node scripts/update-toolchain.mts releases > .artifacts/toolchain-releases.json
```

Commands write JSON to stdout and progress to stderr. A failed command exits nonzero with
`ok: false`; resolve or report the failure before using its result. `inventory` collects the
baseline facts without running `pnpm check`. Use it only when the session already has a current
baseline or explicitly skips checks.

The baseline records Node.js and pnpm versions, root/package/template manifests, all default and
named catalog entries, release-age and build policies, and files requiring review. Read the reported
`reviewFiles` relevant to the update, `CONTRIBUTING.md` for the workspace toolchain, and package
`docs/development.md` files for compatibility checks. Preserve the developer's existing changes.

Release discovery queries the configured npm registries through pnpm and the
[official Node.js release index](https://nodejs.org/dist/index.json). It sorts stable versions
numerically and restricts `@types/node` to the declared runtime generation. It excludes npm releases
younger than 1440 minutes at the report's `asOf` time unless the package name exactly matches a
release-age exclusion. For an exact package-name exclusion, release discovery can select the newest
stable release immediately. Effect uses the repository-approved `4.0.0-rc.N` track: select the highest
numeric RC that meets the same release-age cutoff, and report that track explicitly. Do not replace it with Effect 3
stable, a beta, a snapshot, or another major version. If no RC is eligible, report no candidate
instead of falling back to stable. Other dependencies remain stable-only.

It considers versions still listed in registry metadata, includes unused
catalog entries, and reports exact-version exclusions eligible for removal. Other exclusions require
review. Local references appear in `localDependencies`; aliases, Git sources, and URLs appear in
`manualDependencies` and require source-specific review.

npm candidates either satisfy the release-age cutoff or match an exact package-name exclusion;
compatibility still requires review. The report includes dist-tags, engines, peers, dependencies,
repository metadata, and tarball metadata for candidate review. It does not edit pins or install
upgrades. For non-registry dependencies, renamed packages, or runtime ranges the script cannot
interpret, inspect the source and resolve the unsupported case explicitly. Do not substitute guessed
versions for failed queries.

## Decide compatibility and checks

- Review official release notes and exact candidate source. Prefer Context7 for current library
  documentation when available. Verify package renames in their official repositories before
  changing dependency identities or imports.
- Prefer the latest compatible stable Node.js Current release for development. Keep development pins
  separate from published runtime requirements. Raising a development tool's requirement does not
  justify raising extension engines or the `@types/node` generation.
- Inspect the candidate Pi release's discovery, installation logic, Jiti version and configuration,
  raw `.ts` entry points, relative imports, and dependency resolution. Align related Pi packages
  with that release's dependencies. TypeScript checking and native `.mts` execution do not prove Pi
  loader support.
- Use release notes, installed schemas, and effective configuration to select useful new compiler
  and type-aware lint checks. Preserve existing strict, promise, unsafe-operation, and
  error-handling checks. Check Oxlint and `oxlint-tsgolint` compatibility. Run
  `pnpm exec tsc --noEmit --skipLibCheck false`. When dependency declarations pass, remove
  `skipLibCheck`; otherwise record the concrete declaration errors that require it.
- Review the selected Effect RC release notes and exact source. After installation, read its
  `AGENTS.md` and relevant guidance under the Effect integration rules. Verify memory cancellation,
  scope teardown, durable writes, and independent packed loading on both supported runtimes.
- Before changing syntax, APIs, `target`, or `lib`, test the supported runtimes and Pi loader.
  Preserve `noEmit`, `erasableSyntaxOnly`, `.mts` scripts/tests/ configuration, source publication,
  and independent package installation. Fix findings without blanket suppressions or disabling
  type-aware analysis.

When a candidate is incompatible, select the newest compatible version permitted by that package's
release-age rule, record the blocker, and continue independent updates. Query metadata for any
fallback version before selecting it. The Effect v4 RC track is already approved for routine updates.
Other preview tracks require a developer request; do not broaden the approved track or release-age exclusions implicitly.

## Place and complete adoption work

Treat a requested toolchain adoption as a change to the workspace and its affected packages. Research
release notes and source to choose work; do not substitute a recommendations document for authorized
implementation or contract updates.

Before creating an artifact, match each finding to its owner:

- Put observable behavior, host compatibility, and conformance checks in the existing package SPEC
  and interaction contract. Keep requirement IDs when the behavior is refined rather than replaced.
- Put implementation steps in an existing issue when it already owns that outcome. Update its plan
  and acceptance checks instead of creating a second ticket for the same work.
- Create an issue only for a distinct deliverable that needs its own execution or decision. A new
  API, a restated requirement, or a paragraph-sized SPEC clarification is not a separate deliverable.
- Implement authorized changes in current packages. Track work for unavailable packages under their
  existing delivery issues; do not imply that a SPEC change implements the package.

Before PR delivery, account for every useful finding as implemented, incorporated into the contract,
tracked in a linked issue, or declined with a concrete reason. Apply `revise-package` and
`plan-implementation` where their routing conditions match. Put package changes, relevant SPEC
amendments, and the toolchain update in the requested PR; verify issue relationships and Project
membership for any work it creates or updates. Review this placement alongside code correctness.

## Apply the selected versions

The orchestrator keeps version selection, compatibility decisions, and accumulated verification.
Make the approved edits in one change set, divided under the
[executor rule](../../../AGENTS.md#start-a-session) in `AGENTS.md`:

- `orbis-implementer` updates default and named catalog values, `.node-version`, `packageManager`,
  and affected manifests, including package runtime requirements, and makes the compatibility fixes.
  It then activates the selected development Node.js and pnpm and runs `just install`, which runs
  `pnpm install`, to regenerate the lockfile.
- The orchestrator updates the `CONTRIBUTING.md` version table and affected compatibility
  documentation. It keeps development tool versions, such as the Node.js and pnpm pins, out of
  READMEs. Where documentation names the Pi release, it describes the new release as tested, not
  required, under the `AGENTS.md` [package conventions](../../../AGENTS.md#package-conventions).

Preserve `catalog:`, `catalog:<name>`, `workspace:^`, and Pi peer contracts. Keep
`minimumReleaseAge: 1440` and the package-name exclusions listed in `pnpm-workspace.yaml`; remove
exclusions the release report marks `remove`, and do not add exclusions for younger releases.

Review the catalog and lockfile diff. Installed versions alone do not establish that the catalogs
were updated.

## Verify the update

Verify the accumulated change set under the
[repository verification rule](../../../AGENTS.md#verify-and-deliver). Use these commands for its
mechanical verification:

```sh
just fix
node scripts/update-toolchain.mts verify /absolute/path/to/minimum-node > .artifacts/toolchain-after.json
```

`verify` requires the pinned development Node.js and pnpm and an executable matching the exact root
`engines.node` minimum. It checks package publication contracts, frozen installation, the catalog
`typebox` pin against the installed Pi release's `typebox` dependency, `pnpm check`, effective
compiler settings, and Oxlint type-aware configuration. It creates an isolated workspace
without a lockfile or shared `node_modules`, scaffolds an extension, resolves fresh dependencies,
and runs workspace and package checks.

The script packs the generated extension, installs its tarball with production dependencies and Pi
outside the workspace, checks published files and resolved manifest references, and loads it through
Pi on both runtime executables. It also runs `pi install .` with temporary Pi settings and checks
registration. Temporary workspaces remain at the printed path for failure inspection. Each
subprocess has a 120-second timeout. `ORBIS_PNPM` can select a pnpm executable.

The generated extension does not cover existing packages' behavior or tarballs. Run affected package
tests and packed-loading checks separately. Test the standalone Pi binary only when claiming support
for it. When a required runtime or check is unavailable, report the missing coverage; do not
describe the update as fully verified. Never add a build step to satisfy loading checks.

Report old and selected versions, retained versions and blockers, new checks, primary sources, and
verification results. Distinguish measured command timings from upstream performance claims. State
skipped checks and unverified runtime or distribution support. Publication requires separate
authorization under the [delivery limits](../../../AGENTS.md#verify-and-deliver).
