# Pi lifecycle

## Separate registration from session resources (Required)

An extension exports a default factory that receives `ExtensionAPI`. Register tools, commands, and
handlers through that API. Pi awaits an asynchronous factory, so bound any startup I/O that must
finish before registration completes.

Factories can run without a session. Start watchers, timers, child processes, and sockets in
`session_start` or the operation that needs them. Register an idempotent `session_shutdown` handler
that cancels work and releases those resources.
[Factory and resource lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#writing-an-extension).

## Reestablish state after session replacement (Required)

On reload or session replacement, dispose of resources owned by the old extension instance. On
`session_start`, reconstruct session state and establish resources for the new instance. Do not
retain a command context, session manager, or resource handle from the previous session in a
background callback.

When a session replacement API provides `withSession`, use its fresh context for post-switch work.
Capture only data that survives shutdown. Handle a cancelled result and a rejected promise before
assuming the operation succeeded. In a command handler, await `ctx.waitForIdle()` before tree
navigation; navigation can still reject, so preserve a usable state on failure.
[Session replacement lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#session-replacement-lifecycle-and-footguns).

When a handler calls `ctx.reload()`, treat the call as terminal: `await ctx.reload(); return;`. The
awaiting handler continues in the old call frame with invalidated extension state. Tools do not
receive `reload`; queue a registered reload command through `pi.sendUserMessage("/command", {
deliverAs: "followUp" })`. Verify that the old handler does not execute post-reload work.
[Reload contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#ctxreload).

## Use cancellation from the operation's context (Required)

For tools, use the signal passed to `execute`. For event handlers during an active turn, use
`ctx.signal` when available. Idle commands, shortcuts, and session events can have no turn signal.
For work started in an idle context, create an operation-owned `AbortController` and cancel it on
dismissal or `session_shutdown`. Test cancellation while idle as well as during a turn.
[Context signal](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#ctxsignal).

## Keep session control in its supported context (Required)

Use command-context methods for operations that wait for idle or replace the session. Do not capture
an `ExtensionCommandContext` and invoke its session-control methods from an event or tool handler:
waiting for the run that contains that handler can deadlock.
[Command context](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#extensioncommandcontext).

## Select completion events by the required state (Conditional)

For a status integration that reports the agent has finished all automatic work, use
`agent_settled`. `agent_end` ends a low-level run; retries, compaction recovery, or queued
continuations can still follow it. For turn-specific accounting, use turn events and preserve the
distinction between a turn, a run, and a settled agent.
[Agent events](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#agent_start--agent_end--agent_settled).
