# Checkpoints

## Contents

- When to publish
- What to publish
- Where to publish and how to correct
- After publication
- Packet format
- Resolve the Model row
- Example

## When to publish

For authorized issue-backed work, the orchestrator publishes a checkpoint at each Stage transition,
at a blocked or interrupted handoff, and at delivery.

- A checkpoint covers delegated assignments, the orchestrator's own bounded work, and reviews with
  no findings. An intermediate assignment does not get its own comment.
- The request's explicit scope limits also apply to publication.
- Keep a brainstorm checkpoint private until the developer approves the complete design.
- For other work, publish when the checkpoint is reached instead of deferring every record to the
  end of the session. If a sudden process termination prevents publication, report the gap when
  resuming.

## What to publish

Author a summary from the work and verified results, or verify a separately authored delegate packet
before publishing it. Do not publish raw session logs, delegate replies, tool-call dumps, or private
deliberation. Scale the detail to the work: a clean review may need only its scope, verdict, checks,
and remaining obligations. Group related packets in one comment when practical, keeping each
packet's attribution and outcome.

## Where to publish and how to correct

Publish on the issue that owns the work. Link from a parent or related issue when needed instead of
duplicating packets. Comments are append-only by workflow convention, although GitHub permits edits
and deletion. Correct or supersede a finding in a new comment that links the earlier record and
states what changes. Edit or delete historical records only on explicit developer instruction.

## After publication

1. Keep the returned comment ID and URL, and verify the stored body.
2. If a write has an uncertain result, locate the stable checkpoint ID before retrying, and do not
   append duplicates. Use bounded metadata retrieval to find candidate comments, then fetch their
   bodies as needed.
3. During an outage, keep the unpublished draft locally and report the publication gap. Publish it
   when access returns, without inventing missing evidence.

An unpublished draft is not a shared handoff, and a checkpoint does not transfer unpushed code to
another machine.

## Packet format

A packet is the authored summary that a checkpoint publishes. Start it with
`## Checkpoint: <stable-id>`. Choose the identifier before publication and reuse it when checking an
uncertain write. Follow the heading with a metadata table that has these rows in order:

| Field      | Contents                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent      | The packet author's role or purpose, plus an agent identifier when available.                                                                                                                                                                     |
| Model      | The author's host-reported or explicitly selected model identifier, such as `gpt-6-astra` or `gpt-6.1-sol` on Codex, or `claude-opus-5-5` on Claude Code. Use `Unknown` when unavailable; do not infer it from a role name or repository default. |
| Assignment | The bounded work or handoff this packet records.                                                                                                                                                                                                  |
| Outcome    | Exactly `Completed`, `Blocked`, or `Interrupted`, describing the assignment rather than the whole issue.                                                                                                                                          |
| Revision   | The source revision examined or changed and any uncommitted scope. Use `Not applicable` for work without a repository revision, or `Unknown` when it cannot be established.                                                                       |

Agent and Model identify who authored the packet, not the account that posted the comment. When the
orchestrator summarizes a delegate's work, the orchestrator is the author; append Work agent and
Work model rows that identify the delegate under the same rules. When publishing a delegate's own
packet after verification, keep its author metadata. Do not infer authorship from who ran the GitHub
command, and do not substitute an ordinary conversation reply for an authored packet.

Follow the table with these sections:

- **Result:** the work since the previous checkpoint, findings, consequential choices, and their
  rationale. A review with no findings states its scope and verdict here.
- **Evidence:** relevant checks and conditions, distinguishing passed, failed, skipped, and
  unverified results. State outcomes, such as "`just check` passed", and include useful commands and
  shared links. Make the result understandable without ignored local files.
- **Next action:** remaining obligations, blockers, and the responsible role's next action, or None.

GitHub's comment creation timestamp records publication time. Do not add a recording timestamp, work
interval, or duration. When an observation's time affects its meaning, state that time in Result or
Evidence. Packets grouped in one comment share its timestamp.

## Resolve the Model row

Resolve Model before drafting the packet. Read the active host's session or turn metadata, or use
the explicit model selection of the delegate that authored the packet:

- **Codex:** use `CODEX_THREAD_ID` to locate the matching session under `CODEX_HOME` (normally
  `~/.codex`), then read `payload.model` from the authoring turn's `turn_context` record.
- **Claude Code:** use `CLAUDE_CODE_SESSION_ID` to locate the session transcript
  `<session-id>.jsonl` in the project's directory under `~/.claude/projects/`, then read
  `message.model` from the authoring turn's `assistant` records. A delegate's transcript is
  `<session-id>/subagents/agent-<id>.jsonl`; the `model` field in its `.meta.json` records only a
  requested override, not the model that ran.
- **Claude Code delegate:** inside a delegate, `CLAUDE_CODE_SESSION_ID` names the parent session and
  `CLAUDE_CODE_CHILD_SESSION=1` is set. A delegate authoring its own packet uses its explicit model
  selection: the spawn call's model override or, without one, the `model` field of its agent
  definition.

For a retrospective packet, use that turn's model, not a later selection. Inspect only identity
metadata, and do not publish session logs. Use `Unknown` only when metadata and explicit selection
are both unavailable, and state the lookup gap in Evidence. A repository default alone does not
establish the model used for a turn.

## Example

Replace the example values with observed facts.

```markdown
## Checkpoint: example-review-1

| Field      | Value                              |
| ---------- | ---------------------------------- |
| Agent      | Correctness reviewer               |
| Model      | gpt-6-astra                        |
| Assignment | Review the accumulated change set. |
| Outcome    | Completed                          |
| Revision   | Unknown                            |

### Result

State the findings or a clean review verdict, with its scope.

### Evidence

State what was inspected or checked and what remains unverified.

### Next action

Name the remaining action and responsible role, or write None.
```
