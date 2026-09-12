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
`getResolvedBindings`, and `matches`. Before registering its configured shortcut through
`pi.registerShortcut`, Plan inspects effective host bindings.
[Keybindings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/keybindings.ts),
[shortcut registration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts)

During `/reload`, Pi reloads extensions before reloading keybindings. Before checking conflicts and
registering the shortcut, Plan reloads the injected keybindings manager through its public `reload`
method. When Pi initializes editor handling, it captures registered shortcuts; shortcut setting
changes require `/reload`. Host-action checks cannot establish complete interoperability with other
extensions' shortcuts.
[Interactive reload](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts)

## Approval completion

After clearing its active-run flag, Pi's agent prompt cleanup emits `agent_settled`. An approval
completed by an already-idle command also needs an immediate idleness check because another agent
run need not follow it. Successful approval requests tool termination without agent cancellation;
the [completion and handoff research](completion-handoff.md) describes batch and queue limits.
[Agent session](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)

## Input size and persistence

Pi buffers and parses model tool arguments before validating their schemas. Schema limits can reject
extension input before rendering or retaining it, but cannot prevent the host's initial parsing
allocation. Provider token ceilings do not bound cumulative planning history. Concise frontier
guidance and reducing repeated snapshot data address different costs; neither establishes a need to
reject large plans.
[Tool validation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/utils/validation.ts)
