# Pi UI and RPC

## Check the capability the interaction requires (Required)

Use `ctx.hasUI` for dialogs supported in TUI and RPC modes. Use `ctx.mode === "tui"` for custom
terminal components and direct terminal input. RPC has UI support but does not provide a terminal
for `ctx.ui.custom`.

For print and JSON modes, define an explicit noninteractive result. When an operation requires a
user's decision, a missing UI, dismissed dialog, or timeout does not supply that decision. Return a
cancelled or unsupported outcome unless an authorized noninteractive policy already defines the
action.
[Mode behavior](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#mode-behavior),
[RPC UI protocol](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md#extension-ui-protocol).

When timeout and dismissal require different outcomes, drive the dialog with an owned
`AbortController` and timer, clear the timer on completion, and inspect the abort reason after
resolution. The built-in timeout alone returns the dismissal value: `false` for `confirm`,
`undefined` for `select` and `input`. Test expiry and explicit dismissal separately.
[Dialog timeouts and signals](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#manual-dismissal-with-abortsignal).

## Render within terminal constraints (Required)

Use Pi TUI components, theme tokens, and key-matching helpers. Measure display width with
`visibleWidth`; truncate or wrap with ANSI-aware helpers. JavaScript string length does not measure
terminal columns. Every rendered line must fit the supplied width.

Keep rendering free of I/O and state mutations. On state, width, or theme changes, invalidate
affected render caches. For asynchronous updates, request a render through the TUI API. Complete
dialogs through their completion callback and release resources they own.
[TUI contracts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md).

For containers with an embedded `Input` or `Editor`, implement `Focusable` and propagate focus to
the active child. To position IME input at the field, preserve the child's `CURSOR_MARKER` through
layout and clipping. Reuse Pi's input components for cursor movement and paste handling.
[Focus and IME](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#focusable-interface-ime-support).

## Preserve RPC framing and correlation (Required)

Treat stdout as the RPC JSONL stream. Write diagnostics to stderr or a log file and capture
subprocess output instead of inheriting protocol stdout. Pi v0.85.1 redirects ordinary stdout writes
to stderr in RPC mode, but raw descriptor writes and inherited child stdout can bypass that guard.
Frame records on LF; account for chunks that split UTF-8 characters or contain multiple records.
Avoid Node's `readline` for RPC framing: it also splits at U+2028 and U+2029, which can occur inside
JSON strings. Test these characters inside a record as well as split UTF-8 chunks.

Assign request IDs and correlate responses by ID. Process asynchronous events separately from
command responses; a successful prompt response does not mean generation has completed. On process
exit or transport failure, reject outstanding requests and release subscriptions.
[RPC protocol](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md#protocol-overview),
[stdout guard](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/output-guard.ts).
