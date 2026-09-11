---
name: pi-coding-agent-rules
description: "Use for developing and reviewing Pi Coding Agent extensions, tools, packages, TUI components, and SDK or RPC integrations, including TypeScript architecture, domain modeling, asynchronous work, errors, performance, and testing."
---

# TypeScript and Pi Coding Agent Rules

Use for developing and reviewing Pi Coding Agent extensions, tools, packages, TUI components, and SDK or RPC integrations, including TypeScript architecture, domain modeling, asynchronous work, errors, performance, and testing.

## Rule Strength

- **Required**: Follow this rule to preserve correctness, security, lifecycle, or compatibility.
- **Default**: Follow this project convention unless a stated exception applies.
- **Conditional**: Apply this rule only when its stated condition or measurement is present.

## Rule References

- [Pi design and compatibility](references/pi-design-and-compatibility.md): Read when choosing a Pi customization mechanism, importing Pi APIs, or deciding which guidance belongs in code, skills, or lint configuration.
- [Pi lifecycle](references/pi-lifecycle.md): Read when registering extensions, starting background resources, choosing cancellation signals, reloading, replacing sessions, or reporting agent completion.
- [Pi tools](references/pi-tools.md): Read when designing tool schemas, returning results, overriding built-in tools, bounding output, or mutating files from concurrent tools.
- [Pi session state](references/pi-session-state.md): Read when persisting extension state, reconstructing branches, caching session data, or evolving saved data and tool argument formats.
- [Pi context](references/pi-context.md): Read when injecting instructions, transforming messages, queuing agent input, or customizing compaction.
- [Pi settings and commands](references/pi-settings-and-commands.md): Read when adding extension settings, choosing configuration scopes, registering commands, or evaluating native settings integration.
- [Pi UI and RPC](references/pi-ui-and-rpc.md): Read when prompting users, rendering terminal components, supporting noninteractive modes, or implementing an RPC client.
- [Pi TUI interactions](references/pi-tui-interactions.md): Read when designing keyboard navigation, inline editing, question or review flows, modal dismissal, composer modes, or terminal layout.
- [Pi packages and SDK](references/pi-packages-and-sdk.md): Read when distributing Pi resources, choosing dependencies, embedding sessions, or configuring resource discovery and working directories.
- [TypeScript architecture](references/typescript-architecture.md): Read when organizing modules, separating domain logic from adapters, defining ownership, deriving schema or registry metadata, or introducing an abstraction.
- [TypeScript domain boundaries](references/typescript-domain-boundaries.md): Read when modeling workflow states, validating external data, comparing structured input by meaning, distinguishing identifiers or units, or designing public data contracts.
- [TypeScript asynchronous work and errors](references/typescript-async-and-errors.md): Read when assigning asynchronous task ownership, propagating cancellation, coordinating concurrent mutations, retrying operations, or translating errors.
- [TypeScript workflows](references/typescript-workflows.md): Read when binding actions to state versions, defining derived-output validity, recovering partial transitions, or replacing modal interactions.
- [TypeScript performance](references/typescript-performance.md): Read when processing large inputs or streams, scheduling expensive work, introducing caches, or investigating latency and memory use.
- [Testing](references/pi-testing.md): Read when testing domain contracts, event ordering, recovery and retry, Pi lifecycle transitions, terminal interactions, settings, tool execution, or package installation.
