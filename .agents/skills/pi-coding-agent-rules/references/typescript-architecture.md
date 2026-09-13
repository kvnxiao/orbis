# TypeScript architecture

## Organize modules around owned behavior (Default)

Group code by the domain operation or resource it changes. Keep validation, state transitions, and
their tests close enough to review the contract together. When a module's responsibilities have
different dependencies or lifetimes, split the module; line count alone does not identify a module
boundary.

## Separate policy from integration code when it has an independent contract (Default)

For a workflow with domain decisions, keep parsing and Pi event wiring at the adapter boundary. Pass
validated domain values into functions that compute decisions or transitions, then execute I/O
through the adapter. Domain code should not need a terminal, active Pi session, or provider
connection to express its rules.

For layered configuration, resolve defaults and scope precedence at one configuration boundary, then
pass resolved values to consumers. Keep overrides distinct from resolved configuration; a missing
override can mean inheritance, while a missing resolved value must have a defined domain meaning.
When callers need to explain or edit the winning scope, retain that scope alongside the effective
value. On configuration changes, resolve again according to the operation's reload contract. When a
setting has one consumer and no shared precedence contract, keep its defaults local.

Keep a short adapter-only operation inline when extracting it would add indirection without
separating a policy, lifetime, or testable contract. Do not require a repository layer, service
class, or dependency-injection container for every extension. Pi's factory is already a composition
point.
[Extension factory](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#writing-an-extension).

## Expose operations that preserve invariants (Default)

When a module owns state invariants, expose named operations and read views rather than mutable
internals or a general-purpose setter. Give each mutation one owner. Derive totals, status flags,
and indexes from authoritative state unless measured cost requires a maintained cache.

At an ownership boundary, decide whether a value is borrowed, transferred, or copied. A `readonly`
property does not freeze an object at runtime or prevent another alias from mutating nested data.
Use defensive copying only where the ownership contract requires it.

A getter that returns internal state exposes an alias to callers, regardless of its declared type.
Return a copy, a projection, or a named read view. Apply the module's copy-on-write discipline to
every mutation site, including restoration and repair paths; one direct field assignment beside
copy-on-write updates leaves the ownership contract unverifiable.
[TypeScript readonly properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties).

Keep queries free of domain mutations: reading a queue must not consume an entry or advance its
cursor, and reading effective settings must not persist defaults. For intentional consumption or
creation, expose an operation such as `takeNext()` or `loadOrCreate()` and state its effects. When
an internal cache preserves the query's observable contract, it is permitted. Do not split an atomic
mutation from the result it returns merely to separate reads and writes.

## Derive choices and counts from declared contracts (Default)

When a schema or registry already defines supported choices, derive selectors, membership checks,
and counts from that declaration. For package identity, use package metadata. Keep wire-protocol
values, compatibility policies, and deliberate resource limits explicit.

When a closed variant set supplies the same group of values or behaviors, encode those facets in an
exhaustive mapping such as `mapping satisfies Record<Variant, FacetShape>`. Derive `Variant` from
the authoritative schema, registry, or protocol declaration where one exists. Apply this to
configuration modes, workflow outcomes, provider capabilities, command variants, serialization
formats, status presentation, and compatibility policies. A registry that accepts arbitrary runtime
registrations does not define a closed union; validate membership and missing entries at runtime
instead of asserting that its keys are exhaustive.
[TypeScript satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator).

Group facets only when they vary along the same discriminant and form one contract, such as a
serialization format's media type, filename extension, and encoder. Resolve the variant once, then
use typed property lookups at call sites. Keep state classification and its precedence separate from
value selection. When a facet is unavailable, encode that state with `null`, an optional field whose
absence has defined meaning, or a discriminated union. Narrow that state before use; do not replace
it with an unchecked indexed read or an implicit fallback.

When naming a constant, describe the policy or unit it represents. Equal values can belong to
unrelated policies; do not couple them through a shared constant solely because their literals
match. When the contract requires facets to use the same value, store the value once and derive both
uses. For example, a status contract can require a summary and a detailed view to use one label.
Preserve separate values when equality is incidental or the contract permits divergence. Add
configuration only when callers need to vary the choice.

## Prefer functional transformations for derived data (Default)

Default to small pure functions and readable `map`, `filter`, and related transformations. Keep
transformation callbacks free of externally visible side effects. When a long transformation becomes
hard to follow, name intermediate values. Use `reduce` for clear accumulations; avoid reducers that
combine unrelated state or obscure execution order.

Before indexing, sorting, or deduplicating a collection, define its identity, ordering, and
duplicate policy. When duplicate keys are possible, choose rejection, aggregation, or replacement
explicitly. When populating a `Map`, enforce that policy. When identity must survive reordering, use
a stable domain key rather than an array index. Preserve meaningful order and multiplicity. When
ordinary arrays and direct transformations already express the contract, keep them.

Keep imperative control flow for state-transition precedence, early returns, sequential asynchronous
work, cancellation, cleanup, error translation, and materially different side effects. A mapping
replaces duplicated data selection; do not move control flow into callback tables merely to remove
conditionals. Preserve the ordering and ownership contracts in
[asynchronous work and errors](typescript-async-and-errors.md).

When it simplifies implementation or avoids repeated copying, allow mutation of freshly created
local collections. A function can populate a local array with `push` and remain pure without
mutating inputs or shared state. Local collection ownership does not permit mutation of borrowed
elements.

Do not replace readable transformations with loops solely on an assumed performance advantage. For
lazy pipelines, collection dependencies, compatibility checks, and measurement, apply the
[performance rules](typescript-performance.md).

## Keep public APIs narrower than implementation dependencies (Default)

Accept the data and capabilities an operation uses. Do not pass the entire extension context through
domain modules for access to a clock, filesystem operation, or notification callback. Inject those
capabilities at real I/O or lifetime boundaries; do not wrap every library function.

Use concrete names for domain operations, identifiers, units, and outcomes. Prefer a direct
implementation over configuration-driven dispatch or conditional-type machinery until callers
require that variation. A public generic should preserve a meaningful relationship for callers, not
expose internal implementation choices.
[TypeScript API guidance](https://www.typescriptlang.org/docs/handbook/2/functions.html#guidelines-for-writing-good-generic-functions).

When a boolean selects operations with different caller intent or effects, expose named operations
such as `previewExport()` and `writeExport()`, or a discriminated options object. Keep a boolean for
a binary setting such as `includeHeaders`. When public operations differ only at their boundaries,
keep shared implementation private. Do not split every optional behavior into a new API.
[Flag arguments](https://martinfowler.com/bliki/FlagArgument.html).

When a public contract must remain stable across internal refactors, declare the boundary type and
check the implementation's projection against it. When consumers should follow changes to a helper's
return shape or selected internal fields, deriving the public type with `ReturnType<typeof
internalHelper>` or `Pick<InternalState, ...>` is appropriate. Continue deriving types from
authoritative public schemas; introduce a separate type only for an independently owned contract,
not merely because a symbol is exported.
[TypeScript utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html).
