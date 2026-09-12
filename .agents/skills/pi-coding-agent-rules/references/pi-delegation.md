# Pi delegation

## Define a child task's authority and owner (Conditional)

When a harness delegates work, give the child a bounded objective, expected result, working
directory, and permitted tools and resources. Pass the relevant instructions and evidence; do not
assume a separate session inherits the parent's conversation or effective permissions. Enforce the
authorized scope through the execution environment. Delegation does not grant additional authority.

Assign an owner to each child and define whether parent cancellation, session replacement, or
shutdown cancels it or transfers it to another owner. A child that may outlive the parent needs a
way to retrieve status, deliver its result, and request any required approval. A failed child must
not disappear from the parent's completion accounting. Apply the
[background-task contract](pi-lifecycle.md#track-background-work-independently-of-its-ui-conditional).

## Coordinate shared writes across agents (Conditional)

Separate model contexts do not isolate files. For agents that modify the same checkout, assign
non-overlapping ownership or coordinate the complete mutation. When independent edits need
isolation, use separate workspaces or worktrees and define who integrates the results. Worktrees
still share Git metadata and can share external services; do not treat them as security sandboxes.
[Git worktree boundaries](https://git-scm.com/docs/git-worktree#_details).

Before accepting a child's code changes, check their base revision and the current target state.
Preserve unrelated user changes and resolve conflicts explicitly. Run the checks required by the
integrated result; passing checks on separate child changes does not prove their combination.

## Verify results before reporting delegated completion (Conditional)

Require the child result to distinguish completed work, artifacts, checks performed, unresolved
work, and failures. Treat a child's summary as a report to verify against the required artifacts or
observable outcome. Starting a child, receiving progress, or receiving a final message does not by
itself prove the task succeeded. Bound child concurrency and aggregate work under the
[automatic-continuation rules](pi-lifecycle.md#bound-automatic-continuation-conditional).

Test child failure, parent cancellation, stale results, concurrent writes, and missing approval UI
through the orchestration boundary. Verify that a child cannot broaden permissions and that the
parent does not report success while required child work remains unfinished.
