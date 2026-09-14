# `pi-observational-memory` design

`pi-observational-memory` separates automatic observation capture from topic consolidation and
checkpoint rendering. Its memory representation is small; its model execution still includes
background workers, extraction calls, and consolidation work.

Research date: 2026-09-12. The inspected repository is
[`pi-observational-memory`](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e)
at commit `78a1efcfdd46332253fb289724f05b26dfc7769e`, dated 2026-08-24. These are source findings,
not results from running the package. Its dependency declaration targets an earlier Pi version than
Orbis's 0.85.1 baseline.

## Capture and consolidation

| Stage        | Trigger and input                                                                       | Recorded output                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Observer     | `agent_start` and `turn_end` check for enough unobserved source entries to form a chunk | Headless Pi workers call `record_observations`; the parent appends observations and a source-boundary marker to the session ledger. |
| Active pool  | Ledger replay folds observations and consolidation events                               | Recent unconsolidated observations remain available for the next checkpoint.                                                        |
| Consolidator | The pool reaches its consolidation threshold                                            | A headless Pi worker files older observations into topic files and updates the journey.                                             |
| Topic map    | Topic frontmatter supplies identifiers, titles, and summaries                           | Code generates a compact index; topic bodies remain available through ordinary file reads.                                          |
| Checkpoint   | Native compaction invokes the extension hook                                            | Code renders journey, topic map, and active observations into text. Relevant in-flight observers can delay the hook.                |

The source preserves whole-entry and tool-boundary relationships when forming chunks. A smaller
unfinished chunk normally waits. The observer sees its assigned chunk and decides which facts merit
an observation; it can omit routine activity. The consolidator chooses an existing topic, creates a
topic, or skips noise. There is no separate per-observation category for reusable project learnings.
[Observer trigger](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/observer-trigger.ts),
[consolidator trigger](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/consolidator-trigger.ts).

The inspected configuration differs from some README examples and comments:

| Setting                        | Source default            |
| ------------------------------ | ------------------------- |
| Observation chunk              | 10,000 estimated tokens   |
| Active-pool target             | 10,000 tokens             |
| Consolidation threshold        | 15,000 tokens             |
| Extension compaction threshold | 150,000 context tokens    |
| Retained tail                  | 20,000 tokens             |
| Journey target                 | 1,000 tokens              |
| Observer concurrency           | 4                         |
| Memory model                   | `openrouter/z-ai/glm-5.3` |

Threshold comparisons are inclusive. Observation and consolidation checks occur on `agent_start` and
`turn_end`; the extension's own compaction threshold check occurs on `turn_end`.
[Configuration](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/config.ts),
[compaction trigger](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/compaction-trigger.ts).

These values describe the reference, not recommended defaults for arbitrary Pi context windows or
consumer GPUs. Parallel workers and fixed large thresholds need different treatment in a portable
MVP.

## What its tiers mean

Observations are timestamped text with token accounting and batch-level source coverage metadata.
The prompts ask the observer to preserve assertions versus questions, corrections, completion
signals, identifiers, and error details. The code does not validate the semantic completeness of
that extraction.
[Observer prompt](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/agent/observer/prompt.ts),
[ledger types](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/types.ts).

Topic files contain current prose about their subjects. The journey describes past progress and does
not serve as a next-action list. Older journey segments can be compressed as the journey grows. The
active pool is drained by age toward its target; a clean consolidator exit removes the selected
batch from that pool. Historical ledger records remain. Successful worker completion does not prove
that each removed observation was faithfully filed.
[Consolidator prompt](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/agent/consolidator/prompt.ts),
[ledger folding](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/fold.ts).

External notes are stored under `.memory/<sessionId>/`. Unrelated sessions do not automatically
share topics. A fork seeds memory once, and `/tree` does not rewind the external topic files. Some
prompt wording suggests broader project continuity than the implemented session scope.
[Memory paths](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/memory/paths.ts),
[session memory](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/memory/session.ts).

Observations form a derived event record with temporal ordering. The complete system does not use
event sourcing consistently: observation extraction is selective, topic files are mutable, and
external state does not replay with every conversation branch. Pi's original transcript is the
source record; observations are a lossy projection of it.

