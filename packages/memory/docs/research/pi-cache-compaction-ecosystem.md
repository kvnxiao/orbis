# Pi memory, cache, and pruning packages

Research date: 2026-10-03. This survey compares current source and publication boundaries. It does
not report installation, runtime compatibility, cache measurements, or model-quality tests.

## Version inventory

| Package                    | Published or released baseline                  | Inspected source                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi-blackhole               | npm 0.5.10, 2026-09-28                          | [be64de8](https://github.com/k0valik/pi-blackhole/tree/be64de823f27d8be4195dbe0734409017b05240f), also npm gitHead.                                                                             |
| pi-cache-compact           | npm 0.1.0, 2026-09-22                           | [a905ed8](https://github.com/lennartschoch/pi-cache-compact/tree/a905ed86c3844f1759a9f194dbe4c84d279ac8ca); published source files match.                                                       |
| pi-prefix-cache-compaction | npm/GitHub 0.3.0, 2026-09-20                    | [7091360](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/tree/70913603f1d74eb90d88038d4acf449f235e5724), 2026-09-30; published source matches, later changes are README updates. |
| cprune                     | GitHub v0.4.7, 2026-07-01                       | [7e8694f](https://github.com/amutix/cprune/tree/7e8694f7c2fddd1896ac3c087b17b2ee99153b68), unchanged from the earlier survey.                                                                   |
| pi-oc-prompt-cache         | npm 0.1.0, 2026-08-17                           | [Published archive](https://registry.npmjs.org/@touchtechclub/pi-oc-prompt-cache/-/pi-oc-prompt-cache-0.1.0.tgz), publication gitHead 54ca3dd330f739fb15470e223fb24ae67d825427.                 |
| pi-hermes-memory           | Manifest 0.9.10, with Unreleased source changes | [d5e2d13](https://github.com/chandra447/pi-hermes-memory/tree/d5e2d1384b2f78d7a304f24383ad3aae1da5749e).                                                                                        |

The two observational-memory projects have their own [detailed comparison](observational-memory.md).
For the dedicated cache packages, archive-source comparison was necessary because npm gitHead and
current repository HEAD differ. A matching version string alone would not establish the same code.

## Blackhole: structural compaction and observational memory

Blackhole combines deterministic structural summarization with observational memory under one
compaction owner. Its
[README](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/README.md)
explains the conflict between independently replacing hooks and distinguishes zero-inference
checkpoint rendering from billed background workers. It explicitly reports no comparative
measurements.

The
[summary compiler](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/core/summarize.ts)
uses current messages, earlier summary text, and prepared file operations, recognizes its own
sections, and applies fixed caps. This preserves some structural context without foreground model
summarization. Pattern matching and line limits do not establish semantic parity for goals,
blockers, decision rationale, or active constraints.

Its integration choices differ from the proposed core:

- Default `tailBehavior` is minimal rather than Pi's prepared boundary.
- Its command uses an internal instruction marker; arbitrary `/compact` focus is not passed to a
  semantic summarizer.
- Native fallback occurs when both structural and observational content are empty. Nonempty
  structural output does not require complete observation coverage.
- Optional mid-run behavior adapts private `AgentSession` operations.
- The published peer range is `>=0.85.1 <1.0.0`. This declares a compatibility boundary; it does not
  establish a tested failure on 1.0.1.

Sources:
[hook](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/hooks/before-compact.ts),
[configuration](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/core/unified-config.ts),
[private integration](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/om/inline-compaction.ts),
[manifest](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/package.json).

### Recall and worker improvements

Its recall supports literal/regex search, source expansion, file-content drill-down, touched-file
lists, observation IDs, and paging. Active-lineage restriction is the default; all-branch scope is
explicit. Output defaults to 48,000 characters with continuation guidance. This is evidence that
bounded discovery and exact lookup can exist without semantic/vector search.
[Recall](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/tools/recall.ts),
[scope](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/core/recall-scope.ts),
[budget](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/core/recall-budget.ts).

Versions 0.5.9–0.5.10 add optional hard deadlines, early completion, and rejection of some
incomplete worker results. A capped incomplete observer run is rejected when it recorded
observations; a cap reached before recording anything still becomes an empty success and advances
the cursor. This does not establish complete accepted coverage. Hard deadlines are disabled by
default. Manual mode also uses pending files before ledger flush.
[Observer outcome handling](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/om/agents/observer/agent.ts#L405),
[Changelog](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/CHANGELOG.md),
[pending storage](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/src/om/pending.ts).

Optional
[append compaction](https://github.com/k0valik/pi-blackhole/blob/be64de823f27d8be4195dbe0734409017b05240f/docs/APPEND_COMPACTION.md)
projects immutable prior segments, current memory/recall content, and recent history, then rebases
under pressure. Its fixture prefix checks are not provider cache-hit or continuation-quality
measurements. A fallback inside this mode can mean a complete Blackhole replacement, not native Pi.

## pi-cache-compact: reconstruct the discarded prefix

This package reconstructs the projected discarded prefix with message structure and adds a handoff
instruction. It forwards manual instructions, preserves the prepared retained boundary, uses
registry completion with the compaction signal, disables tools, and delegates on errors,
empty/truncated output, or attempted tool use.
[Extension](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/src/extension.ts),
[builder](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/src/build.ts).

Reconstruction is not capture of the final acting request. Context transformations, tool
declarations, and model overrides can change expected prefix reuse. Its fallback construction
concatenates prepared spans if projection lookup fails.
[Fixture-server tests](https://github.com/lennartschoch/pi-cache-compact/blob/a905ed86c3844f1759a9f194dbe4c84d279ac8ca/test/e2e.test.ts)
verify request construction and persistence, not actual provider cache savings.

It illustrates foreground summary-request optimization. It does not maintain observations or provide
historical recall, and therefore addresses a different responsibility from the proposed core.

## pi-prefix-cache-compaction: capture a request and optionally warm

This package captures a provider request and appends a summary instruction to a clone. It supports
Anthropic Messages and OpenAI Completions payload shapes, skips overflow, resolves authentication,
preserves the prepared boundary, and appends file lists. It includes the captured retained tail in
summarization and does not apply manual `/compact` instructions. Capture occurs at a hook boundary,
not necessarily after every later transformation.
[Extension](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/70913603f1d74eb90d88038d4acf449f235e5724/src/index.ts),
[builder](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/70913603f1d74eb90d88038d4acf449f235e5724/src/core.ts).

Optional one-token warming is skipped when the host will retry, but otherwise awaited. Warming usage
is not added to reported compaction usage. The
[README](https://github.com/jagdeepsinghdev/pi-prefix-cache-compaction/blob/70913603f1d74eb90d88038d4acf449f235e5724/README.md)
includes author smoke runs on Pi 0.99.1 and a correction about a proxy removing cache-count fields.
Those observations are not reproduced here and do not establish native-information parity.

## cprune: reduction can change the source archive

cprune distinguishes prompt-time pruning from truncating tool results before persistence. In full
mode for providers it classifies as prefix caches, it retains previously sent pruned forms while
original hashes match and prunes new context. These forms are process-local and reset at session
start; mismatches or shorter history invalidate preservation.
[Pruning](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L1859),
[tool-result truncation](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L2413).

Persist-time truncation changes the evidence available to later recall. A memory package cannot
promise recovery of bytes that another tool or extension never recorded. Provider classification is
a package heuristic, and estimated savings are different from measured usage. The
[manifest](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/package.json)
uses `latest` dependencies rather than a constrained Pi peer contract, which supplies little version
compatibility evidence.

## pi-oc-prompt-cache: system baseline plus messages

The
[published 0.1.0 source](https://registry.npmjs.org/@touchtechclub/pi-oc-prompt-cache/-/pi-oc-prompt-cache-0.1.0.tgz),
`package/index.ts`, freezes a system-prompt baseline, persists it as a custom entry, and appends
changes through custom messages. Baseline lookup scans all entries rather than selected ancestry.
Compaction initially resets only in-memory state.

The package predates Pi's structured system/tool update support. A current comparison must account
for host capabilities rather than assume they are absent. A `<system_update>` label in custom
message text does not itself grant system-message authority.

## Hermes: complement native compaction

The [Hermes analysis](agent-memory-systems.md#hermes-native-compaction-plus-separate-memory) shows a
bounded pre-compaction save that permits native summarization to continue. It demonstrates a
composition alternative: knowledge capture and historical retrieval need not replace checkpoints.
Its source search has different branch and tool-result coverage from the proposed core, so the
shared label “recall” does not establish equivalent behavior.

## Implications for Orbis composition

| Mechanism                        | Useful lesson                                                   | Reason not to adopt wholesale                                                  |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Prepared observations            | Move useful extraction ahead of compaction.                     | Coverage and freshness remain explicit obligations.                            |
| Deterministic structural summary | Derive known file/activity data without another inference call. | Structural selection does not recover goals or rationale automatically.        |
| Query plus reference recall      | Discover omitted events and inspect precise sources.            | Search scope, source availability, and output bounds still need a contract.    |
| Request reconstruction/capture   | Compare actual provider-prefix behavior.                        | Wire formats and later transformations add compatibility obligations.          |
| Warming and immutable segments   | Explore later-request cost when measurements justify it.        | Additional calls, retained history, and rebase behavior are separate policies. |
| Prompt/result pruning            | Reduce repetitive tool context.                                 | Persisted-source loss can conflict with later evidence recovery.               |

**One checkpoint owner remains the supported starting point.** Multiple extensions may contribute
ordinary context, but Pi does not merge independent replacement checkpoints. Future knowledge
companions should consume evidence and manage their own knowledge rather than each install a
replacement compactor.

These comparisons support keeping source handling, coverage, bounded work, and recall in the
functional core while deferring provider optimization and broader knowledge maintenance. They do not
choose the store, public integration interface, or final catch-up policy. Those remain decisions for
the next brainstorm.
