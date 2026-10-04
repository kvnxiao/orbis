# Development workflow

Orbis tracks shared work in [GitHub Issues](https://github.com/kvnxiao/orbis/issues) and the
[Orbis Project](https://github.com/users/kvnxiao/projects/1). Package SPECs define approved
behavior, issues contain implementation plans, and the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki/Decisions) links repository-wide
constraints and the rationale behind them. [`AGENTS.md`](../AGENTS.md) states the rules every task
follows, including the start protocol; this document defines the procedures those rules invoke.

## Roles and terms

Three roles appear throughout this document. The **developer** approves designs, resolves material
decisions, and merges PRs. The **orchestrator** is the main agent session that owns decisions,
coordination, and verification. A **delegate** executes bounded work that the orchestrator assigns:
the `orbis-implementer` agent implements approved work, reviewer agents return findings, and
documentation delegates edit documentation. [Delegation](#delegation) defines their limits and
models.

These terms recur:

- A **direct request** asks for a development change without naming an issue or PR as its target,
  such as a package fix or a documentation update.
- An issue's **Stage** is its current required activity, such as Design, Planning, or
  Implementation, recorded in the issue's Current handoff table. The issue plan format defines the
  [Stage values](../.agents/skills/plan-implementation/references/plan-format.md#stage-values).
- A **checkpoint** is an authored record of the assignments completed since the previous checkpoint,
  or of a blocked or interrupted handoff, published as an issue comment. The issue body contains the
  compact current plan and handoff; checkpoint comments preserve the work history.
- A **decision record** preserves a lasting choice and its rationale.
  [Decisions and local evidence](#decisions-and-local-evidence) defines its contents and location.
- A package has a **stable release** once it publishes a version at 1.0.0 or later.
- `agent-gh` runs every agent GitHub CLI command, as the
  [`AGENTS.md` commands](../AGENTS.md#commands) require.
- `verify-changes` is a global skill, installed outside this repository, that verifies an
  accumulated change set with review and checks scaled to the change's risk.

## Work paths

Every development request follows one of two paths. The path determines where the plan and the
shared record live:

- The **issue-backed path** covers work that introduces, improves, or changes package behavior. An
  issue tracks the work, and its body and checkpoint comments are the shared record.
- The **PR-only path** delivers a direct request through a PR without an issue. It covers a direct
  request for one of these changes:
  - A change that keeps observable behavior within a package's approved contract, such as a fix, a
    behavior-preserving refactor, or a test change. Implementing a SPEC requirement that the code
    lacks introduces behavior and takes the issue-backed path.
  - A documentation change
  - A workspace tooling change

PR-only work uses the approved request, current source, and any existing PR as inputs and creates no
issue, issue plan, or handoff table. The PR body records the outcome, acceptance, and verification,
and the PR is the shared record another session resumes from. If PR-only work is interrupted before
a PR exists, report the branch and next action in chat.

An existing issue always takes precedence over the PR-only path:

- Resume work already tracked by an issue on that issue, even when its remaining change would
  otherwise qualify for the PR-only path.
- Resume a PR or branch on the issue that tracks it, which the
  [target resolution](../.agents/skills/work-issue/SKILL.md#resolve-the-target) steps select.
- When investigation shows that a direct request changes package behavior, create or reuse an issue
  for it before dependent work.

Both paths share the same roles and two `AGENTS.md` rules: the
[executor rule](../AGENTS.md#start-a-session) in start protocol step 5 and the
[verification requirement](../AGENTS.md#verify-and-deliver). Because `verify-changes` scales its
review to risk, a small change still passes through it.

## Start or resume work

Ask to start, resume, or continue work, for example `Resume #<number>`, `Resume PR #<number>`,
`Continue work on <issue or PR URL>`, or a direct request. The request needs no skill name or
lifecycle stage. The start protocol in `AGENTS.md` invokes the
[work-issue](../.agents/skills/work-issue/SKILL.md) skill, the entry point for the whole development
workflow. The skill resolves the target, derives its Stage or path from current evidence, and routes
the next bounded action. Keep the issue as the shared record for issue-backed work; do not introduce
a separate lifecycle-state file.

### Retrieve current work before history

For routine discovery, request issue metadata, then read the selected issue's body and relevant
relationships with explicit fields. For example:

```sh
agent-gh issue list -R OWNER/REPO --state open --json number,title,state,url --limit 30
agent-gh issue view NUMBER -R OWNER/REPO --json number,title,state,body,parent,subIssues,blockedBy,blocking
```

For a PR target, request its state and closing issues the same way:

```sh
agent-gh pr view NUMBER -R OWNER/REPO --json number,title,state,url,body,headRefName,headRefOid,isDraft,reviewDecision,latestReviews,closingIssuesReferences
```

To find the issue whose handoff Work row records a PR or branch, search issue bodies:

```sh
agent-gh issue list -R OWNER/REPO --state all --search "<PR number or branch> in:body" --json number,title,state,url
```

Do not request comments during routine task selection or resumption. Bare `agent-gh issue view` can
fetch the latest comment; use explicit `--json` fields instead. Read linked PR state and review
decisions as needed without loading unrelated comment history.

Fetch a checkpoint only when current records leave a specific question unanswered, a finding or
decision needs its supporting evidence, or the developer requests a retrospective. Follow a direct
comment link or ID and request that comment alone:

```sh
agent-gh api repos/OWNER/REPO/issues/comments/COMMENT_ID --jq '{id,html_url,body,created_at,updated_at}'
```

When the comment ID is unknown, request bounded pages of comment metadata through GraphQL without
the `body` field, then fetch selected bodies. Filtering `--json comments` with `--jq` still fetches
comment bodies. For a retrospective, set the issue and time scope before paging through its
comments; report incomplete coverage. GitHub issue search returns matching issues, not individual
comment records, and does not establish an exhaustive history.

## Work hierarchy

An **initiative** coordinates substantial deliveries across most of the repository, such as an
Effect overhaul. An **epic** delivers a substantial package or capability through coordinated tasks.
A **task** is an independently executable, bounded outcome. Initiatives and epics are coordinating
issues. These roles describe scope rather than tree depth or effort. An epic or task can stand
alone. A parent can skip a level. A repository-wide investigation with one bounded result is a task,
and an epic can precede its children. Keep small work in one issue; do not create issues to fill
hierarchy tiers. Checklists record steps that do not need separate ownership or delivery.

| Record                                       | Contents                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Package SPEC and linked interaction contract | Current approved behavior and conformance scenarios                                                     |
| Initiative or epic issue                     | Outcome, approved scope and contract baseline, work coverage, shared constraints, integrated acceptance |
| Owning delivery issue decision comments      | Decision records for a package without a stable release                                                 |
| Task issue                                   | Requirement contribution, design, concrete approach, dependencies, acceptance checks, current handoff   |
| Checkpoint comments                          | Authored work summaries, findings, verification, and unresolved obligations                             |
| Project item                                 | Priority, Size, Estimate, and coarse execution status                                                   |
| Wiki decision record                         | Repository-wide constraints and decisions for packages with a stable release                            |
| PR                                           | Delivery summary and verification; the whole record for PR-only work                                    |
| Optional local files                         | Scratch work, detailed logs, and run evidence                                                           |

The SPEC belongs to the package and can support successive epics or initiatives. Link its relevant
requirements from each issue; requirements and implementation work can have many-to-many coverage.
Distinguish partial contributions from full coverage. Use native sub-issue relationships for
decomposition and blocking relationships for prerequisites; issue numbers do not imply execution
order. Add each tracked issue to the Project; parent membership and fields do not establish child
membership or priority.

Keep the current plan in issue bodies using the
[issue plan format](../.agents/skills/plan-implementation/references/plan-format.md), which defines
the fixed Current handoff table at the top of each body and the rules for editing the body.

### Issue labels

Every issue has exactly one `level:` label and one primary `kind:` label. Every PR has exactly one
primary `kind:` label and no `level:` label. Classify a PR by its delivered outcome rather than
copying every label from a linked issue. Apply labels when creating an issue or PR, and reconcile
them when its scope or deliverable changes. Reconcile an existing issue's labels when working on it;
leave unrelated issue content alone.

| Level label        | Scope                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| `level:initiative` | Rare, broad effort coordinating substantial deliveries across most of the repository |
| `level:epic`       | Substantial package or capability delivery coordinated through tasks                 |
| `level:task`       | Independently executable, bounded outcome                                            |

Choose the primary kind by the deliverable, regardless of files touched or the current Stage. A
feature issue in Design remains `kind:feature` when its deliverable is package behavior. Classify
design or research as the primary kind only when that work is itself the deliverable.

| Kind label      | Deliverable                                                        |
| --------------- | ------------------------------------------------------------------ |
| `kind:feature`  | Add or change package behavior                                     |
| `kind:bug`      | Correct a deviation from approved behavior                         |
| `kind:refactor` | Improve implementation while preserving behavior                   |
| `kind:design`   | Deliver an approved contract or design                             |
| `kind:research` | Investigate or evaluate a question                                 |
| `kind:docs`     | Deliver documentation or agent guidance                            |
| `kind:tooling`  | Change workspace tooling, dependencies, scaffolding, or automation |

The repository label catalog has only these ten labels; GitHub's default labels, including
`help wanted` and `good first issue`, are outside it. Report unexpected labels without changing
unrelated records. The issue handoff records Stage, blockers, and authorization. The Project records
status, priority, Size, and Estimate.

## Authorization

Within an authorized task, agents may create and update relevant issues, Project items, concise
handoffs, and decision records. Implementation authorization includes preparing commits on a work
branch, pushing that branch, and opening PRs after repository verification, within the
[delivery limits](../AGENTS.md#verify-and-deliver) in `AGENTS.md`.

A request to resume, continue, or work on an issue or PR authorizes ordinary continuation within its
approved scope, including implementation when its prerequisites are satisfied. A direct request
authorizes delivery on the PR-only path within the request's scope. When classification moves the
request to an issue, the request also authorizes ordinary continuation on that issue within the
request's scope. Each explicit scope limit stops the work at its boundary:

- A design-only or planning-only request authorizes its shared deliverables and, when useful, a
  design-only PR; it does not authorize runtime implementation.
- A review-only request returns findings without editing files or publishing to GitHub, unless the
  request asks for a posted review.
- A local-only request keeps its results in local files or commits, and a chat-only request keeps
  them in chat; neither pushes or publishes to GitHub. When such a request changes package behavior,
  keep the outcome, approach, acceptance, and handoff that an issue plan would record in that local
  or chat destination instead of creating an issue.
- A status question requests a report, not execution or a checkpoint comment.

SPEC approval, permission to implement, and readiness to merge remain distinct, and design approval
does not approve code added later. A directly invoked specialist skill retains its stated scope.

Record the scope and source of existing developer approval; an agent-written summary, issue
assignment, Project status, or community suggestion does not grant additional authority. Resolve
routine implementation choices and fix verification failures autonomously. Ask about material
unresolved behavior, conflicting requirements, or scope changes before dependent work, and continue
unaffected work while waiting. Live-model checks retain their explicit authorization and supervision
requirements.

## Design and PR boundaries

When substantive package brainstorming begins, create or reuse an issue at the intended scope once
its outcome can be named. Research and resolve the design through
[design-package](../.agents/skills/design-package/SKILL.md). Save the approved SPEC before
implementing behavior. Plans can include bounded investigations while design decisions remain open;
dependent implementation stays blocked.

For a substantial new extension, use an initial SPEC-only PR when shared design review or several
implementation efforts need an agreed baseline. State implementation availability in the SPEC. Small
deliveries can combine the SPEC and implementation in one PR. Later scoped revisions normally
combine approved SPEC amendments, code, and tests. Use a separate design PR when the decision needs
independent review. The delivery issue persists across these PRs. Draft PRs share unfinished work.

### Approve the complete design before edits

For work that needs a brainstorm, complete the discussion and obtain approval of the full design for
the requested scope before changing affected repository artifacts or publishing its decisions. Use
read-only investigation to resolve facts. Keep provisional choices, evidence, and open questions in
chat or private scratch under the [local evidence rules](#decisions-and-local-evidence). Individual
answers settle parts of the discussion; they do not authorize edits or publication.

Present the integrated design before requesting confirmation. Cover the scope, behavior and
interfaces, state and lifecycle, failure and recovery paths, limits and controls, verification, and
explicit deferrals that apply. Resolve every question that affects the requested scope; identify
out-of-scope work without making dependent work appear ready. Ask the developer to confirm this
complete picture, then wait. Preserve settled choices rather than asking each question again.

Apply this gate to new designs and revisions, including SPECs, interaction contracts, research,
plans, and implementation. Keep provisional decisions out of issue and PR bodies, comments, and wiki
records, including interruption checkpoints. At an interrupted brainstorm, report pending approval
in chat and retain private notes; a handoff or draft PR does not bypass the gate.

When explicit direction already settles the complete requested change, proceed within that scope
without inventing a brainstorm or requesting the same approval again. Full-design approval does not
expand execution or publication authority under [Authorization](#authorization).

After approval, persist any research synthesis, then update all affected requirements and
conformance scenarios together. Remove resolved open questions and update the interaction contract
before dependent implementation or decision publication. Keep the SPEC as the current behavioral
contract, research as evidence and trade-offs, and decision records as choices and rationale. Link
current summaries to requirements instead of maintaining additional versions of the contract.

If new evidence reopens a material decision, pause affected edits and publication, preserve
unaffected approvals, and confirm the complete revised scope before resuming.

## Delegation

The orchestrator keeps `work-issue` and `verify-changes` coordination, decisions, obtaining the
developer's contract approval, accumulated verification, commits, and PR delivery. Delegates execute
their assignment and return results or findings to the orchestrator. They do not delegate further,
start either coordinating workflow, or take ownership of the orchestrator's responsibilities.
Design-only and planning-only work stays with the orchestrator until implementation is authorized.

### Agent models

Each role runs on the model and reasoning effort in this table. Both hosts set reasoning effort per
agent, so effort follows the role.

| Responsibility                                                                                             | Codex model and effort                                 | Claude Code model and effort                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Orchestration, research, design, SPECs, implementation plans, and verification coordination                | `gpt-6-astra` at `xhigh`, the main session             | `claude-opus-5-5` at `xhigh`, the main session             |
| Approved implementation, tests, and fixes from accepted review findings                                    | `gpt-6-sol` at `xhigh`, `orbis-implementer`            | `claude-opus-5-5` at `high`, `orbis-implementer`           |
| Conformance review, which reads the contract and does not edit files                                       | `gpt-6-astra` at `xhigh`, `orbis-conformance-reviewer` | `claude-opus-5-5` at `xhigh`, `orbis-conformance-reviewer` |
| Correctness, repository-rule, simplification, and other assigned read-only reviews, such as a README check | `gpt-6-astra` at `xhigh`, `orbis-reviewer`             | `claude-opus-5-5` at `xhigh`, `orbis-reviewer`             |
| Documentation updates and prose audits that may edit files                                                 | `gpt-6-sol` at `high`, explicit model selection        | `claude-opus-5-5` at `high`, explicit model selection      |

The [Codex configuration](../.codex/config.toml) selects Astra at `xhigh` for new main sessions and
Sol at `high` as the default subagent model; the definitions under
[`.codex/agents/`](../.codex/agents/) select each custom agent's model, effort, and sandbox. The
[Claude Code settings](../.claude/settings.json) select the main session's model and effort, and the
definitions under [`.claude/agents/`](../.claude/agents/) select each Claude Code agent's model,
effort, and tool access. Keep model configuration in these files; `AGENTS.md` refers to this policy.

Codex must trust the repository to load its project configuration. An explicit launch option or
managed host can override the defaults. Configuration changes apply to new sessions and do not
switch an existing orchestrator's model. Do not claim that a skill changes the active model. Codex
documents
[custom agents and model selection](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and
[configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence).

When the host exposes custom agent selection, select the role for the task. When it exposes model
overrides instead, pass the role's exact model and, where the host supports it, reasoning effort
when spawning the delegate, and include its responsibilities in the handoff. On hosts where a
full-history fork inherits the parent model, use a fresh or bounded-history context for a model
override. Do not rely on a role name in the prompt to select a model. If the required model or
delegation is unavailable, report the limitation and obtain a developer choice before substituting
another model for that role.

### Skill handoffs

For each delegate, name the applicable skills, their resolved `SKILL.md` locations, and the assigned
scope. Include the `*-rules` skills loaded during the start protocol and their references whose
"Read when" conditions match the assignment. Select implementation rules and specialist review
skills from the repository's triggers and the current workflow. Resolve shared skills through the
host's skill catalog; do not assume another session has loaded their instructions. Delegates read
the assigned skills and relevant references before starting dependent work. When automatic skill
invocation is unavailable, read the files directly. If a required skill cannot be loaded, report the
gap to the orchestrator, which supplies the missing instructions or resolves the blocker.

### Implementation handoff

On both work paths, the [executor rule](../AGENTS.md#start-a-session) in `AGENTS.md` start protocol
step 5 assigns implementation edits, including small fixes within a package's contract, to
`orbis-implementer` and the remaining files it lists to the orchestrator.

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
unresolved behavior, material architectural choices, and scope changes to the orchestrator.

## Review and delivery

The orchestrator inspects each returned diff, then verifies the accumulated change set under the
[verification requirement](../AGENTS.md#verify-and-deliver). Give read-only reviewers the reviewer
roles from the [model table](#agent-models), and pass scoped write permissions to documentation and
prose delegates instead of a read-only role. Reviewers follow their assigned skill.

For design changes, compare the approved scope with the SPEC and interaction contract, even when no
runtime implementation exists. Check that:

- Each approved in-scope behavior has a requirement and conformance scenario.
- Resolved questions are removed from open lists; remaining questions concern explicit deferrals.
- Current summaries and research agree with the contract without adding requirements of their own.

Report contract inconsistencies separately from runtime verification gaps. Passing repository checks
do not establish agreement with the approved design.

Review agent instructions and configuration for correctness when changes affect routing,
authorization, delegation, checkpoints, or execution. These files govern agent behavior regardless
of their Markdown or configuration extension.

Resolve findings with the orchestrator and send bounded implementation repairs to the implementer.
While the implementer that made the change is still available, send the repairs to it. Include the
accepted findings and any changed facts, such as newly applicable rules references, and do not
resend its unchanged assignment. Give a new delegate a handoff under
[Skill handoffs](#skill-handoffs) and [Implementation handoff](#implementation-handoff) instead of
the full conversation. Recheck the affected behavior after repairs. Then write the commit and PR
drafts, audit them, and complete delivery. Match each PR to a coherent reviewable outcome.

## Publish checkpoint artifacts

For authorized issue-backed work, the orchestrator publishes a checkpoint at each stage transition,
at a blocked or interrupted handoff, and at delivery. The checkpoint covers delegated assignments,
the orchestrator's own bounded work, and reviews with no findings; an intermediate assignment does
not get its own comment. The request's explicit scope limits under [Authorization](#authorization)
also apply to publication. The
[full-design approval gate](#approve-the-complete-design-before-edits) controls brainstorm
checkpoints; keep them private until approval. For other work, publish when the checkpoint is
reached instead of deferring all records until the session ends. A sudden process termination may
prevent publication; report any resulting gap when resuming.

Author a summary from the work and verified results, or verify a separately authored delegate packet
before publishing it. For brainstorms, also preserve the explored choices and decisions under
[Publish brainstorm records](#publish-brainstorm-records). Do not publish raw session logs, delegate
replies, tool-call dumps, or private deliberation. Scale other checkpoint detail to the work: a
clean review may need only its scope, verdict, checks, and remaining obligations. Group related
artifacts in one comment when practical, retaining each packet's attribution and outcome. Use the
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

## Publish brainstorm records

For brainstorms in issue-backed work that produces or updates a PR, publish concise decision records
and a current summary as comments on the owning issue. Cover every substantive question, explored
alternative, and developer decision, including unanswered or deferred topics. Preserve enough
context for future sessions to reuse the exploration without the originating chat. Use the
[brainstorm record format](../.agents/skills/work-issue/references/brainstorm-records.md).

Before exploring a topic, read the relevant published decisions and their rationale. Reuse settled
choices and prior exploration. Reopen a decision when the developer requests it or new evidence or
changed constraints justify it, and record why. Do not repeat the exploration merely because a new
agent session lacks the local chat.

Wait for [full-design approval](#approve-the-complete-design-before-edits) and reconcile the
affected contract before publishing. Answered rounds, material clarifications, and planned handoffs
do not authorize partial records. After approval:

- Publish one consolidated record and brief current summary covering the approved scope, explored
  alternatives, and explicit deferrals.
- Link the summary from the issue body and any existing issue-backed PR. Include the link when
  creating a PR and verify it after publication. Link prior records instead of repeating them.
- State the discussion's coverage, missing history, unresolved decisions, and authorization limits.

Prefer a compact decision table or short bullets. Summarize questions and alternatives in words;
retain rationale, consequential clarifications, and reconsideration conditions. Full coverage means
preserving every substantive path, not reproducing the conversation. Do not paste entire question
rounds or repeat the full session in each checkpoint. Use the descriptive references required by
[Write GitHub Markdown](#write-github-markdown).

Apply the same approval gate to later brainstormed revisions. Keep approved updates append-only
under the [checkpoint policy](#publish-checkpoint-artifacts). Follow explicit publication limits
under [Authorization](#authorization). If publication is unavailable, retain drafts and report the
gap; do not describe local records as shared. PR-only work does not acquire an issue or
issue-comment requirement from this rule.

## Write GitHub Markdown

Use descriptive decision names and explicit outcomes in issue bodies, PR bodies, and comments,
including checkpoints on both work paths. Do not refer to questions by their conversation numbers or
to choices by option letters. Translate a local answer into its meaning, such as “use Pi session
entries as authoritative storage,” and link the decision record when more context is needed.

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

| Completion case    | Definition of done                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Implementation     | Scoped behavior is implemented, contracts and docs agree, required verification passes, and changes are merged                     |
| Design             | Material decisions are resolved and the approved contract is delivered in its shared destination; a repository design PR is merged |
| Investigation      | The stated question has supported findings and the consequence for dependent work is recorded; a negative result can complete it   |
| Initiative or epic | Required outcomes are delivered and integrated acceptance establishes coverage of the approved scope                               |

Close abandoned work as **not planned**. It may appear in Done, but do not report it as delivered or
treat it as satisfying parent acceptance. Reassess a coordinating issue's scope with the developer
when a required child is abandoned. Child completion counts do not establish conformance.

For PR-delivered work, put a separate `Closes #<number>` line in the PR body for every issue the
merge will complete. Ordinary references describe related work. A SPEC-only PR references an
implementation epic or initiative without closing it. The final delivery PR closes that issue only
when all required child outcomes are already delivered or land in that PR and integrated acceptance
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

The record's location depends on its scope. A package without a stable release keeps its decision
records as comments on its owning package delivery issue, usually an epic or sometimes an
initiative. A standalone task records its decisions without an invented parent. Implementation and
dogfooding can change these decisions. The SPEC states only the current approved behavior, and its
optional [Explored alternatives](specifications.md#explored-alternatives) section records abandoned
ideas. Repository-wide constraints, and decisions for a package with a stable release, go to the
wiki. Comments and wiki records are append-only by convention: supersede a record with a new one
that links the earlier record and states what changes, and move the superseded approach into the
record's explored alternatives.

Use descriptive wiki page names. The Decisions index contains scope, a one-sentence choice or
constraint, status, and a page link. Preserve superseded records with replacement links. A
historical choice does not override the current approved contract or authorize a new requirement.
The [session start](../AGENTS.md#start-a-session) in `AGENTS.md` defines when to read the index.

The wiki has its own Git repository. Refresh it before editing, inspect the diff, audit the prose,
and push only the intended pages and index changes. On a concurrent update, reconcile the changes;
do not force-push. Wiki publication of approved decision summaries is authorized within the task.

After a retrospective, put reusable conclusions in the record location its scope requires, linking
the checkpoint evidence and stating the history examined and its gaps. Keep the checkpoint artifacts
on their issues. A retrospective does not authorize new package requirements.

Detailed execution logs and scratch files can remain in ignored `packages/<name>/implementation/`
directories, or `.artifacts/` for repository-wide work. Do not maintain a second authoritative local
plan or publish raw logs without explicit developer opt-in. Authored checkpoint artifacts belong in
issue comments, and PRs summarize delivery verification; reusable tests and instructions remain
available from a clone. When resuming older local plans, use them as input and reconcile current
scope before publishing issue plans; do not bulk-upload historical files.

## GitHub setup

The repository's Claude Code and Codex `PreToolUse` hooks block direct `gh` commands and direct the
agent to `agent-gh`. `agent-gh` runs commands with the contributor's `gh` login unless its profile
routes them to a bot. As a one-time setup step outside agent sessions, the contributor authenticates
`gh` with `gh auth login`, then adds project access with
`gh auth refresh --hostname github.com --scopes project`. Use the supported CLI commands or
`agent-gh api` for native sub-issues and dependencies. Check the installed CLI's help before using
flags.

Each contributor selects an `agent-gh` profile in their own clone. The profile names the
contributor's GitHub App and the `run_as_bot` rules that select which commands run as the App's bot.
Configure the profile to route issue comments, PR comments, and comment-only reviews to the bot, so
checkpoint comments show the contributor's bot as their author. Issue, PR, and Project changes then
stay with the contributor's login. To set up `agent-gh` in a clone:

1. Install `agent-gh`, install a GitHub App with Issues and Pull requests write access on the
   repository, and define a profile for the App with the
   [comments configuration](https://github.com/kvnxiao/agent-gh#comments-configuration) as its
   `run_as_bot` rules.
2. Run `agent-gh self setup <profile>` in the clone to select the profile.
3. Run `agent-gh self status` and confirm that it prints the profile and its `run_as_bot` rules.

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
