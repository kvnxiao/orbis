# @orbis/tiered-memory

Inspect and configure experimental memory controls for [Pi](https://pi.dev/). The extension supports
session activation, settings validation, model availability reports, and project-local storage.
Memory extraction, consolidation, recall, and custom compaction are unavailable in this version.

## Install

Requires Node.js `>=22.19.0` and Pi `0.87.0`.

```sh
pi install npm:@orbis/tiered-memory
```

Start Pi, or run `/reload` in an existing session. The extension defaults to enabled. It does not
make memory inference calls in this version. At session start, it writes identity and source records
under `.pi/tiered-memory/sessions/` for every persisted Pi session in the project, including while
memory is disabled; in-memory sessions get no storage. Activation overrides, valid settings, and
command reports are stored in Pi's session. Commands do not rewrite settings files or change native
auto-compaction.

The extension blocks Pi's ordinary `write` and `edit` calls into `.pi/tiered-memory/sessions/` and
`.pi/tiered-memory/learnings/`, including while memory is disabled. Users can curate those files in
an editor.

## Try it

```text
/tiered-memory status
```

The report shows activation, settings sources, memory model availability, storage state, resource
limits, and capabilities that are unavailable. Storage state includes the counts cached by the
latest source registration and the event that produced them; inspecting status reads cached state
and writes no memory files. Inspecting status does not require credentials. A memory model without
configured credentials is reported as suspended.

Use `/tiered-memory off` or `/tiered-memory on` to set the current session's activation override.
Resume restores that override; a new unrelated session uses settings defaults. `/tiered-memory` also
prints status.

## More detail

- [Usage guide](docs/usage.md): configuration paths, precedence, limits, and recovery.
- [Storage guide](docs/storage.md): saved records, curation, recovery, and direct-write guards.
- [Specification](SPEC.md): the complete intended memory contract and implementation availability.

## License

[MIT](LICENSE).
