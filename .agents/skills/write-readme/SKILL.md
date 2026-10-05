---
name: write-readme
description:
  Write or review Orbis repository and package READMEs for extension discovery, installation, and
  first use. Use when creating or revising a README or checking README changes before delivery.
---

# Write an Orbis README

This skill writes or reviews a repository or package README so that a reader can choose an
extension, install it, and complete a first use. The result is a README that meets the README
guidelines, or review findings against them.

If `work-issue` did not start this work, first follow
[starting-work.md](../../shared/starting-work.md), with the Stage values in
[work-paths.md](../../shared/work-paths.md) and the labels in
[github-markdown.md](../../shared/github-markdown.md). A README review skips that step and needs
only the README paths or the change set to check.

1. Read the [README guidelines](../../../docs/readme-guidelines.md) before drafting. They define the
   reading order, the documentation destinations, and the review checks.
2. Determine whether the target helps users choose packages or use one package.
3. Inspect the target's current documentation, manifest, commands, and implementation. For a
   package, read its SPEC and linked interaction document before making behavior claims.
4. When writing, cover the purpose, installation, and a realistic first use with its visible result,
   and scale the detail to the package. Move detailed usage, integrations, and development material
   to the destinations the guidelines list, and update incoming links.
5. Before delivery, apply the guidelines'
   [review checks](../../../docs/readme-guidelines.md#review).

## Return

Return `Done` with the README paths, the behavioral claims and their sources, the links inspected,
and any published rendering or installation check that could not run. For a review, also return the
findings from the review checks.
