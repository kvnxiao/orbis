# @orbis/exit

Adds `/exit` to quit [Pi](https://pi.dev/).

## Install

Requires Pi and Node.js `>=22.19.0`.

```sh
pi install npm:@orbis/exit
```

Start Pi, or run `/reload` in an existing session.

## Try it

```text
/exit
```

Pi shuts down gracefully. When the agent is busy, Pi waits until it becomes idle before exiting. The
extension has no configuration.

## Development

See the
[contribution guide](https://github.com/kvnxiao/orbis/blob/main/CONTRIBUTING.md#package-checks) for
source installation and tests, or the [specification](SPEC.md) for the command contract.

## License

[MIT](LICENSE).
