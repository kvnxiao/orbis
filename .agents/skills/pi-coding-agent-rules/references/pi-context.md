# Pi context

## Inject context at the narrowest required lifetime (Default)

Use skills for instructions that can load on demand. Use `before_agent_start` for turn-specific
context or system-prompt changes and `context` for transformations of the messages about to reach
the model. Use persistent messages only when the information belongs in conversation history.

When extending a system prompt, preserve the prompt supplied to the handler and other extensions'
contributions. Replace it wholesale only when replacing prompt policy is the requested behavior. Pi
rebuilds `event.systemPrompt` from its base for each `before_agent_start` invocation; appending to
that supplied prompt does not accumulate across turns and does not need cross-turn deduplication. A
returned `message` persists in session history. For recurring hooks, give persistent messages a
lifetime or deduplication rule and test repeated turns for unintended growth.
[Context hooks](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#before_agent_start),
[skills](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md).

## Scope tool guidance to the named tool (Required)

Use `promptSnippet` for a tool's short entry in the available-tools section. Without
`promptSnippet`, a custom tool is omitted from that section, although its active tool definition
remains available to the model. Use `promptGuidelines` for instructions that apply while the tool is
active. Because Pi appends these bullets without a tool-name prefix, each guideline must name its
tool.
[Tool registration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#piregistertooldefinition).

When dynamically activating tools, account for prompt-cache cost. Activating tools with
`promptSnippet` or `promptGuidelines` rebuilds the system prompt and can invalidate the provider's
cached prefix even with deferred schemas. For lazily loaded tools, prefer the tool description
unless active prompt guidance is needed. Verify the resulting prompt and tool availability across
activation.
[Dynamic tool loading](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#dynamic-tool-loading).

## Choose message delivery deliberately (Conditional)

During an active run, choose steering when new input should affect the current work and follow-up
delivery when it should wait for that work to finish. Do not call a prompting API recursively from a
hook that must return before the active run can complete. Keep user messages, extension
instructions, and retrieved external data distinct in their purpose and representation.
[Message delivery](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#pisendmessagemessage-options),
[SDK prompting](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md).

## Preserve protocol relationships during context reduction (Required)

When filtering messages, preserve tool-call/result relationships required by the provider. Do not
cut an arbitrary suffix of serialized messages or treat raw token deltas as completed messages.

When a custom compaction replaces the summary while retaining Pi's prepared context boundary, return
`firstKeptEntryId: preparation.firstKeptEntryId` and `tokensBefore: preparation.tokensBefore` with
the summary. Pass `event.signal` to the model call. The v0.85.1 public hook requires
`firstKeptEntryId`; `retainedTail` is not a substitute despite conflicting bundled session-format
prose. For a different retention policy, verify the installed `CompactionResult` contract. Test
context rebuilding after resume and cancellation during summarization.

Include constraints, unresolved work, and artifact locations needed to continue the task. Exact
extension state belongs in structured persistence, not solely in a model-generated summary.
[Compaction guide](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/compaction.md),
[CompactionResult contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/compaction.ts).
