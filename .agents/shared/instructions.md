# Instruction files

Read this file before editing `AGENTS.md`, a skill, a shared file, an agent definition, host
configuration, or a documentation standard in `docs/`.

- Treat `docs/` as documentation that humans read, and put agent-only procedures under `.agents/`.
  Place agent behavior in `docs/` only for a standard that humans also apply, such as the SPEC
  format or the README guidelines.
- Put a file that one skill uses in that skill's `references/` directory, and a file that two or
  more skills or agents use in `.agents/shared/`.
- Link only downward:
  - `AGENTS.md` links to skills, shared files, and standards.
  - A `SKILL.md` or agent definition links to the files it needs.
  - Reference files, shared files, and standards do not link to other repository files.
- Name each linked file at the step that uses it, with its trigger, such as "before creating an
  issue, read `issues.md`". Do not require reads up front; every session and delegate loads
  `AGENTS.md`, and every development request loads `work-issue`.
- Keep the meaning of each delegate definition identical in `.claude/agents/` and `.codex/agents/`.
- Keep the instruction tree in `docs/development-workflow.md` current when a file is added, moved,
  or removed.
- Do not add lint rules or check scripts that enforce the structure of skill, agent, or workflow
  instruction files.
- Record lasting developer preferences for this repository in its instruction files, not in
  host-specific memory, so every host follows them.
