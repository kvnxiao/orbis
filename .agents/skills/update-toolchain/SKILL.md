---
name: update-toolchain
description:
  Update the Orbis workspace to current stable Node.js, pnpm, TypeScript, Pi, and development
  dependencies, including the approved Effect v4 stable and release-candidate tracks. Use when
  refreshing the toolchain or adopting newly supported compiler and type-aware lint checks while
  preserving source-only Pi packages.
---

# Update the Orbis toolchain

This skill refreshes Node.js, pnpm, TypeScript, Pi, and the development dependencies, and adopts
newly supported compiler and type-aware lint checks, in one verified change set that keeps Pi
packages source-only. `scripts/update-toolchain.mts` handles inventory, release selection, and
mechanical verification. Agent judgment covers compatibility, package migrations, new correctness
checks, and code fixes.

## 1. Capture the baseline

Run the script from the repository root:

```sh
mkdir -p .artifacts
node scripts/update-toolchain.mts baseline > .artifacts/toolchain-before.json
node scripts/update-toolchain.mts releases > .artifacts/toolchain-releases.json
```

Commands write JSON to stdout and progress to stderr. A failed command exits nonzero with
`ok: false`; resolve or report the failure before using its result. If the failure cannot be
resolved, return `Blocked`. Read the script's implementation only when a command fails or the
repository rules it checks change.

`inventory` collects the baseline facts without running `pnpm check`. Use it instead of `baseline`
only when the session already has a current baseline or explicitly skips checks.

The baseline records the Node.js and pnpm versions, the root, package, and template manifests, all
default and named catalog entries, the release-age and build policies, and the files requiring
review. Read:

- The reported `reviewFiles` relevant to the update.
- `CONTRIBUTING.md` for the workspace toolchain.
- Package `docs/development.md` files for compatibility checks.

