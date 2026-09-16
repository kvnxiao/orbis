# Pi failure signaling

## Failed tool results carry text only (Required)

Throw from `execute` to fail, and render any data the model needs into the message in a fixed form,
such as `Current revision: 12.` Pi's execution catch calls `createErrorToolResult(message)` and sets
`isError: true`; the helper creates text content with `details: {}`. A thrown error's custom fields
do not reach the model through this path.
[Execution catch](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L668-L674),
[error result](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L724-L729).
Apply the
[content and details rule](pi-tools.md#separate-model-output-from-structured-state-required).

## Report cancellation and unsupported modes as outcomes, not failures (Required)

Keep an extension's `cancelled` and `unsupported-mode` outcomes distinct from errors, and check the
execute signal or `ctx.signal` before classifying a caught error. Pi's pre-execution abort checks
emit `Operation aborted` with failure status from the signal; they do not inspect a thrown kind. The
execution catch uses the thrown message, so do not assume every abort is rewritten to that text.
[Signal check](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L617-L622),
[execution catch](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts#L668-L674).
Apply the
[lifecycle cancellation rule](pi-lifecycle.md#use-cancellation-from-the-operations-context-required)
and [UI dismissal rule](pi-ui-and-rpc.md#resolve-the-ui-independently-of-agent-completion-required);
use the [mode outcome rule](pi-ui-and-rpc.md#check-the-capability-the-interaction-requires-required)
when the required UI is unavailable.

## Translate at each Pi surface (Default)

At a tool boundary, throw with remediation composed from the kind; in a command handler, notify; in
a TUI component, display the failed action without remediation. For example, a conflict tool message
includes the current revision and reload instruction, while the component displays the rejected
save. Give model-facing wording one owner under the
[tool wording rule](pi-tools.md#make-the-tool-contract-sufficient-for-invocation-default), and
derive remediation from the
[error contract](typescript-error-contracts.md#give-remediation-text-one-owner-at-the-boundary-default).
[Command notifications](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#piregistercommandname-options).

## Type the callbacks you hand to other extensions (Required)

Give a presenter or hook a versioned contract with documented kinds and reactions under the
[callback error rule](typescript-error-contracts.md#document-the-kinds-a-contract-may-throw-required).
Use validated string discriminants across extension boundaries. Pi creates a loader per extension
with `moduleCache: false`; infer that extension-local class copies need not share identity, even
when both extensions import the same class name. A documented `conflict` kind remains recognizable
across those copies.
[Extension loading](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/loader.ts#L461-L479).

## Test failure status and cancellation through the adapter (Default)

Assert `isError` through the tool adapter, a cancelled extension outcome on abort, and no
remediation for a defect. Keep the extension outcome assertion separate from Pi's aborted-tool
failure status; neither a rendered message nor a direct domain call establishes the adapter's
behavior. Follow the
[adapter testing rule](pi-testing.md#test-tool-and-mode-contracts-at-the-adapter-boundary-required)
and [kind assertions](typescript-error-contracts.md#assert-kinds-not-message-text-default).
