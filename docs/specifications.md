# Package specifications

Each package's `packages/<name>/SPEC.md` defines its behavior for developers and independent
implementers. The installed global `write-spec` skill defines the specification and research format.
`plan-from-spec` produces executable plan sets, and `implement-spec-plan` executes them. This guide
supplies Orbis locations and Pi integration conventions.

A specification can be split by area of responsibility. Its root SPEC declares these area files,
which define their assigned requirements under the shared contract.

## Document locations

| Artifact                                         | Location                                     |
| ------------------------------------------------ | -------------------------------------------- |
| Package specification                            | `packages/<name>/SPEC.md`                    |
| Specification areas, when required by the format | `packages/<name>/specs/`                     |
| Package research and its index                   | `packages/<name>/docs/research/`             |
| Repository research                              | `docs/research/`                             |
| Executable plan set and its task state           | `.plans/<spec-slug>/` at the repository root |
| Detailed terminal interactions, when needed      | `packages/<name>/docs/tui-interactions.md`   |

Use a plan-directory slug that identifies its package and subject. Interpret paths in specification
and plan metadata relative to the declaring file, as the global formats require. Requirement IDs are
unique within a package's specification set; a cross-package reference names the package.

## Pi contracts and implementation status

Specify behavior against Pi's public capabilities. A named Pi release is a reference baseline for
inspected capabilities; source inspection does not establish runtime compatibility. State
implementation availability separately from specification approval.

A directory with only specifications and research is not an installable extension. `just new <name>`
scaffolds runtime files only after the package has a SPEC. A format conversion preserves approved
behavior, requirement identities, and verification obligations; it does not authorize implementing
the package.

## Terminal interactions

A package that owns prompts, menus, forms, modals, or interactive terminal views also defines its
detailed interaction contract in `docs/tui-interactions.md`. Commands that only perform an action or
print output do not require an empty interaction document.

The SPEC and any declared area files own system responsibilities, public interfaces, state,
persistence, ordering, and recovery. The interaction document defines layout, labels, key mappings,
focus, and user flows under those requirements. Declare its normative role in the SPEC's conformance
clause. Keep requirement statements and their scenarios in the specification set; reference the
requirements from detailed interaction scenarios without defining the same requirement twice.

Keep interaction heading anchors independent of requirement IDs. Put a `Requirements:` line in each
interaction section, and preserve links when requirements move. Describe initial state, user
actions, successful results, interruption, and recovery. Use diagrams where the global format calls
for them. Do not impose one layout or keymap across packages.

For grouped values or configurable display variants, introduce the displayed properties or
categories, then put their symbols, colors, labels, and other UI values in a table. Use a row per
property, category, or scenario and a column per mode or configuration.

## Validation and delivery

Use the installed global skills' format and structural checks, with the package's SPEC and research
paths. Preserve authored paragraph wrapping in specification, research, and plan files so formatting
does not split the single-line paragraphs the formats require. Review checks still assess behavior,
reading order, and whether scenarios distinguish correct results from plausible violations.

GitHub issues record scope, authorization, dependencies, and handoffs, and link the relevant plan
files. Plan files define executable tasks; their state files record execution progress. Convert a
contract or reconcile an issue-body plan before work that depends on the installed global format.
Preserve valid completed work and its evidence during reconciliation. When converting a package to
use `specs/`, include that directory in its manifest's published files and verify the packed
contract. Do not rewrite unrelated specifications as part of another package's change.

Keep global skills installed in the host environment. Resolve them by name through the host's skill
catalog; the repository does not vendor their contents or provide a competing format.
