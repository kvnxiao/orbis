# Developing @orbis/plan

Follow the
[workspace contribution guide](https://github.com/kvnxiao/orbis/blob/main/CONTRIBUTING.md) for setup
and package changes. The [system specification](../SPEC.md) and
[interaction contract](tui-interactions.md) define behavior; the
[integration reference](integrations.md) documents tools and presenter APIs.

## Verification

The Vitest tests and benchmarks run local fixtures without live models. The tests do not launch the
Pi CLI. Persistence checks use disposable Pi SDK sessions; agent-turn checks use an in-process
scripted provider. The Vitest process blocks external fetch and TCP connections and fetch redirects;
loopback fixture traffic is allowed. Tests and benchmarks do not incur model charges.

```sh
pnpm --filter @orbis/plan test
just fix
just check
```

To measure document layout, modal rendering, draft transitions, and session saves, run the offline
benchmarks separately:

```sh
pnpm --filter @orbis/plan exec vitest bench --run
```

Benchmark results are written under the package's ignored `implementation/performance/` directory.
Rendering and save timings depend on the fixture, terminal width, runtime, and machine; these
measurements do not establish real-terminal responsiveness or model quality.

To exercise source exports, terminal input, and presenter load order without a model, run
`node packages/plan/tests/packed-probe.mts` from the repository root. The standalone probe blocks
network connections. For a distribution check, run `pnpm pack` in this package, install the emitted
tarball and its Pi peers in a disposable directory, copy `tests/packed-probe.mts` and
`tests/presenter-probe.mts` there, and run `node packed-probe.mts`. This checks public imports
without workspace links or the package's development dependencies.

To generate scripted modal recordings, run from the repository root:

```sh
node packages/plan/tests/record-tui.mts
```

The command prints the generated offline player's path and writes asciinema v2 `.cast` files and
`frames.json` beside it. These files remain in the ignored local evidence directory. The player
displays plain text and provides frame navigation; the casts retain ANSI colors. Each captured frame
lasts two seconds.

The fixture drives the actual `TerminalRound`, `TerminalReview`, and Pi `Editor` with a fake
terminal and scripted state transitions. It checks viewport bounds and scenario outcomes without
launching Pi or calling a model. Its editor uses Pi's Markdown horizontal-rule and select-list theme
colors, and its frame uses the horizontal-rule color. The production wrapper uses border and muted
colors. The fixture does not capture the Pi shell, hardware cursor, real input timing, or disk
recovery.

For real terminal input, use a disposable project and isolated `PI_CODING_AGENT_DIR`. Load this
package and `tests/terminal-probe.mts` with Pi's `-e` option and select
`--provider plan-probe --model probe`. Run `/probe-round` in a fresh session to exercise question
navigation; use another fresh session and `/probe-review` for Markdown review. The fixture calls the
installed package tools through a scripted in-process provider. It does not call a real model. Add
`tests/presenter-probe.mts` to test Ctrl+P and presenter registration; that fixture submits answers
and approves reviews automatically after selection. Use it only with disposable fixture plans.

Check unfinished custom text, per-option details, and multiline clarification across navigation,
wraparound, resize, nested Escape, cancellation, and resume locally and over SSH. Exercise IME input
and narrow terminals. During review, check block focus and batch submission, frontier and revision
browsing, transfer back to the TUI, direct notes, revision requests, and exact-revision approval
with supplementary notes. Separately verify reload, branch navigation, unresolved clarification,
storage failures, and retry. Scripted fixtures do not establish real-host usability or real-model
research and frontier quality.

Node.js 22.19.0 is the declared minimum. Pi 0.85.1 is the compatibility baseline; standalone Pi
binary support remains unverified.

Real-model checks run separately under a live orchestrator during an explicit verification session.
They are excluded from Vitest discovery and `pnpm check`.
