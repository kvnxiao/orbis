# Collaborative planning research

Research date: 2026-09-08. These documents synthesize newly inspected sources
against the existing [Draft v1 specification](../../SPEC.md). They do not
reconstruct the earlier design session or claim that the research preceded it.

| Document                                                  | Questions investigated                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Pi packages](pi-packages.md)                             | Which available packages provide planning, structured questions, browser interfaces, or RPC support? Where do their responsibilities differ?                                          |
| [Pi integration](pi-integration.md)                       | Can public extension APIs supply the required workflow? What does the official questionnaire already provide, and which state, keyboard, and lifecycle behavior remains to implement? |
| [Agent planning comparison](agent-planning-comparison.md) | How do Codex and Claude Code expose planning and structured input? How do frontier rounds and approval-only handoff differ?                                                           |

Package identities and versions come from registry reads. API and implementation
findings come from current official documentation, pinned source, and Pi 0.85.1
installed in this workspace. README claims, source inspection, design implications,
and unverified runtime behavior remain distinct in each document.

The evidence supports implementing the required experience as a Pi extension with
commands, model-callable operations, shared state, and custom renderers. It does
not establish an already conforming package or a best-practice consensus. The
complete browser/terminal experience and approval-only boundary are Orbis design
requirements, not conclusions about what every Pi package should implement.

Research is informative. `SPEC.md` defines the contract; implementation tasks and
test results must identify their own requirement coverage and verification limits.
