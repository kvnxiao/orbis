# Pi 0.99.1 compatibility and package opportunities

Pi 0.99.1 keeps Orbis's source-only extension format and Node.js 22.19.0 minimum. Its new tool
composition APIs warrant a focused follow-up for Plan. Its public color APIs can simplify the
unimplemented theme-preview package, subject to that package's measurement constraints.

This assessment compares the upstream `v0.87.1` and `v0.99.1` tags. The coding-agent changelog goes
directly from 0.87.1 to 0.99.0. Version 0.99.0 introduces the new extension APIs; 0.99.1 adds
GPT-6.1 Sol and fixes bundled OpenAI sign-in. Recommendations below identify potential work; they do
not amend package contracts or enable new package behavior.

Sources:
[coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md),
[release comparison](https://github.com/earendil-works/pi/compare/v0.87.1...v0.99.1).

## Runtime and dependency compatibility

Orbis develops on Node.js Current and publishes raw TypeScript for Pi to load. Development tools can
require a newer runtime without changing an extension's supported Node.js generation.

Pi 0.99.1 still uses Jiti 2.7.0 for extensions. The npm loader creates Jiti with
`moduleCache: false` and aliases host-provided Pi modules and TypeBox. The TypeScript source and
bundled distributions use separate resolution paths. Pi's own move to TypeScript 7 and ES2024 does
not establish support for arbitrary syntax in independently published extensions. Orbis retains its
compiler target and source-publication constraints.

Pi still reads extension entry points from `pi.extensions`, including raw `.ts` files. Managed Git
package installation now omits development dependencies and suppresses automatic peer installation
for npm, pnpm, and Bun. Orbis's `"*"` Pi peers and separately declared runtime dependencies fit that
model. A fresh packed installation remains necessary to verify dependency resolution.

Pi's coding-agent manifest pins TypeBox 1.3.27, so Orbis retains that version even though newer
TypeBox releases exist. The approved Effect 4.0.0-rc.117 pin also remains: the stable-only discovery
result, Effect 3.22.2, is a different major API and cannot replace the existing v4 implementation.

Sources:
[Pi manifest](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/package.json),
[extension loader](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/loader.ts),
[package manager](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/package-manager.ts).

## Package opportunities

### Plan: keep interactive operations visible to the model

Pi distinguishes tools declared to the model from tools callable by another tool. The default
`direct` exposure permits both. `model-only` declares an active tool to the model while excluding it
from `ctx.executeTool()` and codemode scripts.

All four Plan tools currently use the default exposure. They own user interactions or implementation
handoffs. The recommended follow-up is to assess `model-only` for these tools, especially
`plan_review` and `plan_implement`. Their termination requests belong to the model-issued tool
batch; a nested tool's result does not automatically terminate the calling codemode script.

Verify any change with scripted SDK turns covering:

- Direct approval.
- Nested invocation rejection.
- Queued user input.
- Fresh-session handoff.

Keep the existing `REQ-idle-completion` and `REQ-implementation-handoff` guarantees authoritative.

Sources:
[tool exposure and execution contracts](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts),
[nested-call execution](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/nested-tool-calls.ts),
[Plan requirements](../packages/plan/SPEC.md#req-idle-completion--idle-completion).

### Structured results: preserve data across tool composition

Tools can declare `outputSchema` and return `structuredContent`. Codemode passes that data to a
script; a tool without an output schema supplies text instead. A returned `isError: true` result can
preserve structured error data. Throwing still produces a text failure.

Plan currently emits bounded JSON text and stores projected state in `details`. Its adapter strips
unfinished drafts and review notes before returning data. Any structured-output adoption must use
the same projection and preserve truncation, saved-result paths, and error status. Future memory
recall tools could expose typed search results without requiring scripts to parse display text. That
work belongs with the recall implementation, which is currently unavailable.

The generated `pi-failure-signaling` reference describes the older text-only failure path. Its
source must be updated and regenerated through ruleskill before adopting returned structured
failures; generated files are not edited in this upgrade.

Sources:
[agent tool results and failure processing](https://github.com/earendil-works/pi/blob/v0.99.1/packages/agent/src/agent-loop.ts),
[codemode result conversion](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/codemode/execute.ts),
[Plan result adapter](../packages/plan/src/pi/tool-result.ts).

### Tiered-memory: observe nested operations through Pi

`ctx.executeTool()` runs nested operations through Pi's argument validation and extension hooks.
Events identify the parent tool call. This gives the existing memory write guard a path to inspect
nested `write` and `edit` calls without adding a separate codemode integration.

Pi records bounded nested-call metadata on the parent result, including operation status and
duration. It does not persist the nested results there. Future memory observation must distinguish
that incomplete metadata from original source content. It must also avoid counting nested usage
twice because Pi adds that usage to the parent result.

Sources:
[session tool pipeline](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/agent-session.ts),
[bounded nested records](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/nested-tool-calls.ts),
[memory write guard](../packages/tiered-memory/src/pi/write-guard.ts).

### Theme-preview: use public colors without accepting guesses

Pi now exports color parsing, conversion, and mixing helpers. `Theme` exposes `colors`, `style()`,
and `appearance`. `TUI.queryTerminalColors({ timeoutMs })` replaces the separate background and
polarity queries and can report foreground, background, and all 16 ANSI palette colors.

These APIs reduce the need to infer colors from escape sequences. They do not by themselves satisfy
theme-preview's measurement contract:

- `theme.colors` substitutes guessed foreground or background values when the terminal has not
  reported them. It also approximates faint styling.
- Terminal query fields can be absent; the palette is present only when every palette reply arrives.
- The current SPEC requires author-supplied foreground and basic palette values. Automatically using
  queried values for those fields needs an approved contract amendment.
- Pi themes now support `#rgb`, OKLCH, and OKHSL. Effective theme colors and the package's strict
  `#RRGGBB` user-input format remain separate concerns.

Use the public query for the existing background requirement, and preserve explicit provenance and
missing-input handling. The package has no reference implementation yet, so no existing source needs
a terminal-query rename in this upgrade.

Sources:
[theme implementation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/modes/interactive/theme/theme.ts),
[terminal query](https://github.com/earendil-works/pi/blob/v0.99.1/packages/tui/src/tui.ts),
[color helpers](https://github.com/earendil-works/pi/blob/v0.99.1/packages/tui/src/colors.ts),
[theme-preview contract](../packages/theme-preview/SPEC.md).

### Future integrations: let Pi own MCP and model routing

Pi now supplies MCP connection management and codemode as built-in extensions. A modular package can
register an MCP server through `pi.registerMcpServer()` and use namespaces, deferred exposure, and
tool annotations. Annotations describe intent; they do not establish permission. Codemode's
JavaScript sandbox calls real tools, so earlier side effects survive a later script failure.

Experimental virtual models let an extension select a physical model and thinking level per request.
Pi persists router state on the active session branch and records the actual model on assistant
messages. This could support a separate routing package or Plan-aware routing without replacing Pi's
agent loop. It needs its own design for cost, cancellation, retry behavior, and continuation
affinity. A virtual selection also means `ctx.model` need not identify the model that produced the
latest response; memory budget decisions must account for that distinction.

`ModelRuntime` also supports classifiers and image generation through the host's authentication.
Classifier-assisted memory prioritization is a potential experiment, not a prerequisite for the
approved memory contract. No live classifier, image, or model request is part of toolchain checks.

Sources:
[MCP guide](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md),
[virtual model contract](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/virtual-models.ts),
[model runtime](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/model-runtime.ts).

## Other migration checks

| Change in Pi                                                                       | Orbis consequence                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified chat, image, and classifier model catalogs; removed older image-model APIs | Current package code does not import the removed image APIs. Keep chat-only lookups where the operation requires chat.                         |
| SDK and RPC input dispositions distinguish handled, queued, and started input      | Future clients can avoid waiting for an agent run when a command handled the input. A successful response still does not establish completion. |
| `--no-extensions` also disables built-in extensions                                | Isolated tests must explicitly load any built-in capability they exercise.                                                                     |
| New system theme and revised dark/light colors                                     | Retain semantic theme tokens; verify visual assumptions in interactive packages separately.                                                    |
| Effective settings available through `pi.getSettings()`                            | This is a settings snapshot, not a registry for adding extension rows to native `/settings`. Package settings menus remain separate.           |

Sources:
[Pi AI migration notes](https://github.com/earendil-works/pi/blob/v0.99.1/packages/ai/CHANGELOG.md),
[RPC input results](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/modes/rpc/rpc-client.ts),
[extension API](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts).

## Verification scope

Offline SDK probes used scripted in-process providers and blocked network access on Node.js 22.19.0
and 26.10.0. They verified:

- Tool exposure controls active tools and nested reachability.
- Actual codemode execution preserves structured successes and failures.
- Nested calls invoke the existing tiered-memory write guard and record parent-call metadata.
- Virtual model registration and the public color helpers work on both runtimes.

These probes do not establish Plan's nested approval or handoff behavior. Virtual model routing was
not exercised beyond registration. Real-terminal behavior, remote MCP servers, and live model,
classifier, or image requests remain unverified. Standalone Pi binary support also remains
unverified; package-loading checks use npm Pi through its SDK.
