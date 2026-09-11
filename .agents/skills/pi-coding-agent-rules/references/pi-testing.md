# Testing

## Test domain contracts through public operations (Default)

Test accepted and rejected state transitions, boundary validation, and externally observable results. A test should fail when the contract breaks even if private helpers or file layout change. Keep pure domain tests independent of Pi and terminal rendering.

For asynchronous state changes, control completion order with deferred operations or a fake clock. When the operation supports cancellation, cover cancellation before work starts and during I/O. When the owner can change, test a stale completion after replacement. Avoid timing assertions that depend on arbitrary sleeps.

## Test ordering, equality, and recovery at their boundaries (Default)

When correctness depends on event delivery, resource cleanup, or storage commits, exercise the boundary that performs that behavior. Use integration coverage when mocked dependencies would remove the behavior under test. For versioned operations, delay completion, change the version, and verify that the stale action cannot commit. For dependent operations, verify that the prerequisite finishes before the next operation starts. For replaceable interactions, exercise repeated replacement and a late callback from an old instance.

For domain equality, test reordered object keys, changed nested fields, and reordered collections whose order matters. For derived outputs, change a determining input and verify invalidation or recomputation according to the freshness contract.

For recoverable operations, inject failures, repair their causes, and retry. Assert preserved inputs and permitted next operations. For mutations, include failures before and after the commit boundary and verify that retry does not duplicate the mutation. When the operation supports cancellation or owns resources, test the corresponding cancellation or cleanup behavior on failure as well as on success.

## Exercise the lifecycle transitions the extension uses (Required)

For session-owned resources, test repeated startup and shutdown, reload, and failed initialization. Verify that cleanup is idempotent and that an old callback cannot modify the replacement session.

For persisted branch state, test resume and tree navigation with divergent branches. Verify that reconstruction selects the active branch and does not repeat external effects. For mutable snapshots, mutate the current state and assert that an earlier snapshot is preserved. [Session lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#session-events), [branch-state example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/todo.ts).

## Test tool and mode contracts at the adapter boundary (Required)

For custom tools, test malformed arguments, domain failures, cancellation, and output limits. For file mutation tools, exercise competing updates to the same file. Assert Pi's failure status for failed execution; an error-colored renderer does not establish that status.

Test each mode the extension claims to support. For extensions that use UI, include unavailable UI and dismissed prompts. For terminal components, exercise narrow widths, Unicode, resize, and partial results. For an RPC client, split records across chunks, interleave events and responses, and close the transport with requests pending. [Tool contracts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools), [RPC framing](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md#framing), [TUI width](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#line-width).

## Verify interactive workflows through input and rendered output (Conditional)

For extensions with substantial TUI interactions, derive test cases from the initial state, user input, and expected observable outcome.

Drive the production component with key and paste events. Assert preserved drafts, unchanged selections during navigation, explicit submission, and the defined Escape behavior in each focus context. Cover the initial typed or pasted input that opens a field, multiline editing, repeated reopening, and resize during editing. Test short terminal heights as well as narrow widths; keep actions reachable and every line of long content readable.

For settings, test invalid values, scope precedence, reload, and persistence failure. Verify command completion, command-name collisions, and key collisions in a real Pi session. Include autocomplete dismissal before testing a composer Escape override.

A mocked recording establishes the simulated behavior only; report real-host, SSH, IME, or terminal-specific checks separately. Screenshots alone do not establish input routing or persistence.

## Isolate tests from user resources (Required)

Use temporary working directories and explicit resource loading for integration tests. Use `SessionManager.inMemory` and in-memory settings when persistence is irrelevant. In-memory sessions do not disable extension discovery or model network access; configure those separately.

Use deterministic model or transport doubles for orchestration contracts; these doubles do not establish real-model behavior. Reserve live-provider tests for behavior that requires the provider. Do not require a paid model request to test local state transitions. [SDK configuration and in-memory managers](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md).

## Verify the distributed artifact (Conditional)

For a package intended for distribution, test installation from the packed artifact in a temporary project. Verify resource discovery and runtime dependencies without development dependencies. Exercise the supported Pi versions and provider schema constraints the package claims, using the repository's existing test stack.

Keep compiler and linter checks in the verification workflow even though these references omit their deterministic rules. [Pi package dependencies](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md#dependencies).
