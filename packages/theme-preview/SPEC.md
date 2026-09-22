# @orbis/theme-preview specification

Status: Defined contract. A reference implementation is not available.

`@orbis/theme-preview` previews the active Pi theme against static terminal fixtures and displays
advisory color measurements. Theme authors can inspect token use and compare backgrounds without
driving a real agent session. Extension authors and reviewers can inspect the same fixture content.
This contract is for independent implementers using Pi's public extension and TUI APIs.

A **token** is a color property in the installed Pi theme schema. A **fixture region** is a labeled
piece of example UI that uses known foreground and background tokens. The **surface background** is
the concrete terminal background color supplied by the author or obtained from the terminal. A
region may paint a theme background over that surface. **Terminal inputs** supply the background,
terminal-default foreground, and basic ANSI palette colors that Pi cannot resolve to RGB alone.

The package owns a fullscreen view with a settings page and a scrollable gallery. The settings page
collects missing terminal inputs before the gallery can open. Color measurements describe fixture
colors, not the readability of the settings or diagnostic UI.

The `REQ-` requirements and their associated tables define system conformance. The linked
[terminal interaction contract](docs/tui-interactions.md) defines layout, controls, focus, and user
flows under the same requirement IDs. Both documents are normative. The
[Pi rendering research](docs/research/pi-theme-rendering.md) and
[measurement research](docs/research/color-measurements.md) are informative.

## Host and command

### REQ-preview-entry — Preview entry

The extension registers `/theme-preview` through a default factory accepting Pi's `ExtensionAPI`.
The command opens the package view through `ctx.ui.custom()`. It does not accept arguments or
subcommands. Non-whitespace arguments produce a usage message and do not open or alter a preview.

The initial host contract targets the npm installation of Pi 0.87.0 and Node.js 22.19.0 or later
within Pi's supported runtimes. Preview requires `ctx.mode === "tui"`, Pi's active theme in
truecolor mode, and a terminal connection capable of displaying truecolor. The connection includes
any SSH or multiplexer path. The package does not infer physical color accuracy from a mode flag. In
an unsupported host mode or Pi color mode, the command reports the unmet requirement and does not
render fixtures or modify settings. Standalone Pi binary compatibility is not claimed.

The package does not register model-callable tools or start an agent turn. It does not read session
history, repository contents, or model output to construct fixtures.

### REQ-active-theme — Active theme

The preview uses the theme Pi has successfully applied. It does not select, install, edit, generate,
or replace themes, including temporary changes to Pi's global active theme. Author-supplied terminal
inputs affect only the package view. Pi's persisted theme setting remains unchanged throughout the
workflow.

Fixture rendering uses a local snapshot of effective theme colors. Pi owns variable resolution and
optional-token fallbacks. Public Pi TUI primitives and styling callbacks may compose fixtures that
reproduce the supported host's token use; instantiating Pi's internal session components is not
required. Each fixture must retain the foreground/background relationships of the surface it
represents. Arbitrary third-party extension UI is outside fixture coverage.

## Token inventory and terminal inputs

### REQ-token-inventory — Token inventory

On opening the view, the package reads the installed host's shipped `theme-schema.json` and derives
the declared token names and required/optional distinction. It does not substitute a hardcoded
inventory or a count from prose documentation. It excludes the HTML `export` section.

The package associates fixtures with the tokens they actually render. Coverage distinguishes a token
with a fixture, a token whose fixture awaits a terminal input, and a declared token without a
fixture. A token used only in a label or swatch does not satisfy fixture coverage.

For the supported schema, every declared token, including optional tokens resolved through Pi's
fallbacks, must have a fixture. When a newer schema declares an unmapped token, the view reports its
name as unrendered and does not claim complete coverage. The package does not create input fields
for unmapped tokens or block otherwise supported fixtures. Group filtering does not hide the global
coverage report.

When the schema cannot be read or its color inventory cannot be interpreted, the view reports the
inventory failure and does not open the gallery. Before supporting additional host versions, an
implementation must document and verify their schema and public API compatibility.

### REQ-color-resolution — Color resolution

