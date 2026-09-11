# Pi settings and commands

## Keep extension settings within the public API (Required)

Pi v0.85.1 does not expose a public registry for extension rows in native `/settings`. The interactive host dispatches exact `/settings` before extension commands. When an extension registers a built-in command name, the host emits a startup warning and excludes the command from autocomplete. If command collision resolution assigned a numeric suffix, the warning reports that invocation name. Before claiming native integration on another version, inspect its public declarations and command dispatch. [Extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts), [host dispatch](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts).

For a package settings menu, import `SettingsList` from `@earendil-works/pi-tui` and `getSettingsListTheme` from `@earendil-works/pi-coding-agent`. Use them inside `ctx.ui.custom()` in TUI mode. Open the menu through a package command such as `/example-settings` or `/example settings`. The TUI documentation's example registers `settings`; reuse its component construction with a command name that does not collide with the host. [SettingsList pattern](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md#pattern-3-settingstoggles-settingslist), [tools example](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/tools.ts).

## Own configuration independently of its menu (Default)

Keep validation, defaults, scope precedence, loading, and persistence outside the settings component. Define whether edits apply immediately or on Save, and whether they affect current work or the next operation. Display the effective value and write scope. When a project override masks a personal value, make that override visible.

When project overrides are supported, apply only trusted project configuration and merge only supplied fields over personal defaults. Preserve unrelated settings during writes. On invalid configuration or a failed write, report the affected setting and retain a recoverable edit; do not display an unsaved value as persisted.

A shared settings registry can group cooperating extensions under a separate menu. When cross-package settings are needed, adopt a registry only after verifying its implementation and compatibility. A registry package or native-looking component does not establish integration with the host's `/settings`.

## Make commands correspond to user operations (Default)

Prefer a small command surface with completion. Put preferences under settings and expose supported actions. When the host does not provide native `/settings` integration, do not show a menu entry or hint claiming that integration.

When a command accepts subcommands and free-form text, reserve exact subcommand words such as `settings`. Provide an explicit text form for input that equals a reserved word, such as `/example start settings`. Pi supplies the argument string and `getArgumentCompletions`; the extension owns parsing. [Command registration](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#piregistercommandname-options).

When extension command names collide, Pi assigns numeric invocation suffixes such as `/name:1`. [Collision resolution](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/runner.ts).
