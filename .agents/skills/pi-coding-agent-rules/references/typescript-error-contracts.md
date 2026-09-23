# TypeScript error contracts

## Choose the outcome channel before defining an error (Default)

Return expected answers as result variants, propagate failures through the API's error channel, and
convey cancellation or supersession through the operation's signal. For example, return `{ status:
"empty" }` for an empty search and abort replaced work with a supersession reason. Use a plain
`Error` when consumers only propagate and report a failure; introduce typed failures when consumers
need distinct recovery actions or structured data. Adapt the examples below to that need; they do
not require a custom error class or framework.

## Define failure kinds by recovery action (Default)

Keep a kind only when a consumer branches on it or a boundary reacts differently. Require the data
that reaction needs in its discriminated variant: both revisions for a conflict, or the affected
path for file repair. Do not create one kind per message or put unexpected defects in the
expected-failure union.

For interaction-bound actions, check identity before revision. An expired identity requires the
caller to stop using the callback and obtain a new interaction; a revision conflict within the
current interaction requires reloading current input before retrying. Preserve state on either
rejection. Apply the atomic mutation checks in [workflows](typescript-workflows.md).

## Document the kinds a contract may throw (Required)

For shared callbacks and interfaces, document expected failure kinds, required data, recovery
actions, and cancellation behavior. Export their failure types and structural validators through the
public entry point and version changes to the contract. Across extension loaders, validate shape
rather than relying solely on `instanceof` or message parsing; separately loaded classes need not
share identity. Keep the type and validator together and derive the type from the schema, as the
[boundary validation rule](typescript-domain-boundaries.md#validate-boundary-data-with-the-host-schema-library-required)
requires. Because that rule exempts an error object crossing an extension-loader boundary, the
`Conflict` example below has a hand-written validator.

For example, recognize this conflict only when both revisions are nonnegative safe integers. Extend
the contract with a discriminated union when additional recovery actions are needed, require each
variant's data, and dispatch recognized variants exhaustively.
[Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions),
[public API documentation](typescript-code-organization.md#document-every-exported-symbol-required).

```ts
type Conflict = {
  kind: "conflict";
  message: string;
  data: { suppliedRevision: number; currentRevision: number };
  cause?: unknown;
};

function isConflict(value: unknown): value is Conflict {
  if (
    typeof value !== "object" || value === null ||
    !("kind" in value) || value.kind !== "conflict" ||
    !("message" in value) || typeof value.message !== "string" ||
    !("data" in value) || typeof value.data !== "object" || value.data === null
  ) return false;
  const data = value.data;
  return "suppliedRevision" in data && typeof data.suppliedRevision === "number" &&
    Number.isSafeInteger(data.suppliedRevision) && data.suppliedRevision >= 0 &&
    "currentRevision" in data && typeof data.currentRevision === "number" &&
    Number.isSafeInteger(data.currentRevision) && data.currentRevision >= 0;
}
```

## Preserve failures through intermediate layers (Required)

Catch only where the layer can translate a recognized failure, recover, release resources, or report
at the final boundary. Rethrow unrecognized failures unchanged; a storage catch must not classify an
unexpected `TypeError` as repairable I/O. When translation is needed, retain structured data and the
original failure or typed host result as `cause`. Otherwise preserve object identity.
[Error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause).

When an editor needs a returned failure outcome, retain the error until its consumer renders it:

```ts
type SaveOutcome = { status: "saved" } | { status: "failed"; error: Conflict };

async function save(write: () => Promise<void>): Promise<SaveOutcome> {
  try {
    await write();
    return { status: "saved" };
  } catch (error) {
    if (!isConflict(error)) throw error;
    return { status: "failed", error };
  }
}
```

Require `write` to check the revision and mutate atomically. Keep result conversion only where the
consumer needs it; propagate thrown failures directly otherwise.

## Give remediation text one owner at the boundary (Default)

State what failed at the source; add recovery instructions once at the audience's rendering
boundary. Preserve typed failures for programmatic consumers. For a tool, render the data and
recovery action the model needs; for a command, name the user's available action; for a terminal
editor, account for visible controls. Add no speculative remediation or generic retry advice to
defects. Exclude sensitive payloads from output and report a failure once.

For example, use `toolOutcome(await save(write))` before constructing a successful Pi tool result.
Unexpected rejections bypass this renderer. Use `terminalOutcome` beside a reload control, or return
`SaveOutcome` unchanged to programmatic callers. Do not pass tool-rendered errors back through
domain code. See [Pi failure signaling](pi-failure-signaling.md) for the host's failed-result
representation.

```ts
function toolOutcome(outcome: SaveOutcome): { status: "saved" } {
  if (outcome.status === "failed") {
    const failure = outcome.error;
    throw new Error(
      `${failure.message} Current revision: ${failure.data.currentRevision}. ` +
        "Reload current input before retrying.",
      { cause: failure },
    );
  }
  return outcome;
}

