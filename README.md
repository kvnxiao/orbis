# Orbis

Modular extensions for [Pi](https://pi.dev/). Install the packages you need to add planning, review,
and terminal commands to your coding agent.

Orbis takes its name from Latin _orbis_, a circle or orb, and the circle constant pi.

## Choose an extension

| Package                                                  | What it does                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [@orbis/plan](packages/plan/README.md)                   | Develop a plan with the agent, answer questions, annotate Markdown, and choose when to implement.      |
| [@orbis/exit](packages/exit/README.md)                   | Quit Pi with `/exit`.                                                                                  |
| [@orbis/tiered-memory](packages/tiered-memory/README.md) | Inspect experimental memory settings and control session activation; memory processing is unavailable. |

Each extension installs independently. Package READMEs explain requirements and first use.

## Install

With Pi installed, add an extension:

```sh
pi install npm:@orbis/plan
```

Start Pi, or run `/reload` in an existing session. Try planning a change:

```text
/plan Add a local cache to this project
```

Pi researches the change and opens questions for your decisions, then presents Markdown for review.
You choose whether to request revisions, approve the plan, or start implementation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workspace setup, package design, development, and checks.

## License

[MIT](LICENSE).
