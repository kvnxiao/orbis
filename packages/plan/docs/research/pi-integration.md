# Pi integration for collaborative planning

Research dates: 2026-09-08 and 2026-09-10. The local dependency inspected is
`@earendil-works/pi-coding-agent` 0.85.1. Its public release tag resolves to
`d981de1229ef899957bbe968bc8dcda02a21f477`. Documentation and source inspection
establish API capabilities. The package implementation is available; complete
workflow conformance remains unverified.

## Extension, command, or skill

Pi extensions register model-callable tools, commands, lifecycle handlers, and
custom terminal components. They can append session records and modify the
per-turn planning instructions. Those capabilities support the state and UI
required by `@orbis/plan`. [Extension API](https://pi.dev/docs/latest/extensions)

Pi skills supply instructions that the agent loads when relevant. A skill can
describe research and questioning, but it does not itself register a stateful
question tool or persist answer drafts.
[Skills documentation](https://pi.dev/docs/latest/skills)

**Design implication:** The extension owns the interaction and saved state.
`/plan` is an explicit entry point; a model-callable entry operation supports
agent-selected planning. Instructions describe how to research and choose the
next question round. The inspected APIs support this composition without a Pi
core modification. Successful model recognition of natural-language entry still
requires evaluation.

## Official structured-question example

The shipped [questionnaire example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/questionnaire.ts)
registers a structured tool with question identities, options, and custom text.
Its custom terminal component maintains answers and question tabs. For multiple
questions, Tab and Shift+Tab navigate questions and a Submit tab; complete answers
enable submission. For a single question, answering submits immediately.

The input handler routes free-text editing to `Editor` before reaching the
question-navigation branch. Esc clears that unfinished editor text. The example
therefore provides useful UI mechanics, but does not satisfy Orbis's requirement
to navigate the whole round while preserving unfinished input. It also lacks the
main-agent clarification exchange.

**Design implication:** Reuse the public component model, and implement the
specified draft state and key routing explicitly. A recommendation, a selection,
and submission must remain distinct even for a one-question round.

## Terminal support and optional presentation

Pi's RPC mode forwards standard `select`, `confirm`, `input`, and `editor` dialogs
through request/response messages. `ctx.ui.custom()` returns `undefined` in RPC
mode. `ctx.hasUI` is true in both TUI and RPC; `ctx.mode === "tui"` identifies a
real terminal component environment. [RPC extension UI protocol](https://pi.dev/docs/latest/rpc#extension-ui-protocol)

**Design implication:** RPC dialog support does not establish support for the
specified terminal questionnaire. Local and SSH terminals can use the complete
planning workflow without an external renderer. An RPC client controlling a Pi
process is a different integration and remains outside the package contract.

A separate extension can present a pending question round or Markdown review and
return the same planning outcomes as the TUI. Pi's public extension API provides
tools, lifecycle callbacks, and a shared event bus that extensions can use for
registration. A package-defined presentation hook can expose the current
interaction, draft updates, a result, and cancellation without prescribing a
browser protocol. The shared event bus does not define that hook or await
asynchronous presenters. [Public extension API](https://pi.dev/docs/latest/extensions)

**Design implication:** Keep planning state and validation in `@orbis/plan` and
let an installed presenter supply optional rendering. The presenter owns external
connections, browser annotation mapping, and any separate chat state; it returns clarification or revision
feedback through the existing planning interaction. When an active interaction's
presenter fails or is removed, Pi can reopen the TUI with the current drafts.
The package implements the presentation hook using Pi's public APIs. The current
contract also assigns terminal block annotations and overall feedback drafts to
`@orbis/plan`; the extended note state and modal workflow await implementation.

Pi's SDK exposes `createAgentSession()`, `prompt()`, `followUp()`, and event
subscriptions for applications that own an agent session.
[SDK documentation](https://pi.dev/docs/latest/sdk)

**Design implication:** An integration with the existing TUI session uses Pi's
extension APIs and the presentation hook. Creating another SDK session would
change agent ownership; the package does not require a separate SDK host.

## Persistence, clarification, and handoff

`pi.appendEntry()` writes custom session entries without automatically inserting
them into model context. `ctx.sessionManager.getBranch()` exposes the active
conversation branch. Session shutdown and startup events accompany reloads and
session changes. [Session and lifecycle APIs](https://pi.dev/docs/latest/extensions)

**Design implication:** Persist draft answers independently of submitted tool
results. Restore the active branch's records, and return a structured clarification
request from the waiting tool to let the main agent answer it. Reopening the round
must use the saved drafts and current revision. These are proposed uses of the
APIs, not behavior supplied by Pi automatically.

The [event-bus implementation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/event-bus.ts)
uses Node's `EventEmitter`. Its `emit` method returns without awaiting subscribers;
the wrapper catches and logs handler errors. The bus does not store events or
acknowledgements.

**Design implication:** After the artifact and approval state are saved,
`orbis:plan-approved` can notify companion extensions. It cannot establish successful
subscriber execution or durable delivery. The planning extension owns saving and
notification; subscribers own their implementation workflow and recovery.

## Verification still required

- Test terminal navigation with unfinished custom text, including Shift+Tab and
  wraparound, in real Pi terminals.
- Exercise clarification, interruption, reload, and branch changes while drafts
  exist; verify that only explicit submission supplies decisions to the agent.
- Use a fake optional presenter to check draft preservation, stale results,
  cancellation, and terminal fallback. External-app testing belongs to its adapter.
- Evaluate model behavior on discoverable facts, dependent decisions, and plan
  approval; schema validation alone does not establish planning quality.
- Verify supported Pi and Node versions during implementation. The inspected
  release is an evidence baseline, not a claimed compatibility range.
