# The two Pi observational-memory implementations

Research date: 2026-10-03. Two unrelated repositories use the name `pi-observational-memory`. Their
architectures and failure policies must not be attributed to each other. This document records
inspected source behavior; neither package was installed or run for this research.

## Versions and scope

| Project                                | Baseline                                                                                                                      | Release qualification                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Amos Blomqvist's topics implementation | [78a1efc](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e), 2026-08-24 | Manifest 0.1.0; GitHub's latest-release endpoint returned 404.                                                                       |
| Elpapi's v3 implementation             | [886f7a6](https://github.com/elpapi42/pi-observational-memory/tree/886f7a6628d10ea420eb6ceecaee36691489b2fb), 2026-10-02      | Latest published/GitHub release is 3.1.4 from 2026-09-20. HEAD has substantial unreleased changes despite the same manifest version. |

Both prepare derived memory before compaction and render it when history is replaced. Neither
inspected implementation routinely appends refreshed protected current-work snapshots between
ordinary turns. Their model-visible memory is checkpoint content.

## Amos: observations, mutable topics, and a journey

Background headless Pi workers extract observations. A consolidator files older observations into
external topics and updates a journey. At compaction, the renderer combines the journey, topic
index, and active observations. The acting agent can inspect detailed files when needed.
[Entry point](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/index.ts),
[renderer](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/render.ts).

The public
[simplification plan](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/PLAN.md)
removes reflection, importance scoring, per-observation source identifiers, and hash identifiers. It
retains topics, consolidation, and journey. This is a maintainer's architecture decision, not an
experiment establishing that provenance or a current-work snapshot is unnecessary.

### Persistence and navigation

| Representation                    | Storage and update behavior                                     | Consequence                                                                      |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Observations and batch boundaries | Pi custom entries, folded into an active view.                  | Historical records can survive removal from the active pool.                     |
| Topics                            | Mutable files under `.memory/<sessionId>/`.                     | Their lifecycle differs from branch-ledger replay.                               |
| Fork memory                       | External memory is seeded once.                                 | Later file changes are not automatically branch snapshots.                       |
| Tree navigation                   | Does not rewind mutable external topic files.                   | Selected conversation and external topic state can describe different histories. |
| Journey                           | Retrospective chronology, explicitly not a current action plan. | It does not replace a protected statement of active obligations.                 |

Sources:
[paths](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/memory/paths.ts),
[session handling](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/memory/session.ts),
[ledger fold](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/fold.ts),
[consolidator prompt](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/agent/consolidator/prompt.ts).

This does not prove external storage is unsuitable. It shows why a branch, revision, and ownership
policy is necessary when independently mutable files represent conversation history.

### Compaction and coverage

The hook can wait for observers and select an observed chunk boundary near its desired retained
size. It does not require contiguous successful processing of the complete discarded span.
Scheduling can advance past a failed chunk, and settled worker promises are not proof of extraction
success. An enabled hook can return an empty checkpoint if all rendered sections are empty. It does
not explicitly integrate manual instructions or a previous native summary.
[Compaction hook](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/compaction-hook.ts),
[progress](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/progress.ts),
[worker completion](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/spawn/runs.ts).

Its
[configuration](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/config.ts)
uses defaults including 10k observation chunks, a 15k consolidation threshold, four observers, and
an extension-owned 150k compaction threshold. These are source defaults, not recommendations for
Orbis or small local models. The
[manifest](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/package.json)
has unrestricted Pi peers and 0.74.0 development dependencies; that does not demonstrate current Pi
compatibility.

## Elpapi v3: branch records and source-linked recall

V3 schedules an in-process serial observer, reflector, and dropper. Observations have IDs,
importance, and source-entry references. Reflections append conclusions that reference observations.
Drops remove records from active use without deleting the ledger. Projection follows the selected
branch. A separate current-work snapshot with mandatory retention is absent.
[Scheduler](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/hooks/consolidation-trigger.ts),
[projection](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/session-ledger/projection.ts).

### Released behavior versus current development

The
[released 3.1.4 hook](https://github.com/elpapi42/pi-observational-memory/blob/3.1.4/src/hooks/compaction-hook.ts)
renders committed memory at Pi's prepared cutoff and delegates to native Pi when that result is
empty. It does not establish complete discarded-span coverage or wait for ongoing extraction.

The
[current development hook](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/hooks/compaction-hook.ts)
and
[catch-up implementation](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/hooks/compaction-catch-up.ts)
add materially different behavior:

- Check for unobserved source before the proposed cut.
- Run bounded catch-up through the existing observer, with a default of two chunks.
- Re-read committed branch state before checking eligibility again.
- Move the cut backward when a remaining gap can be retained.
- Delegate when overflow, missing coverage, insufficient space recovery, excessive retained size, or
  an empty bounded result prevents a useful custom checkpoint.

Catch-up follows the global observer frontier. It does not redefine the retained tail as the entire
backlog. The source therefore distinguishes scheduled work from committed coverage more clearly than
the released version.

Moving the cut conflicts with the settled Orbis boundary constraint. Catch-up and fallback are
candidate ideas; adaptive retention is not a compatible implementation shortcut.

### Selection, retrieval, and bounds

The current
[renderer](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/session-ledger/render-summary.ts)
reserves at least half its context-relative budget for observations, selects newer records first,
and skips oversized records. Reflections receive the remainder. This bounds output and reduces one
form of competition for space. It does not establish preservation of an old active obligation.

[Recall](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/tools/recall-observation.ts)
follows an exact observation or reflection ID, including dropped observations, to source records. It
is provenance lookup, not text search, and lacks a cursor and explicit output cap. An omitted count
or a view command does not let the model discover an unknown event whose ID was never visible.

Current hooks do not explicitly preserve `previousSummary`, manual instructions, native file lists,
or a dedicated split-turn continuation section. This means there is no explicit guarantee for those
categories; it does not prove the generated prose always omits them.

An optional idle scheduler mode aborts memory work when acting starts, and prior worker memory has
separate bounds. The default still uses proactive scheduling and multiple roles. Configuration
permits bounded role turns, but a turn cap is not an elapsed deadline. Model lookup can fall back to
the session model with a warning.
[Worker memory](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/session-ledger/worker-memory.ts),
[runtime](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/runtime.ts),
[configuration](https://github.com/elpapi42/pi-observational-memory/blob/886f7a6628d10ea420eb6ceecaee36691489b2fb/src/config.ts).

This source review does not establish failure atomicity across every V3 worker error path.

## Implications for the core MVP

Both implementations support preparing memory outside the acting agent's maintenance workflow.
Neither establishes that topics, a journey, reflections, or a dropper are necessary for a useful
observer-plus-snapshot-plus-recall core.

The core needs meaningful safeguards: accepted source coverage, source discovery, selection
identity, finite work, and explicit handling of previous checkpoints and native categories. A small
number of model roles does not remove the need to detect lost input.

The [comparison with Mastra](observational-memory-comparison.md) examines preparation versus
activation, structured current-work extraction, and different meanings of reflection. The
[ecosystem survey](pi-cache-compaction-ecosystem.md) adds Blackhole's broader source discovery and
its different compaction ownership choices.
