# Pi session state

## Assign persistence by lifetime (Default)

Keep transient operation state local to the operation. Keep session-specific in-memory state inside the extension instance. Persist state that must survive reload, resume, or branching through tool-result `details` or custom session entries. Use external storage for data whose intended lifetime is independent of the session tree.

Custom entries persist extension data without adding it to model context. Custom messages participate in model context. Choose between them according to whether the model needs the data. Neither is a secret store. [Session entry types](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md#entry-types).

## Reconstruct from the active branch (Required)

For state tied to conversation history, rebuild from `ctx.sessionManager.getBranch()`. Reconstruct on `session_start` and `session_tree`. Scanning every entry in the session file can include abandoned branches.

Make reconstruction deterministic and free of external side effects. Replaying a completed tool result must not repeat its file write, network request, or other mutation. Session navigation restores recorded state; it does not undo external effects. [Branch reconstruction example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/todo.ts), [session tree](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md).

## Preserve historical snapshots (Required)

When recording a snapshot, detach mutable nested data that later operations can change. Copying an array preserves references to its elements; it does not create an immutable history. Keep a single authoritative representation and derive caches from it.

For concurrent stateful tools, serialize transitions on the owned state or use storage transactions. Result completion order and assistant source order can differ; replay must reproduce the committed state rather than assume those orders match. [Tool event ordering](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#tool_execution_start--tool_execution_update--tool_execution_end).

## Version persistent contracts (Conditional)

When extension data persists across package upgrades, include a schema version and validate loaded entries before use. Migrate supported older shapes at the persistence boundary. Report unsupported versions explicitly; silently resetting state can discard user work.

When a tool must accept a supported legacy argument shape, normalize it in `prepareArguments` before schema validation. Keep `parameters` strict; do not add deprecated fields to the public schema merely for compatibility. Test old and current arguments through the execution path and test continuation from an older session fixture. Resuming history does not itself re-execute completed tool calls. [Argument preparation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

Choose snapshots or events according to replay cost and the required history. Do not introduce an event-sourcing framework for a small snapshot that already meets the persistence contract.
