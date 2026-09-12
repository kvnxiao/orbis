# Implementation launch delivery

Research date: 2026-09-12. Pi baseline: 0.85.1.

The public replacement context exposes asynchronous `sendMessage`. A custom message with
`display: false` participates in model context and saved history without appearing in the
interactive transcript. With `triggerTurn: true`, an idle session starts a model turn. The model
must generate any subsequent tool call; custom-message submission does not create assistant tool
calls.

The public `newSession` lifecycle calls `setup` with the replacement session manager before
`withSession`. Setup can append extension records before the receiving turn. Pi defers initial
session-file persistence until an assistant message is recorded. Submission rejection can occur
after a turn has started and does not establish that execution never occurred.

With `triggerTurn: true`, idle `sendCustomMessage` calls `_runAgentPrompt` without emitting
`before_agent_start`. Before each provider call, the SDK emits `context`. Extensions can return
instructions for the current mode through this hook without appending them to session history.
[Message delivery](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts),
[SDK context transform](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/sdk.ts),
[agent loop](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts).

Receiving tools must obtain execution authorization from validated extension records. Hidden startup
instructions guide model behavior; they cannot guarantee tool selection.

Sources:
[replacement context and lifecycle](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts),
[session runtime](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session-runtime.ts),
[message delivery](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts).
These findings are from installed-source inspection; runtime verification is separate.
