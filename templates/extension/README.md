# @orbis/example

Adds `/orbis-example` to [Pi](https://pi.dev/) to check that the extension loaded.

## Install

Requires Pi and Node.js `>=22.19.0`.

```sh
pi install npm:@orbis/example
```

Start Pi, or run `/reload` in an existing session.

## Try it

```text
/orbis-example
```

Pi displays `@orbis/example is loaded`. When `orbis-example.json` exists in Pi's agent directory and
contains `{ "version": 1, "message": "..." }`, the command displays that `message` instead.

## Development

See the [contribution guide](https://github.com/kvnxiao/orbis/blob/main/CONTRIBUTING.md) for source
installation and tests, or the [specification](SPEC.md) for the package contract.

## License

[MIT](LICENSE).
