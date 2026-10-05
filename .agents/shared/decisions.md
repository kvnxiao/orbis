# Decision records and local evidence

A decision record preserves a choice, its status and scope, the constraints behind it, the
meaningful alternatives, its consequences, its reconsideration conditions, and relevant issue or PR
links. Write one when a choice creates or replaces a lasting constraint and its rationale would be
lost from the current SPEC or code. Keep routine task adjustments in checkpoint comments, and
reflect current plan changes in the issue body. Record observed failed attempts separately from
untested alternatives.

## Where a record lives

- A package without a stable release keeps its decision records as comments on its owning package
  delivery issue, usually an epic and sometimes an initiative. A standalone task records its
  decisions without an invented parent.
- Repository-wide constraints, and decisions for a package with a stable release, go to the wiki.
- The SPEC states only the current approved behavior. Its optional Explored alternatives section
  records abandoned ideas; implementation and dogfooding can change decisions.

Comments and wiki records are append-only by convention. Supersede a record with a new one that
links the earlier record and states what changes, and move the superseded approach into the new
record's explored alternatives. A historical choice does not override the current approved contract
or authorize a new requirement.

## Publish to the wiki

The wiki home page is the decision index. Give each page a descriptive name, and give each index
row:

- A link to the record.
- A "Read when" condition that names the work needing the full record, so readers can skip records
  that do not apply.
- The one-sentence decision or constraint.
- The record's status.

Preserve superseded records with links to their replacements. To publish:

1. Clone or refresh `git@github.com:kvnxiao/orbis.wiki.git` with plain `git` over SSH, not through
   `agent-gh` or `gh`'s Git credential helper. If an existing clone's `origin` uses HTTPS, set it to
   the SSH URL first.
2. Edit the pages and index, inspect the diff, and audit the prose.
3. Push only the intended changes directly to the wiki's `master` branch. On a concurrent update,
   reconcile the changes; do not force-push.

If SSH authentication fails, keep the wiki edit local and report the gap. Do not create keys, start
a login, or change global Git or SSH configuration. Wiki publication of approved decision summaries
is authorized within the task.

## Retrospectives

After a retrospective, put reusable conclusions in the record location their scope requires, linking
the checkpoint evidence and stating the history examined and its gaps. Keep checkpoint packets on
their issues. A retrospective does not authorize new package requirements.

## Local evidence

Keep detailed execution logs and scratch files in ignored `packages/<name>/implementation/`
directories, or in `.artifacts/` for repository-wide work.

- Do not maintain a second authoritative local plan, and do not publish raw logs without explicit
  developer opt-in.
- Authored checkpoint packets belong in issue comments, PRs summarize delivery verification, and
  reusable tests and instructions stay available from a clone.
- When resuming an older local plan, use it as input and reconcile the current scope before
  publishing issue plans. Do not bulk-upload historical files.
