# TypeScript error contracts

## Decide outcome, thrown error, or abort reason before writing a throw (Default)

Choose the channel from the operation's contract: return an expected answer as a result variant,
throw a failure the caller must react to with a kind, and convey the caller's cancellation or
supersession through the signal's abort reason. For example, a search returns `{ status: "empty" }`,
a stale write throws a `conflict` with the current revision, and a replaced operation aborts with `{
kind: "superseded" }`. The channel determines whether the caller consumes an answer, handles a
failure, or stops work.
[Abort reasons](https://nodejs.org/api/globals.html#abortcontrollerabortreason).

## Define failure kinds by the caller's reaction (Default)

Map each project-defined kind to one category and reaction:

| Category     | Reaction                                                       |
| :----------- | :------------------------------------------------------------- |
| Cancellation | Stop and clean up without a report.                            |
| Superseded   | Discard the result without changing state.                     |
| Refusal      | Report what failed for the caller to correct.                  |
| Conflict     | Report the current version for the caller to reload and retry. |
| Unavailable  | Preserve state and report the repair, with no automatic retry. |
| Defect       | Fail loudly with no remediation and no retry advice.           |

Keep a kind only when a consumer branches on it or a boundary reacts differently. A refusal whose
text tells the user what to fix needs one kind, not one kind per message. Cancellation and
supersession belong to the signal contract, not the thrown-error union.

## Represent kinds as one error class with a string discriminant (Default)

Use one class extending `Error`, a string-literal `kind` union, optional typed `data`, and the
original `cause`. Validate the contract's shape and dispatch by `kind` in an exhaustive switch;
module copies can have different class identities, so `instanceof` cannot identify the shared
contract.
[Class identity](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof),
[exhaustiveness lint](https://typescript-eslint.io/rules/switch-exhaustiveness-check/).

```ts
type FailureKind = "refusal" | "conflict" | "unavailable" | "defect";
type FailureData = { currentRevision: number };

class OperationError extends Error {
  readonly kind: FailureKind;
  readonly data?: FailureData;

  constructor(
    kind: FailureKind,
    message: string,
    options: { data?: FailureData; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OperationError";
    this.kind = kind;
    if (options.data !== undefined) this.data = options.data;
  }
}
```

Declare fields explicitly because `erasableSyntaxOnly` forbids constructor parameter properties.
Under `strict`, a catch binding defaults to `unknown`; narrow it before reading fields. Treat a
caught value outside the project error contract as a defect after checking cancellation. Accept
structurally validated copies of the project's class across module boundaries. Translate a typed
host failure into a kind while preserving its status and data, for example an unsaved persistence
result into `unavailable` with the result as `cause`; do not rethrow only `result.message`.
[Erasable syntax](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html),
[strict catch bindings](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-4.html#defaulting-to-the-unknown-type-in-catch-variables---useunknownincatchvariables),
[Error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause).

## Give remediation text one owner at the boundary (Default)

State what failed at the throw site and carry the data needed for the next step; compose remediation
from the kind at the boundary that renders to a person or model. Never append a generic retry
sentence to every error, and give defects no remediation. Render conflicts in a fixed form, for
example `Current revision: 12. Reload this revision before retrying.` A reviewer must be able to
trace each instruction to one kind and one wording owner. Exclude credentials and sensitive payloads
from output, and report a failure once rather than logging it at every layer.

## Keep cancellation and supersession on the signal (Required)

Abort with `controller.abort(reason)`, compose owner and operation signals with `AbortSignal.any`,
and call `signal.throwIfAborted()` before work and after each await. Before classifying a caught
error, check the signal and its reason; a catch that converts failures to messages must rethrow the
abort reason when the signal is aborted. For example, call `signal.throwIfAborted()` first in that
catch. Distinguish `{ kind: "cancelled" }`, which may pause or clean up, from `{ kind: "superseded"
}`, which silently discards the result without changing replacement state. Define precedence when
both owners can abort: `AbortSignal.any` preserves the reason of the signal that triggered it, not a
later reason. [Node.js AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal).

## Document the kinds a contract may throw (Required)

For a callback or interface other code implements, list each thrown kind and the implementer's
expected reaction in its doc comment, export the kind subset from the package entry point, and
version the contract. For example, document `conflict` as requiring the current revision in `data`
and a reload before retry. Consumers must be able to implement recovery without parsing messages;
apply the
[public documentation rule](typescript-code-organization.md#document-every-exported-symbol-required).

## Assert kinds, not message text (Default)

Assert `kind` and `data` in failure tests; assert text only where wording is itself the contract,
such as a remediation table. For example, assert `kind: "conflict"` and `data: { currentRevision: 12
}`. A message-substring assertion couples the test to wording and can pass on an unrelated error.
