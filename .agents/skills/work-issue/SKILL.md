---
name: work-issue
description:
  Start, resume, or continue an Orbis issue, a PR, or a direct request, including plain requests
  such as "Resume #12", "Resume PR #34", or "continue this ticket". Resolve and classify the target,
  route each stage to a specialist skill or delegate, and deliver through review and a PR. Excludes
  status-only questions, read-only reviews, and general questions.
---

# Work on an Orbis issue, PR, or request

This skill is the entry point for development work and the only skill that starts another repository
skill. It starts the work, routes each stage to one specialist skill or delegate, and delivers the
result. A specialist skill returns an outcome; this skill chooses the next action from it.

## 1. Start the work

Before any edit, follow [starting-work.md](../../shared/starting-work.md). Classify with the work
paths and Stage values in [work-paths.md](../../shared/work-paths.md), and apply the labels in
[github-markdown.md](../../shared/github-markdown.md) to every issue and PR the work creates or
changes.

## 2. Route the next action

Choose the first row that matches the classified work. Invoke each specialist skill named here by
name, as the `AGENTS.md` routing table lists.

| Situation                                                                                                                            | Next action                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified PR awaits developer review or merge                                                                                         | Report the PR, its recorded verification, and the remaining developer action                                                                                                                            |
| Linked delivery merged                                                                                                               | Compare the merged delivery with the target's acceptance criteria, then select the next unblocked child within the target's scope                                                                       |
| Target outcome complete                                                                                                              | Report completion without expanding into sibling issues                                                                                                                                                 |
| The requested scope is complete                                                                                                      | If repository changes remain undelivered, go to step 4. Otherwise, report the results and the authorization that the next activity needs                                                                |
| Code or PR needs corrections                                                                                                         | Resume its branch and any PR, send accepted implementation findings to `orbis-implementer`, then go to step 4                                                                                           |
| Dependency refresh or newly supported strict checks                                                                                  | Invoke `update-toolchain`                                                                                                                                                                               |
| Direct request on the PR-only path                                                                                                   | Create a work branch. If the `AGENTS.md` routing table matches a specialist skill, such as `write-readme` for a README, invoke it. Otherwise, have each file's editor make the edits. Then go to step 4 |
| Issue-backed: new package, or a SPEC that is unfinished or lacks approval                                                            | Invoke `design-package`                                                                                                                                                                                 |
| Issue-backed: existing package behavior changes                                                                                      | Invoke `revise-package`                                                                                                                                                                                 |
| Issue-backed: approved contract without a current executable plan, and the developer requested planning or authorized implementation | Invoke `plan-implementation`                                                                                                                                                                            |
| Issue-backed: the plan's Design section awaits developer approval                                                                    | Present the section to the developer for approval, and keep implementation blocked until the developer approves it                                                                                      |
| Issue-backed: approved contract and current plan, unblocked, with implementation authorized                                          | Delegate the next bounded task and its acceptance checks to `orbis-implementer` under [delegation.md](../../shared/delegation.md)                                                                       |

When a specialist skill returns, choose the next action from its outcome:

| Outcome                 | Next action                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done                    | Reclassify from the new state and route again                                                                                                                                                         |
| Needs design            | Invoke `design-package`                                                                                                                                                                               |
| Needs contract revision | Invoke `revise-package`                                                                                                                                                                               |
| Needs a plan            | Invoke `plan-implementation`                                                                                                                                                                          |
| Blocked                 | If the blocker is a decision that needs the developer, settle it through the global `brainstorm` skill and route again. Otherwise, report the blocker and continue independent work within the target |

While routing:

- Follow [authorization.md](../../shared/authorization.md). Continue authorized implementation after
  planning without requesting authorization again. For issue-backed work, when the current request
  grants authorization, treat an older handoff that says authorization was not yet requested as
  history, and record the current authorization in the Current handoff.
- When a decision needs the developer, settle it through the global `brainstorm` skill. Keep
  dependent work blocked until it is settled, and continue only independent authorized work within
  the target.
- For issue-backed work, update the issue's plan when discoveries change the approach, and amend
  approved requirements before implementing changed behavior.
- For an epic or initiative, select an unfinished child based on its dependencies, approved
  priority, and existing active work. Do not restart completed design or duplicate current plans.
- Integrate returned work before starting another task that touches the same files.

## 3. Pause and record

1. For an unconfirmed brainstorm, keep pending decisions private and report the approval still
   needed in chat, under [brainstorm-records.md](../../shared/brainstorm-records.md).
2. For issue-backed work, publish checkpoints under [checkpoints.md](../../shared/checkpoints.md),
   and update the Current handoff table under the editing rules in `work-paths.md`. For a brainstorm
   checkpoint, write its Result section under `brainstorm-records.md`.
3. For PR-only work, the PR is the record. If the work stops before a PR exists, report the branch
   and next action in chat.
4. Record a lasting decision where [decisions.md](../../shared/decisions.md) places it.

## 4. Verify and deliver

1. Run the global `review-changes` skill with `mode=apply` on the accumulated change set, under
   [review.md](../../shared/review.md).
2. If the PR delivers brainstorm results for issue-backed work, apply the publication checks in
   `brainstorm-records.md` first, and report missing history or publication gaps.
3. Prepare delivery on a work branch against the default branch. Write the commit and PR drafts in
   `.artifacts/`, audit them, and publish with `--body-file` under the rules in
   `github-markdown.md`, including a closing line for every issue the PR completes.
4. Leave the PR open for developer review and merge.

Report the issue and PR links, verified outcomes, remaining blockers, and any remote setup or update
that could not be verified. Never infer delivery from an issue closed as not planned or from a child
progress count.
