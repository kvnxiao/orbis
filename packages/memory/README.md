# @orbis/memory

Memory for continuing work across Pi compaction and recalling earlier evidence. The proposed core
works independently and supports future complementary packages for project knowledge and developer
habits across sessions.

This package is in design. The [draft specification](SPEC.md) records the agreed direction and open
decisions; an installable implementation is not available.

## What it adds

The proposed extension prepares a current-work snapshot and source-linked observations as a session
progresses. At compaction, an eligible checkpoint presents what the model needs to continue.
Historical observations and original evidence remain available through recall.

| Capability                | Role                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Pi session history        | Records conversations and branches for resume and navigation.                                                                |
| Pi native compaction      | Summarizes older context and retains recent conversation under Pi's compaction policy.                                       |
| Provider-side compaction  | Compresses context through a model provider's API; its behavior depends on that provider.                                    |
| Orbis memory, as proposed | Prepares continuation memory before compaction and provides evidence recall, with room for complementary knowledge packages. |

The core focuses on continuation within a selected session lineage. Project learnings, personal
preferences, retrospectives, and reflections belong to future design work. The name does not imply
that those capabilities are already implemented.

See the [research synthesis](docs/research/README.md) for evidence, comparison limits, and the
questions that remain. Better continuation and lower cost have not been demonstrated for this
package.

## License

[MIT](https://github.com/kvnxiao/orbis/blob/main/LICENSE).
