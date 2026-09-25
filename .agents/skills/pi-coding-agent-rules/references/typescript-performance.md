# TypeScript performance

## Bound work before optimizing local expressions (Default)

For user-controlled collections or remote results, set limits on bytes, entries, concurrency, and
elapsed time at the input or scheduling boundary. Stream or paginate large results instead of
buffering the full result and truncating only its presentation.

For a Pi tool, distinguish the result sent to the model from the data retained in memory or session
storage. A small `content` field does not make an unbounded `details` snapshot inexpensive.
[Node.js input and event-loop costs](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop),
[Pi output truncation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/truncated-tool.ts).

## Verify iterator compatibility before adoption (Required)

Node.js 22 introduced synchronous iterator helpers. Before adopting them, check the package's
supported Node.js and Pi runtimes, including any claimed standalone-binary support.
[Node.js 22 iterator support](https://nodejs.org/en/blog/announcements/v22-release-announce).

Check TypeScript library declarations separately from runtime support. When the configured libraries
lack iterator helper declarations, add an appropriate library such as `ESNext.Iterator`. Type
declarations do not provide runtime implementations.
[TypeScript iterator helpers](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-6.html#iterator-helper-methods),
[TypeScript library configuration](https://www.typescriptlang.org/tsconfig/lib.html).

## Use native iterators for lazy collection pipelines (Conditional)

When supported runtimes provide iterator helpers and a pipeline benefits from avoiding intermediate
arrays or stopping early, prefer native iterator composition:

```typescript
const labels = commands
  .values()
  .filter(command => command.enabled)
  .map(command => command.label)
  .toArray();
```

Iterator `filter` and `map` process values lazily. Collect with `toArray()` only when the consumer
needs an array. When the consumer requires only a bounded number of results, use `take(limit)`
before collection. For small, straightforward transformations without a useful benefit from
laziness, retain ordinary array methods.

Iterators are consumed as they are read. For another traversal, create a fresh iterator. Lazy
synchronous iteration does not move computation off the event loop or await asynchronous callbacks.
Before converting an array pipeline, check observable differences in callback ordering, mutation,
index arguments, sparse arrays, and iterator reuse. Keep callbacks free of externally visible side
effects as specified in
[pure transformations](typescript-architecture.md#keep-derived-data-transformations-pure-default).
[Iterator helper semantics](https://github.com/tc39/proposal-iterator-helpers).

## Select collection dependencies by required capabilities (Default)

Prefer native JavaScript/TypeScript code, including array methods, iterator helpers, and generators,
over third-party collection libraries. For a lazy pipeline, use supported native iterator helpers
that cover the operation. When a custom lazy traversal is clearer as a generator, use a generator
function. Add a library only when its required capabilities or reduction in implementation
complexity materially outweigh dependency, maintenance, and runtime compatibility costs. Do not add
a dependency solely to combine a simple filter and map.

- When the package needs broader TypeScript collection utilities and functional composition,
  consider Remeda. Supported operations inside `pipe` can evaluate lazily; verify the specific
  pipeline. [Remeda documentation](https://remedajs.com/docs/#pipe).
- When the package needs richer synchronous or asynchronous iterable operations, consider IxJS.
  [IxJS iterable operations](https://github.com/ReactiveX/IxJS).
- In existing Lodash code, verify shortcut-fusion eligibility before assuming chained operations
  avoid intermediate collections. Eligibility depends on the operations, input, callback arity, and
  library heuristics. [Lodash chaining](https://lodash.com/docs/#lodash).

For dependency declarations and host-provided packages, apply the
[Pi package dependency contract](pi-packages-and-sdk.md#use-the-hosts-pi-dependencies-required).

## Keep interactive callbacks responsive (Conditional)

When work runs on a streaming, input, or rendering path, avoid synchronous filesystem operations and
large CPU-bound transformations. An `async` declaration does not move computation off the event
loop. Chunk cooperative work or use a worker when measured CPU cost warrants the scheduling and
transfer overhead.

Coalesce frequent progress updates according to what users can observe. Preserve the final update
and cancellation response. Do not reparse a complete transcript or rebuild an unrelated view for
each token.
[Event-loop behavior](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).

## Give caches an identity, bound, and invalidation rule (Conditional)

Before introducing a cache, name the expensive computation or request it avoids. Include the inputs
that determine the result in the key: project, session branch, model, configuration, or resource
version as required by the computation. Bound entries or bytes and define invalidation at the state
owner.

Do not cache a rejected or cancelled request indefinitely. For in-flight request deduplication,
define whether one subscriber's cancellation cancels shared work. Avoid process-wide caches for data
whose meaning is session-specific.

## Measure the user-visible cost (Default)

For a performance change, compare representative inputs and record the metric the change targets:
startup time, tool latency, terminal responsiveness, allocation, heap growth, or context size.
Investigate repeated I/O, serialization, full-history scans, and retained objects before optimizing
syntax.

For a dense array of `n` elements with `k` matches, eager `filter().map()` makes `n` predicate calls
and `k` mapper calls. With full consumption and equivalent callbacks, lazy composition makes the
same calls. Lazy pipelines avoid intermediate arrays and can stop consuming input early; they do not
inherently halve computation. Iterator machinery has overhead, and fewer allocations do not
guarantee faster execution.

Repeatedly copying a growing accumulator, such as `[...acc, item]` inside `reduce`, can produce
quadratic copying. Use a readable transformation or populate a fresh local collection under the
[architecture ownership rules](typescript-architecture.md#keep-derived-data-transformations-pure-default).

Keep a more complex representation only when measured cost or a required scale bound justifies it.
Include cold-start cost and invalidation work in cache comparisons; a warm-cache benchmark alone
does not establish the workload's performance.
