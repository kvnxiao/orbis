# @orbis/tiered-memory

Keep a running summary of ongoing work in [Pi](https://pi.dev/) sessions and show it to the model in
later requests. After each turn, an observer model reads the new conversation, records observations
that cite their sources, and updates a bounded current-work note. The extension is experimental.
Organizing older observations into long-term notes, recall, and custom compaction are unavailable in
this version.

## Install

Requires Node.js `>=22.19.0`. Tested with Pi `0.99.1`.

```sh
pi install npm:@orbis/tiered-memory
```

Start Pi, or run `/reload` in an existing session. The extension defaults to enabled. While enabled,
the observer calls the configured observer model, or the active session model when none is
configured, through your Pi provider credentials, so these calls can add provider charges. Each call
is bounded by the [resource limits](docs/usage.md#resource-limits); without credentials for the
selected model, the observer is suspended and does not call it.

At session start, the extension writes identity and source records under
`.pi/tiered-memory/sessions/` for every persisted Pi session in the project, including while memory
is disabled; it does not store anything for in-memory sessions. Memory revisions and the
current-work note are written there too. Presented notes are added to the Pi session as custom
messages that the model sees; together they use at most about `limits.presentationTokens` (4096
estimated tokens by default) of each request, plus any short correction that withdraws a note.
Activation overrides, valid settings, and command reports are stored in Pi's session. Commands do
not rewrite settings files or change native auto-compaction.

Before each request that shows the note, the extension checks that the complete note fits the
model's context window and `limits.presentationTokens`. When it cannot fit, the extension stops the
request before it reaches the provider and does not retry it; `/tiered-memory status` shows the
cause and how to recover.

The extension blocks Pi's ordinary `write` and `edit` calls into `.pi/tiered-memory/sessions/` and
`.pi/tiered-memory/learnings/`, including while memory is disabled. Users can curate those files in
an editor. The extension checks `current-work.md` before each turn. After you edit it, the extension
stops showing the note to the model and adds a correction stating that the note is no longer
current. The observer does not update an edited note. Delete the file to let the observer write a
new note from later conversation. If Pi starts a compaction before that correction is saved, the
extension cancels the compaction, saves the correction, and tells you how to continue.

## Try it

Work for a few turns, then run:

```text
/tiered-memory status
```

Among other lines, the report shows the current-work note, its freshness, processing coverage, and
observer jobs:

```text
Current-work note: revision <revision-id>; source boundary tm1:<project-id>:<session-id>:<entry-id>:0 (branch entry 12); 0 eligible sources not yet observed
Current-work note freshness: verified at <time> by the latest completed inspection.
Processing coverage: no gaps
Observer jobs: 0 queued, none running, 0 deferred offers, 0 exhausted spans; last outcome: committed revision <revision-id>
```

The note line names the newest source the observer processed and how many conversation entries it
has not processed yet. The freshness line says when the extension last confirmed that the note file
still matches what it wrote. The report also shows provider-reported observer usage, the note's
presentation, activation, settings sources, memory model availability, storage state, resource
limits, and unavailable capabilities. Inspecting status reads cached state and does not write memory
files or require credentials.

The note itself is `.pi/tiered-memory/sessions/<session-id>/current/current-work.md`. In the
transcript, each presentation record appears as one collapsed line, such as
`Tiered memory current-work note: revision …`, that expands to the text the model sees.

Use `/tiered-memory off` or `/tiered-memory on` to set the current session's activation override.
Resume restores that override; a new unrelated session uses settings defaults. `/tiered-memory` also
prints status.

## More detail

- [Usage guide](docs/usage.md): configuration, observation, presentation, request capacity, status,
  and recovery.
- [Storage guide](docs/storage.md): saved records, coverage, curation, presentation records,
  recovery, and direct-write guards.
- [Specification](SPEC.md): the complete intended memory contract and implementation availability.

## License

[MIT](LICENSE).
