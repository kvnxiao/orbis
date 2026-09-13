# Testing

## Test domain contracts through public operations (Default)

Test accepted and rejected state transitions, boundary validation, and externally observable
results. A test should fail when the contract breaks even if private helpers or file layout change.
Keep pure domain tests independent of Pi and terminal rendering.

For correlated requests, cover rejected command-payload combinations at external parsers and keep
compile-time rejection cases in the project's type-test mechanism when one exists. For partial
updates, assert preservation, clearing, replacement, and rejection of unsupported representations,
including nested values and serialization boundaries the API uses. For layered configuration,
exercise conflicting scopes, omitted overrides, and reload behavior through the resolver and its
consumers.

For collection transformations, cover duplicate identities and meaningful order or multiplicity. For
queries, assert that reads preserve domain state; for consuming operations, assert the returned
value and the mutation together. When preview and execution are separate operations, verify that
preview does not perform execution's external writes. Check public projections through their
declared boundary types and assert that observable output contains only permitted fields.

For closed variant mappings, derive exercised variant membership from the authoritative schema or
registry and assert observable results against an exhaustive test-owned expected mapping, such as
`expected satisfies Record<Variant, ExpectedShape>`. Keep expected values independent of the
production mapping; do not import, copy, or calculate them from that mapping. When the declaration
exists only as a TypeScript union, use the exhaustive expected mapping to enumerate test cases.
Adding a variant must cause a compile-time failure, a missing-case test failure, or both until its
expectations are supplied. Cover unavailable facets and required equality between uses. Test state
classification precedence separately from the selected values.

For asynchronous state changes, control completion order with deferred operations or a fake clock.
When the operation supports cancellation, cover cancellation before work starts and during I/O. When
the owner can change, test a stale completion after replacement. Avoid timing assertions that depend
on arbitrary sleeps.

Name each test file for the contract it enforces and use one naming basis across the suite; a suite
that mixes module names with workflow names gives no rule for where a new test belongs. When a test
file grows beyond the modules it covers, split it along the same module boundaries as the source.

## Test ordering, equality, and recovery at their boundaries (Default)

When correctness depends on event delivery, resource cleanup, or storage commits, exercise the
boundary that performs that behavior. Use integration coverage when mocked dependencies would remove
the behavior under test. For versioned operations, delay completion, change the version, and verify
that the stale action cannot commit. For dependent operations, verify that the prerequisite finishes
before the next operation starts. For replaceable interactions, exercise repeated replacement and a
late callback from an old instance.

For domain equality, test reordered object keys, changed nested fields, and reordered collections
whose order matters. For derived outputs, change a determining input and verify invalidation or
recomputation according to the freshness contract.

For recoverable operations, inject failures, repair their causes, and retry. Assert preserved inputs
and permitted next operations. For mutations, include failures before and after the commit boundary
and verify that retry does not duplicate the mutation. When the operation supports cancellation or
owns resources, test the corresponding cancellation or cleanup behavior on failure as well as on
success.

For deduplicated operations, exercise an exact retry after discarding a successful response,
conflicting input under the same identity, and invalid input followed by corrected input. Assert the
returned outcome and that mutations and UI submission occur only as the contract permits. Cover
repeated cancellation separately from explicit reopening and authorized restart.

For durable retry records, inject persistence failure before mutation and after mutation but before
recording completion. Verify that pending or unknown outcomes remain recoverable without automatic
repetition. After reload or a related job's restart, failure, or destination change, check whether a
cached result remains usable. Pass replayed results through the tool adapter and assert preserved
draft privacy, submission state, output bounds, and failure status.

## Exercise the lifecycle transitions the extension uses (Required)

For session-owned resources, test repeated startup and shutdown, reload, and failed initialization.
Verify that cleanup is idempotent and that an old callback cannot modify the replacement session.

For UI workflows, test successful completion, dismissal, explicit interruption, and UI-owned cleanup
separately. Verify that success does not abort the agent or hide provider errors or unrelated
interruptions. After approval is saved, dismiss the next selector and assert preserved approval and
no further action. Exercise a selector while its tool still awaits input.

For terminating tools, cover a batch whose finalized results all terminate, a mixed batch,
sequential execution, and queued steering or follow-up messages. For command handoffs, exercise
expansion enabled and disabled during active work, cancelled replacement, rejected prompt
submission, and a session change before delayed work runs. Assert preserved approval, prompt
delivery only through the intended replacement context, observed task rejection, and no automatic
retry after ambiguous completion. Report source inspection separately from runtime validation.

For persisted branch state, test resume and tree navigation with divergent branches. Verify that
reconstruction selects the active branch and does not repeat external effects. For mutable
snapshots, mutate the current state and assert that an earlier snapshot is preserved.
[Session lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#session-events),
[branch-state example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/todo.ts).

## Test tool and mode contracts at the adapter boundary (Required)

For custom tools, test malformed arguments, domain failures, cancellation, and output limits. For
file mutation tools, exercise competing updates to the same file. Assert Pi's failure status for
failed execution; an error-colored renderer does not establish that status.

Test each mode the extension claims to support. For extensions that use UI, include unavailable UI
and dismissed prompts. For terminal components, exercise narrow widths, Unicode, resize, and partial
results. For an RPC client, split records across chunks, interleave events and responses, and close
the transport with requests pending.
[Tool contracts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-tools),
[RPC framing](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md#framing),
[TUI width](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#line-width).

## Verify interactive workflows through input and rendered output (Conditional)

For extensions with substantial TUI interactions, derive test cases from the initial state, user
input, and expected observable outcome.

Drive the production component with key and paste events. Assert preserved drafts, unchanged
selections during navigation, explicit submission, and the defined Escape behavior in each focus
context. Cover the initial typed or pasted input that opens a field, multiline editing, repeated
reopening, and resize during editing. Test short terminal heights as well as narrow widths; keep
actions reachable and every line of long content readable.

For settings, test invalid values, scope precedence, reload, and persistence failure. Verify command
completion, command-name collisions, and key collisions in a real Pi session. Include autocomplete
dismissal before testing a composer Escape override.

A mocked recording establishes the simulated behavior only; report real-host, SSH, IME, or
terminal-specific checks separately. Screenshots alone do not establish input routing or
persistence.

## Isolate tests from user resources (Required)

Use temporary working directories and explicit resource loading for integration tests. Use
`SessionManager.inMemory` and in-memory settings when persistence is irrelevant. In-memory sessions
do not disable extension discovery or model network access; configure those separately.

For SDK orchestration tests, use scripted in-process providers and block external model traffic;
allow local fixture traffic only when needed. Drive the prompting entry paths the extension uses,
including custom-message startup, and inspect provider-bound context across later-turn mode
transitions. Directly invoking a hook does not verify SDK routing. Report source inspection,
scripted runtime tests, and real-model behavior separately. Reserve live-provider tests for behavior
that requires the provider. Do not require a paid model request to test local state transitions.
[SDK configuration and in-memory managers](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md).

## Verify the distributed artifact (Conditional)

For a package intended for distribution, test installation from the packed artifact in a temporary
project. Verify resource discovery and runtime dependencies without development dependencies.
Exercise the supported Pi versions and provider schema constraints the package claims, using the
repository's existing test stack.

Keep compiler and linter checks in the verification workflow even though these references omit their
deterministic rules.
[Pi package dependencies](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md#dependencies).
