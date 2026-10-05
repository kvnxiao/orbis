# Design approval and brainstorm records

## Contents

- Approve the complete design before edits
- Publish brainstorm records
- Record decisions
- Example record
- Reuse and recover

## Approve the complete design before edits

When work settles decisions through the global `brainstorm` skill, finish the discussion and obtain
the developer's approval of the full design for the requested scope before changing affected
repository artifacts or publishing its decisions.

1. Resolve facts through read-only investigation.
2. Keep provisional choices, evidence, and open questions in chat or private scratch. Individual
   answers settle parts of the discussion; they do not approve the design or permit edits or
   publication.
3. Present the integrated design. Cover the scope, behavior and interfaces, state and lifecycle,
   failure and recovery paths, limits and controls, verification, and explicit deferrals that apply.
   Resolve every question that affects the requested scope, and identify out-of-scope work without
   making dependent work appear ready.
4. Ask the developer to confirm this complete picture, then wait. Preserve settled choices instead
   of asking each question again.
5. After approval, persist any research synthesis. Then update all affected requirements and
   conformance scenarios together, remove resolved open questions, and update the interaction
   contract before dependent implementation or decision publication.

Apply this gate to new designs and revisions, including SPECs, interaction contracts, research,
plans, and implementation. Keep provisional decisions out of issue and PR bodies, comments, and wiki
records, including interruption checkpoints. At an interrupted brainstorm, report the pending
approval in chat and keep private notes; a handoff or draft PR does not bypass the gate.

- When explicit direction already settles the complete requested change, proceed within that scope
  without inventing a brainstorm or requesting the same approval again.
- Full-design approval does not expand execution or publication authority.
- If new evidence reopens a material decision, pause affected edits and publication, preserve
  unaffected approvals, and confirm the complete revised scope before resuming.

Keep the SPEC as the current behavioral contract, research as evidence and trade-offs, and decision
records as choices and rationale. Link current summaries to requirements instead of maintaining
other versions of the contract.

## Publish brainstorm records

For a brainstorm in issue-backed work that produces or updates a PR, publish concise decision
records and a current summary as comments on the owning issue. This rule does not require an issue
or issue comments for PR-only work.

After full-design approval and contract reconciliation:

1. Publish one consolidated record and a brief current summary covering the approved scope, explored
   alternatives, and explicit deferrals. Cover every substantive question, alternative, and
   developer decision, including unanswered or deferred topics.
2. Link the summary from the issue body and any existing issue-backed PR. Include the link when
   creating a PR, and verify it after publication.
3. State the discussion's coverage, missing history, unresolved decisions, and authorization limits.

Answered rounds, material clarifications, and planned handoffs do not authorize partial records.
Apply the same gate to later brainstormed revisions, and keep approved updates append-only. If
publication is unavailable, keep drafts and report the gap; do not describe local records as shared.

## Record decisions

A record is a checkpoint packet. Under its Result section, prefer a compact table with one row per
decision, or short bullets when clearer. Add brief context only when needed to understand a choice.

| Field                 | Content                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision              | A descriptive question or topic and its relevant constraint.                                                                                  |
| Alternatives explored | The meaningful approaches explored, each described briefly.                                                                                   |
| Outcome and rationale | The developer's selected direction and why it was chosen, or the unresolved choice. Distinguish developer reasons from agent recommendations. |
| Follow-up             | Deferred or rejected paths, reconsideration conditions, dependent questions, and any approval limit.                                          |

- Summarize questions and alternatives in plain words. Keep the caveats that affect a decision, and
  quote exact wording only when paraphrasing would lose meaning.
- Keep rationale, consequential clarifications, changed recommendations, and reconsideration
  conditions. Preserve rejected, deferred, superseded, and open alternatives so later sessions do
  not treat them as unexplored.
- Full coverage means preserving every substantive path, not reproducing the conversation. Do not
  paste question rounds or repeat the full session in each checkpoint.
- Link research or an earlier record for more evidence instead of copying its explanation, and keep
  research hypotheses distinguishable from measured findings.
- An unanswered question is not rejected, and a clarification or recommendation is not approval.

## Example record

The decisions below are illustrative, not package requirements. Replace every placeholder and
example fact with the actual discussion.

```markdown
## Checkpoint: storage-and-retrieval-design

| Field      | Value                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| Agent      | <author role and identifier>                                            |
| Model      | <verified model identifier, or Unknown with the lookup gap in Evidence> |
| Assignment | Record the storage and retrieval decisions.                             |
| Outcome    | Completed                                                               |
| Revision   | <examined commit, or Not applicable>                                    |

### Result

The developer approved the complete MVP storage and retrieval design. The
[memory requirements](<shared SPEC requirement URL>) specify its behavior.

| Decision          | Alternatives explored               | Outcome and rationale                                                                                     | Follow-up                                            |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Storage authority | Pi session entries; separate store. | Selected Pi entries to align memory with session retention. A separate store is deferred.                 | Revisit if memory must outlive Pi sessions.          |
| Retrieval         | Text search; vector search.         | Selected text search for exact identifiers; vector search is deferred. Comparative quality is unverified. | Revisit if semantic retrieval becomes a requirement. |

### Evidence

The developer confirmed the integrated design after reviewing its behavior, limits, and failure
paths. [Storage research](<shared evidence URL>) records the retention constraints. No live-model
evaluation was performed.

### Next action

Orchestrator: verify and deliver the approved SPEC changes. Runtime implementation remains outside
this design-only request.
```

For a small discussion, one comment can serve as both record and summary. For a later update, record
only the new selection or changed reasoning, and link the prior checkpoint by its descriptive
subject instead of copying its table.

## Reuse and recover

- Before proposing options on an existing topic, read its summary and relevant records, and reuse
  their findings and rationale. Reopen a choice only when the developer requests it or new evidence
  or changed constraints justify it; state that reason and link the earlier decision. Do not restart
  exploration merely because a new session lacks the original chat.
- When backfilling, summarize available public evidence, and label missing history or uncertain
  attribution. Do not invent unrecorded options, developer reasons, or approvals. State coverage and
  gaps under Evidence.
- Private deliberation, raw logs, routine progress chatter, and unauthorized private material do not
  belong in decision records. Local transcripts or ignored drafts do not satisfy shared publication.
