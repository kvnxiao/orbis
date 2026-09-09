# @orbis/example

A TypeScript extension for the Orbis agent harness.

## Local use

With Pi installed globally and `pi` available on `PATH`, run from the monorepo
root:

```sh
pnpm install
pi install ./packages/example
```

Start Pi and run `/orbis-example` to check that the extension loaded.
Replace the example command with the package's intended behavior and document
its commands, tools, configuration, and side effects here.

## Install from npm

After this package is published:

```sh
pi install npm:@orbis/example
```

Pi loads `src/index.ts` directly. The package does not require a build step.

## Tests

From the monorepo root:

```sh
pnpm --filter @orbis/example test
pnpm --filter @orbis/example test:watch
```

Vitest runs `tests/**/*.test.mts`. The included test loads the extension through
Pi and checks command registration. Add tests for the package's behavior as it
changes. The root `pnpm test` command discovers this package through its
`vitest.config.mts` project.

## License

[MIT](./LICENSE).
