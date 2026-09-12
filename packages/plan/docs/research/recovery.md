# Planning recovery and command routing

Research date: 2026-09-12. Pi baseline: 0.85.1. Source inspection establishes API mechanics; runtime
behavior requires separate verification.

When extension command names collide, Pi assigns numeric invocation suffixes. The public
`ExtensionAPI.getCommands()` returns invocation names, descriptions, and source information. Command
lookup uses the resolved invocation name rather than the original duplicate name.
[Command resolution](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts),
[extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts).

Pi finishes streaming an assistant response before executing its tool calls. An aborted assistant
response ends the turn without executing those calls. Tool-call display alone does not establish
that a modal opened.
[Agent loop](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts).

Pi session entries form a tree. `SessionManager.getBranch()` returns entries on the selected branch,
while custom entries can preserve extension state independently of model messages. Session-tree
navigation does not restore external files. Compaction summaries describe conversation context;
extensions retain responsibility for validating their saved state and execution authorization.
[Session format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md),
[session APIs](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md).
