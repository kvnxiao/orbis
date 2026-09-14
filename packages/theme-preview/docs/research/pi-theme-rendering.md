# Pi theme rendering

Research date: 2026-09-13. Inspected host: Pi 0.85.1, using installed declarations and JavaScript.
The findings are source checks; they do not establish terminal or runtime compatibility.

## Scope

This research examines whether a Pi extension can render static theme fixtures, resolve their
colors, and follow active-theme changes without changing the session theme. It does not establish
feature comparisons with third-party theme packages.

## Inventory and effective colors

Pi ships a JSON theme schema alongside its npm runtime. In 0.85.1, the schema declares 56 color
properties and requires 51. Its optional properties are `scrollbarTrack`, `scrollbarThumb`,
`searchMatchBg`, `searchMatchText`, and `thinkingMax`. The runtime applies these fallbacks:

| Optional token    | Fallback token  |
| ----------------- | --------------- |
| `scrollbarTrack`  | `muted`         |
| `scrollbarThumb`  | `text`          |
| `searchMatchBg`   | `selectedBg`    |
| `searchMatchText` | `text`          |
| `thinkingMax`     | `thinkingXhigh` |

The schema is the inventory source. Fixture coverage still needs an explicit association between
each rendered region and its tokens; a newly declared token does not create a fixture automatically.
The schema does not provide the gallery's group organization.

Pi exports `getPackageDir()`, but it does not export a schema accessor. The npm installation stores
the schema at `dist/modes/interactive/theme/theme-schema.json`; its standalone binary uses a
different asset layout. Binary support has not been verified.

Sources:
[schema](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/theme/theme-schema.json),
[theme implementation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/theme/theme.ts),
[package asset commands](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json).

## Isolated fixture rendering

Pi publicly exports `Theme`. Its constructor accepts foreground and background color maps and a
truecolor or 256-color mode. Its `getFgAnsi()` and `getBgAnsi()` methods expose the effective token
styles, including resolved optional fallbacks. The 256-color mode reduces hex values to palette
indices, so these methods do not preserve original hex values in that mode.

Pi TUI primitives accept styling callbacks. A local theme with concrete RGB values can therefore
style fixture components without replacing the active theme. Pi's built-in message and tool
components import the global theme and do not accept a complete local theme. Composing equivalent
fixtures from public primitives permits isolated color overrides; it requires tests of the token
pairings against the supported host's rendering.

Even with concrete RGB values, `Theme.fg()` and `Theme.bg()` append terminal-default reset
sequences. Concrete-color requirements should describe the colors of visible fixture cells, not
prohibit reset bytes between styled spans. Padding, empty lines, and wrapped lines also need the
resolved surface background.

Sources:
[theme API and implementation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/theme/theme.ts),
[message components](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent/src/modes/interactive/components),
[TUI documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md).

## Terminal inputs and settings

The TUI instance exposes `queryTerminalBackgroundColor({ timeoutMs })`, returning RGB or
`undefined`. It also exposes color-scheme notifications and a polarity query. Only the RGB query
supplies a measurement background. Source inspection found no public foreground or ANSI-palette
query. Terminal foreground and palette indices 0-15 therefore need author-supplied values.

Pi's environment background detection can use `COLORFGBG` with low confidence. Explicit input or the
RGB query avoids inferring a measurement color from polarity or environment hints.

Pi 0.85.1 does not expose extension rows in native `/settings`. A package can use `SettingsList` and
input components inside its custom view. Public `getAgentDir()` identifies the personal Pi data
directory, including an environment override.

Sources:
[terminal query implementation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/tui.ts),
[extension UI API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts),
[personal data directory](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/config.ts).

## Theme changes and disposal

When Pi applies a theme, its interactive host invalidates the TUI and requests rendering. TUI
invalidation includes custom root and overlay components. An extension can refresh a local snapshot
from the public `ctx.ui.theme` getter during invalidation. The internal `onThemeChange` function is
not a root export and replaces a single callback; it is not an extension subscription API.

Pi's custom-theme watcher watches the selected user theme file, debounces changes, and retains the
last successfully loaded theme during invalid or missing-file edits. It does not watch every
discovered package or project theme path. A contract that follows themes Pi successfully applies
matches this behavior without requiring independent theme loading.

Sources:
[interactive host](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts),
[TUI invalidation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/tui.ts),
[theme watcher](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/theme/theme.ts).

## Verification limits

Terminal queries through SSH and multiplexers, resize behavior, custom-view lifecycle, and complete
fixture parity require runtime checks. Source inspection supports the npm Pi 0.85.1 design; it does
not establish compatibility with future schemas or the standalone binary.
