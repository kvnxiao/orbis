# Effect v4 integration

Apply this reference when the repository selects Effect v4 or requests an assessment of it. Keep the
adoption policy in the repository's own instructions; this rule pack does not require adoption.

## Read the selected installation's guidance (Required)

Resolve `effect/package.json` from the importing package, or from the declared workspace
documentation dependency when assessing adoption. Verify the selected v4 version and follow the
resolved package location, including package-manager symlinks. Read that installation's `AGENTS.md`
completely before implementing or reviewing Effect code. Reuse that reading for the same version;
recheck after dependency changes.

Follow its links to the relevant `ai-docs/src` examples, then inspect public API documentation in
`src` for the mechanisms in use. Use its generator and `Effect.fn` / `Effect.fnUntraced` guidance
directly. Keep services, errors, resources, and testing idioms in the installed guide rather than
copying them into local rules. If the dependency is unavailable, restore the repository-declared
version before relying on guidance from another release. Import application APIs through the
package's public exports, not its documentation or internal source paths.

For example, start at `node_modules/effect/AGENTS.md` when the workspace exposes its documentation
dependency there. Follow the integration example for host callbacks; follow process-entrypoint
examples only for a program that owns its process. The
[official setup skill](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/SKILL.md)
describes repository setup; preserve the repository's selected version when applying it.

## Judge each use by its implementation benefit (Conditional)

For repositories that choose Effect, compare the complete workflow and its helpers using the
[architecture rules](typescript-architecture.md). Evaluate its benefits to:

- Code quality and high-level legibility.
- Separation of concerns.
- Maintainability.

Use Effect when those benefits outweigh added complexity and nonzero runtime cost. If it worsens
quality or legibility, keep the clearer implementation. Include synchronous operations and data
modeling in the assessment; do not require a service or wrapper for every function. Introduce a
reusable runtime only when shared capabilities or resource ownership justify it.

Consider library loading and allocation on performance-sensitive paths. Effect adoption does not
require before-and-after probes or equivalent-work benchmarks. For example, a data type may clarify
valid outcomes without a managed runtime, while still adding library execution and allocation costs.

## Preserve the Pi host contracts (Required)

Apply these integration constraints before adopting an upstream example:

- Keep the [TypeBox boundary rules](typescript-domain-boundaries.md) authoritative over upstream
  Schema guidance. Reuse the existing parser and its derived types; do not define a second Effect
  Schema for the same record.
- Keep sessions and providers under the [Pi package and SDK contracts](pi-packages-and-sdk.md). Keep
  [trust and authorization](pi-trust-and-authorization.md) under Pi's existing controls. Library AI
  examples do not authorize a second agent loop or credential path.
- Keep process and session ownership under [Pi lifecycle](pi-lifecycle.md), and preserve
  [Pi UI and RPC](pi-ui-and-rpc.md) behavior. Bind any Effect runtime to an existing owner, await
  owned teardown, and leave borrowed runtimes with their owner. Do not copy process signal handlers
  or process-exit behavior into an extension from an application example.
- Preserve plain public and persisted contracts. Keep public callbacks and package interfaces in
  their existing plain-value or Promise form. Adapt internal Effect outcomes through
  [failure signaling](pi-failure-signaling.md) and [error contracts](typescript-error-contracts.md).
  Preserve discriminants and structural recognition across separately loaded packages; keep Effect
  runtime objects out of serialized records.
- Preserve the repository's loading and distribution contract, including source-only TypeScript
  loading where required. Verify imports through the supported Pi loader. A root documentation
  dependency does not replace an importing package's runtime dependency; follow the
  [dependency rules](pi-packages-and-sdk.md#use-the-hosts-pi-dependencies-required).

For example, adapt an existing TypeBox parser's failure into the internal Effect error channel
without redefining the persisted record or changing the public failure contract. Configure logging
and telemetry through the host's existing policy; an upstream observability example does not
authorize a new exporter.

## Verify the underlying operation's lifetime (Required)

Apply [asynchronous work and errors](typescript-async-and-errors.md) to the underlying operation as
well as its Effect wrapper. At a cancellable host boundary:

- Check for existing cancellation before starting work and propagate cancellation to nested I/O.
  Passing an already-aborted signal to a runner does not by itself establish that work cannot start.
- Preserve the original host cancellation reason when translating an actual interruption. Do not
  relabel an unrelated failure or defect as cancellation merely because the signal is now aborted.
- Verify that external work has stopped or finished before releasing resources it still uses. For
  non-cooperative work, retain dependent resources until completion and guard late commits with the
  existing operation identity. Fiber interruption alone does not establish I/O completion.

Inspect the selected API's interruption and finalizer semantics in `src/Effect.ts` and
`src/ManagedRuntime.ts`. When replacing native concurrency, compare the exact race or traversal
completion policy, including sibling failure and cancellation. Preserve durable commit boundaries
and the existing retry contract.

For example, an interrupted fiber can finish while its Promise still writes through a file handle.
The adapter must establish completion before closing that handle or releasing its protecting lock.

## Review the integration with the selected version (Default)

Apply the same benefit/cost criterion during implementation and review. Read only the additional
installed examples and source needed for the change. Use the integration and resource examples when
reviewing a host-owned runtime, and the installed testing guide alongside
[Pi testing](pi-testing.md) for its host boundary. Report deviations with the owning rule and
version-specific evidence.

For example, test cancellation before execution and during non-cooperative I/O. Assert that late
work cannot commit into a replacement session and that resource release follows actual completion.
