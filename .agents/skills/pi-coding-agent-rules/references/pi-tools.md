# Pi tools

## Make the tool contract sufficient for invocation (Default)

Give each tool a name and description that identify the operation, required inputs, side effects, and output limits. Keep unrelated operations separate; group actions only when they share a resource and a coherent contract.

Use the TypeBox version supplied by the supported Pi release for parameter schemas. Use `StringEnum` from `@earendil-works/pi-ai` for string enums; Google providers reject the `Type.Union` of `Type.Literal` representation. For path arguments, normalize a leading `@` before resolving the path, matching Pi's built-in tools. After schema validation, check domain preconditions such as resource existence, permitted state transitions, and relationships between arguments. If the provider-compatible schema requires optional action-specific fields, validate those fields for the selected action before mutating state. [Custom tools](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Separate model output from structured state (Required)

Put the information the model needs in `content`. Use `details` for serializable state and rendering metadata; a model cannot act on information available only to a custom renderer. When execution fails, throw an error from `execute` to set Pi's failure status. Returning text that says "Error" does not mark the tool result as failed.

When overriding a built-in tool, preserve its result contract, including the `details` shape used by rendering and session logic. Prefer delegating to the public built-in tool implementation over reproducing its path handling and output behavior. Only `renderCall` and `renderResult` are inherited per renderer slot; explicitly preserve `promptSnippet` and `promptGuidelines` when their guidance still applies. Test the override's result and prompt contracts. [Tool definitions and overrides](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Coordinate the entire file mutation (Required)

Pi can execute sibling tool calls concurrently. For a custom file mutation, resolve the target against `ctx.cwd` and use `withFileMutationQueue` around the complete read-modify-write operation. Queuing only the final write still permits lost updates. This queue coordinates participating tools in the process; use a separate storage concurrency mechanism when external writers can modify the resource.

Do not infer execution order from tool-call order or assume a `tool_call` hook can read a sibling's completed result. [Concurrent file mutations](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Bound output and preserve a retrieval path (Required)

Use Pi's exported truncation helpers and limits for large text results. Keep the beginning for search results or file previews; keep the end for logs when the latest output matters. Report truncation and provide a file path or pagination mechanism for retrieving omitted output. Bound collection or stream output before buffering it in full.

Keep progress updates small and reserve a complete outcome for the final result. Forward the tool's cancellation signal to subprocesses and network requests. [Truncation example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/truncated-tool.ts).
