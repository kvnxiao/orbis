# Collaborative planning research

Research dates: 2026-09-08 through 2026-09-12. These documents synthesize inspected sources for the
[planning specification](../../SPEC.md). Each document identifies its evidence and verification
limits.

| Document                                                        | Questions investigated                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Pi packages](pi-packages.md)                                   | Which available packages provide planning, structured questions, browser interfaces, or RPC support? Where do their responsibilities differ?                                          |
| [Pi integration](pi-integration.md)                             | Can public extension APIs supply the required workflow? What does the official questionnaire already provide, and which state, keyboard, and lifecycle behavior remains to implement? |
| [TUI interaction design](tui-interaction-design.md)             | Can public Pi components support a modal frontier, nested keyboard navigation, read-only review, and inline block annotations?                                                        |
| [Frontier history and annotated review](frontier-and-review.md) | Can terminal links, source ranges, function keys, and persisted snapshots support evolving frontiers and approval with supplementary notes?                                           |
| [Composer mode](composer-mode.md)                               | How can Plan mode compose with Pi's editor, recognize planning intent, and preserve interruption and recovery behavior?                                                               |
| [Planning boundaries](planning-boundaries.md)                   | How do branch restoration, keyboard conflicts, agent completion, and input-size costs affect planning?                                                                                |
| [Agent planning comparison](agent-planning-comparison.md)       | How do Codex and Claude Code expose planning and structured input? How do frontier rounds and separate implementation authorization differ?                                           |
| [Completion and implementation handoff](completion-handoff.md)  | How do graceful tool termination, native selectors, command routing, and fresh-session submission preserve approval and queued input?                                                 |
| [Recovery and command routing](recovery.md)                     | How do resolved command names, streamed tool calls, and branch-local session records constrain restoration and dispatch?                                                              |
| [Implementation launch delivery](implementation-launches.md)    | How do hidden custom messages, replacement setup, and receiving tools preserve launch identity and execution authorization?                                                           |

Package identities and versions come from registry reads. API and implementation findings come from
current official documentation, pinned source, and Pi 0.85.1 installed in this workspace. README
claims, source inspection, design implications, and unverified runtime behavior remain distinct in
each document.

The evidence supports implementing the required experience as a Pi extension with commands,
model-callable operations, saved drafts, and a terminal questionnaire. It does not establish an
already conforming package or a best-practice consensus. The complete TUI workflow and separate
implementation authorization are Orbis design requirements, not conclusions about what every Pi
package should implement.

Optional external presentation is discussed only as a boundary supported by Pi's extension APIs.
Companion application architecture and integration protocols are maintained outside this package.

Research is informative. `SPEC.md` defines the contract; implementation tasks and test results must
identify their own requirement coverage and verification limits.
