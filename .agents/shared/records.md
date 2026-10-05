# Records

Records let the developer or another session resume and audit work. Each surface has one job: the
repository stores current state, issues and the Project store progress records, and the wiki stores
repository-wide decision records (ADRs).

## Contents

- Write GitHub text
- Checkpoints
- Decision records
- The wiki
- Local evidence

## Write GitHub text

These rules apply to issue and PR bodies, comments, and Project items.

- Name a decision by its meaning, such as "use Pi session entries as authoritative storage", not by
  a conversation question number or option letter.
- Do not cite counts or sizes of repository artifacts, such as requirement, test, file, line, or
  word counts. Write "every requirement has a conformance scenario", not "eight requirements have
  scenarios". Identifiers, versions, commit-pinned links, and runtime measurements with the revision
  they measured are not counts.
- Draft in ignored `.artifacts/` files. Write each paragraph or list item on one physical line, and
  keep structural newlines for headings, lists, tables, and code blocks. Do not run a reflow
  formatter on drafts, and pass the destination and this line rule to every prose auditor.
- A PR body states the outcome, the acceptance criteria, and the verification run against its head
  commit. For PR-only work, it is the whole record.
- Publish with `--body-file`, then verify the stored body. Correct current bodies when needed; do
  not reformat historical comments.

## Checkpoints

A checkpoint is an issue comment with an authored packet. For authorized issue-backed work, the
orchestrator publishes one when work stops with obligations another session must resume, at
delivery, and as the decision record of an approved brainstorm.

- Author the packet from verified results. Do not publish raw logs, tool output, delegate replies,
  or private deliberation, and scale the detail to the work.
- Publish on the issue that owns the work, and link it from related issues instead of copying it.
  Point the handoff table's Checkpoint row at the packet the next session needs.
- Comments are append-only. Correct a packet in a new comment that links the earlier one, and edit
  or delete history only on explicit developer instruction.
- After an uncertain write, search for the packet's stable ID before retrying. During an outage,
  keep the draft local and report the publication gap.

```markdown
## Checkpoint: <stable-id>

| Field      | Value                                                      |
| ---------- | ---------------------------------------------------------- |
| Agent      | <author role and identifier>                               |
| Model      | <author model>                                             |
| Assignment | <the bounded work this packet records>                     |
| Outcome    | <Completed, Blocked, or Interrupted>                       |
| Revision   | <examined commit and uncommitted scope, or Not applicable> |

### Result

### Evidence

### Next action
```

- Choose the stable ID before publishing.
- Agent and Model name the packet's author, not the account that posts it. When the orchestrator
  summarizes a delegate's work, add Work agent and Work model rows for the delegate.
- Model is the identifier the host reports in the author's session context, such as
  `claude-opus-5-5`, or a delegate's explicit model selection. Write `Unknown` when neither is
  available; do not infer it from a role name or repository default.
- Result states the work, findings, and consequential choices with their rationale. Evidence
  separates passed, failed, skipped, and unverified checks. Next action names the remaining
  obligations and the responsible role, or None.
- Do not add timestamps or durations; state an observation's time only when it changes its meaning.

## Decision records

Write a decision record when a choice creates or replaces a lasting constraint whose rationale the
SPEC or code would lose. Keep routine adjustments in checkpoints.

- A package without a stable release, meaning no published version at 1.0.0 or later, keeps its
  records as comments on its owning delivery issue. Repository-wide constraints and decisions for a
  stable package go to the wiki.
- An approved brainstorm in issue-backed work publishes one consolidated record after contract
  reconciliation: a checkpoint whose Result has a table with the columns Decision, Alternatives
  explored, Outcome and rationale, and Follow-up. Cover every substantive question, alternative, and
  deferral, and state missing history. Link it as the approval link in the issue's Authorization row
  and from any PR.
- Summarize in plain words. Distinguish developer reasons from agent recommendations, keep rejected
  and deferred paths with their reconsideration conditions, and link research instead of copying it.
  An unanswered question is not a rejection.
- Before proposing options on a recorded topic, read its records and reuse their findings. Reopen a
  choice only for new evidence, changed constraints, or developer request, and link the earlier
  record.
- Supersede a record with a new one that links it and moves the superseded approach into its
  alternatives. A historical choice does not override the current contract.

## The wiki

The wiki at <https://github.com/kvnxiao/orbis/wiki> stores ADRs. Its Home page indexes each record
with a link, a "Read when" condition, the decision, and its status.

- Read the wiki only before creating, reopening, or superseding a repository-wide or stable-package
  decision. The repository states the current rules; the wiki explains them. Fetch pages directly,
  such as `curl -s https://raw.githubusercontent.com/wiki/kvnxiao/orbis/Home.md`.
- To publish, clone or refresh `git@github.com:kvnxiao/orbis.wiki.git` with plain `git` over SSH,
  setting an HTTPS `origin` to the SSH URL first. Edit the page and its index row, inspect the diff,
  audit the prose, and push to `master` without force. Publishing approved decision records is
  authorized within the task.
- If SSH authentication fails, keep the edit local and report the gap. Do not create keys, start a
  login, or change Git or SSH configuration.

## Local evidence

- Keep scratch work, logs, and run evidence in ignored `.artifacts/` or
  `packages/<name>/implementation/` directories.
- Do not keep a second authoritative local plan, and do not publish raw logs without the developer's
  opt-in. Reconcile an older local plan with the current scope before publishing from it.
- Put reusable conclusions from a retrospective where their scope requires, link the checkpoint
  evidence, and state the history examined and its gaps.
