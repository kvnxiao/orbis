# @orbis/memory

Memory for continuing work across Pi compaction and recalling earlier evidence. The core design
works independently and supports future complementary packages for project knowledge and developer
habits across sessions.

The [approved specification](SPEC.md) defines the MVP behavior and conformance scenarios. An
installable implementation is not available.

## What it adds

The extension design prepares a continuation snapshot and source-linked observations as a session
progresses. At compaction, a checkpoint presents continuation state through Pi's prepared cut,
followed by the retained recent conversation. Memory updates are automatic. Recall uses effective
source text by default; access to edited-out originals requires an explicit request and a personal
configuration opt-in. Disabling memory stops preparation and supplements while bounded recall
remains available.

| Capability               | Role                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Pi session history       | Records conversations and branches for resume and navigation.                                                                |
| Pi native compaction     | Summarizes older context and retains recent conversation under Pi's compaction policy.                                       |
| Provider-side compaction | Compresses context through a model provider's API; its behavior depends on that provider.                                    |
| Orbis memory design      | Prepares continuation memory before compaction and provides evidence recall, with room for complementary knowledge packages. |

The core focuses on continuation within a selected session lineage. Project learnings, personal
preferences, retrospectives, and reflections belong to future design work. The name does not imply
that those capabilities are already implemented.

See the [research synthesis](docs/research/README.md) for evidence, comparison limits, and the
evaluation questions. Better continuation and lower cost have not been demonstrated for this
package.

## License

[MIT](https://github.com/kvnxiao/orbis/blob/main/LICENSE).
