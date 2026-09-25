---
name: pi-coding-agent-rules
description: "Use for developing and reviewing Pi Coding Agent extensions, tools, packages, TUI components, and SDK or RPC integrations, including TypeScript architecture, code organization, public API documentation, domain modeling, asynchronous work, thrown errors, remediation text, cancellation, performance, and testing."
---

# TypeScript and Pi Coding Agent Rules

Use for developing and reviewing Pi Coding Agent extensions, tools, packages, TUI components, and SDK or RPC integrations, including TypeScript architecture, code organization, public API documentation, domain modeling, asynchronous work, thrown errors, remediation text, cancellation, performance, and testing.

## Rule Strength

- **Required**: Follow this rule to preserve correctness, security, lifecycle, or compatibility.
- **Default**: Follow this project convention unless a stated exception applies.
- **Conditional**: Apply this rule only when its stated condition or measurement is present.

## Rule References

- [Pi design and compatibility](references/pi-design-and-compatibility.md): Read when choosing a Pi customization mechanism, importing Pi APIs, or deciding which guidance belongs in code, skills, or lint configuration.
- [Pi trust and authorization](references/pi-trust-and-authorization.md): Read when implementing approval flows, project trust, execution permissions, credential access, or unattended work.
- [Pi delegation](references/pi-delegation.md): Read when spawning child agents, assigning shared workspace ownership, integrating delegated results, or propagating permissions and cancellation.
- [Pi lifecycle](references/pi-lifecycle.md): Read when registering extensions, owning cancellation or background tasks, bounding automatic continuation, reloading, handing work to a replacement session, or reporting agent completion.
- [Pi tools](references/pi-tools.md): Read when designing tool schemas, returning results, terminating automatic continuation, overriding built-in tools, bounding output, or mutating files from concurrent tools.
- [Pi session state](references/pi-session-state.md): Read when persisting extension state, recovering interrupted mutations, defining rewind, reconstructing branches, caching session data, or evolving saved data and tool argument formats.
- [Pi failure signaling](references/pi-failure-signaling.md): Read when adapting failures or cancellation for Pi tools, commands, terminal interfaces, or extension callbacks. Render recovery instructions once for each audience and preserve structured failures for programmatic consumers.
- [Pi context](references/pi-context.md): Read when injecting instructions, transforming context, preserving authority through compaction, retaining learned memory, queuing agent input, or dispatching extension commands.
- [Pi settings and commands](references/pi-settings-and-commands.md): Read when adding extension settings, choosing configuration scopes, registering commands, or evaluating native settings integration.
- [Pi UI and RPC](references/pi-ui-and-rpc.md): Read when prompting users, completing or dismissing UI, sequencing selectors, rendering terminal components, supporting noninteractive modes, or implementing an RPC client.
- [Pi TUI interactions](references/pi-tui-interactions.md): Read when designing keyboard navigation, inline editing, question or review flows, modal dismissal, composer modes, or terminal layout.
- [Pi packages and SDK](references/pi-packages-and-sdk.md): Read when distributing Pi resources, declaring package dependencies, embedding sessions, switching model or remote-tool integrations, or configuring resource discovery and working directories.
- [TypeScript architecture](references/typescript-architecture.md): Read before adding or extending a workflow, and when separating domain logic from adapters, defining ownership and copy semantics, transforming derived data, deriving schema or registry metadata, or introducing an abstraction.
- [TypeScript code organization](references/typescript-code-organization.md): Read before adding or extending a workflow, and when reviewing its responsibilities, placing or naming a module, deciding what a module exports, documenting an exported symbol, colocating a type with its validator, promoting a helper to shared code, or defining a package entry point.
- [TypeScript domain boundaries](references/typescript-domain-boundaries.md): Read when modeling workflow states, declaring schemas for persisted or parsed data, validating external data, comparing structured input by meaning, distinguishing identifiers or units, or designing public data contracts.
- [TypeScript asynchronous work and errors](references/typescript-async-and-errors.md): Read when assigning asynchronous task ownership, propagating cancellation, coordinating concurrent mutations, retrying operations, or translating errors.
- [TypeScript error contracts](references/typescript-error-contracts.md): Read when defining, propagating, documenting, or testing failures and cancellation. Classify expected failures by recovery action, preserve data and causes, recognize shared contracts structurally, and check ownership before cancellation cleanup.
- [TypeScript workflows](references/typescript-workflows.md): Read when binding actions to state versions, defining derived-output validity, recovering partial transitions, or replacing modal interactions. Distinguish expired interaction identities from revision conflicts before prescribing recovery.
- [TypeScript performance](references/typescript-performance.md): Read when choosing collection pipelines or libraries, checking iterator compatibility, processing large inputs or streams, scheduling expensive work, introducing caches, or investigating latency and memory use.
- [Testing](references/pi-testing.md): Read when testing domain contracts, event ordering, recovery and retry, Pi lifecycle transitions, terminal interactions, settings, tool execution, or package installation.
