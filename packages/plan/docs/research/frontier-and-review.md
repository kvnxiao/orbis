# Frontier history and annotated review

Research date: 2026-09-11. Inspected runtime: Pi 0.85.1.

## Public terminal interfaces

Pi's Markdown component renders terminal hyperlinks and supports bold and background styling.
Hyperlink activation depends on the terminal's OSC8 support and local file handler. Titles can
display a shortened path while targeting an absolute file URL. The renderer returns styled rows
without a source map. Source ranges must use parsed Markdown block offsets; terminal wrapping must
not determine source line numbers.

Block source offsets can distinguish repeated and nested blocks. Rendering independent fragments can
break reference definitions, list indentation, and code fences. When placing annotations, a block
renderer must retain document definitions and preserve nested source structure. The selected block's
source range remains stable during terminal resize.

Pi recognizes ordinary F2, F3, and F4 sequences and does not assign them in its default bindings.
Some enhanced keyboard encodings require explicit decoding. Ctrl+G is the external-editor shortcut;
Alt+F moves the editor cursor by a word. F2 can focus overall feedback; F3/F4 can browse revisions
without reserving printable brackets. Terminal and SSH key delivery require host verification.

Sources: Pi 0.85.1
[Markdown renderer](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/components/markdown.ts),
[key parser](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/keys.ts), and
[editor bindings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/keybindings.ts).

## State and artifact boundaries

Pi session entries can preserve branch-owned extension snapshots without adding them to model
context. Reconstructing from the active branch excludes unrelated continuations. A completed-round
snapshot can preserve question context and clarification history that a final decision alone lacks.

Stable question identity and content revision serve different purposes. Structural comparison can
detect content changes but cannot decide whether a reformulated question concerns a different
decision. Retained records allow withdrawn and deferred decisions to preserve identity and drafts.

Before a modal displays a revision file, the file must be written and confirmed. Approval must
reference the same immutable bytes. Supplementary notes can be stored in a companion artifact and
included in the approval event without changing the plan Markdown. Partial writes must remain
recoverable, and acceptance must follow confirmed artifact and session persistence. File existence
does not establish approval.

Source: Pi 0.85.1
[session format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md).
The snapshot and artifact observations above are design implications of those storage boundaries.
Interactive terminal appearance and live-model research quality remain unverified.
