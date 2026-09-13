# TypeScript code organization

## Keep one contract in one module (Default)

A contract's TypeScript type, its runtime schema, its transitions, and its validity check belong in
one module, with one encoding derived from the others. Where the schema library can produce the
type, declare the schema and derive the type. Parallel hand-written encodings can diverge without a
compiler error: adding a state or an action then requires a matching edit in every encoding, and a
missed edit still compiles.

Count the encodings before adding one. A union partitioned into subsets is itself a contract: the
members one validator accepts, and the members another branch dispatches. Derive each subset from
the union declaration rather than restating its members in a validator, a mapped type, and a
dispatch condition.
[Utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html#extracttype-union).

## Split a module when its exports serve unrelated importers (Default)

Cohesion is measured by which importers change together. When one module exports a presentation
type, a domain predicate, and filesystem read and write, every importer of any one export can depend
on all three. Split along the importer sets: give a presentation type to the module the renderers
already depend on, and keep file I/O with the code that owns the file.

Apply the same test before splitting. When a typical change touches most of a module's exports,
splitting adds edit sites without reducing coupling; keep that module whole. A generic `utils`
module fails the test by construction, because its importers share no contract.

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

## Name modules on one axis and keep the dependency direction visible (Default)

Within one directory, name every module for the domain concept it owns, or name every module for the
host layer it adapts. A flat directory that mixes domain names with adapter names does not show
which modules may reach a terminal or a filesystem.

When a package holds both domain modules and host adapters, separate them by directory so the
permitted import direction is stated by the layout and checkable by a linter. Add directories for
that separation, not for file count.
