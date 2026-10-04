# Pi compaction and public integration contracts

Research date: 2026-10-04. The installed reference is Pi 0.99.1. The current published release
checked is [Pi 1.0.1](https://github.com/earendil-works/pi/releases/tag/v1.0.1), released on
2026-10-03 at 16:14 UTC from
[a7229dd](https://github.com/earendil-works/pi/commit/a7229ddc21810d6245105978033b7df645ecc2f7).
GitHub release metadata and npm metadata agreed. These are inspected source baselines, not tested
runtime compatibility claims for the proposed package.

Published 1.0.1 archives were compared in memory with installed 0.99.1. Compaction, compaction
utilities, session manager, message conversion, and cache-warmer JavaScript files were
byte-identical. Other changed files add tool, rendering, namespace, and image-generation behavior;
they do not add a compaction-input correction API. The findings below therefore apply to both
inspected versions.

## Pi's existing continuity mechanisms

| Mechanism              | Contribution                                                                                         | Limit                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Session tree           | Recorded conversation, alternative branches, resume and navigation.                                  | Persistence does not itself provide semantic extraction or model-facing source search.   |
| Native compaction      | Generated checkpoint and retained recent context.                                                    | Summarization is lossy and does not replay the entire archive on every later compaction. |
| Branch summary         | Deliberately imports summarized abandoned work onto the selected branch.                             | It does not authorize silently merging all alternative branches.                         |
| Authored context files | Load user/project instructions into system context.                                                  | These are authored instructions, not automatically maintained learned knowledge.         |
| Skills                 | Advertise instructions by name, description, and location, with detailed content loaded when needed. | They are not a historical memory database.                                               |
| Extensions             | Add behavior through public hooks and tools.                                                         | A capability supplied by an extension is not native merely because Pi can load it.       |

Current context loading recognizes names including `AGENTS.override.md`, `AGENTS.md`, and
`CLAUDE.md`, with global and ancestor-project context. Sources:
[resource loader](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/resource-loader.ts),
[system prompt](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/system-prompt.ts),
[skills](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/skills.md),
[sessions](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/docs/sessions.md).

## Native checkpoint information

Pi's
[compaction implementation](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts)
requests a structured summary: goal; constraints/preferences; done, in-progress, and blocked work;
decisions with rationale; next steps; and critical context. It asks for exact paths, names, and
errors. Updating a summary supplies `previousSummary`; a split turn can receive a separate prefix
summary describing the original request and progress. These are model instructions, not proof that
all requested facts survive generation.

The [continuity table](continuity-and-invariants.md#category-level-parity) maps these categories to
candidate package content. File-operation extraction is deterministic and separate from prose
summary generation.

### Actual source coverage

The baseline is not a lossless, single-call reading of every original byte. Pi uses the canonical
projected source, separates split-turn history, truncates serialized tool results to 2,000
characters each, and does not represent images in this text serializer. System messages are outside
conversation summarization. Prior history is represented by the previous checkpoint text.

| Content                                    | Treatment by native preparation/conversion                                  |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| User messages                              | Text enters the summary input.                                              |
| Assistant messages                         | Text, thinking text, and tool-call arguments are serialized.                |
| Tool results                               | Text enters subject to serialization truncation.                            |
| User shell executions                      | Converted unless excluded from model context.                               |
| Hidden custom messages                     | Included; `display: false` controls UI visibility, not context eligibility. |
| Branch summaries                           | Included as summarized evidence on the selected branch.                     |
| Previous compaction                        | Supplied separately as `previousSummary`.                                   |
| Custom session entries and message details | Metadata is not automatically model-visible.                                |
| Request-local context transformations      | Not automatically persisted into compaction preparation.                    |

Sources:
[serialization](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/utils.ts),
[message conversion](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/messages.ts),
[session projection](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts).

The observer's eligibility domain must account for these differences. Counting only ordinary user,
assistant, and tool records would not establish parity with all native summary inputs. A branch
summary deliberately selected by Pi is legitimate selected-lineage evidence even if it describes
work originally performed elsewhere.

## Custom results and later native summaries

The host saves the custom summary text unchanged and marks the checkpoint `fromHook: true`. It uses
fields such as `firstKeptEntryId`, `tokensBefore`, usage, and details, while computing its own
post-compaction context estimate. Therefore, “stores the result as given” is accurate for the
summary text, not every possible field on the returned object.

Later preparation supplies the latest projected custom checkpoint as `previousSummary`. It does not
require native headings. This supports custom-to-native continuation, but fallback cannot recover
all information already omitted from a prior package checkpoint: native summarization receives that
checkpoint and new source, not a replay of its original archive.

Sources:
[host persistence](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/agent-session.ts),
[compaction entries](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts).

### File-operation history is an exception

Native preparation inherits prior `details.readFiles` and `details.modifiedFiles` only from
checkpoints that are not marked `fromHook`. Returning native-shaped metadata does not opt a custom
checkpoint into that inheritance.

The extractor recognizes `read`, `write`, and `edit` with string paths, including recorded nested
tool calls. It sorts paths and excludes modified paths from the read-only list. These are invoked
operations, not verified filesystem effects. Arbitrary shell effects and omitted nested-call
metadata are outside that deterministic account.

A later native summary might retain old filenames from custom summary text, but that is generative
retention rather than inherited file metadata. The package needs an explicit policy for current-span
lists, cumulative custom lists, and custom-to-native-to-custom transitions.
[Inheritance rule](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts),
[file tracking](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/utils.ts).

## Split turns and manual instructions

A split compaction can make two calls: an earlier-history summary and a turn-prefix summary. The
retained suffix is supplied to the acting model afterward, not to these summary calls.

`previousSummary` and `/compact` instructions reach the history call. The separate prefix call does
not receive them. If only a turn prefix needs summarization, no new call receives those custom
instructions. Thus native fallback follows the host's behavior but does not guarantee that manual
instructions govern every native subcall.

This is a concrete decision for the package: native delegation is simple, while improving
instruction handling would require an explicit package-owned inference contract. It must not be
silently inferred from a promise to honor instructions.
[Call construction](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts).

## Public inference capabilities

An extension can use the selected model, thinking level, model discovery, registry inference,
request-time authentication, effective settings, and exported compaction/serialization helpers.
`getApiKeyAndHeaders()` resolves credentials and request metadata; registry streaming can perform
that work internally.

Starting with `ctx.model` does not reproduce the native request exactly:

- Native virtual-model selection uses the current acting conversation; a nested registry request can
  route using its own summary transcript.
- The extension interface does not expose the host's private model-resolution operation.
- The SDK stream wrapper adds timeout/retry defaults, attribution, and header-hook processing.
- A direct registry call does not automatically reproduce that wrapper or a custom SDK stream.

Sources:
[extension API](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts),
[model registry](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/model-registry.ts),
[model runtime](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/model-runtime.ts),
[SDK](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/sdk.ts).

Native authentication happens after the compaction hook declines. A prepared custom checkpoint can
succeed without resolving native-summary credentials, provided a selected model and valid
preparation exist.

## Hook outcomes, failure, and retry

`session_before_compact` provides preparation, branch data, instructions, reason, incoming retry
intent, and an abort signal. Public outcomes are a complete custom result, cancellation, or decline
to override. There is no supported preparation-replacement or instruction-override return value.

| Hook outcome           | Host consequence                                                  | Design implication                                                                          |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Valid custom result    | Pi saves the checkpoint and follows its normal continuation flow. | Preserve the original prepared boundary and supplied retry intent.                          |
| Decline                | Native compaction runs.                                           | This is whole-checkpoint fallback, not a partial native section.                            |
| Cancel                 | Compaction stops.                                                 | Overflow retry can be suppressed; cancellation is not equivalent to preserving `willRetry`. |
| Throw                  | Error is reported and swallowed by the extension runner.          | Throwing is not a fail-closed veto; another hook or native summarization may run.           |
| Later replacement hook | A later nonempty result can replace an earlier result.            | Independent checkpoint owners do not compose into one reliable result.                      |

Sources:
[hook dispatch](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/runner.ts),
[host outcomes](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/agent-session.ts).

The compaction reason does not substitute for incoming `willRetry`. In automatic failure handling,
the implementation reports `willRetry: false`, despite declaration wording about whether the aborted
turn would have retried. Attempt telemetry should preserve the incoming decision separately from the
final outcome. Manual compaction does not create an automatic retry.

### Observe completion separately from initiation

`ctx.compact({ customInstructions, onComplete, onError })` returns `void`. Returning from, or
awaiting, that call does not establish completion. The callbacks report the asynchronous operation;
`session_compact` and `session_compact_failed` expose host outcomes independently of observer
completion and the earlier decision to decline. An exception thrown by `onComplete` also reaches
`onError` in the inspected wrapper, so callback failure and compaction failure need distinction.
[Extension contracts](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts),
[wrapper and outcomes](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/agent-session.ts).

Both success paths locate the event's `compactionEntry` by the first stored summary-text match.
Identical summary text can therefore identify an earlier checkpoint. A consumer needing the new
checkpoint identity should check current selected state and test repeated identical summaries; the
success event alone does not establish that identity. This is a source-derived caveat, not a
reproduced runtime failure.

### Threshold, output allowance, and actual request size

Pi's automatic predicate is `contextTokens > contextWindow - reserveTokens` when enabled. Effective
settings include model-specific overrides. Accounting can use provider usage plus estimated trailing
messages, or estimate projected context when earlier usage is stale. Later provider usage can
reflect context transformations; a pre-dispatch estimate is not a measurement of the final request.

Trigger threshold, summarizer output allowance, actual checkpoint size, and retained recent context
are different quantities. Pi's reserve affects both the trigger and summary generation allowance;
split-turn generation and deterministic file metadata can add to the final checkpoint. An output
limit is not an observed size or a recommended core budget.

Budget a rendered checkpoint with its file inventory, wrappers, system/tool context, retained tail,
and generation headroom. This matters when a context hook adds information absent from the stored
summary. Immediately after compaction, `getContextUsage()` can return null token/percentage values
until an eligible assistant response supplies valid nonzero usage. Without a usable model context
window, it returns `undefined`. Neither outcome is the compaction result's `estimatedTokensAfter`.
[Compaction accounting](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts),
[session accounting](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/agent-session.ts),
[settings](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/settings-manager.ts).

## Correction paths and their limits

Acting-context hooks and provider-request callbacks do not provide a hidden native-summary body
rewrite. Native summarization calls its stream directly. The SDK header hook can run there, but it
only changes headers. Durable context edits affect future preparation for supported ordinary
entries; compaction and branch-summary entries are not editable targets. An edit appended after
preparation does not rebuild the already supplied object. Mutating that object is not a documented
correction protocol.

Sources:
[SDK callbacks](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/sdk.ts),
[context edits](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts),
[extension dispatch](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/runner.ts).

### Original records and effective context

A `context_edit` can omit or replace the complete content of an earlier selected-branch user,
assistant, tool-result, or custom-message entry. It preserves the original role and other message
metadata, while the original raw entry remains available. The edit has its own entry identity and
time, but no explicit editor identity or semantic reason. Preserved role metadata does not prove
that the original speaker authored the replacement text.

The public extension reads have different scopes:

| Read                          | Representation                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `getBranch(fromId?)`          | Raw ancestry, defaulting to the selected leaf.                                |
| `getEntry(id)`                | Raw stored entry; membership in the permitted lineage needs a separate check. |
| `getEntries()` or `getTree()` | All stored branches.                                                          |
| `buildContextEntries()`       | Active compaction-aware entry window, without substituting edited content.    |
| `buildSessionProjection()`    | Active effective messages associated with their original `sourceEntry`.       |

The active projection is not an effective overlay over the whole archive. Historical recall needs
explicit view semantics and cannot substitute an all-entry scan for selected ancestry. Omission does
not prove that an obligation was withdrawn, and editing a tool result does not undo a filesystem
operation. Navigating before an edit removes that edit from selected ancestry; it does not revise
claims already embedded in an applicable checkpoint.
[Session projection and edits](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts).

Request-local filtering also does not alter persisted evidence or an already prepared compaction.
Context-handler errors are reported and swallowed rather than serving as a dispatch veto. Queued
custom messages and custom state appends have different delivery semantics; return from
`pi.sendMessage()` or `pi.appendEntry()` does not prove a model consumed anything.
[Extension runner](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/runner.ts),
[public APIs](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/extensions/types.ts).

### Ordinary correction is not off-transcript invalidation

Native Pi can summarize an earlier statement and retain a later correction verbatim after the
checkpoint. Chronological supersession is part of the native baseline. That situation alone does not
justify cancelling compaction.

Checkpoint-only presentation avoids repeated standalone snapshot messages in ordinary history. A
stale statement alone does not justify blanket cancellation. Stronger correction guarantees would
need to address these cases:

- A stored record is edited or deleted without a model-visible correction.
- A source is context-edited after its claims entered a checkpoint.
- Curation promises to retract a claim from an earlier checkpoint.
- Disable promises to erase prior memory, rather than stop future package work.

Native fallback cannot discover an off-transcript invalidation by itself. A package-owned summarizer
can generate a corrected checkpoint, but failure cannot both veto native fallthrough and
unconditionally preserve an overflow retry through the current hook outcomes. Whether that trade-off
is needed depends on the curation contract. It is not an unconditional blocker for the core MVP.

## Persistence and selected lineage

Public reads include session/leaf identity, ancestry, entry lookup, canonical projection, all
entries, and the tree. Ancestry reads and all-entry scans have different scopes. Compaction retains
original stored entries. Fork operations can copy selected ancestry or broader stored history, so
source IDs, session identity, and eligible ancestry must remain distinguishable.

`pi.appendEntry()` stores custom data outside model context. This makes session records a supported
storage candidate, not a decision about schema, atomicity, curation, deletion, or source lifetime.
Tree navigation can change ancestry without replacing the whole extension runtime; pending worker
results still need a selection check. Ephemeral sessions and user deletion remain availability
limits.
[Session manager](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts).

The [modularity analysis](modularity-and-knowledge.md) covers public runtime communication and
artifact readers. Neither requires a second replacement-compaction hook.

### Derived evidence and original-source coverage

A native checkpoint can summarize originals the observer never processed. The observer may use it as
derived evidence, preserving checkpoint identity and provenance. Processing that summary does not
establish processing coverage of its original messages. Repeated appearances of one checkpoint are
not independent supporting evidence. Recovery after fallback or re-enabling must distinguish these
two kinds of accepted input. This is a design implication of Pi's previous-summary reuse, not a
coverage guarantee supplied by the host.
[Preparation](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/compaction/compaction.ts).

### Persistence does not validate the retained boundary

`appendCompaction()` stores a supplied non-null `firstKeptEntryId` without checking selected-branch
membership. Reconstruction starts retaining earlier entries only after it encounters that ID. If it
does not, those earlier entries are omitted; the checkpoint and subsequent entries remain.
Successful persistence therefore does not prove the boundary is valid. Preserve Pi's prepared ID
exactly and include a malformed-ID fixture as a diagnostic, rather than selecting a different cut.
[Append and reconstruction](https://github.com/earendil-works/pi/blob/v1.0.1/packages/coding-agent/src/core/session-manager.ts).

## Verification limits and next fixtures

Scripted-stream probes observed history/prefix input separation, custom `previousSummary` reuse,
missing inheritance of custom file details, and absence of retained-tail corrections from summary
inputs. These narrow probes did not test model quality or the whole SDK lifecycle.

Before implementation claims, use model-free fixtures for hidden custom messages, branch summaries,
nested calls, long tool results, and images. Record inputs across repeated custom/native
transitions. Exercise throw, decline, cancel, and success with each incoming retry value. Contrast
virtual routing for acting and nested requests. Test context edits before and after checkpoint
creation, plus navigation during pending observation. These are proposed checks, not results of this
research.
