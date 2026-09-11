# TypeScript workflows

## Bind actions to the state version the user observed (Default)

When a user action depends on displayed state, include the state identity and version in the action.
After asynchronous work, recheck the version at the state owner before committing. For shared
storage, make the version check and mutation atomic through a conditional write or transaction. If
newer state changes the action's meaning, reject the stale action and obtain fresh input instead of
applying it to a different version. HTTP's `If-Match` precondition is one implementation of this
concurrency check. [Conditional writes](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).

## Track the inputs that determine derived output validity (Default)

When consumers require output based on current inputs, record the input versions or invalidate the
output when those inputs change. Reject stale output or recompute it before use; file existence and
creation time do not establish validity. When history is retained, distinguish historical output
from output valid for current operations. If consumers permit stale data, define its maximum age and
permitted uses.
[Cache invalidation and consistency trade-offs](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside#problems-and-considerations).

## Define recovery across the state transition (Default)

When an operation combines fallible preparation and external mutations, identify the commit boundary
and preserve the inputs needed to recover. Include initialization and validation failures in
recovery, not only the final write. Release partially acquired resources and restore a usable state.
After an ambiguous mutation failure, determine the stored outcome or use the operation's idempotency
contract before retrying.
[Recovery and idempotent operations](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

## Give modal replacement an explicit lifecycle (Default)

When modal interactions replace one another and share an input resource, finish and clean up the
current interaction before opening its replacement. Prefer an owned loop or an existing lifecycle
controller over recursive calls that retain prior interactions. Cancel obsolete work and reject late
callbacks from replaced instances. This ordering applies to replacements; intentionally nested
dialogs need their own ownership contract.
[Cancellation and listener cleanup](https://nodejs.org/api/globals.html#class-abortsignal).