Before opening the gallery, the package resolves every token used by its complete fixture set to an
opaque sRGB color. Selecting a group does not bypass missing inputs in another group. A shared
terminal input resolves every token that uses it; overrides are not keyed by token name.

| Effective theme value                    | Concrete fixture color                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Hex color, including a resolved variable | Its RGB value                                                              |
| Palette index 16-231                     | Conventional xterm RGB cube, with channel levels 0, 95, 135, 175, 215, 255 |
| Palette index 232-255                    | Conventional grayscale value `8 + 10 × (index - 232)` for each channel     |
| Palette index 0-15                       | Author-supplied RGB for that palette index                                 |
| Empty foreground                         | Author-supplied terminal foreground                                        |
| Empty background                         | Current surface background                                                 |

The package renders these resolved colors as truecolor, including numeric palette values. It does
not rely on the terminal's indexed palette for fixture output. A token that uses an optional
fallback resolves through the fallback's effective value and retains its original token label.

Color input accepts `#RRGGBB` with case-insensitive hex digits and surrounding whitespace trimmed.
Empty input clears an optional supplied value. Other formats, alpha values, malformed hex, and
palette keys outside 0-15 are rejected. Settings identify each missing shared input and the tokens
and regions it affects. Until all required inputs resolve, the gallery remains unavailable.

Concrete-color requirements apply to visible fixture cells. Pi-generated styling resets between
spans are permitted, but subsequent fixture text, padding, and line backgrounds must receive their
resolved colors. Settings, controls, labels, and diagnostic text may use the active theme, including
its terminal defaults; those colors are excluded from fixture measurements.

### REQ-background-source — Background source

The background source is either queried or supplied. Without saved defaults, the source is queried.
A supplied source requires a hex color and suppresses terminal background queries. A queried source
uses the TUI's public background RGB query with a finite timeout. The implementation documents its
timeout; it must not leave preview readiness pending indefinitely.

When the query times out, rejects, or returns an unusable value, settings report the failure and
require either a successful retry or a supplied background. The package does not substitute
`COLORFGBG`, a polarity result, a built-in theme's export colors, or a guessed RGB value.

The view displays the effective background RGB and its source. The gallery paints the surface
background across its full available surface, including unused rows and padding; fixture-specific
backgrounds paint over that base. Measurements use each region's actual foreground and background,
including theme backgrounds and reversed search colors.

On the queried path, a terminal color-scheme notification invalidates the previous query result and
starts a new bounded query. The gallery is suspended until that result resolves. A failed refresh
returns to settings and does not reuse stale measurements. Supplied inputs remain author-controlled;
the package does not change them in response to a terminal notification.

### REQ-personal-defaults — Personal defaults

Settings edits apply to the current open view. An explicit Save defaults action persists confirmed
terminal inputs for future invocations across projects. Previewing, closing, and finishing a field
edit do not save defaults. On closing the view, unsaved values are discarded; reopening loads saved
defaults. When the saved source is queried, reopening starts a fresh query.

Persisted data contains a schema version, the selected background source, an optional supplied
background, an optional terminal foreground, and supplied palette values keyed by index. It does not
contain query answers, theme copies, measurement results, scroll positions, or session entries.
Missing foreground and palette values are permitted in saved defaults; the active theme determines
which are required for preview. A supplied background source cannot be saved without its color.

The store is package-owned and personal, under the directory identified by Pi's public
`getAgentDir()`. The implementation documents its filename and serialized field names. It must not
edit Pi's native settings file or read project overrides. Before use, loaded data is validated.
Malformed or unsupported-version data opens settings with a visible error, remains unchanged on
disk, and does not silently become saved defaults. This error prevents automatic gallery entry even
when the fixture colors already resolve; authors may explicitly preview with resolved temporary
values or replace the store through Save defaults.

Saving replaces the package store without exposing a partially written document. A failed save
preserves the previous file and current edits, reports that the values were not saved, and permits
retry. A successful save establishes defaults even if the author subsequently closes the view. Save
operations within a view are serialized. Independent Pi processes use the last successfully
completed save; settings do not merge concurrent edits.

