# Pi TUI interactions

## Minimize navigation between the user and the task (Default)

Prefer a scrollable overview with actionable rows and inline fields. Let arrows cross group
boundaries and Tab move between focus regions. On entering a group, focus an actionable row
directly. When typing or pasting on a row starts editing, insert that initial input into the field.

Review common key sequences and remove redundant transitions or confirmations for reversible local
edits. Use a separate modal when the task needs a different workspace or an explicit confirmation
boundary.

## Assign keys by focus context (Default)

Support the workflow with arrows, Enter, Escape, and Tab. Show visible actions and context-specific
hints; hotkeys should accelerate reachable operations. Avoid requiring modified Enter combinations
that some terminals cannot distinguish.

In an editor, arrows move the cursor and printable keys enter text. Option letters are labels unless
explicitly assigned as shortcuts; shortcuts must not consume inline text. In multiline fields,
preserve Enter for newlines and provide a reachable Send or Confirm action.

Before overriding a host key, inspect installed keybindings and dispatch order. Preserve
autocomplete dismissal and interruption; extension shortcuts cannot override reserved host bindings.
Use the public custom-editor contract for editor interception and account for competing editor
replacements.
[Custom editor](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-editor).

In Pi v0.85.1, when streaming and Bash handlers do not consume Escape and the composer is empty or
whitespace-only, a second Escape less than 500 ms after the first runs the configured `tree` or
`fork` action; `none` disables it. Scope an extension's second-Escape dismissal to a focused
`ctx.ui.custom()` component that owns input.
[Host Escape handling](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts).

## Separate editing, submission, and cancellation (Required)

Keep unfinished text, confirmed local values, and submitted values distinct. Bind drafts to stable
identities; navigation must not retarget them. Closing or restoring a draft must not imply
submission or approval.

Define field dismissal, outer closure, and cancellation of the owning agent's work separately. A
closed modal does not establish that the agent stopped. When recovery is supported, preserve drafts
across reopening and report persistence failures before claiming that work is saved.

## Scope behavior to the extension's workflow (Conditional)

For question flows, distinguish focus, selection, and recommendation. When custom answers and
clarification cause different transitions, expose separate actions and mark answer context sent with
clarification as unsubmitted. Keep option notes inline and selections visible during navigation.
When required answers are missing, explain the failure and focus an unanswered question.

For document review flows, prefer read-only content with editable annotations. Attach notes to the
reviewed revision and source target. Keep annotation edits, requests for changes, and approval
distinct.

For extensions with composer modes, show the active mode, preserve typed text across switches, and
define switching during active work.

## Preserve context as content grows (Default)

Use task language in titles. Separate groups with whitespace. Render prose with Pi's Markdown
component and theme styles; preserve literal code content. Do not strip Markdown markers with
regular expressions.
[Markdown component](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#markdown).

Wrap inline fields beneath their rows on narrow terminals. Preserve field identity, cursor position,
drafts, and selections across rerenders. Keep the active field visible and long content fully
scrollable.

Choose borders, padding, and dividers before computing content dimensions. Reserve height for
actions and help; when space is tight, remove decoration before controls or the last usable content
row. Keep actions visible while the body scrolls.
