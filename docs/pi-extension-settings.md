# Settings menus for Pi extensions

Research date: 2026-09-11. Baseline: Pi 0.85.1. Findings come from the installed API declarations
and source, checked against the pinned upstream documentation. Third-party examples were checked
against their online source or documentation. Later Pi versions and live command routing were not
tested.

## Native settings boundary

Pi 0.85.1 does not expose a public API for adding extension-owned rows to native `/settings`.
`ExtensionAPI` supports command registration, while `ExtensionUIContext` supports dialogs and custom
components. Neither exposes a host settings registry. The native settings selector constructs its
own items from host configuration and callbacks.
[Extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts),
[native selector](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/components/settings-selector.ts)

The interactive host recognizes exact `/settings` before dispatching extension commands. Registering
an extension command with that name does not replace the native menu. Built-in-name collisions
produce warnings and are excluded from interactive autocomplete.
[Host dispatch](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts)

## Reuse the settings component

An extension can create a separate menu with `SettingsList` from `@earendil-works/pi-tui` inside
`ctx.ui.custom()`. This reuses Pi's settings interaction and theme; it does not register rows in the
native menu. The official tools extension demonstrates this component under its own command.
[Tools example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/tools.ts)

The TUI documentation's SettingsList example registers a command named `settings`. Its component
construction is reusable, but its command name conflicts with native dispatch. Use a package-scoped
command or a settings action within an extension's existing command.
[SettingsList example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#pattern-3-settingstoggles-settingslist)

Custom terminal menus require TUI mode. The package owns validation, persistence, personal defaults,
and any trusted project overrides for its settings; rendering a SettingsList does not supply those
behaviors.
[Extension UI contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts)

## Third-party settings menus

The reviewed packages expose separate settings menus. None establishes an API for adding rows to
stock Pi's native `/settings`.

| Package                               | Integration                                                                                                                                                                      | Evidence                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@juanibiapina/pi-extension-settings` | Collects registrations from cooperating extensions through `pi-extension-settings:register`. Opens grouped settings under `/extension-settings` and `/extension-settings-local`. | [Source](https://github.com/juanibiapina/pi-extension-settings/blob/main/src/extension.ts) registers those commands and constructs a custom menu with a package-local `SettingsList` through `ctx.ui.custom()`. |
| `@aliou/pi-utils-settings`            | Supplies configuration loading and separate `/name:settings` commands with scope tabs.                                                                                           | [Author documentation](https://github.com/aliou/pi-utils-settings#registersettingscommand) describes a dependency library. Its implementation was not inspected.                                                |
| `@getpipher/cursor`                   | Opens a separate `/cursor` panel using Pi's `SettingsList`.                                                                                                                      | [Author documentation](https://github.com/getpipher/cursor) describes reuse of the native settings component. Its implementation was not inspected.                                                             |

A shared extension-settings registry can consolidate settings from participating packages under one
command. Adopting that registry introduces an integration with the registry package; it does not
place settings inside native `/settings`.

These examples establish available patterns, not an exhaustive survey of packages or private API
workarounds. Recheck upstream APIs and package implementations before adopting a dependency.

## Command design

Command handlers receive an argument string, and `getArgumentCompletions` can complete subcommands.
A package can therefore expose a command such as `/example settings` without registering another
top-level slash command. The extension parses its own subcommand grammar.
[Command registration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#piregistercommandname-options)

When a command already accepts free-form text, reserved subcommands can change the meaning of
existing input. Specify an explicit text-entry form or escape, match complete management commands,
and document any retained aliases.

When different extensions register the same command, Pi assigns numeric invocation suffixes in load
order, such as `/example:1` and `/example:2`.
[Collision resolver](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts)

## Checks for adopting packages

Verify command dispatch and completion in an actual Pi session, including native `/settings` and
extension-name collisions. Exercise keyboard navigation, Escape, reload, invalid configuration, and
persistence failure in the package's own menu. When updating the Pi baseline, recheck the public API
before claiming native-menu integration or replacing the package-owned settings entry.
