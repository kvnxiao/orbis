---
date: 2026-10-11
questions:
  - What do the latest Amos and Elpapi Pi observational-memory implementations establish about storage, maintenance, accepted coverage, compaction, and source recall?
observed-in:
  [
    Pi 1.1.0 host baseline,
    Amos main retrieved 2026-10-11,
    Elpapi master retrieved 2026-10-11,
    Elpapi release 3.1.4,
  ]
recheck-when: Either implementation changes memory acceptance, source access, or compaction, or the Pi host baseline changes.
---

# The two Pi observational-memory implementations

The latest available sources do not justify changing Orbis's independent continuation core. Amos combines branch observations with mutable topic files and a retrospective journey; Elpapi combines branch records, reflections, pruning, and ID-based source recall. Both prepare checkpoint content, but neither inspected implementation establishes mandatory retention of active obligations, complete accepted processing of every discarded source portion, or semantic parity with native Pi. Elpapi's current development adds bounded catch-up and fallback beyond its latest release; these mechanisms are relevant without adopting its additional memory roles or movable retention boundary.

This research informs whether those mechanisms change the approved [Orbis continuation contract](../../SPEC.md): one observer maintains explicit continuation state and source-linked observations, Pi owns the prepared cut, and bounded recall remains independent of topic consolidation or reflection. Pi 1.1.0 remains the fixed host baseline. The comparison does not claim either extension was tested with that host.

## Versions and scope

**Observed in upstream repository, release, and package metadata retrieved 2026-10-11:** The repositories share the name `pi-observational-memory`, but Amos's manifest names its package `observational-memory` and Elpapi's names its package `pi-observational-memory`. Their behavior must be attributed separately. The links below use current default branches, qualified by this retrieval date; the recorded revisions identify the source inspected.

| Project                                | Latest default-branch source                                                                                                                    | Latest release qualification                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amos Blomqvist's topics implementation | [`main`](https://github.com/amosblomqvist/pi-observational-memory/tree/main), `78a1efcfdd46332253fb289724f05b26dfc7769e`, committed 2026-08-24. | Manifest 0.1.0; GitHub's latest-release endpoint returned 404. This does not establish npm publication status.                                                                                                                                                                                                            |
| Elpapi's v3 implementation             | [`master`](https://github.com/elpapi42/pi-observational-memory/tree/master), `022da5e5554d04dfdc876ed7dac4a42c6b83dfd4`, committed 2026-10-05.  | [Latest GitHub release](https://github.com/elpapi42/pi-observational-memory/releases/latest) and [npm latest metadata](https://registry.npmjs.org/pi-observational-memory/latest) both identify 3.1.4, published 2026-09-20. Development still declares 3.1.4, so the manifest alone does not identify released behavior. |

