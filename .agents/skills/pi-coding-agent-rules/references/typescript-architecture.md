# TypeScript architecture

## Organize modules around owned behavior (Default)

Group code by the domain operation or resource it changes. Keep validation, state transitions, and
their tests close enough to review the contract together. When a module's responsibilities have
different dependencies or lifetimes, split the module; line count alone does not identify a module
boundary.

Choose the smallest design that satisfies the current contract. Add extension points when a caller
requires variation. Improving names or extracting a cohesive operation can simplify current code
without adding future capabilities. [YAGNI](https://martinfowler.com/bliki/Yagni.html).

## Separate policy from integration code when it has an independent contract (Default)

For a workflow with domain decisions, keep parsing and Pi event wiring at the adapter boundary. Pass
validated domain values into functions that compute decisions or transitions, then execute I/O
through the adapter. Domain code should not need a terminal, active Pi session, or provider
connection to express its rules.

Separate reads from decisions by passing the observed values to decision code. Keep the read,
decision, revalidation, and write inside the same lock or transaction when correctness requires it.
A pure decision can still become stale; extracting it does not change the concurrency contract.

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

## Make workflows describe meaningful operations (Default)

Before implementing a workflow, identify its operation sequence, data dependencies, and owners of
effects and mutable state. For a small operation, do this directly in the code; a separate design
artifact is not required. During implementation and review, apply the
[responsibility review](typescript-code-organization.md#review-responsibilities-and-data-flow-default)
to the workflow and its helpers together.

Keep a workflow's prerequisites, operation order, data dependencies, outcome branches, and commit
boundary visible. Delegate detailed parsing, collection assembly, storage access, and rendering when
those details obscure the process. Keep lifecycle coordination with the scope that owns it; an
operation that owns a subscription must also own its cleanup. A workflow may contain branches,
loops, sequential awaits, and `try`/`finally` when they express that coordination.

Use names that state the operation or decision, such as `reserveCapacity` or `eligibleOrders`,
rather than `processData` or `handleStep`. Name intermediate decisions and use early returns when
they make the main path easier to follow. Keep precedence and materially different outcomes
explicit; do not compress them into a pipeline or dispatch table merely to reduce statements.

Extract by the operation's result or invariant, not by consecutive blocks of statements. Pass the
inputs the operation needs and return its result. Avoid helpers that exchange progress through a
shared mutable context object. Keep short, cohesive adapter operations inline, and do not add a
generic workflow engine, command interpreter, or service layer to sequence a fixed set of calls.

For example, keep overdue-balance calculation in a private helper so the reminder workflow can use
its result without following eligibility and accumulation details. Assume `loadInvoices` returns
validated records and both I/O operations honor the supplied cancellation signal:

```ts
function overdueBalances(invoices: readonly Invoice[], cutoff: number): Balance[] {
  const balances: Balance[] = [];
  for (const invoice of invoices) {
    if (invoice.dueAt <= cutoff && invoice.paid < invoice.total) {
      balances.push({ id: invoice.id, amount: invoice.total - invoice.paid });
    }
  }
  return balances;
}

async function remind(accountId: string, cutoff: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const invoices = await loadInvoices(accountId, signal);
  signal.throwIfAborted();
  const balances = overdueBalances(invoices, cutoff);
  if (balances.length === 0) {
    return;
  }
  await writeReminder(accountId, renderReminder(balances), signal);
}
```

Keep short decisions and transformations inline when their meaning is already clear. For example,
`if (requested > available) return { status: "full" };` can express a capacity rule directly, and
`items.map((item) => item.id)` can express a field projection. Extract only when the operation's
contract reduces the details a reader must follow to understand the caller.
[Split Phase](https://refactoring.com/catalog/splitPhase.html).

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

## Keep derived-data transformations pure (Default)

Compute derived data without changing inputs or shared state. Choose loops or `map`, `filter`, and
related transformations according to which expresses the algorithm clearly. Keep transformation
callbacks free of externally visible side effects. When a long transformation becomes hard to
follow, name intermediate values. Use `reduce` for clear accumulations; avoid reducers that combine
unrelated state or obscure execution order.

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

When concurrent callbacks mutate a captured collection or operations share a mutable collection,
treat it as shared state even when declared inside a function. Identify its writers and lifetime,
and control updates through its owner. Conditional appends are not a design defect by themselves;
separate collection assembly when it makes the surrounding workflow track transformation details
alongside I/O or lifecycle work.

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
