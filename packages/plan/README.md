# @orbis/plan

Work out a change with [Pi](https://pi.dev/) before implementing it. Answer questions in the
terminal, annotate the proposed Markdown, and approve the plan when it is ready.

## Install

Requires Pi's interactive terminal and Node.js `>=22.19.0`. RPC, JSON, and print modes are
unsupported.

```sh
pi install npm:@orbis/plan
```

Start Pi, or run `/reload` in an existing session.

## Try it

While Pi is idle, enter an objective:

```text
/plan Add a local cache to this project
```

The agent researches the project and opens a question round. Choose answers, add your own text, or
ask for clarification. Review your answers and submit the round to continue planning.

When the plan is ready, review its Markdown in the terminal. Add notes to individual blocks or the
whole plan, request a revision, or approve it. After approval, choose **Implement in this session**,
**Implement in a new session**, or **Decide later**.

## How it works

Planning uses the existing conversation and agent. Approval records your acceptance; only a separate
implementation choice or request starts execution. Planning instructions do not sandbox the agent's
tools.

Plan saves Markdown revisions under `.pi/plans/` by default and stores planning state in the Pi
session. Supplementary approval notes are saved separately. The output filesystem must support hard
links. When session persistence is unavailable, drafts remain unsaved and Plan reports that state.
Use `/plan` to resume saved questions or review.

Open `/plan-settings` to change the save directory, appearance, or planning shortcut. The default
Shift+Tab shortcut conflicts with Pi's thinking-level shortcut until you rebind it; `/plan` works
without rebinding. See [shortcut setup](docs/usage.md#planning-entry).

## More detail

- [Usage guide](docs/usage.md): keyboard controls, settings, saving, and recovery.
- [Integration reference](docs/integrations.md): planning tools and optional presenters.
- [Development](docs/development.md): setup, tests, and compatibility checks.
- [Specification](SPEC.md): complete behavior and interaction contract.

## License

[MIT](LICENSE).
