# Checkpoint packets

A checkpoint packet is an authored summary of the assignments completed since the previous
checkpoint, or of a blocked or interrupted handoff. The development workflow's
[checkpoint policy](../../../../docs/development-workflow.md#publish-checkpoint-artifacts) defines
when to publish a packet and how to correct or retrieve one; this reference defines the packet.

Start each packet with `## Checkpoint: <stable-id>`. Choose the identifier before publication and
reuse it when checking an uncertain write. Use a metadata table with these required rows in order:

| Field | Contents |
| --- | --- |
| Agent | The packet author's role or purpose, plus an agent identifier when available. |
| Model | The author's host-reported or explicitly selected model identifier, such as `gpt-6-astra` or `gpt-6-sol`. Use `Unknown` when unavailable; do not infer it from a role name or repository default. |
| Assignment | The bounded work or handoff this packet records. |
| Outcome | Exactly `Completed`, `Blocked`, or `Interrupted`, describing the assignment rather than the whole issue. |
| Revision | The source revision examined or changed and any uncommitted scope. Use `Not applicable` for work without a repository revision, or `Unknown` when it cannot be established. |

Resolve Model before drafting the packet. Read the active host's session or turn metadata, or use
the explicit model selection for the delegate that authored it. On Codex hosts with local session
records, use `CODEX_THREAD_ID` to locate the matching session under `CODEX_HOME` (normally
`~/.codex`), then read `payload.model` from the authoring turn's `turn_context` record. For
retrospective packets, use that turn's model rather than a later selection. Inspect only the
identity metadata; do not publish session logs. Use `Unknown` only when the relevant metadata and
explicit selection cannot be obtained, and state the lookup gap in Evidence. A repository default
alone does not establish the model used for a turn.

Agent and Model identify who authored the packet, not the account that posted the comment. When an
orchestrator summarizes a delegate's work, the orchestrator is the author; append Work agent and Work
model rows identifying the delegate under the same naming rules. When publishing a separately
authored delegate packet after verification, retain its author metadata. Do not infer authorship
from who ran the GitHub command or substitute an ordinary conversation reply for an authored packet.

Follow the table with these sections:

- **Result:** work performed since the previous checkpoint, findings, consequential choices, and
  their supporting rationale. A review with no findings states its scope and verdict here.
- **Evidence:** relevant checks and conditions, distinguishing passed, failed, skipped, and
  unverified results. Include useful commands and shared links; make the result understandable
  without ignored local files.
- **Next action:** remaining obligations, blockers, and the responsible role's next action, or None.

GitHub's comment creation timestamp records publication time. Do not add a recording timestamp, work
interval, or duration to the packet. When an observation's time affects its meaning, state that time
in Result or Evidence. Packets grouped in one comment share its publication timestamp.

Use this structure, replacing the example values with observed facts.

```markdown
## Checkpoint: example-review-1

| Field | Value |
| --- | --- |
| Agent | Correctness reviewer |
| Model | gpt-6-astra |
| Assignment | Review the approved change set. |
| Outcome | Completed |
| Revision | Unknown |

### Result

State the findings or a clean review verdict, with its scope.

### Evidence

State what was inspected or checked and what remains unverified.

### Next action

Name the remaining action and responsible role, or write None.
```
