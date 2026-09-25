# TypeScript code organization

## Give each contract an authoritative owner (Default)

Keep a boundary record's schema and derived TypeScript type together. Declare its shape constraints
in the schema, as the
[boundary validation rule](typescript-domain-boundaries.md#validate-boundary-data-with-the-host-schema-library-required)
requires. Let transitions and semantic validation depend on that authoritative contract rather than
repeat its encoding. For example, keep a reservation schema with its derived type while a booking
operation imports it to enforce capacity.

Keep those operations in the same module while they form one cohesive responsibility. Split when
they own different decisions, dependencies, or lifetimes; sharing a session type does not make every
operation on that session one responsibility. Do not move I/O, rendering, or an entire workflow into
the schema module merely because they use its types.

Count the encodings before adding one. A union partitioned into subsets is itself a contract: the
members one validator accepts, and the members another branch dispatches. Derive each subset from
the union declaration rather than restating its members in a validator, a mapped type, and a
dispatch condition.
[Utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html#extracttype-union).

## Split a module when its exports serve unrelated importers (Default)

Cohesion depends on shared invariants, dependencies, and lifetimes; importer sets provide supporting
evidence. One large importer can still consume several distinct responsibilities. When one module
exports a presentation type, a domain predicate, and filesystem read and write, every importer of
any one export can depend on all three. Split along the importer sets: give a presentation type to
the module the renderers already depend on, and keep file I/O with the code that owns the file.

Apply the same test before splitting. When a typical change touches most of a module's exports,
splitting adds edit sites without reducing coupling; keep that module whole. A generic `utils`
module fails the test by construction, because its importers share no contract.

## Decompose locally before introducing shared abstractions (Default)

Extract a private helper when its name and contract let the caller omit implementation details from
its reasoning, even if it has one caller. Keep short decisions and transformations inline when their
meaning is already clear. Keep the helper in the owning module until a separate responsibility
warrants another module. For example, `overdueBalances` can own eligibility and balance calculation
without becoming a configurable billing service.

Keep trivial forwarding inline. Require a helper's contract to be understandable without
reconstructing changing locals from its caller. A closure may capture stable dependencies, and a
state owner may use private methods; make their effects explicit. Reject extractions that spread one
invariant across files or pass the entire runtime to helpers without narrowing responsibilities. A
short wrapper is justified when it enforces a constraint, adapts a boundary, or owns cleanup.
[Extract Function](https://refactoring.com/catalog/extractFunction.html),
[Inline Function](https://refactoring.com/catalog/inlineFunction.html).

## Review responsibilities and data flow (Default)

During implementation and review, examine the workflow with its helpers, regardless of function
size:

- Can the reader identify the operation sequence and dependencies without following collection
  assembly, rendering, or storage mechanics? Name a specific mixed responsibility before requesting
  extraction.
- Can a domain decision be exercised with values and assertions, without constructing Pi, a
  terminal, or a filesystem fixture? Keep integration tests for the actual I/O contract.
- Does each helper remove details from the caller's reasoning, or merely move statements behind a
  name while sharing the same mutable state? Keep the smaller direct implementation when extraction
  adds only navigation.
- Do types guarantee the data required by each outcome? Distinguish missing correlations from
  legitimate optional data, history, and runtime relationships.
- Can the reader locate the owner of each mutable resource, task, subscription, and cleanup action?
  Check whether extraction changed ordering, cancellation, transaction scope, or stale-result
  guards.

When proposing a design change, report the concrete reasoning burden, the proposed boundary, and the
behavior that must remain unchanged. Keep design findings distinct from demonstrated correctness
defects. Treat size and field-count thresholds as review signals; do not split code mechanically to
satisfy a count.

## Report size, duplication, and test-coupling thresholds (Default)

Report a review finding for each of these conditions:

- A class has more than 8 mutable fields.
- The same helper is present in two or more modules.
- A test asserts an internal call ordinal, such as requiring a private dependency's third call to
  receive a particular argument.

Use these thresholds to request review of responsibilities, shared ownership, or observable test
contracts. Apply the cohesion and helper-promotion rules when choosing a remedy; a finding does not
require a mechanical split or extraction.

## Let the manifest define the public surface (Default)

Package `exports` entries are the encapsulation boundary: a path the manifest does not list cannot
be imported from outside the package. Choose entry points deliberately — the extension factory, and
any contract third parties implement — and keep every other module private.

Inside the implementation directory, import siblings directly. A module that re-exports another
module's symbols alongside its own hides which symbols it owns, routes unrelated importers through
one hub, and gives tests a second name for the same class. Reserve the re-export facade for the
manifest's entry points. [Subpath exports](https://nodejs.org/api/packages.html#subpath-exports).

## Document every exported symbol (Required)

Every symbol a module exports has a doc comment: functions, classes, constants, types, schemas, and
the entry points the package manifest publishes. A caller outside the module cannot inspect its
implementation to recover the contract, and callers who never read this repository can invoke a
published entry point. Non-exported helpers stay undocumented; where a private name needs a comment
to be clear, rename it.

Open with one imperative line naming the operation, or the meaning the value carries. Then state
only what the signature cannot: the preconditions the caller establishes, the invariant the value
holds, the unit or identifier space a constant belongs to, which condition maps to which thrown
error, and what the call writes outside its return value. Do not restate the parameter list, the
return type, or the identifier in prose. Write `@param` and `@returns` where they add a constraint,
not to mirror the declared types.

For an exported type or schema, record the contract its members cannot express: which fields are
valid only together, which field discriminates the union, and what compatibility a version literal
promises. For a contract third parties implement, document the ordering the caller guarantees, the
cancellation behavior, and the errors an implementation may throw. [TSDoc](https://tsdoc.org/).

## Promote a helper on its second caller, not its second resemblance (Default)

Use this rule to share behavior between owners; private decomposition does not need multiple
callers.

Duplicated knowledge and duplicated syntax take different remedies. Where two modules encode the
same rule — one precedence order, one retry policy — unify them at the second occurrence, because a
divergence between them is a defect. Where two modules merely look alike, wait: extract once a third
caller confirms the shape, or once a shared type already unions the variants.

When variant data duplicates knowledge, needs shared ownership, or defines a closed contract that
needs exhaustive coverage, introduce a mapping. Otherwise, keep an isolated literal or single-use
branch inline. Place the mapping with the contract's owner and apply the
[variant mapping rules](typescript-architecture.md#derive-choices-and-counts-from-declared-contracts-default).

A type that unions two implementations is evidence that the contract exists. When a function accepts
`A | B` and both supply the same fields in the same order, name that contract: declare the shared
interface, or give both a single argument object so callers cannot transpose positional parameters.
[Rule of three](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)).

## Restrict raw parsing to the parse helper (Conditional)

When the project's linter supports property restrictions, restrict `JSON.parse` in extension source
to the parse helper module that the
[boundary validation rule](typescript-domain-boundaries.md#validate-boundary-data-with-the-host-schema-library-required)
requires, and name that module in the restriction message. The restriction cannot match a
hand-written type predicate; report a review finding for a predicate on data a schema can describe.

## Name modules on one axis and keep the dependency direction visible (Default)

Within one directory, name every module for the domain concept it owns, or name every module for the
host layer it adapts. A flat directory that mixes domain names with adapter names does not show
which modules may reach a terminal or a filesystem.

When a package holds both domain modules and host adapters, separate them by directory so the
permitted import direction is stated by the layout and checkable by a linter. Add directories for
that separation, not for file count.
