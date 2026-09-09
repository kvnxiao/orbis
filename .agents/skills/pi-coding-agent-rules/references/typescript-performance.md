# TypeScript performance

## Bound work before optimizing local expressions (Default)

For user-controlled collections or remote results, set limits on bytes, entries, concurrency, and elapsed time at the input or scheduling boundary. Stream or paginate large results instead of buffering the full result and truncating only its presentation.

For a Pi tool, distinguish the result sent to the model from the data retained in memory or session storage. A small `content` field does not make an unbounded `details` snapshot inexpensive. [Node.js input and event-loop costs](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop), [Pi output truncation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/truncated-tool.ts).

## Keep interactive callbacks responsive (Conditional)

When work runs on a streaming, input, or rendering path, avoid synchronous filesystem operations and large CPU-bound transformations. An `async` declaration does not move computation off the event loop. Chunk cooperative work or use a worker when measured CPU cost warrants the scheduling and transfer overhead.

Coalesce frequent progress updates according to what users can observe. Preserve the final update and cancellation response. Do not reparse a complete transcript or rebuild an unrelated view for each token. [Event-loop behavior](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).

## Give caches an identity, bound, and invalidation rule (Conditional)

Before introducing a cache, name the expensive computation or request it avoids. Include the inputs that determine the result in the key: project, session branch, model, configuration, or resource version as required by the computation. Bound entries or bytes and define invalidation at the state owner.

Do not cache a rejected or cancelled request indefinitely. For in-flight request deduplication, define whether one subscriber's cancellation cancels shared work. Avoid process-wide caches for data whose meaning is session-specific.

## Measure the user-visible cost (Default)

For a performance change, compare representative inputs and record the metric the change targets: startup time, tool latency, terminal responsiveness, heap growth, or context size. Investigate repeated I/O, serialization, full-history scans, and retained objects before micro-optimizing syntax.

Keep a more complex representation only when measured cost or a required scale bound justifies it. Include cold-start cost and invalidation work in cache comparisons; a warm-cache benchmark alone does not establish the workload's performance.