**Observed in the latest default-branch sources:** Elpapi loads a committed `dist/index.ts` bundle. Its latest commit changes packaging without changing the `src/` memory implementation; it does not establish improved continuation. The current [manifest](https://github.com/elpapi42/pi-observational-memory/blob/master/package.json) and [build documentation](https://github.com/elpapi42/pi-observational-memory#development) describe that loading path. Bundle execution and runtime equivalence were not tested.

All implementation findings below come from source and documentation inspection. Neither package was installed or run, and no model calls were made. Both prepare derived memory before compaction and render it when history is replaced. Neither inspected implementation routinely injects refreshed protected current-work snapshots between ordinary turns; its memory becomes model-visible as checkpoint content or through explicit inspection and recall.

## Amos: observations, mutable topics, and a journey

**Observed in Amos `main`, retrieved 2026-10-11:** Background headless Pi workers extract observations. A consolidator files older observations into external topics and updates a journey, a retrospective chronology of earlier work. At compaction, the renderer combines the journey, topic index, and active observations. The acting agent can inspect detailed files when needed. [Entry point](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/index.ts), [renderer](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/ledger/render.ts).

The public [implementation plan](https://github.com/amosblomqvist/pi-observational-memory/blob/main/PLAN.md) describes removing reflection, importance scoring, per-observation source identifiers, and content-hash identifiers; the current [observation schema](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/ledger/types.ts) confirms those choices. It retains topics, consolidation, and journey. This is a maintainer's architecture decision, not an experiment establishing that provenance or a current-work snapshot is unnecessary.

### Persistence and navigation

| Representation                    | Storage and update behavior                                     | Consequence                                                                      |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Observations and batch boundaries | Pi custom entries, folded into an active view.                  | Historical records can survive removal from the active pool.                     |
| Topics                            | Mutable files under `.memory/<sessionId>/`.                     | Their lifecycle differs from branch-ledger replay.                               |
| Fork memory                       | External memory is seeded once.                                 | Later file changes are not automatically branch snapshots.                       |
| Tree navigation                   | Does not rewind mutable external topic files.                   | Selected conversation and external topic state can describe different histories. |
| Journey                           | Retrospective chronology, explicitly not a current action plan. | It does not replace a protected statement of active obligations.                 |

Sources: [paths](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/memory/paths.ts), [session handling](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/memory/session.ts), [ledger fold](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/ledger/fold.ts), [consolidator prompt](https://github.com/amosblomqvist/pi-observational-memory/blob/main/agent/consolidator/prompt.ts).

This does not prove external storage is unsuitable. It shows why a branch, revision, and ownership policy is necessary when independently mutable files represent conversation history.

### Compaction and coverage

The hook can wait for observers and select an observed chunk boundary near its desired retained size. It does not require contiguous successful processing of the complete discarded span. Scheduling can advance past a failed chunk, and settled worker promises are not proof of extraction success. An enabled hook can return an empty checkpoint if all rendered sections are empty. It does not explicitly integrate manual instructions or a previous native summary. [Compaction hook](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/hooks/compaction-hook.ts), [progress](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/ledger/progress.ts), [observer dispatch and completion](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/hooks/observer-trigger.ts), [worker waiting](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/runtime.ts).

Its [configuration](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/config.ts) defaults to 10,000-token observation chunks, a 15,000-token active-pool consolidation threshold, four concurrent observers, and an extension-owned 150,000-token context compaction threshold. These are source defaults, not recommendations for Orbis or small local models. The [manifest](https://github.com/amosblomqvist/pi-observational-memory/blob/main/package.json) has unrestricted Pi peers; that range does not demonstrate runtime compatibility with Pi 1.1.0.

Amos's chunk formation preserves whole-entry and tool-boundary relationships; an unfinished small chunk can wait. Its observer prompt asks for corrections, completion signals, identifiers, and error details, but the code does not validate semantic completeness. Source defaults also include a 10,000-token active-pool target, a 20,000-token retained-tail target, a 1,000-token journey target, and the configured `openrouter/z-ai/glm-5.3` memory model. Chunk and tail sizes use token estimates and entry boundaries; the journey size is a prompt target, not a hard output guarantee. These describe the inspected implementation, not portable core defaults. [Observer trigger](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/hooks/observer-trigger.ts), [observer prompt](https://github.com/amosblomqvist/pi-observational-memory/blob/main/agent/observer/prompt.ts), [configuration](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/config.ts).

New Amos sessions start disabled; the gate persists on resume, and disabling aborts workers. Its commands expose activation, status, compaction, and consolidation. Worker errors can notify the user, but command completion does not prove accepted discarded-span coverage. Operator controls and persistent fallback reporting are distinct contracts. [Entry point](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/index.ts), [runtime](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/runtime.ts).

## Elpapi v3: branch records and source-linked recall

**Observed in Elpapi `master`, retrieved 2026-10-11:** V3 schedules an in-process serial observer, reflector, and dropper. Observations have IDs, importance, and source-entry references. Reflections append conclusions that reference observations. Drops remove records from active use without deleting the ledger. Projection follows the selected branch. A separate current-work snapshot with mandatory retention is absent. [Scheduler](https://github.com/elpapi42/pi-observational-memory/blob/master/src/hooks/consolidation-trigger.ts), [projection](https://github.com/elpapi42/pi-observational-memory/blob/master/src/session-ledger/projection.ts).

### Released behavior versus current development

The [released 3.1.4 hook](https://github.com/elpapi42/pi-observational-memory/blob/3.1.4/src/hooks/compaction-hook.ts) renders committed memory at Pi's prepared cutoff and delegates to native Pi when that result is empty. It does not establish complete discarded-span coverage or wait for ongoing extraction.

The [current development hook](https://github.com/elpapi42/pi-observational-memory/blob/master/src/hooks/compaction-hook.ts) and [catch-up implementation](https://github.com/elpapi42/pi-observational-memory/blob/master/src/hooks/compaction-catch-up.ts) add materially different behavior:

- Check for unobserved source before the proposed cut.
- Run bounded catch-up through the existing observer, with a default of two chunks.
- Re-read committed branch state before checking eligibility again.
- Move the cut backward when a remaining gap can be retained.
- Delegate when overflow, missing coverage, insufficient space recovery, excessive retained size, or an empty bounded result prevents a useful custom checkpoint.

Catch-up starts immediately after the selected branch's recorded observation boundary and continues toward the last uncovered entry before Pi's cut. The code's term ‘global observation frontier’ means that branch-wide boundary, not progress shared across sessions. Starting at the retained range alone could skip an earlier backlog. Catch-up requires existing observation coverage and no consolidation already in flight; a deliberately empty observer result does not advance coverage. The source therefore distinguishes scheduled work from recorded progress more clearly than the released version, but its positional marker is not proof of complete processing.

Moving the cut conflicts with the settled Orbis boundary constraint. Catch-up and fallback are candidate ideas; adaptive retention is not a compatible implementation shortcut.

### Selection, retrieval, and bounds

The current [renderer](https://github.com/elpapi42/pi-observational-memory/blob/master/src/session-ledger/render-summary.ts) reserves half its record budget, after fixed rendering overhead, for observations, selects newer records first, and skips oversized records. Reflections receive the remainder. This applies an estimated token budget and reduces competition between the two record types. It does not establish preservation of an old active obligation.

[Recall](https://github.com/elpapi42/pi-observational-memory/blob/master/src/tools/recall-observation.ts) follows an exact observation or reflection ID, including dropped observations, to source records. It is provenance lookup, not text search, and lacks a cursor and explicit output cap. An omission count or user-facing view command does not itself provide model-driven discovery of an unknown event whose ID was never visible.

Current hooks do not explicitly preserve `previousSummary`, manual instructions, native file lists, or a dedicated split-turn continuation section. This means there is no explicit guarantee for those categories; it does not prove the generated prose always omits them.

An optional idle scheduler mode aborts memory work when acting starts, and prior worker memory has separate bounds. The default still uses proactive scheduling and multiple roles. Configuration permits bounded role turns, but a turn cap is not an elapsed deadline. Model lookup can fall back to the session model with a warning when a configured model is absent from the registry. An optional configured fallback model can handle resolution failure and retry a failed background worker stage once; this is a separate policy from native compaction fallback. [Worker memory](https://github.com/elpapi42/pi-observational-memory/blob/master/src/session-ledger/worker-memory.ts), [runtime](https://github.com/elpapi42/pi-observational-memory/blob/master/src/runtime.ts), [configuration](https://github.com/elpapi42/pi-observational-memory/blob/master/src/config.ts).

This source review does not establish failure atomicity across every V3 worker error path.

## Coverage, partial output, and bounded input

**Observed in Elpapi `master`, retrieved 2026-10-11:** The source exposes several distinctions that matter beyond its particular architecture:

| Mechanism                  | Inspected behavior                                                                                                                                                                                                                                                           | Limit                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Reflection coverage        | Counts supporting reflection references: zero, one, or at least two.                                                                                                                                                                                                         | Reference count does not measure preserved meaning or processed source.                    |
| Observation identity       | Hashes observation content and skips matching IDs.                                                                                                                                                                                                                           | Identical wording can describe distinct source events.                                     |
| Oversized source           | Serializes a marked head/tail excerpt when the first renderable entry cannot fit alone, and records its original entry ID.                                                                                                                                                   | The omitted middle was not presented to the observer.                                      |
| Progress after extraction  | A nonempty recorded result advances the marker to the last serialized entry ID; background observation logs excerpt IDs.                                                                                                                                                     | Entry-level progress can advance over content the observer did not read.                   |
| Terminal stream failure    | Throws when nothing was recorded, but can return accumulated records after an error when the result is nonempty.                                                                                                                                                             | Nonempty output does not establish successful completion of the whole assigned extraction. |
| Full versus visible memory | Ordinary checkpoints apply observations through the new source boundary, but apply reflections and drops only through the previous boundary where all three were applied together. Crossing the configured observation threshold applies all three through the new boundary. | Stored state, worker input, and the latest checkpoint can differ.                          |

Sources on the development branch, retrieved 2026-10-11: [coverage counts](https://github.com/elpapi42/pi-observational-memory/blob/master/src/agents/dropper/coverage.ts), [observer](https://github.com/elpapi42/pi-observational-memory/blob/master/src/agents/observer/agent.ts), [serialization](https://github.com/elpapi42/pi-observational-memory/blob/master/src/serialize.ts), [scheduler](https://github.com/elpapi42/pi-observational-memory/blob/master/src/hooks/consolidation-trigger.ts), [projection](https://github.com/elpapi42/pi-observational-memory/blob/master/src/session-ledger/projection.ts).

These source findings are not measured failure rates. They motivate separate checks for source presentation, accepted processing, and semantic preservation. The [observation contract](../../specs/session-state.md#req-session-observations--session-observations) treats an oversized input portion and interrupted proposal accordingly; retaining an original for recall does not prove it was processed.

The active observation target is also different from a hard storage bound. A maintenance pass may return no new reflection or decline removal. Reflections append rather than replacing conflicting conclusions in the inspected projection, while checkpoint and worker renderers impose their own bounds. A bounded prompt therefore does not establish bounded archival storage or correct retirement of old claims.

**Observed in Amos `main`, retrieved 2026-10-11:** A consolidator that exits successfully drains its selected still-active batch, but worker completion does not prove each observation was faithfully filed. Its journey supplies retrospective orientation rather than a current action plan. The [consolidator trigger](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/hooks/consolidator-trigger.ts) commits removal after a clean worker exit, and the [ledger fold](https://github.com/amosblomqvist/pi-observational-memory/blob/main/src/ledger/fold.ts) reconstructs active records. These transitions do not establish that a protected continuation snapshot was evaluated and rejected.

## Implications for the core MVP

Retain the approved independent core. Both implementations prepare memory outside the acting agent's maintenance workflow. Neither establishes that topics, a journey, reflections, or a dropper improve the [core continuation contract](../../SPEC.md). A small number of model roles does not itself detect lost input.

The [comparison with Mastra](observational-memory-comparison.md) examines preparation versus activation, structured current-work extraction, and different meanings of reflection. The [ecosystem survey](pi-cache-compaction-ecosystem.md) adds Blackhole's broader source discovery and its different compaction ownership choices.

For Orbis, branch-derived storage, explicit source references, bounded same-observer catch-up, and native fallback remain useful mechanisms. Mutable topics and a journey require separate ownership and revision policies. Reflection and dropping add maintenance decisions without establishing protection of active obligations. Neither implementation justifies moving Pi's prepared cut or treating an entry marker, reference count, successful worker exit, or nonempty partial result as semantic completeness.

## Evidence gaps

This source comparison does not establish continuation quality, latency, total cost, compatibility with Pi 1.1.0, or failure atomicity across every worker and persistence path. The current [README](https://github.com/elpapi42/pi-observational-memory#current-v3-behavior) describes compaction as model-free even though the development hook can call the observer synchronously; the hook defines the inspected behavior. Claims about source coverage remain qualified by the excerpt and partial-output paths above.

Scripted Pi 1.1.0 integration cases would establish runtime behavior for cancellation, append failure, branch navigation, bounded recall, and checkpoint reconstruction. Separately authorized continuation evaluations would be needed to compare preservation of active obligations and subsequent actions against native Pi. None of these unmeasured outcomes requires changing the approved core on the available evidence.

## Sources

Source and documentation links throughout this document refer to the default branches retrieved on 2026-10-11, except the explicitly labeled 3.1.4 release source and fixed Pi baseline. Fresh [Amos repository metadata](https://api.github.com/repos/amosblomqvist/pi-observational-memory), [Amos latest-release endpoint](https://api.github.com/repos/amosblomqvist/pi-observational-memory/releases/latest), [Elpapi repository metadata](https://api.github.com/repos/elpapi42/pi-observational-memory), [Elpapi latest-release metadata](https://api.github.com/repos/elpapi42/pi-observational-memory/releases/latest), and [npm package metadata](https://registry.npmjs.org/pi-observational-memory) establish the version distinction. The [Pi 1.1.0 extension types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts) identify the fixed host baseline; [Pi compaction research](pi-compaction.md) records its separate host analysis.
