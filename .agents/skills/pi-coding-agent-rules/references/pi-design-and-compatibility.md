# Pi design and compatibility

## Choose the customization mechanism by behavior (Default)

Use a prompt template for reusable prompt text, a skill for instructions and supporting resources loaded on demand, and an extension for executable behavior such as tools, lifecycle hooks, commands, or terminal UI. Use the SDK to embed Pi in a Node.js application; use RPC when a subprocess boundary or another language is part of the integration.

Before adding a tool, check whether an existing CLI plus a skill can express the workflow. Add a tool when structured arguments, lifecycle integration, or controlled result rendering materially improve the task. A package distributes resources; it does not require a new orchestration framework. [Pi customization](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md#customization), [RPC](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md).

## Match the installed API (Required)

Before copying an example or changing a Pi integration, inspect the project's resolved Pi version and its bundled `docs/` and declarations. Resolve these files from the installed `@earendil-works/pi-coding-agent` package. Use public exports from that version. When documentation and declarations disagree, verify the installed implementation before choosing a contract.

Pi API names and repository links in this pack use v0.85.1 as a reference baseline, not a minimum-version guarantee. The installed package is authoritative; upstream `main` can describe unreleased behavior. Before using a named API on another version, check its availability and contract in that version.

Current Pi packages use the `@earendil-works` scope and `typebox`. Keep imports consistent with the supported Pi version; do not mix old and new package identities in one extension. When supporting multiple versions, isolate compatibility code at the Pi adapter and test each claimed version. [Package names](https://pi.dev/news/2026/5/7/pi-has-a-new-home), [extension imports](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#available-imports).

## Reserve prose rules for design decisions (Default)

Keep formatting, import syntax, assertion restrictions, promise syntax, exhaustive-switch checks, and mechanically detectable performance patterns in the project's compiler and linter configuration. These references govern choices that require domain knowledge: valid states, dependency direction, task ownership, retry safety, resource limits, and compatibility contracts.

Treat architecture recommendations marked Default as project conventions with stated exceptions. Treat Pi lifecycle and protocol requirements as contracts. Do not promote an example's file layout, casts, error presentation, or dependencies into a universal requirement.
