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
assuming the operation succeeded. Before a normal session handoff or tree navigation, finish active
work and await `ctx.waitForIdle()` in a command handler. After waiting, revalidate the originating
session identity. For `ctx.newSession()`, send the new prompt through the fresh `withSession`
context's `sendUserMessage()`. After replacement, do not send it through captured old `pi` or `ctx`
objects.

When approval has already been saved, preserve it on handoff failure or cancelled replacement. A
cancelled `newSession` result does not authorize sending the prompt to the original session. A
rejection can occur after replacement or prompt submission; determine the completed state before
offering recovery. Do not automatically retry ambiguously completed work or send the implementation
prompt to whichever session happens to be current.
[Session replacement lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#session-replacement-lifecycle-and-footguns).

When a handler calls `ctx.reload()`, treat the call as terminal: `await ctx.reload(); return;`. The
awaiting handler continues in the old call frame with invalidated extension state. Tools do not
receive `reload`; use a command handler for reload and verify that the old handler does not execute
post-reload work. For programmatic command dispatch, apply the
[command-routing contract](pi-context.md#verify-command-routing-before-deferring-session-control-required).
[Reload contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#ctxreload).

## Use cancellation from the operation's context (Required)

For tools, use the signal passed to `execute`. For event handlers during an active turn, use
`ctx.signal` when available. Idle commands, shortcuts, and session events can have no turn signal.
For work started in an idle context, create an operation-owned `AbortController` and cancel it on
dismissal or `session_shutdown`. Test cancellation while idle as well as during a turn.
[Context signal](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#ctxsignal).

Use the
[abort-reason contract](typescript-error-contracts.md#keep-cancellation-and-supersession-on-the-signal-required)
to distinguish user cancellation from supersession before translating an error.

UI-owned controllers may cancel obsolete rendering, listeners, or pending UI work during normal
cleanup, including successful completion. Aborting a UI-owned controller is distinct from
`ctx.abort()`, which interrupts ongoing agent work. Define cancellation according to the
interaction's contract: explicit user interruption may require `ctx.abort()`, but completing or
dismissing a UI does not inherently require it. Preserve real provider errors and unrelated
interruptions; do not classify every abort-shaped error as expected UI cleanup.
[Agent abort](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts).

## Keep session control in its supported context (Required)

Use command-context methods for operations that wait for idle or replace the session. Do not capture
an `ExtensionCommandContext` and invoke its session-control methods from an event or tool handler:
waiting for the run that contains that handler can deadlock.
[Command context](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#extensioncommandcontext).

Keep lifecycle handlers bounded. Do not await a prompt, idle wait, or session transition whose
completion depends on that handler returning. When delayed work is necessary, give it an owner,
revalidate session identity before acting, and explicitly observe task rejection. A timer or a
detached promise does not establish a safe handoff or keep a captured context valid.

## Bound automatic continuation (Conditional)

When a harness automatically schedules retries, verification attempts, follow-up turns, or child
tasks, define a stopping condition and an owner for the aggregate work. Account for nested retries
and children within configured attempt, time, or usage budgets; spawning another task must not reset
the parent's limit. Keep fixed limits in runtime policy rather than relying on model instructions to
count them.

When repeated attempts make no progress or a budget is exhausted, stop scheduling additional work,
preserve partial results, and report the incomplete outcome and reason. Define whether already
running operations finish or cancel. Keep genuine user interruption distinct from budget exhaustion
and provider failure. A completion hook must not enqueue itself indefinitely. Test repeated hook
continuation and budget exhaustion with child work still active.

## Track background work independently of its UI (Conditional)

When work can outlive a tool response or UI, assign a task identity and an owner. Distinguish
queued, running, awaiting input, and terminal outcomes wherever those states change permitted
actions. A request acknowledgment establishes acceptance, not completion; an unavailable connection
leaves the outcome unknown unless the task owner confirms it.

Define whether UI dismissal, disconnect, or session shutdown cancels the task or leaves it running.
For surviving work, provide status retrieval and a cancellation path. Correlate results with the
task and originating session; do not deliver a late result into a replacement session implicitly.
For reconnectable clients, define notification replay or deduplication and bound buffered output.
Keep state transitions and actionable failures observable without recording credentials or full
sensitive payloads. Test disconnect, reconnect, duplicate notifications, late completion, and
rejection while the UI is absent.

## Select completion events by the required state (Conditional)

For a status integration that reports the agent has finished all automatic work, use
`agent_settled`. `agent_end` ends a low-level run; retries, compaction recovery, or queued
continuations can still follow it. For turn-specific accounting, use turn events and preserve the
distinction between a turn, a run, and a settled agent.
[Agent events](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#agent_start--agent_end--agent_settled).
