# Brainstorm decision records

Read when composing a brainstorm checkpoint or backfilling missing decision context.

Preserve concise historical context under the workflow's
[brainstorm publication policy](../../../../docs/development-workflow.md#publish-brainstorm-records).
Record enough for a future session to reuse explored alternatives and decisions without repeating
the investigation. Cover every substantive path; do not reproduce the full conversation.

## Record decisions concisely

Use the [checkpoint packet](checkpoint-format.md) metadata and its Result, Evidence, and Next action
sections. Under Result, prefer a compact table with one row per decision, or short bullets when
clearer. Include brief context only when needed to understand the choice.

| Field | Content |
| --- | --- |
| Decision | A descriptive question or topic and its relevant constraint. |
| Alternatives | The meaningful approaches explored, each described briefly. |
| Outcome and rationale | The developer's selected direction and why it was chosen, or the unresolved choice. Distinguish developer reasons from agent recommendations. |
| Remaining work | Deferred or rejected paths, reconsideration conditions, dependent questions, and any approval limit. |

Summarize in plain words. Keep the caveats that affect the decision; quote exact wording only when
paraphrasing would lose meaning. Link research or an earlier record for additional evidence instead
of copying its explanation. Record consequential clarifications and changed recommendations,
including what changed and why. Preserve rejected, deferred, superseded, and open alternatives so
later sessions do not treat them as unexplored.

Use descriptive names throughout GitHub issue/PR bodies and comments. Do not reference questions by
conversation number or choices by option letter, even when the local chat used them. Expand a short
answer into the selected behavior. No numbered question list is required in a shared record.

An unanswered question is not rejected. A clarification or recommendation is not approval. A
selected direction does not approve a complete SPEC or authorize implementation. Keep research
hypotheses distinguishable from measured findings.

## Summarize and reuse

Publish a brief current summary with links to the relevant decision records. State the approved
direction, important constraints, deferred work, unresolved decisions, and the next action and owner.
For a small discussion, one comment can serve as both record and summary. For a longer discussion,
append only new decisions or changes and link earlier context; do not repeat the full history.

State whether the design is ongoing or confirmed, including the scope of confirmation. At a handoff,
a pending shared confirmation remains pending even if individual choices were approved. The issue
body and any existing issue-backed PR link to the current summary, which indexes supporting records.
Include and verify that link when publishing a new PR.

Before proposing options on an existing topic, read its summary and relevant records. Reuse their
findings and rationale. If new evidence, changed constraints, or developer direction reopens a
choice, identify that reason and link the earlier decision. Do not restart exploration solely
because the current agent lacks the original chat.

## Example comment

Use this structure as the default; the decisions below are illustrative, not package requirements.
Replace every placeholder and example fact with the actual discussion. Keep the Result introduction
short and add one table row per substantive decision. Use short bullets instead only when a table
would obscure the relationships. The normal checkpoint metadata remains required.

```markdown
## Checkpoint: storage-and-retrieval-design

| Field | Value |
| --- | --- |
| Agent | <author role and identifier> |
| Model | <verified model identifier, or Unknown with the lookup gap in Evidence> |
| Assignment | Record the storage and retrieval decisions. |
| Outcome | Completed |
| Revision | <examined commit, or Not applicable> |

### Result

Use session-backed storage for the MVP. Retrieval remains open.

| Decision | Alternatives explored | Outcome and rationale | Follow-up |
| --- | --- | --- | --- |
| Storage authority | Pi session entries; separate store. | Selected Pi entries to align memory with session retention. A separate store is deferred. | Revisit if memory must outlive Pi sessions. |
| Retrieval | Text search; vector search. | Open. The agent recommends text search for exact identifiers; comparative quality is unverified. | Developer chooses the MVP approach. |

### Evidence

The developer confirmed the storage choice; complete design approval is pending. [Storage research](<shared evidence URL>) records the retention constraints. No live-model evaluation was performed.

### Next action

Developer: settle retrieval. Orchestrator: incorporate the selected directions after the remaining design decisions are resolved.
```

For a later update, record only the new selection or changed reasoning and link the prior checkpoint.
Use its descriptive subject in the link text. Do not copy the earlier table merely to retain history.

## Publish and recover

Publish through `agent-gh` under the workflow's
[GitHub Markdown rules](../../../../docs/development-workflow.md#write-github-markdown). Use stable
checkpoint IDs, verify stored bodies, and check uncertain writes before retrying. Append corrections
or later selections with links to affected records. Follow the workflow's publication schedule and
explicit authorization limits.

When backfilling, summarize available public evidence and label missing history or uncertain
attribution. Do not invent unrecorded options, user reasons, or approvals. State coverage and gaps
under Evidence. Private deliberation, raw logs, routine progress chatter, and unauthorized private
material do not belong in decision records. Local transcripts or ignored drafts do not satisfy
shared publication.
