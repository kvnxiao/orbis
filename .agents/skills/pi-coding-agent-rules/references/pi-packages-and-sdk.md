# Pi packages and SDK

## Declare the resources the package distributes (Required)

For a distributed package, use the `pi` manifest fields or documented conventional directories for
extensions, skills, prompts, and themes. Verify that the published artifact includes every entry
point and referenced asset. Keep helper modules outside auto-discovered entry-point locations unless
the manifest explicitly selects the entry points.

Keep a small extension in one file until separate responsibilities justify a directory. Add
packaging structure for distribution or runtime dependencies, not merely because the extension is
written in TypeScript.
[Package structure](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md#package-structure),
[extension discovery](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#extension-locations).

## Use the host's Pi dependencies (Required)

For Pi packages, declare imported host-provided Pi packages and TypeBox in `peerDependencies` using
Pi's documented `"*"` range, and do not bundle those packages. Document and test the Pi versions the
package supports; the peer range does not prove compatibility.

Put third-party runtime dependencies in `dependencies`. Production installation can omit
`devDependencies`. When distributing another Pi package's resources inside the package, follow Pi's
`bundledDependencies` convention and reference the bundled resource paths. Standalone SDK
applications own their runtime dependencies directly.
[Dependency contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md#dependencies).

Before adding a collection library, apply the
[collection dependency selection rules](typescript-performance.md#select-collection-dependencies-by-required-capabilities-default).

## Make embedding boundaries explicit (Default)

For an embedded session, set the intended working directory, persistence policy, resource loader,
and active tools. Do not inherit user-global extensions or credentials accidentally in a service or
test harness. When user customization is a product requirement, load it deliberately through the
supported resource APIs.

Construct built-in tools for the session's working directory. Resolve project paths from the session
context; resolve packaged assets from the package location. Avoid changing the process working
directory to implement per-session behavior.
[SDK resource and tool configuration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md).

## Revalidate capabilities when replacing integrations (Conditional)

When a harness switches models or providers, verify that the target supports the workflow's input
modalities, tool schemas, context size, and reasoning options. Before submitting work, finish or
explicitly cancel active work according to the switch's contract. Do not silently drop unsupported
inputs or describe a fallback as equivalent without verifying the workflow's contract.

When remote tools reconnect or change endpoints, revalidate tool definitions and bind pending
requests to the intended server and account. A transport reconnect does not prove that an earlier
mutation failed. Before resubmitting it, apply the
[recovery contract](pi-session-state.md#reconcile-external-work-after-process-interruption-conditional).
Before sending data, apply the
[credential rules](pi-trust-and-authorization.md#keep-credentials-within-the-integration-that-owns-them-conditional).
Test unavailable capabilities, changed schemas, and ambiguous disconnects.

## Dispose of the resources the embedding owns (Required)

Keep ownership of sessions, subscriptions, model runtimes, and transports explicit. Before disposal,
await `session.abort()` to stop in-flight agent work. `session.dispose()` is synchronous and does
not drain that work. When the embedding owns an `AgentSessionRuntime`, use `await runtime.dispose()`
to run extension shutdown hooks; this does not replace awaiting the session abort. Cancel and await
other owned tasks explicitly, then release their resources. A borrowed runtime must not be disposed
while another session still uses it. Verify shutdown with work in flight and an active extension
resource.
[SDK lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md),
[runtime disposal](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session-runtime.ts).
