# TypeScript asynchronous work and errors

## Give asynchronous work an owner and an end condition (Required)

For every background task, identify the operation, session, or process that owns it. The owner must
observe failure, cancel work that has become obsolete, and release resources on completion or
shutdown. Attaching a rejection handler alone does not define task lifetime.

Forward cancellation through nested I/O and subprocess calls. If an API cannot cancel, prevent a
late result from committing into a replaced session or superseded operation. Check an operation
identity or generation before committing state. A timeout that only races promises does not stop the
losing operation. [AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal),
[subprocess cancellation](https://nodejs.org/api/child_process.html).

## Choose concurrency according to resource independence (Default)

Run independent reads concurrently within a limit that matches service capacity and memory use.
Serialize operations that read and modify the same resource, or use transactions or compare-and-swap
semantics at the storage boundary. Include the read and decision in the protected operation.

When concurrent work partially fails, define whether siblings should finish, cancel, or contribute a
partial result. `Promise.all` rejects on a failure but does not cancel the other operations. Do not
report atomic success for a workflow whose earlier writes have already committed.
[Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all).

When an interaction or mutation depends on the previous operation finishing, preserve sequential
`await`. If the project enables `no-await-in-loop`, suppress it at the affected statement and state
the ordering constraint.
[Sequential-await exceptions](https://eslint.org/docs/latest/rules/no-await-in-loop#when-not-to-use-it).

## Retry only within the operation's safety contract (Conditional)

For a transient failure, retry only when repeating the operation is safe or the receiving service
deduplicates an idempotency key. Bound attempts and elapsed time, apply backoff with jitter, and
stop on cancellation. After an ambiguous timeout on a mutation, query its outcome or use its
idempotency contract before repeating it.

For stateful tools, define
[repeated invocation](pi-tools.md#define-repeated-invocation-for-stateful-tools-conditional)
separately from automatic transport retries. When completion remains unknown, retain the recovery
state and report how to reconcile it; absence of a terminal result does not authorize repetition.

Choose one layer to own retries for a request. Account for SDK or provider retries before adding an
outer loop. Do not retry validation failures, unsupported operations, or user cancellation.
[Retry and idempotency guidance](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html).

## Translate errors at the boundary that can act on them (Default)

Use [TypeScript error contracts](typescript-error-contracts.md) to choose outcomes, thrown kinds,
abort reasons, and remediation ownership; apply [Pi failure signaling](pi-failure-signaling.md) when
translating them into tool results, notifications, or TUI messages.

## Keep subprocess arguments separate from shell programs (Required)

For executable invocation, pass arguments as an array through a supported execution API. Resolve
paths against the intended working directory and validate resource access before invocation. When
shell syntax is required, keep the shell program controlled and pass untrusted values through a
mechanism that cannot reinterpret them as shell code. Argument arrays still require protection
against the executable's option injection, such as `--` where supported.
[Node.js subprocess behavior](https://nodejs.org/api/child_process.html).