## Fixture gallery

### REQ-fixture-gallery — Fixture gallery

The gallery renders static package data as a continuous, scrollable document responsive to terminal
width and height. The interaction contract defines its
[gallery navigation](docs/tui-interactions.md#gallery) and
[terminal adaptation](docs/tui-interactions.md#terminal-adaptation).

The fixture groups and their content are required. Exact example prose and code are implementation
choices, provided their token use and edge cases remain observable.

| Group                | Required fixture regions                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core UI              | Accent; normal, accented, and muted borders; success, warning, and error text; muted and dim text; visible scrollbar track and thumb                                                |
| Messages             | User message with background and text; custom message with background, text, and label; assistant prose using `text`                                                                |
| Tool boxes           | Pending, success, and error boxes, each with a title and multiline output on its corresponding background                                                                           |
| Markdown             | Every heading level; ordered and unordered lists; blockquote; horizontal rule; link text and URL; inline code; fenced code with fence styling and an unhighlighted code-body region |
| Syntax               | Identifiable comment, keyword, function, variable, string, number, type, operator, and punctuation spans                                                                            |
| Diffs                | Added, removed, and context lines in a tool-result hunk, retaining their line markers                                                                                               |
| Thinking             | Editor-border fixtures for off, minimal, low, medium, high, xhigh, and max; thinking-block text                                                                                     |
| Bash mode            | Editor border and a visible `!`-prefixed input example                                                                                                                              |
| Selection and search | Selected line; non-current search match; current search match with `searchMatchBg` and `searchMatchText` exchanging foreground/background roles                                     |
| Edge cases           | Long wrapped text, wide CJK characters, emoji, preformatted ANSI-styled tool output, and an empty tool result                                                                       |

Every region identifies the tokens that produced it. A token used on different backgrounds receives
measurements for each rendered pairing, including tool title and output across tool states. The
syntax fixture must exercise every syntax token. When a highlighter omits a token from a sample,
another fixture span must exercise that token.

ANSI-styled fixture output is static data produced through Pi styling helpers. Its visible colors
remain concrete and its resets must not erase the resolved surrounding background. It does not
execute commands or emit terminal queries, cursor-control commands, or hyperlinks as fixture side
effects. The empty-result fixture must remain distinguishable from a missing fixture.

The group selector contains All and every fixture group. A selection limits the document to that
group without changing colors, saved defaults, or global coverage. Returning to All restores the
complete document. Diagnostics for a visible region remain adjacent to that region and identify any
comparison partner outside the selected group.

## Advisory measurements

### REQ-contrast-measurements — Contrast measurements

For each fixture foreground/background pair, the package computes APCA lightness contrast and the
WCAG 2 contrast ratio from the same resolved opaque sRGB colors it renders. APCA output retains its
sign: positive for dark foreground on a lighter background and negative for the opposite polarity.
Threshold comparisons use the absolute unrounded Lc value. The WCAG ratio is a secondary number and
does not independently trigger a warning.

The numerical APCA contract is 0.0.98G-4g. Independent implementations may use a library or
implement the calculation, provided they reproduce that version's sRGB results, polarity, and
low-contrast clamp. [Color.js's APCA documentation](https://colorjs.io/docs/contrast.html)
identifies the calculation; dependency selection does not confer theme or tool certification. The
WCAG ratio uses the standard relative-luminance calculation with the sRGB linearization breakpoint
0.04045.

| Foreground role           | Token assignment                                                                                                                                               | Target magnitude | Warn below |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------- |
| Body text                 | `text`, `toolOutput`, `userMessageText`, `customMessageText`, `mdCodeBlock`, `thinkingText`, all `syntax*` tokens; foreground tokens not assigned another role | 75               | 60         |
| Secondary text            | `muted`, `toolTitle`, `mdLinkUrl`, `customMessageLabel`, `mdQuote`                                                                                             | 60               | 45         |
| Decorative text and marks | `dim`, `mdHr`, `borderMuted`, `scrollbarTrack`                                                                                                                 | 45               | 30         |
| Strokes                   | `border`, `borderAccent`, thinking-level borders, `bashMode`, `scrollbarThumb`, `mdQuoteBorder`, `mdCodeBlockBorder`                                           | 45               | 30         |

The reversed current-search foreground uses the body-text role. Background tokens receive contrast
measurements when paired with foreground content; they do not receive a standalone text role merely
because they paint an area.

Below magnitude 15, the region receives the Very low contrast diagnostic instead of a duplicate
ordinary contrast warning. At a warning threshold, the ordinary warning does not apply. Targets
remain informational and do not introduce a second warning interval. Built-in themes use the same
thresholds, without automatic calibration or exceptions.

These thresholds are package heuristics. The view describes results as advisory measurements and
does not label a theme compliant, accessible, certified, passing, or failing. It does not claim APCA
tool certification, emit a diagnostic exit code, or provide a CI mode. Font size, font weight,
terminal rendering, and viewer perception remain outside the measurement model.

### REQ-color-distinctness — Color distinctness

The package computes CIEDE2000 color difference, displayed as ΔE2000, between every unordered pair
within each comparison set. It uses the resolved fixture colors, CIELAB with a D65 reference white,
and unit lightness, chroma, and hue weighting factors. A difference below 2.3 receives a
Near-identical classification; a difference from 2.3 up to but excluding 10 receives a Similar
classification. Comparisons use unrounded values.

| Comparison set                                                    | Reporting role           |
| ----------------------------------------------------------------- | ------------------------ |
| `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`             | Semantic warning         |
| `success`, `warning`, `error`                                     | Semantic warning         |
| `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`                   | Semantic warning         |
| All `syntax*` tokens                                              | Informational similarity |
| `selectedBg`, `searchMatchBg`, `userMessageBg`, `customMessageBg` | Informational similarity |

Similarity does not prove that content is indistinguishable: line markers, labels, and layout remain
present. General syntax and surface similarity do not become warnings solely because colors are
equal. A token used in multiple regions may share one calculation, but each displayed diagnostic
must identify the compared tokens and the affected context.

### REQ-vision-simulation — Vision simulation

For each semantic comparison set, the package repeats the distinctness calculation after simulating
deuteranopia, protanopia, and tritanopia. Both colors receive the same transform. The same 2.3 and
10 cutoffs classify simulated similarity and produce advisory semantic warnings. The diagnostic
names the simulation and both tokens. General syntax and surface similarity do not acquire semantic
warnings through simulation.

The simulation uses a published Machado or Brettel model for full deficiency. Model selection,
parameters, conversion, and gamut treatment are implementation choices that must be documented and
verified against independent reference vectors. The view identifies the selected model in its
measurement explanation. Simulation affects calculations only; it does not recolor the gallery or
claim to reproduce every viewer's perception.

## Updates and view lifetime

### REQ-live-refresh — Live refresh

When Pi successfully applies a changed active theme, the view refreshes its snapshot, resolved
colors, coverage, and measurements together. This includes edits that Pi's theme hot reload applies.
The package does not independently load an invalid edit or promise to watch paths Pi does not watch.
When Pi retains its previous theme, the preview continues to describe that applied theme.

When a refresh introduces missing inputs, the gallery is suspended and settings focus the first
missing input. Existing entries, selected group, and gallery position are preserved for recovery.
When all inputs resolve again, returning to the gallery uses the current theme rather than the
previous snapshot. A failed color calculation displays an unmeasured diagnostic for the affected
pair, never a fabricated number; it does not suppress unrelated valid measurements.

Theme and background results belong to the view state that requested them. A late result must not
replace a newer theme, a supplied-background selection, or a closed view. On width or height
changes, the document reflows and preserves the visible fixture where possible. Rendering is free of
I/O and state mutation; lifecycle and input callbacks prepare updates and invalidate affected render
data.

### REQ-view-cleanup — View cleanup

Only one package view may be active per extension instance. Closing the view resolves the custom UI
through Pi's completion callback and releases package-owned listeners, pending-query effects, and
other view resources. Repeated cleanup is safe. Session shutdown or extension reload performs the
same disposal; late asynchronous completions do not reopen or modify the view.

Closing the preview does not abort the agent, send a message, append fixture content to session
history, or alter the session theme. An interruption of the custom UI closes the package view and
discards unsaved inputs; it does not create a model turn or save defaults. Pi retains ownership of
session-level interruption and shutdown behavior.

## Conformance

Conformance requires every requirement and the linked interaction scenarios. These checks define
expected behavior; they do not establish that an implementation exists or has passed them. Automated
checks use local fixtures and scripted host APIs without model calls or external network traffic.
Real-terminal checks do not need an agent turn.

| Requirement               | Initial state, action, and observable result                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-preview-entry         | Load the extension and invoke `/theme-preview` in TUI truecolor mode: one custom view opens without an agent turn. Supply arguments, RPC mode, or 256-color mode: a clear message replaces preview and settings remain unchanged.                                                                                                                                                    |
| REQ-active-theme          | Preview a theme with supplied colors, close, and reopen: the host's active theme and persisted setting are unchanged. Inspect fixtures against Pi 0.87.0 token/background use.                                                                                                                                                                                                       |
| REQ-token-inventory       | Load the supported schema and built-in themes: every required and optional token has a fixture. Add a declared future token: it appears as unrendered even under a group filter. Remove or corrupt the schema: inventory failure blocks the gallery.                                                                                                                                 |
| REQ-color-resolution      | Exercise direct hex, variable resolution, optional fallbacks, palette boundaries 0/15/16/231/232/255, and empty foreground/background values. Shared input resolves all dependent regions; missing input in a filtered-out group still blocks preview. Reject malformed hex, alpha, and invalid palette keys. Inspect visible styled cells across resets and wrapping.               |
| REQ-background-source     | Query successfully, then time out and reject: success identifies the RGB source; failures block preview until retry or supplied input. Supply a light background in a dark terminal: the gallery paints and measures the light color, including unused rows. A scheme change re-queries only on the queried path.                                                                    |
| REQ-personal-defaults     | Edit and preview without saving, close, and reopen: saved values are restored. Save, close, and reopen from another project: personal values persist, query answers do not. Reject malformed stored data and an unsupported version. Inject a write failure: previous file and edits survive, and no saved confirmation appears.                                                     |
| REQ-fixture-gallery       | Render every required group, filter one, and return to All: fixtures and global coverage remain accurate. Inspect tool state pairings, syntax coverage, reversed search colors, ANSI resets, empty output, CJK, emoji, and long wrapping.                                                                                                                                            |
| REQ-contrast-measurements | Use independent reference vectors with both polarities, equal colors, and low-contrast clamping. At magnitudes 15/30/45/60, verify boundary behavior before rounding. At just below the role threshold, show the appropriate warning and secondary ratio; target-only shortfalls remain informational.                                                                               |
| REQ-color-distinctness    | Use independent CIEDE2000 vectors and values just below, at, and above 2.3 and 10. Identical syntax colors produce information; identical semantic state colors produce a warning. Every compared pair is named.                                                                                                                                                                     |
| REQ-vision-simulation     | Verify each documented transform against independent vectors. A semantic pair that crosses a cutoff under a simulation receives a diagnostic naming that simulation; the rendered fixture colors remain unchanged.                                                                                                                                                                   |
| REQ-live-refresh          | Apply a valid host theme change, retain a previous theme after an invalid edit, and introduce an unresolved palette value: measurements follow only the applied snapshot, and missing inputs suspend preview. Resolve queries out of order, change source mid-query, resize, and inject a calculation failure: stale results are ignored and unaffected measurements remain correct. |
| REQ-view-cleanup          | Close during a query, repeat disposal, trigger session shutdown, and reopen: listeners do not accumulate, late completions have no effect, unsaved inputs are discarded, and saved defaults survive.                                                                                                                                                                                 |

Compatibility checks cover the supported npm Pi runtime, its loader, and terminal rendering with
truecolor through local and SSH/multiplexer connections. Runtime support must be documented from
those checks; TypeScript checking alone does not establish loading or rendering compatibility.