## 2. Review the release candidates

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` and lists release-age exclusions under
`minimumReleaseAgeExclude`. Release discovery queries the configured npm registries through pnpm and
the [official Node.js release index](https://nodejs.org/dist/index.json), then:

- Sorts stable versions numerically and restricts `@types/node` to the declared runtime generation.
- Excludes npm releases younger than 1440 minutes at the report's `asOf` time. For a package whose
  name exactly matches a release-age exclusion, it can select the newest stable release immediately.
- Considers versions still listed in registry metadata and includes unused catalog entries.
- Reports exact-version exclusions eligible for removal. Other exclusions require review.
- Lists local references in `localDependencies`. It lists aliases, Git sources, and URLs in
  `manualDependencies`, which require source-specific review.

Effect follows the approved v4 policy under the same release-age rule:

- Prefer the newest eligible stable `4.x` release, including migration from an RC.
- Until a stable v4 release is eligible, select the highest eligible numeric `4.0.0-rc.N` release.
- Report no candidate when neither is eligible. Exclude other major versions, betas, snapshots, and
  other preview tracks.

Other dependencies remain stable-only. The report includes dist-tags, engines, peers, dependencies,
repository metadata, and tarball metadata for candidate review. It does not edit pins or install
upgrades, and an eligible candidate still requires a compatibility review. For non-registry
dependencies, renamed packages, or runtime ranges the script cannot interpret, inspect the source
and resolve the unsupported case explicitly. Do not substitute guessed versions for failed queries.

## 3. Decide compatibility and checks

The supported runtimes are the pinned development Node.js and an executable matching the exact root
`engines.node` minimum.

- Review official release notes and exact candidate source. Prefer Context7 for current library
  documentation when available. Verify package renames in their official repositories before
  changing dependency identities or imports.
- Prefer the latest compatible stable Node.js Current release for development. Keep development pins
  separate from published runtime requirements. Raising a development tool's requirement does not
  justify raising extension engines or the `@types/node` generation.
- Inspect the candidate Pi release's discovery, installation logic, Jiti version and configuration,
  raw `.ts` entry points, relative imports, and dependency resolution. Align related Pi packages
  with that release's dependencies. Native `.mts` execution does not prove Pi loader support.
- Select useful new compiler and type-aware lint checks from release notes, installed schemas, and
  effective configuration:
  - Preserve existing strict, promise, unsafe-operation, and error-handling checks.
  - Check Oxlint and `oxlint-tsgolint` compatibility.
  - Run `pnpm exec tsc --noEmit --skipLibCheck false`. When dependency declarations pass, remove
    `skipLibCheck`; otherwise, record the concrete declaration errors that require it.
- Review the selected Effect release notes and exact source. After installation, read the new
  installation's guidance as the `pi-coding-agent-rules` Effect v4 integration reference directs.
  Verify memory cancellation, scope teardown, durable writes, and independent packed loading on both
  supported runtimes.
- Before changing syntax, APIs, `target`, or `lib`, test the supported runtimes and the Pi loader.
  Preserve `noEmit`, `erasableSyntaxOnly`, and independent package installation. Fix findings
  without blanket suppressions or disabling type-aware analysis.

When a candidate is incompatible, query metadata for the newest compatible version that the
package's release-age rule permits, and select it. Record the blocker and continue independent
updates.

Routine Effect v4 RC updates and migration to stable v4 are already authorized, subject to
compatibility checks. Other Effect major versions and preview tracks require a developer request; do
not broaden the release-age exclusions implicitly.

## 4. Place each finding

A toolchain update request authorizes the update and the package fixes it requires, without an
implementation plan. Research release notes and source to choose work. A recommendations document
does not replace authorized implementation or contract updates.

Before creating an artifact, match each finding to its owner:

- Implement the fixes the update requires in current packages.
- Select SPEC and interaction document edits that do not change observable behavior, such as a
  refined host-compatibility statement or a conformance scenario for existing behavior. Keep
  requirement IDs when the behavior is refined rather than replaced.
- Leave a finding that changes observable behavior for a contract revision, without editing that
  contract.
- Record work outside the update's scope as a comment on the existing issue that owns its outcome,
  not in a second issue for the same work. Create an issue only for a distinct deliverable that
  needs its own execution or decision, under [issues.md](../../shared/issues.md). A new API, a
  restated requirement, or a paragraph-sized SPEC clarification is not a separate deliverable.
- Track work for unavailable packages under their existing delivery issues. Do not imply that a SPEC
  change implements the package.

The toolchain update, its package fixes, and the SPEC edits that do not change behavior belong in
the requested PR.

## 5. Apply the selected versions

Make the selected edits in one change set:

- Delegate the version updates and the compatibility fixes to `orbis-implementer` under
  [delegation.md](../../shared/delegation.md). The version updates cover default and named catalog
  values, `.node-version`, `packageManager`, and affected manifests, including package runtime
  requirements. The implementer activates the selected development Node.js and pnpm, then runs
  `just install` to regenerate the lockfile.
- For a non-trivial update, split the fixes into bounded implementer assignments, and assign
  `orbis-reviewer` a focused review of each risky migration under
  [review.md](../../shared/review.md) as it lands.
- The orchestrator updates the `CONTRIBUTING.md` version table, affected compatibility
  documentation, and the SPEC edits from step 4. It keeps development tool versions, such as the
  Node.js and pnpm pins, out of READMEs.

Preserve the `catalog:`, `catalog:<name>`, `workspace:^`, and Pi peer specifiers. Keep
`minimumReleaseAge: 1440` and the listed exclusions. Remove the exclusions that the release report
marks `remove`, and do not add exclusions for younger releases.

Review the catalog and lockfile diff. Installed versions alone do not establish that the catalogs
were updated.

## 6. Verify the update

Run the mechanical verification:

```sh
just fix
node scripts/update-toolchain.mts verify /absolute/path/to/minimum-node > .artifacts/toolchain-after.json
```

`verify` requires the pinned development pnpm and both supported runtimes. It checks:

- Package publication contracts and frozen installation.
- The catalog `typebox` pin against the installed Pi release's `typebox` dependency.
- `pnpm check`, effective compiler settings, and Oxlint type-aware configuration.
- An isolated workspace without a lockfile or shared `node_modules`, in which it scaffolds an
  extension, resolves fresh dependencies, and runs workspace and package checks.
- The packed generated extension. It installs the tarball with production dependencies and Pi
  outside the workspace, checks published files and resolved manifest references, and loads the
  extension through Pi on both supported runtimes. It also runs `pi install .` with temporary Pi
  settings and checks registration.

Temporary workspaces remain at the printed path for failure inspection. Each subprocess has a
120-second timeout. `ORBIS_PNPM` can select a pnpm executable.

The generated extension does not cover existing packages' behavior or tarballs, so run affected
package tests and packed-loading checks separately. Test the standalone Pi binary only when claiming
support for it. When a required runtime or check is unavailable, report the missing coverage, and do
not describe the update as fully verified.

Then account for every finding, and return the outcome that the Return section defines with the
finding placements. `work-issue` runs the review, which checks the placements alongside code
correctness, and delivers the requested PR.

## Return

Account for every useful finding as implemented, incorporated into the contract, tracked in a linked
issue, or declined with a concrete reason. Report:

- Old and selected versions, retained versions, and blockers.
- The Effect v4 policy applied.
- New checks and primary sources.
- Verification results. Distinguish measured command timings from upstream performance claims, and
  state skipped checks and unverified runtime or distribution support.

Return one outcome:

- `Done`, with the report: the selected versions are applied and verified, and no finding needs a
  contract revision.
- `Needs contract`, with the report and the affected requirements: a finding changes observable
  behavior that a package SPEC or interaction document defines.
- `Blocked`, with the failure and the decision it needs: a script command failed and the failure
  cannot be resolved.
