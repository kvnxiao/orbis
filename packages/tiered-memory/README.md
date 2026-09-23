# @orbis/tiered-memory

Inspect and configure experimental memory controls for [Pi](https://pi.dev/). The extension supports
session activation, settings validation, and model availability reports. Memory extraction,
consolidation, storage, recall, and custom compaction are unavailable in this version.

## Install

Requires Node.js `>=22.19.0`, Pi `0.87.0`, and Git on `PATH` for project-root discovery.

```sh
pi install npm:@orbis/tiered-memory
```

Start Pi, or run `/reload` in an existing session. The extension defaults to enabled. It does not
make memory inference calls or write memory files in this version. Activation overrides, valid
settings, and command reports are stored in Pi's session. Commands do not rewrite settings files or
change native auto-compaction.

## Try it

```text
/tiered-memory status
```

The report shows activation, settings sources, memory model availability, resource limits, and
capabilities that are unavailable. Inspecting status does not require credentials. A memory model
without configured credentials is reported as suspended.

Use `/tiered-memory off` or `/tiered-memory on` to set the current session's activation override.
Resume restores that override; a new unrelated session uses settings defaults. `/tiered-memory` also
prints status.

## More detail

- [Usage guide](docs/usage.md): configuration paths, precedence, limits, and recovery.
- [Specification](SPEC.md): the complete intended memory contract and implementation availability.

## License

[MIT](LICENSE).