## Why the design became smaller

The public plan explicitly removes reflection, relevance scores, per-observation source identifiers,
and content-hash identifiers from its proposed core. Public commits show concrete simplifications
and repairs, but they do not establish every experiment the author tried privately.
[Plan](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/PLAN.md).

| Public change                                                                                                                                                           | Supported inference                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Drain a whole selected batch after successful consolidation](https://github.com/amosblomqvist/pi-observational-memory/commit/bed3fd7bd28c0c9ae0c2b7faddce7bf8860b2d44) | Reporting promoted subsets could strand observations. Whole-batch drainage favors predictable pool size over per-item filing confirmation. |
| [Add the journey](https://github.com/amosblomqvist/pi-observational-memory/commit/e61e4e9fc417a18a08f1ed32a0098526dad88acb)                                             | Topic organization alone did not provide enough chronological orientation.                                                                 |
| [Clarify what the journey's batch end means](https://github.com/amosblomqvist/pi-observational-memory/commit/7eabcf572ea2c5b6cd37dcfbebe7540a866e1456)                  | An old batch's last event can be mistaken for the session's current state.                                                                 |
| [Separate memory by session](https://github.com/amosblomqvist/pi-observational-memory/commit/844292dd084bfe7cd36ed1aa44666b08a8b1a482)                                  | Concurrent sessions writing shared files require an ownership policy.                                                                      |

The evidence supports a preference for a small record format and predictable transitions. It does
not show that a protected current-work note or structured task-state design was tested and rejected.

## Incomplete observation at compaction

The enabled hook can wait for relevant in-flight observers and choose a boundary near the desired
tail. It does not require a complete, contiguous set of successfully committed observation spans
before replacing Pi's summary. Scheduling progress can advance beyond a failed chunk, and waiting
uses settled worker results rather than treating every worker rejection as a compaction failure.
[Compaction hook](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/compaction-hook.ts),
[progress](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/progress.ts),
[worker runs](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/spawn/runs.ts).

When journey, map, and observations are empty, the renderer returns an empty string. The enabled
hook can still return that as a custom checkpoint. Disabled or passive operation declines
replacement; the inspected hook does not use empty memory or failed coverage as an explicit native
summary fallback condition.
[Renderer](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/ledger/render.ts),
[hook](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/hooks/compaction-hook.ts).

When Pi prepares a discarded span that lacks usable observations, the checkpoint can omit needed
history, for example after a worker failure or late activation over existing history. This
source-derived risk does not establish that every early manual compact loses history: Pi may retain
the available tail or decline to prepare a compaction. The package has not been run to reproduce
this failure here.

Worker failures update `lastWorkerError` and can notify interactive users. The compact command can
still report completion because its success path does not prove observation coverage. These paths do
not supply the proposed persistent, noninteractive fallback report that ties the memory failure to
the eventual native compaction outcome.
[Runtime](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/runtime.ts),
[compact command](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/commands/compact.ts),
[status command](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/commands/status.ts).

## User and agent work

The reference exposes `/om`, `/om on`, `/om off`, `/om:status`, `/om:compact`, and
`/om:consolidate`. New sessions start disabled; the gate persists on resume, and disabling aborts
workers. Text commands, files, and automatic status indicators provide controls without a dedicated
note-editing workflow.
[Entry point](https://github.com/amosblomqvist/pi-observational-memory/blob/78a1efcfdd46332253fb289724f05b26dfc7769e/src/index.ts).

The acting agent does not continually call memory-maintenance tools. Observer and consolidator
workers perform that work with their own tools. This reduces visible ceremony without eliminating
inference cost. Replacing subprocess tool loops with bounded in-process proposals is a plausible
operational simplification, not a measured reduction in required reasoning tokens.

The Orbis design retains automatic recording and selective loading, adds read-only recall, and
requires extension validation before filesystem commits. Blocking the acting agent's direct memory
writes does not prevent recording: the conversation supplies evidence, auxiliary models propose
memory updates, and the extension commits accepted proposals. Manual changes remain protected by
revision checks. Fully preventing arbitrary shell-based mutation would require a broader sandbox
than these guards provide.
