# Pi compaction and memory integration

Pi **0.87.0** exposes one checkpoint hook for manual and automatic compaction. An extension can
replace checkpoint content while retaining the host's trigger, cancellation, persistence, and
overflow-retry behavior.

Research date: 2026-09-21. Findings come from the installed dependency and pinned upstream sources;
the proposed extension has not been exercised in a live Pi session.

## Native lifecycle

Pi estimates context use, prepares a retained-message boundary, invokes extension hooks, obtains a
summary, and appends a compaction entry. Later requests contain the summary and retained messages.
Older entries remain in the JSONL session. Native summarization uses an ordinary completion through
the session model, not a provider-specific compaction endpoint.
[Compaction source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/compaction.ts),
[session lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

Threshold compaction uses `contextTokens > contextWindow - reserveTokens`. Pi resolves compaction
settings for the selected model; the extension should use the supplied preparation settings instead
of assuming one reserve or retained-tail size for every model. Usage combines provider accounting
with estimates for trailing messages; the retained tail is approximate. Preparation preserves
tool-call relationships and can separate a turn prefix for summarization. The previous summary
participates in incremental native compaction.
[Compaction documentation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/compaction.md).

Before native summarization, the serializer truncates each tool result to 2,000 characters. An
observer that reuses this representation inherits those omissions. Source capture should retain
recorded tool results and references to available full artifacts. Even the session transcript may
contain output already truncated by a tool; retrieval cannot recover bytes that were never stored.
File-operation metadata identifies attempted paths, not proof of successful operations.
[Serializer and metadata extraction](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/utils.ts).

## Public integration surface

| Capability                 | Interface                                                                                                                   | Design consequence                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Replace checkpoint content | `session_before_compact` receives `reason`, `willRetry`, `signal`, `preparation`, `branchEntries`, and `customInstructions` | Manual, threshold, and overflow requests can share one replacement policy.               |
| Return a checkpoint        | `summary`, `firstKeptEntryId`, `tokensBefore`, optional `details` and `usage`                                               | Metadata can record a frozen memory revision with the same compaction entry.             |
| Decline or cancel          | An absent result permits native summarization; `{ cancel: true }` cancels                                                   | Failure fallback and user cancellation are distinct outcomes.                            |
| Observe outcomes           | `session_compact` and `session_compact_failed`                                                                              | Report the actual compaction result separately from worker completion.                   |
| Request compaction         | `ctx.compact()` with completion and error callbacks                                                                         | It returns `void`; completion is not established by the call returning.                  |
| Persist observations       | `pi.appendEntry`                                                                                                            | Custom entries persist without becoming ordinary prompt messages.                        |
| Select session history     | Session manager `getBranch()`                                                                                               | Reconstruct the selected lineage; `getEntries()` also contains abandoned branches.       |
| Transform a request        | `context`                                                                                                                   | Transformations are ephemeral and must preserve message and tool protocol relationships. |
| Resolve a memory model     | The public model registry and ordinary `complete()` API                                                                     | In-process extraction can use configured Pi providers, including local providers.        |

These interfaces are defined in the
[extension API](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts),
[model registry](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/model-registry.ts),
and
[extension documentation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md).

Model and authentication resolution precede the compaction hook. An independent observer model does
not remove native prerequisites. Ordinary completions also do not automatically inherit the native
summary retry wrapper; the extension must bound its own retries and propagate cancellation.
[Agent session source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

## Boundaries to preserve

**Compaction ownership.** Later nonempty hook results can replace earlier results, while a
cancellation stops dispatch. Exceptions do not serve as an explicit cancellation policy. Pi does not
offer an atomic registry of exclusive compaction ownership. A package must document incompatible
replacement hooks and report conflicts it can detect without claiming to detect every competitor.
[Extension runner](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/runner.ts).

**Discarded-span coverage.** A custom `firstKeptEntryId` can differ from preparation, but it must
identify a valid entry on the selected branch and preserve protocol relationships. Keeping the
prepared boundary reduces the initial integration obligations. Every discarded source interval,
including a split-turn prefix, needs committed processing coverage or an equivalent prior
checkpoint. A newer completion marker alone does not establish that intervening intervals completed.

Pi's `appendCompaction` stores a supplied non-null retained-entry identifier without checking branch
membership. If that identifier is absent from the selected path, context reconstruction includes the
checkpoint and subsequent entries but none of the earlier retained tail. This source behavior makes
boundary validation an extension responsibility; a successful append is not validation.
[Compaction persistence and context reconstruction](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts).

**Cancellation and overflow.** Native manual compaction interrupts the active operation and does not
automatically retry that turn. Recoverable overflow permits one compact-and-retry attempt. Disabling
native automatic compaction also disables native overflow recovery. The memory extension should
retain native triggers and distinguish a cancelled attempt from a failed memory worker.
[Native entry points](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

Pi 0.87.0 propagates cancellation to automatic-compaction failure reporting. The extension must also
check its captured cancellation signal before publishing worker results. Overflow compaction can
occur with `willRetry: false` after a successful response. An extension must preserve the supplied
retry decision instead of inferring it from the reason alone.
[Automatic compaction outcomes](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

**Branch snapshots.** Forks can copy selected custom entries and compaction details. External topic
files require their own version and lineage rules. `/tree` can deliberately carry a branch summary;
such a summary supplies historical evidence, not renewed authority for abandoned instructions.
Conversation navigation does not rewind repository files or project-wide knowledge.
[Session format](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md).

**Context budgets.** Pi checks the threshold before applying the `context` hook. Masking can reduce
subsequent provider-reported usage without changing the current estimate of the untransformed tail.
Retained action text can still grow. A custom checkpoint must fit the actual acting model alongside
instructions, tools, retained messages, and generation headroom. The topics implementation's
[150,000-token trigger](observational-memory.md#capture-and-consolidation) is a configured default,
not a budget derived from the selected local model's context limit.

**Custom instructions.** `/compact <instructions>` supplies user intent to the hook. A ready
deterministic renderer cannot silently discard that intent. Instruction-aware processing or native
fallback may require a new model call.

## Controls and managed writes

Pi's interactive host dispatches built-in `/compact` and `/settings` before extension commands.
Registering those names does not replace native command behavior. Pi 0.87.0 has no public registry
for extension-owned rows in native `/settings`. Package text commands and editable configuration
files avoid a custom terminal menu while retaining explicit controls.
[Interactive dispatch](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts),
[extension API](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts).

The `tool_call` event can block ordinary acting-agent writes and edits to managed files. Extension
code can separately validate and commit observer or consolidator proposals. This separates model
extraction from filesystem mutation without requiring the acting agent to invoke maintenance tools.
Participating file-mutation queues do not coordinate arbitrary editors or shell commands. Revision
checks and preservation of unknown external changes remain necessary; direct tool guards are not a
general filesystem sandbox.
[Tool events and mutation APIs](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts).

## Provider portability

Provider compaction features have distinct request formats, model support, and output types.
Anthropic documents textual context compaction; OpenAI Responses documents compacted items that
include opaque encrypted state. These interfaces do not define project-memory ownership or a
portable textual archive.
[Anthropic compaction](https://platform.claude.com/docs/en/build-with-claude/compaction),
[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

The initial design uses Pi's public textual checkpoint hook. Provider adapters would be separate
experiments with explicit model support, session-migration, retained-tail, usage, and fallback
tests.

## Effective context and retained evidence

Pi records `context_edit` entries that replace or omit supported messages when building effective
context. The raw entries remain available through the session manager. Navigating before an edit can
restore the earlier effective context. An observer must extract current instructions from that
context and bind its proposal to the source revisions it read. Raw tool results remain useful
historical evidence of actual filesystem effects; editing a message does not undo those effects.
Compaction and branch summaries are not supported targets of `appendContextEdit`.
[Session manager](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts),
[context-edit format](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md#contexteditentry).

An earlier native checkpoint can carry information whose original source spans have not been
processed by the observer. Refreshing the current-work note can use that checkpoint as derived
evidence, retaining its identity and provenance. The refresh must not mark the unseen originals as
processed or treat repeated checkpoint text as independent support. This permits bounded recovery
through the existing observer without an archive replay.

## Capacity stops and disabled operation

Ordinary `context` handlers can change messages but cannot directly veto a request: handler errors
are caught, and `continue: false` belongs to a different event and does not suppress a pending
natural turn. The public `ctx.abort()` method returns `void` and initiates host cancellation; the
underlying session abort sets the active signal before waiting for the turn to unwind. The standard
provider path checks that signal before dispatch. A capacity stop can use `ctx.abort()` and let the
callback return; waiting for session idleness inside the callback can wait on itself. Calling manual
compaction there also waits for the active turn and cannot provide transparent resumption. These
source findings need scripted provider-dispatch and cancellation tests in the implementation. The
same host abort path also handles user cancellation. A separate extension status cause can
distinguish a capacity stop without changing Pi's abort event semantics.
[Extension runner](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/runner.ts),
[session lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts),
[provider dispatch](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/auth/resolve.ts).

Disabling memory injection does not remove Pi's committed compaction entry. A native checkpoint can
still contain an earlier memory snapshot, so removing only ephemeral injection cannot preserve later
corrections or invalidation through subsequent native compaction. A durable continuation record is
needed before later summarization. Pi's `sendMessage` with `triggerTurn: false` can record a custom
message without starting an idle model turn; during streaming it queues until the current messages
are committed. Its return alone does not prove persistence. Re-enabling must select the latest
checkpoint and retained tail, including native compactions made while disabled.
[Message and compaction lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts).

## Recall scope and project trust

Selected-branch and all-entry APIs support current-lineage discovery and explicit historical lookup
within the current session. Forks preserve entry identifiers in copied ancestry, allowing a known
source reference to resolve locally when the copy exists. Pi's session listing is keyed by working
directory, which is not the same as the extension's project root. Project-wide discovery of unknown
old sessions therefore requires separate indexing and scope decisions. The initial design defers
that search while retaining resolution of known same-project source references.
[Session selection, forks, and listing](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts).

Project configuration should follow `ctx.isProjectTrusted()`, including temporary host trust
decisions. Untrusted project settings are ignored while personal settings and session controls
remain available. Status should identify the sources that actually supplied effective values.
[Extension context](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts).
