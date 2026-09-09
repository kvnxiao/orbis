# TypeScript architecture

## Organize modules around owned behavior (Default)

Group code by the domain operation or resource it changes. Keep validation, state transitions, and their tests close enough to review the contract together. When a module's responsibilities have different dependencies or lifetimes, split the module; line count alone does not identify a module boundary.

Keep a local helper local until another caller needs the same semantics. A shared abstraction must represent a shared contract, not merely similar syntax. Avoid a generic `utils` module whose callers depend on unrelated helpers.

## Separate policy from integration code when it has an independent contract (Default)

For a workflow with domain decisions, keep parsing and Pi event wiring at the adapter boundary. Pass validated domain values into functions that compute decisions or transitions, then execute I/O through the adapter. Domain code should not need a terminal, active Pi session, or provider connection to express its rules.

Keep a short adapter-only operation inline when extracting it would add indirection without separating a policy, lifetime, or testable contract. Do not require a repository layer, service class, or dependency-injection container for every extension. Pi's factory is already a composition point. [Extension factory](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#writing-an-extension).

## Expose operations that preserve invariants (Default)

When a module owns state invariants, expose named operations and read views rather than mutable internals or a general-purpose setter. Give each mutation one owner. Derive totals, status flags, and indexes from authoritative state unless measured cost requires a maintained cache.

At an ownership boundary, decide whether a value is borrowed, transferred, or copied. A `readonly` property does not freeze an object at runtime or prevent another alias from mutating nested data. Use defensive copying only where the ownership contract requires it. [TypeScript readonly properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties).

## Derive choices and counts from declared contracts (Default)

When a schema or registry already defines supported choices, derive selectors, membership checks, and counts from that declaration. For package identity, use package metadata. Keep wire-protocol values, compatibility policies, and deliberate resource limits explicit.

When naming a constant, describe the policy or unit it represents. Equal values can belong to unrelated policies; do not couple them through a shared constant solely because their literals match. Add configuration only when callers need to vary the choice.

## Keep public APIs narrower than implementation dependencies (Default)

Accept the data and capabilities an operation uses. Do not pass the entire extension context through domain modules for access to a clock, filesystem operation, or notification callback. Inject those capabilities at real I/O or lifetime boundaries; do not wrap every library function.

Use concrete names for domain operations, identifiers, units, and outcomes. Prefer a direct implementation over configuration-driven dispatch or conditional-type machinery until callers require that variation. A public generic should preserve a meaningful relationship for callers, not expose internal implementation choices. [TypeScript API guidance](https://www.typescriptlang.org/docs/handbook/2/functions.html#guidelines-for-writing-good-generic-functions).
