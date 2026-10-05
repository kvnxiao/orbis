# Effect v4 adoption

Prefer Effect v4 for reference implementations and repository scripts when it improves code quality
and high-level legibility, separation of concerns, or maintainability. Use it only when these gains
outweigh its added complexity and nonzero runtime costs.

- Assess synchronous operations and data modeling too, not only asynchronous work.
- Reject a use that worsens quality or legibility. Uniform syntax alone does not justify adoption.
- Select the library approach and its verification in the implementation plan.
- Do not name Effect as a library choice or requirement in a package SPEC or the specification
  guide's outline.

Before implementing, reviewing, or assessing Effect code, follow the `pi-coding-agent-rules` Effect
v4 integration reference, which defines how to read the installed guidance and preserve Pi host
contracts. For adoption assessment, the workspace documentation dependency is the root `effect`
development dependency at `node_modules/effect`.
