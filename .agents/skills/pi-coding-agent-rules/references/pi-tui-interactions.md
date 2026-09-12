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
explicitly assigned as shortcuts; shortcuts must not consume inline text. Multiline fields use Pi's
editor bindings: by default, Enter submits or finishes local editing, and Shift+Enter and Ctrl+J
insert newlines. Match the effective `tui.input.submit` and `tui.input.newLine` bindings. Finishing
local editing does not submit the enclosing form; provide visible controls for sending
clarification, submitting answers, or approving a document. An optional shortcut may activate the
same submission action as a visible control. Apply the same validation and confirmation boundary,
preserve ordinary typing and newline input, and derive its hint from the binding. Modified Enter may
supplement the visible action but must not be required.

Before overriding a host key, inspect installed keybindings and dispatch order. Preserve
autocomplete dismissal and interruption; extension shortcuts cannot override reserved host bindings.
Use the public custom-editor contract for editor interception and account for competing editor
replacements.
[Custom editor](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-editor).

In Pi v0.85.1, when streaming and Bash handlers do not consume Escape and the composer is empty or
whitespace-only, a second Escape less than 500 ms after the first runs the configured `tree` or
`fork` action; `none` disables it. When an extension uses second-Escape dismissal, scope it to a
focused `ctx.ui.custom()` component that owns input.
[Host Escape handling](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts).

## Bind hotkeys through the SDK (Required)

Register extension shortcuts with `pi.registerShortcut(key, { description, handler })`. Give every
registered shortcut a description for `/hotkeys`. Do not implement composer shortcuts with raw
terminal listeners or a parallel shortcut dispatcher.
[registerShortcut](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#piregistershortcutshortcut-options).

`pi.registerShortcut` binds a raw key rather than a rebindable id. While the composer editor has
focus, Pi dispatches registered shortcuts. Inside a focused `ctx.ui.custom()` component, use the
injected `KeybindingsManager.matches(data, id)` for host actions and the SDK's `matchesKey(data,
key)` for extension-owned keys. When an action has a host action id, reuse it; do not replace it
with its default key or compare raw escape sequences.

When the SDK matcher lacks a supported terminal encoding, isolate its conversion to an encoding the
SDK accepts, then match through the SDK. Test equivalent encodings and preserve effective binding
overrides; the adapter must not dispatch actions itself.

## Never hardcode displayed hotkey labels (Required)

Derive every displayed hotkey label from the binding used for registration or input matching. This
includes footers, help panels, buttons, placeholders, and dismissal prompts. Never embed default key
labels such as `↑↓`, `Tab`, `F2`, or `Esc` in UI strings, even when they currently match the
bindings. Keep literal key values in binding definitions only; compose UI text from derived key
labels and action descriptions. A hint such as `"Tab: focus · F2: overall · Esc: back"` violates
this rule.

For a host action, pass the namespaced `app.*` or `tui.*` id to `keyHint(id, description)` or
`keyText(id)`, which resolve the user's `keybindings.json` override. For an extension-owned key,
define one `KeyId` and pass it to `pi.registerShortcut` or `matchesKey`, and to `rawKeyHint` for
display. Both formatters render `alt` as `option` on macOS; capitalization depends on the formatter
and SDK version. A label written as literal text states a key that the handler may not match.
[Keybinding hints](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#keybinding-hints),
[Keybinding ids](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/keybindings.md).

Inside `ctx.ui.custom()` and a custom-editor factory, resolve host keys through the injected
`KeybindingsManager`: `matches(data, id)` for input and `getKeys(id)` for labels. `keyHint` and
`keyText` read the global manager and are display-only.

When a binding changes, input matching and rendered hints must use the updated binding. Test with a
non-default binding and assert that the new key invokes the action and appears in the UI, and that
the action's hint does not show the default label. When a binding is disabled or blocked, do not
display it as available.

Pi v0.85.1 resolves `keybindings.json` entries against a static definition table and ignores unknown
ids, so an extension cannot publish a rebindable id; declaration merging on the `Keybindings`
interface adds the type, not the host definition. Expose an extension-owned key as a setting, label
from the configured value, and name the fallback when the key is disabled or blocked by a host
binding.
[Definition table](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/keybindings.ts),
[Shortcut conflicts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts).

## Separate editing, submission, and cancellation (Required)

Keep unfinished text, confirmed local values, and submitted values distinct. Bind drafts to stable
identities; navigation must not retarget them. Closing or restoring a draft must not imply
submission or approval.

Define field dismissal, outer closure, and cancellation of the owning agent's work separately. A
closed modal does not establish that the agent stopped. When recovery is supported, preserve drafts
across reopening and report persistence failures before claiming that work is saved.

After an irreversible approval has been saved, dismissing a subsequent action selector preserves the
approval and means "take no further action." Keep approval persistence separate from the optional
action and its session handoff. Menu structure and single- or double-Escape dismissal are
interaction choices, not universal extension requirements. Apply the
[UI completion rules](pi-ui-and-rpc.md#resolve-the-ui-independently-of-agent-completion-required).

## Scope behavior to the extension's workflow (Conditional)

For a flow that collects structured answers, keep focus, selection, and any recommended default
distinct. When a side request against an item follows a different transition from answering it, give
each action its own control and treat the item as unanswered until the user submits it. Keep
per-item notes inline and keep selections visible during navigation. When required answers are
missing, name the failure and focus an unanswered item.

For a flow that reviews a document, prefer read-only content with editable annotations. Anchor each
annotation to the document version and the span it targets. Keep editing an annotation, submitting
the collected annotations, and accepting the document as separate actions.

For an extension with composer modes, show the active mode, preserve typed text across switches, and
define what switching does during active work.

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
