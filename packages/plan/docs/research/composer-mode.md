# Composer mode and planning entry

Research date: 2026-09-11. Pi baseline: 0.85.1. Source inspection establishes API feasibility;
editor interoperability and model intent recognition require separate verification.

## Keyboard and input boundaries

Pi binds Shift+Tab to `app.thinking.cycle` and reserves that action against extension shortcut
overrides. Registering the same key through `registerShortcut` is rejected while that binding
remains active.
[Keybindings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/keybindings.md),
[shortcut resolver](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts)

The public `getEditorComponent` and `setEditorComponent` APIs support wrapping the configured
composer. The editor factory receives Pi's live keybindings manager. Before registering the planning
shortcut through `pi.registerShortcut`, Plan checks effective host bindings and rejects conflicts.
Using the default Shift+Tab shortcut requires rebinding `app.thinking.cycle` and reloading Pi. While
the composer has focus, Pi dispatches registered shortcuts; focused modals receive their own input.
When Pi initializes editor handling, it captures registered shortcuts. Shortcut setting changes
therefore require `/reload`.
[Custom editors](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#custom-editor)

The `input` event distinguishes interactive input from extension and RPC messages. An extension can
prepare planning state and continue the original user submission; `before_agent_start` can supply
turn-specific instructions. Transforming a message into slash-command text does not repeat command
dispatch. Queued input needs a separate ordering rule because the input event runs before queuing.
[Agent input](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)

## Other harnesses

Codex documents `/plan` as unavailable during an active turn. An observed Codex session also
rejected Shift+Tab mode switching during work. This supports an idle-only Plan/Default toggle; it
does not establish a universal harness convention.
[Codex commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#switch-to-plan-mode-with-plan)

Claude Code documents Shift+Tab permission-mode selection separately from Escape interruption. Its
SDK applies permission changes to subsequent tool requests immediately. That SDK rule does not
establish the exact CLI timing of plan-mode instructions, which was not verified.
[Claude Code controls](https://code.claude.com/docs/en/interactive-mode),
[SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions#set-permission-mode)

## Entry and recovery

Model-callable entry supports intent recognition without an exact phrase. Valid examples include
“enter plan mode,” “help me plan this change,” “resume the plan,” and “continue planning.” A quoted
example, a discussion about plan mode, or an unrelated follow-up does not express an entry request.
When the requested saved plan is ambiguous, selection must precede resumption. Scripted providers
verify tool routing; real-model evaluation is needed to assess recognition quality.

The composer mode selects planning for ordinary submitted text. Switching the indicator alone
neither sends that text nor resumes an unfinished interaction. The selected mode cannot change
during an active turn. Escape remains the stop action, and interrupted work remains recoverable on
its conversation branch.

Pi's `agent_end` marks the end of a run; automatic retries and recovery can still follow it.
`agent_settled` marks the end of automatic continuation. Plan records interruption or a final error
at run end and pauses only after the agent settles. Native Escape keeps Pi's context-sensitive
behavior, including dismissing autocomplete without interrupting work.
[Agent lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#agent_start--agent_end--agent_settled)
