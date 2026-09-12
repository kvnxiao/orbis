---
name: write-orbis-readme
description: Write or review Orbis repository and package READMEs for extension discovery, installation, and first use. Use when creating or revising a README or checking README changes before delivery.
---

# Write an Orbis README

Read [README guidance](../../../docs/readme-guidelines.md) before drafting. Determine whether the
target helps users choose packages or use one package. Inspect its current documentation, manifest,
commands, and implementation. For a package, read the SPEC and linked interaction contract before
making behavior claims.

Write the purpose, installation, and a realistic first use with its visible result. Follow the
guide's reading order and scale detail to the package. Keep prerequisites and material side effects
visible. Use the [extension template](../../../templates/extension/README.md) as an example, not a
mandatory list of sections.

Avoid forward references. Introduce package-specific terminology and each named approach before
using them in instructions or comparisons. Read the install-to-first-use path without following
forward links; explain missing prerequisites before the step that needs them. Advanced links may
add detail but must not supply context required to complete that path.

When shortening an existing README, move useful advanced usage, integration, and contributor
material to the guide's destinations. Preserve technical meaning, update incoming links, and check
instructions in other repository skills that name the former destination. Do not convert the
README into a specification or erase constraints to meet a length target.

Review the default install-to-first-use path without relying on contributor documentation. Check
manifest names, example commands, package-relative links, anchors, and published file inclusion.
When published pages are available, inspect npm and pi.dev rendering. Report unavailable checks
in the delivery response. Keep npm installation commands in the README without temporary availability
notices. Do not publish a package or change its behavior as part of README work.

Use the repository's accumulated-change verification and prose audit before delivery. README
review checks audience and navigation; package conformance review checks behavioral claims.
