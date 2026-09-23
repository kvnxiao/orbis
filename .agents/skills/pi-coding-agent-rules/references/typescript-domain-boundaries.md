# TypeScript domain boundaries

## Encode valid workflow states (Default)

When fields are valid only together, model the alternatives as a discriminated union. A job with
`status: "succeeded"` requires its result; a job with `status: "failed"` requires its error.
Independent `loading`, `done`, and `failed` booleans permit combinations the workflow may forbid.

When a command determines its payload, preserve that correlation in a discriminated request object
through internal calls. Separate `command: Command` and `payload: AllPayloads` parameters accept
combinations that may be invalid together. Where an authoritative schema or command registry exists,
derive the request type from it. Before using variant-specific fields, narrow the request. When
every combination is valid, keep independent parameters; do not couple unrelated values merely
because they are passed together.

Define allowed transitions in the state owner's operations. Exhaustive switches check coverage after
the state model exists; they do not decide which states or transitions belong in that model.
[Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions).

## Validate when data crosses a trust or persistence boundary (Required)

Treat decoded network responses, configuration, subprocess output, and persisted entries as
untrusted data until a runtime parser establishes their contract. A TypeScript assertion cannot
validate a payload. Validate shape with the
[host schema library](#validate-boundary-data-with-the-host-schema-library-required), then domain
constraints such as bounds, supported versions, and relationships between fields.

Normalize accepted external representations into one internal representation at the boundary. Keep
validated values typed through internal calls instead of repeatedly parsing them. When missing,
explicitly empty, malformed, and unsupported input require different actions, preserve those
distinctions.
[TypeScript assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions).

## Define omission, clearing, and replacement in update contracts (Default)

When an API accepts partial updates, define the meaning of omitted fields, explicit `undefined`,
`null`, and supplied values. For example, omission can preserve a field, `null` can clear it, and a
value can replace it. Reject representations the contract does not support, and preserve accepted
distinctions through validation and serialization. Define whether nested objects merge or replace
and whether collections replace, append, or update by identity.

When optional fields express the permitted updates and their meaning is defined, use `Partial<T>`.
When clearing differs from storing a valid `null`, or fields require different operations, use
explicit update variants such as `set` and `clear`. When a simple optional-field object already
expresses the contract, keep it. TypeScript's optional-property checks constrain assignable values;
they do not define update behavior.
[Exact optional property types](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html).

## Compare structured inputs by domain meaning (Conditional)

When equality controls deduplication, change detection, or cache validity, define which fields
determine meaning. JSON objects are unordered collections of members; arrays are ordered sequences.
Include meaningful nested fields and preserve element identities. Sort a collection only when its
order has no domain meaning: a set of labels can be order-independent, while a sequence of
transformations is not. Do not substitute raw serialization equality for domain equality.
[JSON data structures](https://www.rfc-editor.org/rfc/rfc8259.html#section-1).

## Distinguish identifiers and units when substitution is hazardous (Conditional)

When confusing values of the same primitive type has a concrete consequence, distinguish them
through domain types and validated constructors: session IDs versus tool-call IDs, bytes versus
tokens, or relative paths versus resolved paths. Keep units visible at arithmetic and serialization
boundaries.

Use a brand or wrapper only when it prevents a demonstrated class of substitution errors. Do not
brand every string or number. A brand records a validation or construction contract; a cast alone
does not establish that contract.

## Validate boundary data with the host schema library (Required)

The schema library is the `typebox` package that the supported Pi release bundles and lists among
the core packages an extension declares as a `"*"` peer. Import `Type` and `Static` from `typebox`
and `Value` from `typebox/value`. Do not add a second schema or validation library.

Boundary data is any value the extension did not construct in the current process: settings files,
files the extension reads under its own directories, custom session entry `data` read back through
the session manager, tool `parameters`, tool result `details` read back from a session, and JSON
from a subprocess or network. A record the extension wrote itself, such as a saved retry record, is
boundary data when it is read back.

For each boundary record, declare one schema, derive its TypeScript type with `Static`, validate at
the boundary with `Value.Check`, and include the `Value.Errors` output in the thrown error. Give a
persisted schema a literal `version` property. Use one schema both to write a custom entry and to
validate it on read.

Do not write an interface by hand for a record a schema describes. Do not write a type predicate on
`unknown` for data a schema can describe. Do not narrow parsed data with an `as` assertion. The
permitted exceptions are an error object crossing an extension-loader boundary, a value that
contains functions or class instances, and a cross-field invariant written as a wrapper that first
calls `Value.Check`.

To keep the parse and the check together, route every `JSON.parse` of boundary data through one
per-package parse helper that takes the schema.
[Available imports](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#available-imports),
[TypeBox](https://github.com/sinclairzx81/typebox).

```ts
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

const settingsSchema = Type.Object({
  version: Type.Literal(1),
  enabled: Type.Boolean(),
});
type Settings = Static<typeof settingsSchema>;

function parseRecord<T extends TSchema>(schema: T, text: string, path: string): Static<T> {
  const value: unknown = JSON.parse(text);
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value)
      .map((error) => `${error.instancePath}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid record at ${path}: ${detail}`);
  }
  return value;
}
```

## Separate wire formats from domain models when their contracts differ (Conditional)

When an external API's nullability, names, or versioning differs from the domain, translate through
a boundary adapter. Do not spread transport objects into internal state or public results and
accidentally adopt unknown fields.

When a schema defines an external contract, derive its TypeScript type from the schema, as the
[boundary validation rule](#validate-boundary-data-with-the-host-schema-library-required) requires.
Maintain a separate domain type only when the translation has meaning. For exported results, decide
which fields callers may rely on and keep transient rendering or transport details private.

Without an external API, a hand-written interface and a hand-written schema for one piece of
internal state still define one contract twice. Derive the type from the schema under the
[boundary validation rule](#validate-boundary-data-with-the-host-schema-library-required), and split
the representations only when the persisted form and the in-memory form differ in meaning.
