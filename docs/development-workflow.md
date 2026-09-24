# Development workflow

Orbis tracks shared work in [GitHub Issues](https://github.com/kvnxiao/orbis/issues) and the
[Orbis Project](https://github.com/users/kvnxiao/projects/1). Package SPECs define approved
behavior, issues contain implementation plans, and the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) links repository-wide
constraints and the rationale behind them.

Three roles appear throughout this document. The **developer** approves designs, resolves material
decisions, and merges PRs. The **orchestrator** is the main agent session or an explicitly selected
delegate that owns decisions, coordination, and verification. A **delegate** executes bounded work
that the orchestrator assigns: implementation from an approved plan, or a review that returns
findings. [Agent models](#agent-models) maps the roles to models per host.

A **checkpoint** records assignments completed since the previous checkpoint, or a blocked or
interrupted handoff, as authored artifacts published on issue-backed work. The issue body contains
the compact current plan and handoff; checkpoint comments preserve the work history.

## Work hierarchy

Work that introduces, improves, or changes package behavior is tracked in issues. A direct request
for a fix within a package's existing contract, a documentation change, or a workspace tooling
change takes the **PR-only path**: use the approved request, current source, and any existing PR as
inputs; do not create an issue, issue plan, or handoff table. The PR body records the outcome,
acceptance, and verification, and the PR is the shared record another session resumes from. If
PR-only work is interrupted before a PR exists, report the branch and next action in chat. Resume
work already tracked by an issue on that issue, even when its remaining change would otherwise
qualify for the PR-only path.

An **initiative** is a bounded delivery represented by an ordinary issue. It can cover an
extension's initial delivery or a functionality facet. A **work issue** is an independently
executable outcome within that initiative. Small changes can use one issue without children.
Checklists hold smaller steps that do not need separate ownership or delivery.

| Record                                       | Contents                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Package SPEC and linked interaction contract | Current approved behavior and conformance scenarios                                                        |
| Initiative issue                             | Outcome, approved scope and SPEC baseline, requirement coverage, shared constraints, integrated acceptance |
| Initiative decision comments                 | Decision records for a package before its first stable release                                             |
| Work issue                                   | Requirement contribution, design, concrete approach, dependencies, acceptance checks, current handoff      |
| Checkpoint comments                          | Authored work summaries, findings, verification, and unresolved obligations                                |
| Project item                                 | Priority and coarse execution status                                                                       |
| Wiki decision record                         | Repository-wide constraints and decisions for released packages                                            |
| PR                                           | Delivery summary and verification; the whole record for PR-only work                                       |
| Optional local files                         | Scratch work, detailed logs, and run evidence                                                              |

The SPEC belongs to the package and can support successive initiatives. Link its relevant
requirements from each issue; requirements and implementation work can have many-to-many coverage.
Distinguish partial contributions from full coverage. Use native sub-issue relationships for
decomposition and blocking relationships for prerequisites; issue numbers do not imply execution
order. Add each tracked issue to the Project; parent membership and fields do not establish child
membership or priority.

Keep the current plan in issue bodies using the
[issue plan format](../.agents/skills/plan-implementation/references/plan-format.md), which defines
the fixed Current handoff table at the top of each body and its editing rules. Edit plan sections
only when the plan changes, and confine routine state updates to the handoff table. Keep only the
checkpoint links needed to resume current work; record findings and progress in checkpoint comments
even when the body needs no change.

Batch pending body changes before a stage transition, pause, or delivery; update sooner when another
worker needs the changed plan. Do not rewrite the body after every delegate returns or merely to
refresh a timestamp. Reread before editing, preserve contributor text, and skip unchanged writes.
After an uncertain write, check remote state before retrying or creating another issue.

## Authorization

Within an authorized task, agents may create and update relevant issues, Project items, concise
handoffs, and decision records. Implementation authorization includes preparing commits on a work
branch, pushing that branch, and opening PRs after repository verification. Developers review and
merge PRs. Agents do not merge, push directly to the default branch, publish packages, or create
releases without separate explicit authorization.

A request to resume, continue, or work on an issue authorizes ordinary continuation within that
issue's approved scope, including implementation when its prerequisites are satisfied. Preserve
applicable explicit design-only, planning-only, and review-only limits. A design-only or
planning-only request authorizes its shared deliverables and, when useful, a design-only PR; it does
not authorize runtime implementation. SPEC approval, permission to implement, and readiness to merge
remain distinct, and design approval does not approve code added later. A status question requests a
report, not execution. Direct requests to specialist skills retain their stated scope.

Record the scope and source of existing developer approval; an agent-written summary, issue
assignment, Project status, or community suggestion does not grant additional authority. Resolve
routine implementation choices and fix verification failures autonomously. Ask about material
unresolved behavior, conflicting requirements, or scope changes before dependent work, and continue
unaffected work while waiting. Live-model checks retain their explicit authorization and supervision
requirements.

## Start or resume work

Ask to resume an issue, for example `Resume #<number>` or `Continue work on <issue URL>`. The
[work-issue](../.agents/skills/work-issue/SKILL.md) skill is the entry point for the whole
development workflow; the request does not need a skill name or lifecycle stage. Resolve bare issue
numbers against the current repository and honor explicit repository references.

For issue-backed work, determine the current stage from the issue and related work, approval
records, SPEC, source, verification evidence, and linked PRs. State the stage, supporting evidence,
and next bounded action before proceeding. When an approved SPEC lacks executable plans, create or
update issue plans; when plans exist, select the next eligible task; when work or a PR is underway,
resume it. Reassess after each completed action instead of replaying a fixed sequence. Project
status alone does not establish readiness or completion. For PR-only work, resume from the approved
request, current source, and existing PR without assigning an issue stage.

At the start of a new session on issue-backed work, verify the issue's Current handoff table against
current artifacts before continuing. Keep the issue as the shared record; do not introduce a
separate lifecycle-state file.

### Retrieve current work before history

For routine discovery, request issue metadata, then read the selected issue's body and relevant
relationships with explicit fields. For example:

```sh
gh issue list -R OWNER/REPO --state open --json number,title,state,url --limit 30
gh issue view NUMBER -R OWNER/REPO --json number,title,state,body,parent,subIssues,blockedBy,blocking
```

Do not request comments during routine task selection or resumption. Bare `gh issue view` can fetch
the latest comment; use explicit `--json` fields instead. Read linked PR state and review decisions
as needed without loading unrelated comment history.

Fetch a checkpoint only when current records leave a specific question unanswered, a finding or
decision needs its supporting evidence, or the developer requests a retrospective. Follow a direct
comment link or ID and request that comment alone:

```sh
gh api repos/OWNER/REPO/issues/comments/COMMENT_ID --jq '{id,html_url,body,created_at,updated_at}'
```

When the comment ID is unknown, request bounded pages of comment metadata through GraphQL without
the `body` field, then fetch selected bodies. Filtering `--json comments` with `--jq` still fetches
comment bodies. For a retrospective, set the issue and time scope before paging through its
comments; report incomplete coverage. GitHub issue search returns matching issues, not individual
comment records, and does not establish an exhaustive history.

## Agent models

The orchestrator runs on the host's strongest reasoning model and every delegate runs on the host's
delegate model. Both hosts set reasoning effort per agent, so effort follows the role.

| Responsibility                                                                              | Codex model and effort                               | Claude Code model and effort                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Orchestration, research, design, SPECs, implementation plans, and verification coordination | `gpt-6-astra` at `xhigh`, the main session           | `claude-fable-5-1` at `xhigh`, the main session            |
| Approved implementation, tests, and fixes from accepted review findings                     | `gpt-6-sol` at `high`, `orbis-implementer`           | `claude-opus-5-5` at `high`, `orbis-implementer`           |
| Conformance review, which reads the contract and does not edit files                        | `gpt-6-sol` at `xhigh`, `orbis-conformance-reviewer` | `claude-opus-5-5` at `xhigh`, `orbis-conformance-reviewer` |
| Correctness, simplification, and other reviews that do not edit files                       | `gpt-6-sol` at `high`, `orbis-reviewer`              | `claude-opus-5-5` at `high`, `orbis-reviewer`              |
| Documentation updates and prose audits that may edit files                                  | `gpt-6-sol` at `high`, explicit model selection      | `claude-opus-5-5` at `high`, explicit model selection      |

The [Codex configuration](../.codex/config.toml) selects Astra at `xhigh` for new main sessions and
Sol at `high` as the default subagent model; the definitions under
[`.codex/agents/`](../.codex/agents/) select each custom agent's model, effort, and sandbox. The
[Claude Code settings](../.claude/settings.json) select the main session's model and effort, and the
definitions under [`.claude/agents/`](../.claude/agents/) select each Claude Code agent's model,
effort, and tool access. Keep model configuration in these files; `AGENTS.md` refers to this policy.

Codex must trust the repository to load its project configuration. An explicit launch option or
managed host can override the defaults. Configuration changes apply to new sessions and do not
switch an existing orchestrator's model. Do not claim that a skill changes the active model.

When the host exposes custom agent selection, select the role for the task. When it exposes model
overrides instead, pass the role's exact model and, where the host supports it, reasoning effort
when spawning the delegate, and include its responsibilities in the handoff. On hosts where a
full-history fork inherits the parent model, use a fresh or bounded-history context for a model
override. Do not rely on a role name in the prompt to select a model. If the required model or
delegation is unavailable, report the limitation and obtain a developer choice before substituting
another model for that role.

### Skill handoffs

For each delegate, name the applicable skills, their resolved `SKILL.md` locations, and the assigned
scope. Select skills from the repository's triggers and the current workflow. Resolve shared skills
through the host's skill catalog; do not assume another session has loaded their instructions.
Delegates read the assigned skills and relevant references before starting dependent work. When
automatic skill invocation is unavailable, read the files directly. If a required skill cannot be
loaded, report the gap to the orchestrator, which supplies the missing instructions or resolves the
blocker.

Keep `work-issue` and `verify-changes` coordination with the orchestrator. Assign implementation
rules and specialist review skills to delegates without restarting either coordinating workflow.

### Implementation handoff

Before delegating implementation, the orchestrator resolves the contract and selects authorized,
unblocked work. Give the implementer:

- The issue for issue-backed work, or the approved request and any existing PR for PR-only work;
  include the repository baseline, approved scope, and execution authorization.
- Relevant SPEC requirement IDs, interaction scenarios, and repository constraints; for workspace
  work without a SPEC, provide the approved request and acceptance criteria.
- The issue plan for issue-backed work, or concrete task for PR-only work; include files it may
  edit, dependencies, and concurrent work it must preserve.
- Observable outcomes, required checks, and the report needed for review.

The implementer may make routine choices within the assigned work, write code and tests, run
targeted checks, and repair accepted findings. Before dependent edits, the implementer returns
unresolved behavior, material architectural choices, and scope changes to the orchestrator. The
implementer does not delegate further or take ownership of contract approval, final verification,
commits, or PR delivery. Keep design-only and planning-only work with the orchestrator until
implementation is authorized.

### Review and delivery

The orchestrator inspects the returned diff and runs `verify-changes` once on the accumulated change
set before requesting merge. Give read-only reviewers the reviewer roles from the model table, and
pass scoped write permissions to documentation and prose delegates instead of a read-only role.
Reviewers follow their assigned skill and return findings without recursively delegating or
coordinating another verification workflow.

Review agent instructions and configuration for correctness when changes affect routing,
authorization, delegation, checkpoints, or execution. These files govern agent behavior regardless
of their Markdown or configuration extension.

Resolve findings with the orchestrator and send bounded implementation repairs to the implementer.
Recheck the affected behavior after repairs. Then write the commit and PR drafts, audit them, and
complete delivery. Match each PR to a coherent reviewable outcome; developer approval and merge
remain the developer's decisions.

Codex documents
[custom agents and model selection](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and
[configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence).

## Publish checkpoint artifacts

For authorized issue-backed work, the orchestrator publishes a checkpoint at each stage transition,
at a blocked or interrupted handoff, and at delivery. The checkpoint summarizes every assignment
completed since the previous checkpoint, including the orchestrator's own bounded work and reviews
with no findings; an intermediate assignment does not get its own comment. Preserve explicit
local-only, chat-only, and read-only publication limits. A status-only request does not authorize a
checkpoint comment. Publish when the checkpoint is reached instead of deferring all records until
the session ends. A sudden process termination may prevent publication; report any resulting gap
when resuming.

Author a summary from the work and verified results, or verify a separately authored delegate packet
before publishing it. Do not copy ordinary conversation turns, delegate replies, tool-call dumps, or
raw JSONL into the journal. Record conclusions and their supporting rationale, not private
deliberation. Scale detail to the work: a clean review may need only its scope, verdict, checks, and
remaining obligations. Group related artifacts in one comment when practical, retaining each
packet's attribution and outcome. Use the
[checkpoint packet format](../.agents/skills/work-issue/references/checkpoint-format.md), which
defines the packet's identifier, metadata table, sections, and attribution rules.

Publish on the issue that owns the work. Link from a parent or related issue when needed instead of
duplicating artifacts. Comments are append-only by workflow convention; GitHub still permits edits
and deletion. Correct or supersede a finding in a new comment linking the earlier record and stating
what changes. Edit or delete historical records only on explicit developer instruction.

After publication, retain the returned comment ID and URL and verify the stored body. If a write has
an uncertain result, locate the stable checkpoint ID before retrying; do not append duplicates. Use
bounded metadata retrieval to locate candidate comments, then fetch their bodies as needed. During
an outage, retain an unpublished draft locally and report the publication gap. Publish it when
access returns without inventing missing evidence. An unpublished draft is not a shared handoff, and
a checkpoint does not transfer unpushed code to another machine.

## Write GitHub Markdown

For issue bodies, issue comments, PR bodies, and PR comments, write each prose paragraph or list
item on one physical line and let the browser wrap it. Preserve structural newlines for headings,
lists, tables, and code blocks. Do not insert column-width breaks, trailing double spaces, or HTML
breaks to wrap prose.

Prepare publication drafts in ignored `.artifacts/` files. Pass the destination and this no-reflow
rule to every prose auditor. Do not run Markdown reflow or a width-enforcing formatter on these
drafts. Oxfmt excludes `.artifacts/**` and wraps Markdown in the files it formats. When adapting
tracked prose for GitHub, join its artificial line breaks without flattening Markdown structure or
changing code blocks.

Publish issue and PR bodies and comments with `--body-file`, preserving the draft's bytes, and
verify the stored body after publication. Review ordinary checkpoint prose within the publishing
assignment; a separate audit assignment is not required. Correct current bodies when needed; do not
bulk-reformat historical comments.

## Design and PR boundaries

When substantive package brainstorming begins, create or reuse an initiative once its intended
outcome can be named. Research and resolve the design through
[design-package](../.agents/skills/design-package/SKILL.md). Save the approved SPEC before
implementing behavior. Plans can include bounded investigations while design decisions remain open;
dependent implementation stays blocked.

For a substantial new extension, use an initial SPEC-only PR when shared design review or several
implementation efforts need an agreed baseline. State implementation availability in the SPEC. Small
deliveries can combine the SPEC and implementation in one PR. Later scoped revisions normally
combine approved SPEC amendments, code, and tests. Use a separate design PR when the decision needs
independent review. The initiative persists across these PRs. Draft PRs share unfinished work.

## Status and completion

| Project status | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| Backlog        | Candidate work awaiting prioritization or a decision to begin                             |
| Ready          | Approved scope and prerequisites permit execution; execution still requires authorization |
| In progress    | Design, investigation, or implementation is underway                                      |
| In review      | The issue's complete delivery is ready for developer review                               |
| Done           | Issue is closed; its completion reason distinguishes delivery from abandonment            |

Record a blocker and its resolving decision or prerequisite on the issue without adding a status. A
parent remains In progress while only some child outcomes are in review. Avoid inferring readiness
from a draft PR or completion from a locally passing test suite.

| Issue role     | Definition of done                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Implementation | Scoped behavior is implemented, contracts and docs agree, required verification passes, and changes are merged                     |
| Design         | Material decisions are resolved and the approved contract is delivered in its shared destination; a repository design PR is merged |
| Investigation  | The stated question has supported findings and the consequence for dependent work is recorded; a negative result can complete it   |
| Initiative     | Required outcomes are delivered and integrated acceptance establishes the scoped requirement coverage                              |

Close abandoned work as **not planned**. It may appear in Done, but do not report it as delivered or
treat it as satisfying parent acceptance. Reassess an initiative's scope with the developer when a
required child is abandoned. Child completion counts do not establish conformance.

For PR-delivered work, put a separate `Closes #<number>` line in the PR body for every issue the
merge will complete. Ordinary references describe related work. A SPEC-only PR references an
implementation initiative without closing it. The final delivery PR closes the initiative only when
all required child outcomes are already delivered or land in that PR and integrated acceptance
passes. List each delivered issue explicitly; do not rely on parent or child closure cascading.

Merging into the default branch closes the linked issues and updates their Project status through
the automation that [GitHub setup](#github-setup) enables. Do not manually close implementation
issues before merge. For a completed investigation without a PR, close its issue after recording the
accepted outcome. On resumption, reconcile issue state and delivery links rather than replaying
completed work.

## Decisions and local evidence

A decision record preserves a choice, its status and scope, the constraints behind it, the
meaningful alternatives, its consequences, its reconsideration conditions, and relevant issue or PR
links. Write one when a choice creates or replaces a lasting constraint and its rationale would be
lost from the current SPEC or code. Routine task adjustments stay in checkpoint comments, with
current plan changes reflected in the issue body. Record observed failed attempts separately from
untested alternatives.

The record's location depends on its scope. A package without a stable release, meaning no published
version at 1.0.0 or later, keeps its decision records as comments on its initiative issue, because
implementation and dogfooding are expected to change them. The SPEC states only the current approved
behavior; its optional [Explored alternatives](specifications.md#explored-alternatives) section
lists each abandoned idea with the reason; later planning reads it before proposing approaches.
Repository-wide constraints, and decisions for a package with a stable release, go to the wiki.
Comments and wiki records are append-only by convention: supersede a record with a new one that
links the earlier record and states what changes, and move the superseded approach into the record's
explored alternatives.

Use descriptive wiki page names. The Decisions index contains scope, a one-sentence choice or
constraint, status, and a page link. Preserve superseded records with replacement links. A
historical choice does not override the current approved contract or authorize a new requirement. At
the start of substantive repository work, read the index once, open the records for the affected
package or mechanism, and compare their constraints with current source and runtime versions before
relying on them.

The wiki has its own Git repository. Refresh it before editing, inspect the diff, audit the prose,
and push only the intended pages and index changes. On a concurrent update, reconcile the changes;
do not force-push. Wiki publication of approved decision summaries is authorized within the task.

After a retrospective, put reusable conclusions in the record location its scope requires, linking
the checkpoint evidence and stating the history examined and its gaps. Keep the checkpoint artifacts
on their work issues. A retrospective does not authorize new package requirements.

Detailed execution logs and scratch files can remain in ignored `packages/<name>/implementation/`
directories, or `.artifacts/` for repository-wide work. Do not maintain a second authoritative local
plan or publish raw logs without explicit developer opt-in. Authored checkpoint artifacts belong in
issue comments, and PRs summarize delivery verification; reusable tests and instructions remain
available from a clone. Explicit requests can retain local or chat-only planning. When resuming
older local plans, use them as input and reconcile current scope before publishing issue plans; do
not bulk-upload historical files.

## GitHub setup

Use `gh` for issues, Projects, and PRs. Authenticate with `gh auth login`, then add project access
with `gh auth refresh --hostname github.com --scopes project`. Use the supported CLI commands or
`gh api` for native sub-issues and dependencies. Check the installed CLI's help before using flags.

Keep the existing Project columns. Native auto-add for `repo:kvnxiao/orbis is:issue` is optional;
agents explicitly add their issues and verify membership. In the Project menu, open **Workflows**
and enable **Item closed** with Status **Done**. In repository **Settings → General → Issues**,
enable **Auto-close issues with merged linked pull requests**. Verify these settings in GitHub
rather than assuming their defaults. Use issues as the board's work records and linked PRs for
review.

Enable the repository wiki and create its first page on GitHub before cloning
`https://github.com/kvnxiao/orbis.wiki.git`. Keep editing restricted to collaborators. When Git uses
an interactive credential helper, use `gh`'s Git credential helper for that invocation rather than
starting another login or changing global credentials.

GitHub documents
[sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues),
[PR closing links](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue),
[Project workflows](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations),
and
[wiki editing](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages).
