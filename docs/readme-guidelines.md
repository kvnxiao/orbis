# Orbis README guidelines

READMEs help users choose, install, and try extensions. Before advanced reference or contributor
material, explain the package's purpose, required setup, installation, and a realistic first use
with its expected result.

## Package READMEs

Use this reading order and adapt headings to the package:

1. **Purpose:** Name the user capability and when it is useful. Avoid implementation inventories.
2. **Install:** State required setup and show `pi install npm:@orbis/<name>`. Include activation
   instructions. Keep source builds and workspace setup in contributor documentation.
3. **Try it:** Show a command or natural-language request and its visible result. Complete the
   default workflow before introducing alternatives. Use tool-call JSON only for an API audience.
4. **How it works, when needed:** Explain activation, user decisions, saved output, and everyday
   behavior. Link internal architecture and complete schemas elsewhere.
5. **Further reading:** Link advanced usage, integrations, contributing, and the specification as
   needed. End with the license.

Keep prerequisites and material constraints beside the actions they affect. Required credentials,
runtime requirements, additional model calls, automatic edits, and file writes can change an
installation decision. Describe only constraints that apply to the package. Do not bury them in
contributor documentation to shorten the README.

The [extension template](../templates/extension/README.md) demonstrates the structure with its
actual example command. Replace the example behavior as implementation changes. Do not copy author
instructions into package READMEs or pad a small extension with empty sections.

A screenshot or short recording is optional when it explains an interaction faster than prose. Keep
a text-based quick start usable without the media. Use plain Markdown and verify links, images, and
code blocks in npm and pi.dev when a published preview is available. For repository-only documents
and assets, use absolute GitHub URLs; relative links must resolve from the package and its published
contents.

Judge concision by the reader's path to first use, not a word count or required section count. Avoid
provider catalogs, exhaustive option tables, contributor instructions, verification journals, and
implementation progress in the README. Keep npm commands in the authored README; do not add
temporary publication or repository-visibility notices. Release preparation verifies that the
published package and linked resources exist.

## Repository README

Introduce Orbis and its name, then help users choose independently installable extensions. Use a
linked package-and-purpose table and a representative installation and first-use example. Package
READMEs own detailed setup and usage. Link `CONTRIBUTING.md` for workspace setup, package design,
architecture, testing, and publication.

## Documentation destinations

| Content                                               | Destination                                       |
| ----------------------------------------------------- | ------------------------------------------------- |
| Workspace setup, toolchain, common tests, publication | Root `CONTRIBUTING.md`                            |
| Advanced user workflows, settings, troubleshooting    | Package `docs/usage.md`, when needed              |
| Extension integration APIs                            | Package `docs/integrations.md`, when needed       |
| Package-specific development and reusable checks      | Package `docs/development.md`, when needed        |
| Complete behavioral requirements                      | Package `SPEC.md` and linked interaction contract |
| Local run results and verification gaps               | Git-ignored implementation directory              |

Create supporting documents only when they contain useful material. Keep one authoritative account
of each detailed topic and update incoming links when moving it. The README summarizes current
behavior; it does not replace the specification.

## Review

Check that a reader can identify the purpose, satisfy prerequisites, install, and complete the first
example without reading a specification or contributor guide. Compare commands and claims with the
implementation and contract. Check package names, link targets and anchors, template substitutions,
published file inclusion, and the package description used by the catalog. Report unavailable
rendering or installation checks without inserting session results into public docs.
