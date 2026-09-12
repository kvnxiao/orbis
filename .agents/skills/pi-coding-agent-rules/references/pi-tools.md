# Pi tools

## Make the tool contract sufficient for invocation (Default)

Give each tool a name and description that identify the operation, required inputs, side effects,
and output limits. Keep unrelated operations separate; group actions only when they share a resource
and a coherent contract.

Name the complete operation, including supported reopening or recovery. Distinguish opening or
reviewing a resource from authorizing its execution; a name limited to initial creation can conceal
the tool's supported use on existing work.

Use the TypeBox version supplied by the supported Pi release for parameter schemas. Use `StringEnum`
from `@earendil-works/pi-ai` for string enums; Google providers reject the `Type.Union` of
`Type.Literal` representation. For path arguments, normalize a leading `@` before resolving the
path, matching Pi's built-in tools. After schema validation, check domain preconditions such as
resource existence, permitted state transitions, and relationships between arguments. If the
provider-compatible schema requires optional action-specific fields, validate those fields for the
selected action before mutating state.

The model receives one constraint through the parameter schema, tool description, injected
instructions, and rejection message. Name one owner for the wording and let the other surfaces
reference or reuse it. Four independent statements of one requirement drift into contradictory
guidance, and the model receives all four.
[Custom tools](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Separate model output from structured state (Required)

Put the information the model needs in `content`. Use `details` for serializable state and rendering
metadata; a model cannot act on information available only to a custom renderer. When execution
fails, throw an error from `execute` to set Pi's failure status. Returning text that says "Error"
does not mark the tool result as failed.

When overriding a built-in tool, preserve its result contract, including the `details` shape used by
rendering and session logic. Prefer delegating to the public built-in tool implementation over
reproducing its path handling and output behavior. Only `renderCall` and `renderResult` are
inherited per renderer slot; explicitly preserve `promptSnippet` and `promptGuidelines` when their
guidance still applies. Test the override's result and prompt contracts.
[Tool definitions and overrides](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Define repeated invocation for stateful tools (Conditional)

For retryable stateful tools, document whether an exact repeated request returns its prior outcome,
reports pending or unknown completion, or requires explicit recovery. A revision guard rejects stale
writes; it does not recover a successful response that the caller never received. Use the
[operation identity contract](typescript-workflows.md#bind-retries-to-an-operation-and-accepted-input-conditional)
to distinguish retries from new work. Do not assume a model-generated tool-call ID remains stable
across repeated requests.

Keep retry, reopening, and restart distinct. Replaying an accepted operation must not implicitly
reopen UI, resubmit a decision, create a revision, or launch a session. Explicit reopening may
restore unfinished input; an authorized restart creates a new attempt. Read and open operations may
intentionally refresh state or reopen UI on each call; define their contract separately from
mutation deduplication.

Before returning a cached result, apply the same validation, privacy projection, output limits, and
failure signaling as for the original result. Keep private drafts out of model-facing results and
preserve the distinction between unsubmitted selections and submitted decisions. Recheck
[current dependencies](typescript-workflows.md#track-the-inputs-that-determine-derived-output-validity-default)
before presenting a historical result as usable now.

## Complete successfully without aborting the agent (Required)

When a workflow succeeds, return a successful tool result. When it should end automatic
continuation, use the supported `AgentToolResult` field `terminate: true`. Do not call `ctx.abort()`
merely to stop after success and then suppress the resulting error. For explicit interruption, apply
the [cancellation contract](pi-lifecycle.md#use-cancellation-from-the-operations-context-required).
[Result type](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/types.ts).

In Pi v0.85.1, termination skips the automatic follow-up model call only when every finalized result
in the current tool batch has `terminate: true`. A sibling result without that flag prevents batch
termination. Sequential execution changes execution order; it does not isolate a tool into its own
batch. Steering and follow-up queues can still continue the agent after a terminating batch.

Instructions to call a tool alone or acknowledge and stop express model guidance, not execution
guarantees. Do not promise unconditional immediate idleness from `terminate: true` or use the flag
as proof that session replacement is safe. For handoff, apply the
[session-control contract](pi-lifecycle.md#keep-session-control-in-its-supported-context-required).
[Batch termination and continuation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts).

## Coordinate the entire file mutation (Required)

Pi can execute sibling tool calls concurrently. For a custom file mutation, resolve the target
against `ctx.cwd` and use `withFileMutationQueue` around the complete read-modify-write operation.
Queuing only the final write still permits lost updates. This queue coordinates participating tools
in the process; use a separate storage concurrency mechanism when external writers can modify the
resource.

Do not infer execution order from tool-call order or assume a `tool_call` hook can read a sibling's
completed result.
[Concurrent file mutations](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools).

## Bound output and preserve a retrieval path (Required)

Use Pi's exported truncation helpers and limits for large text results. Keep the beginning for
search results or file previews; keep the end for logs when the latest output matters. Report
truncation and provide a file path or pagination mechanism for retrieving omitted output. Bound
collection or stream output before buffering it in full.

Keep progress updates small and reserve a complete outcome for the final result. Forward the tool's
cancellation signal to subprocesses and network requests.
[Truncation example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/truncated-tool.ts).
