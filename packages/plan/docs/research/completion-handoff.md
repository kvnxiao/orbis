# Planning completion and implementation handoff

Pi 0.85.1 exposes successful tool termination and command-owned session replacement through public
APIs. Source inspection establishes these mechanics; offline runtime tests must verify their
ordering and failure boundaries.

Only when every finalized result in a tool batch requests `AgentToolResult.terminate: true` does
automatic continuation stop. Sequential execution preserves the batch. Steering and follow-up
messages can continue the agent. Completion instructions can ask a continuing model to acknowledge
approval and finish; they cannot guarantee idleness.
[Agent loop](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts).

`ctx.ui.select` replaces the composer container and restores the existing editor on selection or
dismissal. The native selector initially focuses its first option. A review can release its UI and
immediately await this selector while its tool remains active. UI controller cleanup does not
require agent interruption.
[Interactive host](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts).

`waitForIdle` and `newSession` belong to command context. After replacement, `withSession` supplies
a fresh context whose `sendMessage` and `sendUserMessage` return promises. A cancelled replacement
retains the old session. A rejected replacement or prompt can leave an ambiguous completion state
and must not trigger an automatic retry.
[Extension contracts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts).

`pi.sendUserMessage` returns immediately and observes asynchronous rejection through Pi's extension
error reporting. Expansion defaults to false. With `expandPromptTemplates: true`, command dispatch
precedes steering or follow-up queueing even during active work. If the originating tool cannot
return independently, the dispatched command must not wait for idle. An opaque, single-use token
routed through the existing `/plan` command can bind a pending action to its originating session
without adding a launcher command. Hidden custom-message startup and receiving-tool delivery use the
separate [implementation launch APIs](implementation-launches.md).
[Message routing](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).

Approval persistence remains independent of implementation dispatch. Selectors and active dispatch
callbacks are ephemeral; saved launch records preserve approval and delivery state across
restoration. Session changes invalidate old selectors and unconsumed callbacks. Replacement setup
records the receiving launch before its startup message. Before dispatch, artifact bytes and
originating session identity need revalidation. Natural-language intent uses a model-callable
operation and explicit saved-plan selection when the reference is ambiguous.
