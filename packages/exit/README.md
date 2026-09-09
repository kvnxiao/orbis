# @orbis/exit

Adds `/exit` to quit Pi through its graceful shutdown API.

## Local use

With Pi installed globally and `pi` available on `PATH`, run from the monorepo
root:

```sh
pi install ./packages/exit
pi
```

The install command registers the local package for future sessions. In an
existing Pi session, run `/reload` to load the package. Run `/exit` to quit.

The command calls `ctx.shutdown()`. When Pi is busy, shutdown waits until the
agent becomes idle. Pi emits `session_shutdown` before exiting.
The package has no configuration.

## Compatibility

Requires Node.js `>=22.19.0`. Tested with Pi `0.85.1`.
Pi loads `src/index.ts` directly without a build step.

## Tests

```sh
pnpm --filter @orbis/exit test
```

The test loads the package through Pi and checks that `/exit` requests shutdown.

## License

[MIT](./LICENSE).
