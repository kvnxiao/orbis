# Terminal planning and annotation

Research date: 2026-09-10. Evidence baseline: Pi 0.85.1 installed in this workspace
and its versioned public documentation. Findings come from source inspection;
the proposed interaction has not been exercised in a real terminal.

## Modal layout and navigation

Pi exposes focused overlays through `ctx.ui.custom(component, { overlay: true })`.
Overlay dimensions can use terminal-relative sizes. A large modal does not require
Pi's experimental fullscreen mode. Custom components receive input and can use
Pi's key-matching helpers for ordinary arrows, Enter, Escape, Tab, and paging.
[Overlay documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#overlays)

The overlay recomputes its geometry on resize, but `maxHeight` clips excess rows.
It does not scroll content or keep the focused control visible. The planning
component must reserve space for its action bar and help, scroll the question
list or document, and preserve focus and drafts during resizing.

**Design implication:** A continuous list can expose all questions and their
options without question tabs. Arrow navigation crosses question boundaries;
Tab navigation accelerates movement. Long rounds remain scrollable
rather than requiring every question to fit on screen simultaneously.

## Read-only document and editable notes

Pi's public `Markdown` component renders text, while `Input` and `Editor` accept
text input. A custom component can compose a document, notes, and an action bar
and route keys to the focused child. Focus must propagate to the text component
for cursor and IME behavior. Editor height depends on terminal geometry, so the
parent must budget space for notes and document content.
[Component documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#built-in-components)

Pi's multiline editor defaults to Enter for submission and modified Enter for
newlines. Modified Enter is not distinguishable in every terminal; the local
macOS modifier fallback does not operate over SSH. A package can define its own
key routing with Enter for note newlines and Tab to a visible Send action.
[Terminal setup](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/terminal-setup.md)

**Design implication:** The plan stays read-only. Only note fields accept text.
Key help identifies the active document, note, or action context. Sending feedback
is a separate action from writing or confirming a local annotation.

## Block versus substring annotations

The installed Markdown component returns styled terminal lines without source
offsets or selection endpoints. Pi's exported Marked tokenizer supplies raw text
and nested tokens, but its standard token types do not expose start/end offsets.
Rendering wraps lines, inserts list markers and table borders, and changes link
presentation according to terminal capabilities. Terminal cells, Unicode
graphemes, and JavaScript string offsets are distinct coordinate systems.
[Markdown component](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#markdown)

Block annotations require a block identity, exact source excerpt, and revision
identity. Repeated paragraphs and nested lists still need distinct targets.
Arbitrary rendered-text selection additionally requires a selection cursor,
highlighting, scrolling during selection, and a source-to-display mapping that
survives wrapping and resize. Searching for a selected quote alone is ambiguous.

**Design decision:** Terminal review targets document blocks and submits their
notes with overall feedback as a batch. Arbitrary substring selection is outside
this TUI contract. The package does not need a browser renderer or an external
annotation protocol to implement this terminal behavior.

## Verification obligations

Interaction tests must distinguish highlighting, confirmed local input, and
agent submission. Cover narrow layouts, resize, Unicode, long blocks, nested
lists, repeated text, and preservation of the exact Markdown. Exercise nested
Escape, focus transfer, clarification return, note discard, stale revisions, and
approval in real local and SSH terminals. Source feasibility does not establish
runtime correctness, usability, or full package conformance.
