# Implementation plan formats

Research date: 2026-09-09. The inspected formats range from conversational Markdown
to persisted documents and structured task ledgers. They do not establish one
standard `PLAN.md` schema or evidence that a particular template is best.

## Codex

The public Plan Mode prompt at revision
`283f34387b7e16bd524d8f3a431f77aa7395471d` requests Markdown inside a
`<proposed_plan>` response block. Its suggested organization is a title, summary,
implementation changes, tests, and assumptions. It prefers behavior-oriented
groups and adds file detail when needed to prevent mistakes. This defines a
response format; it does not prescribe a local filename, task-file layout, or
durable progress schema. The inspected prompt distinguishes Plan Mode from the
`update_plan` progress tool.
[Public prompt](https://github.com/openai/codex/blob/283f34387b7e16bd524d8f3a431f77aa7395471d/codex-rs/collaboration-mode-templates/templates/plan.md).

OpenAI separately publishes an ExecPlan recipe for work spanning hours. Its
`PLANS.md` contains instructions for writing plans, rather than one particular
implementation plan. The recipe combines purpose, progress, discoveries,
decisions, outcomes, repository context, edits, concrete commands, acceptance,
recovery, evidence, and interfaces. It requires ongoing updates and enough context
to resume without the original conversation. This is a customizable published
recipe, not Codex's built-in Plan Mode template.
[ExecPlan recipe](https://developers.openai.com/cookbook/articles/codex_exec_plans).

For Orbis, concrete commands, acceptance evidence, and resume context are useful.
Copying the entire recipe would duplicate the approved specification and add
sections that small tasks do not need. Host response tags do not belong in saved
Markdown files.

## Claude Code

Official documentation describes writing and reviewing a plan, editing it with
Ctrl+G, and leaving Plan Mode through approval. The reviewed documentation does
not promise a fixed heading schema.
[Plan review](https://code.claude.com/docs/en/permission-modes#review-and-approve-a-plan).

The installed Claude Code 2.1.263 Windows executable contains final-plan
instructions that start with context, describe the recommended approach, identify
critical files and reusable functions, and include end-to-end verification. The
instructions favor a scannable document with sufficient execution detail and use
representative paths for repeated edits. The executable's configuration schema
describes `plansDirectory` as project-relative, with `~/.claude/plans/` as the
default. These are version-specific observations from the shipped binary, not
claims that every generated plan follows the instructions. No model session was
run for this comparison.

The published changelog also records configurable plan storage and prompt-derived
plan filenames. Those storage features do not establish a Markdown schema.
[Changelog](https://code.claude.com/docs/en/changelog).

For Orbis, critical paths, reuse decisions, and explicit verification improve
handoffs. The package specification already supplies the behavioral contract;
the implementation plan should explain how the current repository will satisfy it.

## Pi implementations

The package comparisons use pinned source and the installed Pi example. The
extensions were not executed. Source-defined prompts and parser constraints do
not prove the quality or conformance of generated plans.

| Implementation                               | Observed plan structure                                                                                                         | Storage or consumption                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi 0.85.1 shipped plan-mode example          | A `Plan:` header followed by numbered steps.                                                                                    | The parser extracts numbered items into session state; execution responses use completion markers. This is an example extension, not a universal Pi format. |
| `@narumitw/pi-plan-mode`, revision `1b96c32` | Markdown with a title, summary, behavior/interface changes, verification, and assumptions, following Codex's compact structure. | `plan_mode_complete` accepts the complete document. Optional export defaults to `PLAN.md`; exclusive file creation rejects an existing target.              |
| `@burneikis/pi-plan`, revision `bf636541`    | A plan title, `Goal`, numbered `Steps`, and `Notes`. Each step names touched files and an independently verifiable change.      | The extension requests a plan file and rejects a reviewed document without numbered steps under `Steps`.                                                    |
| `@dreki-gg/pi-plan-mode`, revision `065d820` | A Markdown handoff plus structured tasks with IDs, descriptions, optional details, and dependencies.                            | Larger work can use an initiative containing dependent plans. Task records are stored separately from narrative context.                                    |

Sources:

- Pi's installed `examples/extensions/plan-mode/index.ts` and `utils.ts`, with
  [release source](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent/examples/extensions/plan-mode).
- Narumitw's [prompt](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-plan-mode/src/prompt.ts),
  [export](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-plan-mode/src/plan-export.ts),
  and [settings](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-plan-mode/src/settings.ts).
- Burneikis's [planning instructions and review](https://github.com/burneikis/pi-plan/blob/bf6365411fdd8813c609754329863e79a22655dd/index.ts).
  The previously recorded npm revision returned HTTP 404 during this inspection;
  this comparison describes repository source, not verified 2.0.0 tarball contents.
- Dreki's [prompt](https://github.com/jalbarrang/pi-plan-mode/blob/065d82000a990222082b82711f40012f2b07699b/extensions/plan-mode/prompts.ts)
  and [ledger integration](https://github.com/jalbarrang/pi-plan-mode/blob/065d82000a990222082b82711f40012f2b07699b/extensions/plan-mode/ledger.ts).

## Recommended Orbis format

Use ordinary Markdown with task-level detail and a small amount of baseline
metadata. Each plan identifies its specification revision, approved scope,
repository baseline, readiness, and execution state. Specification approval does
not imply authorization to execute the plan.

Each task states its outcome, requirement contribution, prerequisite outputs,
files or symbols to change, intended edits, existing behavior to reuse, and
verification. Verification names the working directory, command or interaction,
input, and expected result. Recorded evidence remains separate from expected
results. Unknown host behavior becomes a bounded investigation with dependent
work explicitly blocked.

Use a coverage table to assign the check that establishes each requirement's full
coverage. During implementation, record partial completion and the next unblocked
task. Recheck affected source and specification assumptions on resumption.

Split large work by independently executable outcomes and context needs, not by
an arbitrary line or task limit. An index records shared decisions, dependencies,
and combined coverage; each child contains its task details and evidence. Assign
verification of interactions across plans to concrete tasks. A separate JSON
ledger or YAML schema is unnecessary until a consumer needs machine-readable
state.

Local implementation files belong in `packages/<name>/implementation/`, ignored
by Git by default. The tracked skill defines their format. The scaffold must
preserve this directory when adding runtime files to a specification-only package.
These mutable work documents are separate from `@orbis/plan`'s approved artifacts;
the runtime specification still requires saving the exact reviewed Markdown.

The selected naming scheme keeps `PLAN.md` as the entry point. A single plan uses
that file directly; multiple plans use it as an index of `01-<outcome>.md` siblings.
The alternatives have these trade-offs:

| Choice                           | One plan                    | Multiple plans                               | Trade-off                                                                        |
| -------------------------------- | --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Stable entry point (recommended) | `PLAN.md` contains the work | `PLAN.md` indexes `01-<outcome>.md` siblings | The entry path survives splitting; the file's role changes.                      |
| Explicit index                   | `PLAN.md`                   | `INDEX.md` plus `01-<outcome>.md` siblings   | The index's role is explicit; splitting changes the entry path.                  |
| Descriptive files                | `<outcome>.md`              | Descriptive plans plus `INDEX.md`            | Every plan has a meaningful filename; readers need discovery or a supplied link. |

Numbering helps browsing. Explicit task and plan dependencies determine execution
order. Stable task IDs preserve references when plans are reordered.
