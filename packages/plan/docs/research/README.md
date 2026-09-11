# Collaborative planning research

Research dates: 2026-09-08 through 2026-09-11. These documents synthesize inspected sources for the
[planning specification](../../SPEC.md). Each document identifies its evidence and verification
limits.

| Document                                                  | Questions investigated                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Pi packages](pi-packages.md)                             | Which available packages provide planning, structured questions, browser interfaces, or RPC support? Where do their responsibilities differ?                                          |
| [Pi integration](pi-integration.md)                       | Can public extension APIs supply the required workflow? What does the official questionnaire already provide, and which state, keyboard, and lifecycle behavior remains to implement? |
| [TUI interaction design](tui-interaction-design.md)       | Can public Pi components support a modal frontier, nested keyboard navigation, read-only review, and inline block annotations?                                                        |
| [Composer mode](composer-mode.md)                         | How can Plan mode compose with Pi's editor, recognize planning intent, and preserve interruption and recovery behavior?                                                               |
| [Agent planning comparison](agent-planning-comparison.md) | How do Codex and Claude Code expose planning and structured input? How do frontier rounds and approval-only handoff differ?                                                           |

Package identities and versions come from registry reads. API and implementation findings come from
current official documentation, pinned source, and Pi 0.85.1 installed in this workspace. README
claims, source inspection, design implications, and unverified runtime behavior remain distinct in
each document.

The evidence supports implementing the required experience as a Pi extension with commands,
model-callable operations, saved drafts, and a terminal questionnaire. It does not establish an
already conforming package or a best-practice consensus. The complete TUI workflow and approval-only
boundary are Orbis design requirements, not conclusions about what every Pi package should
implement.

Optional external presentation is discussed only as a boundary supported by Pi's extension APIs.
Companion application architecture and integration protocols are maintained outside this package.

Research is informative. `SPEC.md` defines the contract; implementation tasks and test results must
identify their own requirement coverage and verification limits.
