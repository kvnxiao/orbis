# Existing Pi planning packages

Research date: 2026-09-08. Package versions were checked against the npm registry;
comparisons use freshly inspected source and package documentation. Published
tarballs were inspected where repository and package revisions differed. The
packages were not installed or executed.

## Package comparison

| Package and inspected version   | Evidence and relevant behavior                                                                                                                                                                                                  | Difference from the Orbis contract                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@narumitw/pi-plan-mode` 0.57.1 | The question tool accepts one to three questions with two to four options. Its shared questionnaire selects custom TUI or sequential RPC dialogs. The README describes question tabs, answer revision, notes, and final review. | Results contain answers or cancellation and options use indexes. The inspected result contract does not supply Orbis's main-agent clarification exchange or shared browser question state. Tool restrictions and implementation routes add responsibilities Orbis excludes.                 |
| `@dreki-gg/pi-plan-mode` 0.40.0 | The README describes model switching, a persistent execution ledger, progress tracking, and HTML prototypes. Source confirms a token-protected loopback HTTP/SSE prototype server.                                              | The server accepts GET only; browser feedback is copied for pasting into Pi. Artifact viewing does not implement browser question or approval submission. Its execution workflow exceeds Orbis's planning responsibility.                                                                   |
| `@burneikis/pi-plan` 2.0.0      | Published source saves plan files and offers execute, refine, edit, and cancel dialogs. Execution can start through a fresh-session prompt; a resumed path can use the current session.                                         | Cancel deletes the current plan file. Orbis instead requires resumable cancellation, exact-revision approval, and notification without implementation kickoff. Browser rounds were not established in the inspected source.                                                                 |
| `@ifi/pi-plan` 0.5.1            | Published source registers `set_plan`, custom-TUI `request_user_input`, and research/steering tools using its subagent runtime.                                                                                                 | The inspected question result collects answers without a distinct main-agent clarification result. Published peers use older Pi package identities; current Orbis compatibility was not tested. The published package's advertised source directory is absent from current repository HEAD. |

These packages are available through `pi install npm:<package-name>`. Availability
does not establish compatibility with the installed Orbis toolchain. Download or
star rankings were not established, and the comparison does not claim community
consensus or an exhaustive inventory.

## Source and release boundaries

### Narumitw

The npm `gitHead` and inspected repository HEAD agree at
`1b96c32bda85f496e5512ba79b94f871ebf9f0bd`. The package depends on
`@narumitw/pi-tui-kit`. Its package entry is generated `dist/index.ts`; using a
source checkout requires its build step. The
[question-tool source](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-plan-mode/src/question-tool.ts),
[questionnaire dispatcher](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-tui-kit/src/questionnaire.ts),
and [README](https://github.com/narumiruna/pi-extensions/blob/1b96c32bda85f496e5512ba79b94f871ebf9f0bd/packages/pi-plan-mode/README.md)
support the comparison. Registry metadata:
[`@narumitw/pi-plan-mode`](https://registry.npmjs.org/@narumitw%2fpi-plan-mode/0.57.1).

### Dreki

The npm `gitHead` and inspected repository HEAD agree at
`065d82000a990222082b82711f40012f2b07699b`. Runtime dependencies include Taskman,
its command sandbox, Effect, and TypeBox. Its
[prototype server](https://github.com/jalbarrang/pi-plan-mode/blob/065d82000a990222082b82711f40012f2b07699b/extensions/plan-mode/prototypes/server.ts)
and [phase transitions](https://github.com/jalbarrang/pi-plan-mode/blob/065d82000a990222082b82711f40012f2b07699b/extensions/plan-mode/phase-transitions.ts)
establish the transport and execution boundaries. The
[README](https://github.com/jalbarrang/pi-plan-mode/blob/065d82000a990222082b82711f40012f2b07699b/README.md)
recommends separate questionnaire and subagent packages. Registry metadata:
[`@dreki-gg/pi-plan-mode`](https://registry.npmjs.org/@dreki-gg%2fpi-plan-mode/0.40.0).

### Burneikis

The published revision is `b57c70b79296b56cb1ed5f1b5207d6661f9acd26`; inspected
repository HEAD is `bf6365411fdd8813c609754329863e79a22655dd`. The comparison was
checked against the published tarball instead of treating HEAD as the release.
The manifest requires Pi `>=0.84.0`.
[Published source](https://github.com/burneikis/pi-plan/blob/b57c70b79296b56cb1ed5f1b5207d6661f9acd26/index.ts),
[tarball](https://registry.npmjs.org/@burneikis/pi-plan/-/pi-plan-2.0.0.tgz), and
[registry metadata](https://registry.npmjs.org/@burneikis%2fpi-plan/2.0.0).

### Ifi

The [0.5.1 tarball](https://registry.npmjs.org/@ifi/pi-plan/-/pi-plan-0.5.1.tgz)
depends on `@ifi/pi-shared-qna` and `@ifi/pi-extension-subagents` 0.5.1. Its peers
use `@mariozechner/pi-*` and `@sinclair/typebox`. The registry advertises
`packages/plan` in `ifiokjr/oh-pi`, but that directory is absent from inspected
[repository HEAD](https://github.com/ifiokjr/oh-pi/tree/7ed1c265f8aa4fbe57941405acbd17105639ec56).
The tarball remains evidence of the published package; the source mismatch limits
maintenance and compatibility conclusions.
[Registry metadata](https://registry.npmjs.org/@ifi%2fpi-plan/0.5.1).

## Official plan-mode example

Pi 0.85.1 includes a plan-mode example in the installed package. Fresh upstream
source at `6160683a4a8012f0d1cd30c145df18b4ca6f5176` disables write tools, filters
Bash, extracts numbered plan steps, persists state, and tracks completed steps.
An execution choice sends an implementation prompt. Its questionnaire is a
separate tool. This is a shipped example with a broader planning/execution
workflow, not a built-in implementation of the Orbis contract.
[Example source](https://github.com/earendil-works/pi/blob/6160683a4a8012f0d1cd30c145df18b4ca6f5176/packages/coding-agent/examples/extensions/plan-mode/index.ts)

## Design implications

The inspected packages provide concrete examples of terminal questionnaires,
planning state, execution handoff, and browser artifact viewing. They do not
establish a package satisfying the complete Orbis workflow; this conclusion is
limited to the versions and source paths inspected.

Narumitw answers the RPC question directly: a planning extension can support Pi
RPC by implementing a separate dialog path. Dreki illustrates why a local HTTP
server is not sufficient evidence of browser question submission. Neither
observation requires Orbis to adopt an RPC client or an execution ledger.

The remaining Orbis work is the specified combination: shared browser/terminal
draft state, stable revisions, clarification through the main agent, explicit
round submission, and approval followed by persistence and an event. Runtime
compatibility, keyboard behavior, recovery, and model adherence remain unverified.
