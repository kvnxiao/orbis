# Pi compaction and memory integration

Pi **0.85.1** exposes one checkpoint hook for manual and automatic compaction. An extension can
replace checkpoint content while retaining the host's trigger, cancellation, persistence, and
overflow-retry behavior.

Research date: 2026-09-12. Findings come from the installed dependency and pinned upstream sources;
the proposed extension has not been exercised in a live Pi session.

## Native lifecycle

Pi estimates context use, prepares a retained-message boundary, invokes extension hooks, obtains a
summary, and appends a compaction entry. Later requests contain the summary and retained messages.
Older entries remain in the JSONL session. Native summarization uses an ordinary completion through
the session model, not a provider-specific compaction endpoint.
[Compaction source](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/compaction.ts),
[session lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).

The baseline defaults are `reserveTokens: 16384` and `keepRecentTokens: 20000`. Threshold compaction
uses `contextTokens > contextWindow - reserveTokens`. Usage combines provider accounting with
estimates for trailing messages; the retained tail is approximate. Preparation preserves tool-call
relationships and can separate a turn prefix for summarization. The previous summary participates in
incremental native compaction.
[Compaction documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/compaction.md).

Before native summarization, the serializer truncates each tool result to 2,000 characters. An
observer that reuses this representation inherits those omissions. Source capture should retain
recorded tool results and references to available full artifacts. Even the session transcript may
contain output already truncated by a tool; retrieval cannot recover bytes that were never stored.
File-operation metadata identifies attempted paths, not proof of successful operations.
[Serializer and metadata extraction](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/utils.ts).

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
[extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts),
[model registry](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/model-registry.ts),
and
[extension documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md).

Model and authentication resolution precede the compaction hook. An independent observer model does
not remove native prerequisites. Ordinary completions also do not automatically inherit the native
summary retry wrapper; the extension must bound its own retries and propagate cancellation.
[Agent session source](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).

## Boundaries to preserve

**Compaction ownership.** Later nonempty hook results can replace earlier results, while a
cancellation stops dispatch. Exceptions do not serve as an explicit cancellation policy. Pi does not
offer an atomic registry of exclusive compaction ownership. A package must document incompatible
replacement hooks and report conflicts it can detect without claiming to detect every competitor.
[Extension runner](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts).

**Discarded-span coverage.** A custom `firstKeptEntryId` can differ from preparation, but it must
identify a valid entry on the selected branch and preserve protocol relationships. Keeping the
prepared boundary reduces the initial integration obligations. Every discarded source interval,
including a split-turn prefix, needs committed processing coverage or an equivalent prior
checkpoint. A newer completion marker alone does not establish that intervening intervals completed.

**Cancellation and overflow.** Native manual compaction interrupts the active operation and does not
automatically retry that turn. Recoverable overflow permits one compact-and-retry attempt. Disabling
native automatic compaction also disables native overflow recovery. The memory extension should
retain native triggers and distinguish a cancelled attempt from a failed memory worker.
[Native entry points](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).

When native summarization throws after cancellation, the automatic-compaction catch path can emit
`aborted: false`. A report must also inspect the captured cancellation signal; the event flag alone
does not reliably classify this outcome. Overflow compaction can also occur with `willRetry: false`
after a successful response. An extension must preserve the supplied retry decision instead of
inferring it from the reason alone.
[Automatic compaction outcomes](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).

**Branch snapshots.** Forks can copy selected custom entries and compaction details. External topic
files require their own version and lineage rules. `/tree` can deliberately carry a branch summary;
such a summary supplies historical evidence, not renewed authority for abandoned instructions.
Conversation navigation does not rewind repository files or project-wide knowledge.
[Session format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md).

**Context budgets.** Pi checks the threshold before applying the `context` hook. Masking can reduce
subsequent provider-reported usage without changing the current estimate of the untransformed tail.
Retained action text can still grow. A custom checkpoint must fit the actual acting model alongside
instructions, tools, retained messages, and generation headroom; a fixed 150,000-token trigger is
unsuitable for a general local-model default.

**Custom instructions.** `/compact <instructions>` supplies user intent to the hook. A ready
deterministic renderer cannot silently discard that intent. Instruction-aware processing or native
fallback may require a new model call.

## Controls and managed writes

Pi's interactive host dispatches built-in `/compact` and `/settings` before extension commands.
Registering those names does not replace native command behavior. Pi 0.85.1 has no public registry
for extension-owned rows in native `/settings`. Package text commands and editable configuration
files avoid a custom terminal menu while retaining explicit controls.
[Interactive dispatch](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts),
[extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts).

The `tool_call` event can block ordinary acting-agent writes and edits to managed files. Extension
code can separately validate and commit observer or consolidator proposals. This separates model
extraction from filesystem mutation without requiring the acting agent to invoke maintenance tools.
Participating file-mutation queues do not coordinate arbitrary editors or shell commands. Revision
checks and preservation of unknown external changes remain necessary; direct tool guards are not a
general filesystem sandbox.
[Tool events and mutation APIs](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts).

## Provider portability

Provider compaction features have distinct request formats, model support, and output types.
Anthropic documents textual context compaction; OpenAI Responses documents compacted items that
include opaque encrypted state. These interfaces do not define project-memory ownership or a
portable textual archive.
[Anthropic compaction](https://platform.claude.com/docs/en/build-with-claude/compaction),
[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

The initial design uses Pi's public textual checkpoint hook. Provider adapters would be separate
experiments with explicit model support, session-migration, retained-tail, usage, and fallback
tests. Later Pi features, including changed per-model compaction settings, require renewed
inspection before use; they are outside the 0.85.1 baseline.
