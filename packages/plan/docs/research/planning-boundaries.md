# Planning identity, keyboard conflicts, and completion

Research date: 2026-09-11. Pi baseline: 0.85.1. Source inspection establishes the integration
mechanisms; automated and terminal verification remain separate.

## Restoring planning identity

Pi reconstructs the selected session branch independently of external files. Navigating a session
tree does not undo a previously written approval artifact. Plan restoration must preserve a recorded
approval attempt, including its destination. When a continuation diverges from another branch, it
needs a distinct planning identity before saving another artifact. A session ID alone cannot
distinguish sibling branches.
[Session format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md)

## Composer key conflicts

Pi binds Shift+Tab to `app.thinking.cycle` and reserves that action against extension shortcut
overrides. The public editor factory receives a live `KeybindingsManager` with `getKeys`,
`getResolvedBindings`, and `matches`. A composer wrapper can inspect effective host bindings before
consuming its configured shortcut.
[Keybindings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/keybindings.ts),
[shortcut registration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts)

During `/reload`, Pi reloads extensions before reloading keybindings. A conflict check cached only
when the editor is installed can be stale. Input handling must consult the live keybindings. Pi does
not expose a public registry of other extensions' shortcuts, so host-action checks cannot establish
complete extension interoperability.
[Interactive reload](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts)

## Approval completion

After clearing its active-run flag, Pi's agent prompt cleanup emits `agent_settled`. Tool-context
`abort` requests cancellation without waiting inside the executing tool. An approval completed by an
already-idle command also needs an immediate idleness check because another agent run need not
follow it.
[Agent session](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)

## Input size and persistence

Pi buffers and parses model tool arguments before validating their schemas. Schema limits can reject
extension input before rendering or retaining it, but cannot prevent the host's initial parsing
allocation. Provider token ceilings do not bound cumulative planning history. Concise frontier
guidance and reducing repeated snapshot data address different costs; neither establishes a need to
reject large plans.
[Tool validation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/utils/validation.ts)