function terminalOutcome(outcome: SaveOutcome): string {
  return outcome.status === "saved" ? "Saved." : outcome.error.message;
}
```

## Keep cancellation and supersession on the signal (Required)

Preserve the reason supplied to `controller.abort(reason)`. When either caller or lifecycle owner
can cancel work, compose signals with `AbortSignal.any` where supported. Check cancellation before
work and after awaits before further work or mutation. In a catch, recognize the operation's
cancellation before rendering a failure; propagate its reason or return the documented cancelled
outcome. At an I/O adapter, normalize only that API's documented cancellation shape, never an
arbitrary error name or message. Preserve unrelated defects even when they race with abort.

Check ownership separately before mutation, recovery, and cleanup. A composed signal retains its
first abort reason; cancellation followed by replacement does not change that reason or authorize
old cleanup to modify replacement state. For example, use controller identity for work whose latest
invocation owns the result:

```ts
type Owner = { current: AbortController | undefined; value: string };
type WorkOutcome = { status: "committed" } | { status: "cancelled"; reason: unknown };
const superseded = { kind: "superseded" } as const;

async function runLatest(
  owner: Owner,
  caller: AbortSignal,
  prepare: (signal: AbortSignal) => Promise<string>,
  release: () => void,
): Promise<WorkOutcome> {
  const controller = new AbortController();
  const signal = AbortSignal.any([caller, controller.signal]);
  try {
    signal.throwIfAborted();
    const previous = owner.current;
    owner.current = controller;
    previous?.abort(superseded);
    const value = await prepare(signal);
    signal.throwIfAborted();
    if (owner.current !== controller) return { status: "cancelled", reason: superseded };
    owner.value = value;
    return { status: "committed" };
  } catch (error) {
    if (signal.aborted && Object.is(error, signal.reason)) {
      return { status: "cancelled", reason: signal.reason };
    }
    throw error;
  } finally {
    if (owner.current === controller) owner.current = undefined;
    release();
  }
}
```

For this example, require `prepare` to reject cancellation with `signal.reason` and `release` to be
nonthrowing and dispose only this invocation's resources, including on pre-abort. Keep the ownership
check and in-memory assignment synchronous; enforce checks for external writes at the storage
boundary. Cancellation cannot undo committed effects or stop uncooperative work. Use `finally` to
release resources without replacing the original failure.
[Node.js AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal).

## Assert kinds, not message text (Default)

Test through public operations; use message substrings only as supplementary evidence, never as the
sole proof of classification. Control race order with deferred promises rather than sleeps.

| Case                 | Required assertion                                                                                                                                     |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expected failure     | Assert kind, required data, original cause, and state preservation required by the contract.                                                           |
| Intermediate outcome | Assert error identity; exercise both returned failures and rejected promises where supported.                                                          |
| Shared contract      | Accept structural copies without class identity; reject unknown kinds, missing data, and invalid field values.                                         |
| Rendering            | Assert exact contractual wording, recovery instructions once per audience, and preserved structured data for programmatic consumers.                   |
| Unexpected defect    | Assert the original error and cause survive, including a failure racing with cancellation, without added advice.                                       |
| Cancellation         | Cover pre-abort and abort during I/O; assert the original reason and release of owned resources.                                                       |
| Replacement          | Cover supersession alone and cancellation before supersession, then resolve or reject the old work; assert unchanged replacement state and controller. |

For the cancellation example, hold old and replacement preparations pending, abort the caller, start
the replacement, then release the old preparation. Assert `owner.current` still identifies the
replacement and `owner.value` is unchanged until the replacement commits. Repeat with an unrelated
old rejection and assert that it remains observable. Verify Pi's failure status and UI behavior
through the actual adapters under [Pi testing](pi-testing.md); these snippets do not load Pi.
