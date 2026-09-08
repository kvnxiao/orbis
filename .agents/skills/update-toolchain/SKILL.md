---
name: update-toolchain
description: Update the Orbis workspace to current stable Node.js, pnpm, TypeScript, Pi, and development dependencies. Use when refreshing the toolchain or adopting newly supported compiler and type-aware lint checks while preserving source-only Pi packages.
---

# Update the Orbis toolchain

Use `scripts/update-toolchain.mts` from the repository root for inventory,
release selection, and mechanical verification. Read its implementation only
when a command fails or the repository contract changes. Reserve agent judgment
for compatibility, package migrations, new correctness checks, and code fixes.

## Capture the baseline

```sh
mkdir -p .artifacts
node scripts/update-toolchain.mts baseline > .artifacts/toolchain-before.json
node scripts/update-toolchain.mts releases > .artifacts/toolchain-releases.json
```

Commands write JSON to stdout and progress to stderr. A failed command exits
nonzero with `ok: false`; resolve or report the failure before using its result.
`inventory` collects the baseline facts without running `pnpm check`. Use it
only when the session already has a current baseline or explicitly skips checks.

The baseline records Node.js and pnpm versions, root/package/template manifests,
all default and named catalog entries, release-age and build policies, and files
requiring review. Read `AGENTS.md` and the reported `reviewFiles` relevant to the
update. Preserve existing user changes.

Release discovery queries the configured npm registries through pnpm and the
[official Node.js release index](https://nodejs.org/dist/index.json). It sorts
stable versions numerically, excludes npm releases younger than 1440 minutes at
the report's `asOf` time, and restricts `@types/node` to the declared runtime
generation. It considers versions still listed in registry metadata, includes
unused catalog entries, and reports exact release-age exclusions eligible for
removal. Pattern exclusions require review. Local references appear in
`localDependencies`; aliases, Git sources, and URLs appear in
`manualDependencies` and require source-specific review.

npm candidates satisfy the release-age policy; compatibility still requires
review. The report includes dist-tags, engines, peers, dependencies, repository
metadata, and tarball metadata for candidate review. It does not edit pins or install
upgrades. For non-registry dependencies, renamed packages, or runtime ranges
the script cannot interpret, inspect the source and resolve the unsupported
case explicitly. Do not substitute guessed versions for failed queries.

## Decide compatibility and checks

- Review official release notes and exact candidate source. Prefer Context7
  for current library documentation when available. Verify package renames in
  their official repositories before changing dependency identities or imports.
- Prefer the latest compatible stable Node.js Current release for development.
  Keep development pins separate from published runtime requirements. Raising
  a development tool's requirement does not justify raising extension engines
  or the `@types/node` generation.
- Inspect the candidate Pi release's discovery, installation logic, Jiti version
  and configuration, raw `.ts` entry points, relative imports, and dependency
  resolution. Align related Pi packages with that release's dependencies.
  TypeScript checking and native `.mts` execution do not prove Pi loader support.
- Use release notes, installed schemas, and effective configuration to select
  useful new compiler and type-aware lint checks. Preserve existing strict,
  promise, unsafe-operation, and error-handling checks. Check Oxlint and
  `oxlint-tsgolint` compatibility. Run `pnpm exec tsc --noEmit --skipLibCheck false`.
  When dependency declarations pass, remove `skipLibCheck`; otherwise record the
  concrete declaration errors that require it.
- Before changing syntax, APIs, `target`, or `lib`, test the supported runtimes
  and Pi loader. Preserve `noEmit`, `erasableSyntaxOnly`, `.mts` scripts/tests/
  configuration, source publication, and independent package installation.
  Fix findings without blanket suppressions or disabling type-aware analysis.

When a candidate is incompatible, select the newest age-eligible compatible
version, record the blocker, and continue independent updates. Query metadata
for any fallback version before selecting it. Previews require a user request.

## Apply the selected versions

Update default and named catalog values, `.node-version`, `packageManager`,
affected manifests, and README version tables together. Preserve `catalog:`,
`catalog:<name>`, `workspace:^`, and Pi peer contracts. Keep dependency build
policies and `minimumReleaseAge: 1440`; remove exclusions marked `remove` in the
release report. Do not add exceptions for younger releases.

Activate the selected development Node.js and pnpm, then run `pnpm install` to
regenerate the lockfile. Review the catalog and lockfile diff. Installed versions
alone do not establish that the catalogs were updated.

## Verify the update

Run the repository's `verify-changes` workflow once for the accumulated change
set. Use these commands for its mechanical verification:

```sh
pnpm format
node scripts/update-toolchain.mts verify /absolute/path/to/minimum-node > .artifacts/toolchain-after.json
```

`verify` requires the pinned development Node.js and pnpm and an executable
matching the exact root `engines.node` minimum. It checks package publication
contracts, frozen installation, `pnpm check`, effective compiler settings, and
Oxlint type-aware configuration. It creates an isolated workspace without a
lockfile or shared `node_modules`, scaffolds an extension, resolves fresh
dependencies, and runs workspace and package checks.

The script packs the generated extension, installs its tarball with production
dependencies and Pi outside the workspace, checks published files and resolved
manifest references, and loads it through Pi on both runtime executables. It
also runs `pi install .` with temporary Pi settings and checks registration.
Temporary workspaces remain at the printed path for failure inspection. Each
subprocess has a 120-second timeout. `ORBIS_PNPM` can select a pnpm executable.

The generated extension does not cover existing packages' behavior or tarballs.
Run affected package tests and packed-loading checks separately. Test the
standalone Pi binary only when claiming support for it. When a required runtime
or check is unavailable, report the missing coverage; do not describe the update
as fully verified. Never add a build step to satisfy loading checks.

Report old and selected versions, retained versions and blockers, new checks,
primary sources, and verification results. Distinguish measured command timings
from upstream performance claims. State skipped checks and unverified runtime
or distribution support. Follow repository authorization rules for publication.
