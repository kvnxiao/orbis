# @orbis/memory

Memory for continuing work across Pi compaction and recalling earlier evidence. The core design
works independently and supports future complementary packages for project knowledge and developer
habits across sessions.

The [draft specification](SPEC.md) defines the MVP behavior and conformance scenarios. An
installable implementation is not available.

## What it adds

The extension design maintains unfinished obligations, decisions, progress, and critical facts as a
session progresses. It also records findings linked to their source messages for later recall. At
compaction, it replaces Pi's native summary with a checkpoint of that maintained state and retains
Pi's selected recent conversation. Native summarization remains the fallback.

Memory updates are automatic. The design includes `/memory inspect` for the current snapshot and
recent obligation retirements with evidence references. Nonmodal notices report degraded operation
and whether auxiliary observation continues to incur costs. Virtual acting models use native
compaction when their request capacity cannot be bounded; unsupported observer routing suspends
auxiliary inference.

Recall uses source text after replacements and omissions by default; reading edited-out originals
requires an explicit request and a personal configuration opt-in. When requests use a native
checkpoint, a bounded file-path supplement preserves available earlier file activity. Disabling
memory stops preparation and these supplements while recall remains available.

| Capability               | Role                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Pi session history       | Records conversations and branches for resume and navigation.                                                                |
| Pi native compaction     | Summarizes older context and retains recent conversation under Pi's compaction policy.                                       |
| Provider-side compaction | Compresses context through a model provider's API; its behavior depends on that provider.                                    |
| Orbis memory design      | Prepares continuation memory before compaction and provides evidence recall, with room for complementary knowledge packages. |

The core focuses on continuation within the active session branch and its ancestry. Project
learnings, personal preferences, retrospectives, and reflections belong to future design work. The
name does not imply that those capabilities are already implemented.

See the [research synthesis](docs/research/README.md) for evidence, comparison limits, and the
evaluation questions. Better continuation and lower cost have not been demonstrated for this
package.

## License

[MIT](https://github.com/kvnxiao/orbis/blob/main/LICENSE).
