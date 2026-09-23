# Development workflow

Orbis tracks shared work in [GitHub Issues](https://github.com/kvnxiao/orbis/issues) and the
[Orbis Project](https://github.com/users/kvnxiao/projects/1). Package SPECs define approved
behavior; issues contain implementation plans. The
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) links consequential choices
and the constraints behind them.

A **checkpoint** records a completed agent assignment or a blocked or interrupted handoff. Each
checkpoint contains one or more authored artifacts summarizing the work and its results, published
as issue comments. The issue body contains the compact current plan and handoff; checkpoint comments
preserve the work history.

## Start or resume work

Ask to resume an issue, for example `Resume #<number>` or `Continue work on <issue URL>`. The
[work-issue](../.agents/skills/work-issue/SKILL.md) skill is the entry point for the whole
development workflow; the request does not need a skill name or lifecycle stage. Resolve bare issue
numbers against the current repository and honor explicit repository references.

Determine the current stage from the issue and related work, approval records, SPEC, source,
verification evidence, and linked PRs. State the stage, supporting evidence, and next bounded action
before proceeding. When an approved SPEC lacks executable plans, create or update issue plans; when
plans exist, select the next eligible task; when work or a PR is underway, resume it. Reassess after
each completed action instead of replaying a fixed sequence. Project status alone does not establish
readiness or completion.

A request to resume work authorizes ordinary continuation within the specified issue's approved
scope, including implementation when its prerequisites are satisfied. Preserve applicable explicit
design-only, planning-only, and review-only limits. Resolve missing design approval and material
decisions before dependent work; retain separate authorization for merge, publication, and
live-model checks. A status question requests a report, not execution. Direct requests to specialist
skills retain their stated scope.

Record the stage, approval and execution scope, active work, evidence, next action, and blockers in
the issue's current handoff. At the start of a new session, verify that handoff against current
artifacts before continuing. Keep the issue as the shared record; do not introduce a separate
lifecycle-state file.

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
gh api repos/OWNER/REPO/issues/comments/COMMENT_ID --jq '{id,html_url,body,updated_at}'
```

When the comment ID is unknown, request bounded pages of comment metadata through GraphQL without
the `body` field, then fetch selected bodies. Filtering `--json comments` with `--jq` still fetches
comment bodies. For a retrospective, set the issue and time scope before paging through its
comments; report incomplete coverage. GitHub issue search returns matching issues, not individual
comment records, and does not establish an exhaustive history.

At the start of substantive repository work, read the decision index once and open records relevant
to the affected package or mechanism. Compare historical constraints with current source and runtime
versions before relying on them. If GitHub is unavailable, report the missing context and continue
independent local work; do not claim that remote records were read or updated.

## Agent models

Use the following models for repository software development. The Astra orchestrator owns decisions
and verification; the Sol implementer executes bounded work from approved plans.

| Responsibility                                                                              | Model         | Selection                                                     |
| ------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| Orchestration, research, design, SPECs, implementation plans, and verification coordination | `gpt-6-astra` | Main session or an explicitly selected Astra delegate         |
| Approved implementation, tests, and fixes from accepted review findings                     | `gpt-6-sol`   | `orbis-implementer` custom agent                              |
| Correctness, simplification, conformance, and other reviews that do not edit files          | `gpt-6-astra` | `orbis-reviewer` custom agent                                 |
| Documentation updates and prose audits that may edit files                                  | `gpt-6-astra` | Explicit model selection with the skill's scoped write access |

The repository [Codex configuration](../.codex/config.toml) selects Astra for new main sessions and
as the default subagent model. The [implementer](../.codex/agents/orbis-implementer.toml) and
[reviewer](../.codex/agents/orbis-reviewer.toml) definitions select their models and
responsibilities. These defaults use `xhigh` reasoning for orchestration and review, and `high` for
implementation. Keep model configuration in these files; specialist skills refer to this policy.

Codex must trust the repository to load its project configuration. An explicit launch option or
managed host can override the defaults. Configuration changes apply to new sessions and do not
switch an existing orchestrator's model. Before starting software development, use an Astra session
or explicitly delegate development decisions to Astra; do not claim that a skill changes the active
model.

When the host exposes custom agent selection, select the role for the task. When it exposes model
overrides instead, pass the role's exact model and reasoning effort when spawning the delegate and
include its responsibilities in the handoff. On hosts where a full-history fork inherits the parent
model, use a fresh or bounded-history context for a model override. Do not rely on a role name in
the prompt to select a model. If the required model or delegation is unavailable, report the
limitation and obtain a developer choice before substituting another model for that role.

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

Before delegating implementation, the Astra orchestrator resolves the contract and selects an
authorized, unblocked issue. Give the Sol implementer:

- The issue, repository baseline, approved scope, and execution authorization.
- Relevant SPEC requirement IDs, interaction scenarios, and repository constraints; for workspace
  work without a SPEC, provide the approved request and acceptance criteria.
- The concrete plan, files it may edit, dependencies, and concurrent work it must preserve.
- Observable outcomes, required checks, and the report needed for review.

The implementer may make routine choices within the plan, write code and tests, run targeted checks,
and repair accepted findings. Before dependent edits, the implementer returns unresolved behavior,
material architectural choices, and scope changes to Astra. The implementer does not delegate
further or take ownership of contract approval, final verification, commits, or PR delivery. Keep
design-only and planning-only work with Astra until implementation is authorized.

### Review and delivery

The Astra orchestrator inspects the returned diff and runs `verify-changes` once on the accumulated
change set. Select Astra for each review delegate, including the documentation and prose passes;
give read-only reviewers the `orbis-reviewer` role. Pass scoped write permissions to documentation
and prose delegates instead of using the read-only role. Reviewers follow their assigned skill and
return findings without recursively delegating or coordinating another verification workflow.

Resolve findings with Astra and send bounded implementation repairs to Sol. Recheck the affected
behavior after repairs, then let Astra prepare the audited commit and PR drafts and complete
delivery. Developer approval and merge checkpoints remain those defined in this workflow.

Codex documents
[custom agents and model selection](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and
[configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence).

## Work hierarchy

An **initiative** is a bounded delivery represented by an ordinary issue. It can cover an
extension's initial delivery or a functionality facet. A **work issue** is an independently
executable outcome within that initiative. Small changes can use one issue without children.
Checklists hold smaller steps that do not need separate ownership or delivery.

| Record                                       | Contents                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Package SPEC and linked interaction contract | Current approved behavior and conformance scenarios                                                        |
| Initiative issue                             | Outcome, approved scope and SPEC baseline, requirement coverage, shared constraints, integrated acceptance |
| Work issue                                   | Requirement contribution, concrete approach, dependencies, acceptance checks, current handoff              |
| Checkpoint comments                          | Authored work summaries, findings, verification, and unresolved obligations                                |
| Project item                                 | Priority and coarse execution status                                                                       |
| Wiki decision record                         | Choice, constraints, alternatives, consequences, and reconsideration conditions                            |
| Optional local files                         | Scratch work, detailed logs, and run evidence                                                              |

The SPEC belongs to the package and can support successive initiatives. Link its relevant
requirements from each issue; requirements and implementation work can have many-to-many coverage.
Distinguish partial contributions from full coverage. Use native sub-issue relationships for
decomposition and blocking relationships for prerequisites. Add each tracked issue to the Project;
parent membership and fields do not establish child membership or priority.

Keep the current plan in issue bodies using the
[issue plan format](../.agents/skills/plan-implementation/references/plan-format.md). Edit the body
only when current scope, plan, acceptance criteria, authorization, stage, branch or revision,
blockers, or next action changes. Update checklist completion at meaningful task boundaries. Keep
only the checkpoint links needed to resume current work; do not grow a history index in the body.
Record findings and progress in checkpoint comments even when the body needs no change.

Batch pending body changes before a stage transition, pause, or delivery; update sooner when another
worker needs the changed plan. Do not rewrite the body after every delegate returns or merely to
refresh a timestamp. Reread before editing, preserve contributor text, and skip unchanged writes.
After an uncertain write, check remote state before retrying or creating another issue.

## Publish checkpoint artifacts

Within authorized shared work, the orchestrator publishes a checkpoint after every completed agent
assignment, including its own bounded work and reviews with no findings, and at blocked or
interrupted handoffs. Preserve explicit local-only, chat-only, and read-only publication limits. A
status-only request does not authorize a checkpoint comment. Publish when the checkpoint is reached
instead of deferring all records until the session ends. A sudden process termination may prevent
publication; report any resulting gap when resuming.

Author a summary from the work and verified results. Do not copy conversation turns, delegate
responses, tool-call dumps, or raw JSONL into the journal. Record conclusions and their supporting
rationale, not private deliberation. Scale detail to the work: a clean review may need only its
scope, verdict, checks, and remaining obligations. Group related artifacts in one comment when
practical, retaining each assignment's attribution and outcome.

Each checkpoint records:

- A stable checkpoint ID chosen before publication, the assignment, responsible agent or role, and
  completion, blocked, or interrupted status.
- UTC recording time, observed work interval or measured duration when available, and an explicit
  unknown for unmeasured time. Do not reconstruct time spent from comment timestamps.
- The source revision and scope examined or changed. Identify uncommitted work explicitly.
- Work performed, findings, consequential choices and their rationale, and verification results.
  Distinguish passed, failed, skipped, and unverified checks; include useful commands and
  conditions.
- Unresolved obligations, blockers, next action, and relevant issue, PR, commit, or artifact links.
  Include enough evidence to understand the result without access to ignored local files.

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

For commits and PRs, complete repository verification before preparing and auditing delivery drafts.
Review ordinary checkpoint prose within the publishing assignment; a separate audit assignment is
not required. Publish issue and PR bodies and comments with `--body-file`, preserving the draft's
bytes. Verify the stored body after publication. Correct current bodies when needed; do not
bulk-reformat historical comments.

## Authorization and checkpoints

Within an authorized task, agents may create and update relevant issues, project items, concise
handoffs, and wiki records of approved decisions. Implementation authorization includes preparing
commits on a work branch, pushing that branch, and opening PRs after repository verification.
Developers review and merge PRs. Agents do not merge, push directly to the default branch, publish
packages, or create releases without separate explicit authorization.

A design-only or planning-only request authorizes its shared deliverables and, when useful, a
design-only PR. It does not authorize runtime implementation. SPEC approval, permission to
implement, and readiness to merge remain distinct. Record the scope and source of existing developer
approval; an agent-written summary, issue assignment, Project status, or community suggestion does
not grant additional authority.

Resolve routine implementation choices and fix verification failures autonomously. Ask about
material unresolved behavior, conflicting requirements, or scope changes before dependent work.
Continue unaffected work while waiting. Separate live-model checks retain their explicit
authorization and supervision requirements.

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
independent review. The initiative persists across these PRs.

Draft PRs share unfinished work. Design approval does not approve code added later. Before
requesting merge, run `verify-changes` on the accumulated change set, resolve scoped findings, and
audit the commit and PR drafts. Match each PR to a coherent reviewable outcome.

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

Keep repository auto-closing enabled and the Project's **Item closed → Done** workflow enabled.
Merging into the default branch then closes the linked issues and updates their Project status. Do
not manually close implementation issues before merge. For a completed investigation without a PR,
close its issue after recording the accepted outcome. On resumption, reconcile issue state and
delivery links rather than replaying completed work.

## Decisions and local evidence

Write a wiki decision record when a choice creates or replaces a lasting constraint and its
consequential rationale would be lost from the current SPEC or code. Routine task adjustments stay
in checkpoint comments, with current plan changes reflected in the issue body. Record observed
failed attempts separately from untested alternatives.

Keep each record concise: decision and status, affected scope, constraints, meaningful alternatives,
consequences, reconsideration conditions, and relevant issue or PR links. Use descriptive page
names. The Decisions index contains scope, a one-sentence choice or constraint, status, and a page
link. Preserve superseded records with replacement links. A historical choice does not override the
current approved contract or authorize a new requirement.

The wiki has its own Git repository. Refresh it before editing, inspect the diff, audit the prose,
and push only the intended pages and index changes. On a concurrent update, reconcile the changes;
do not force-push. Wiki publication of approved decision summaries is authorized within the task.

After a retrospective, put reusable conclusions and approved consequential decisions in the wiki,
linking the checkpoint evidence and stating the history examined and its gaps. Keep the checkpoint
artifacts on their work issues. A retrospective does not authorize new package requirements.

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
