# Starting work

Resolve the target, read its current state, classify the work, and load the rules before any edit.
`work-issue` runs these steps first. A specialist skill that the developer invokes directly runs
them before its own steps.

## Contents

- Read the decision index
- Query GitHub with explicit fields
- Resolve the target
- Read the current state
- Classify and state
- Load the rules

## 1. Read the decision index

At the start of substantive work, read the
[wiki decision index](https://github.com/kvnxiao/orbis/wiki) once. Open each record whose "Read
when" condition matches the work, and compare its constraints with current source and runtime
versions before relying on it. If GitHub is unavailable, report the gap and continue independent
local work.

## 2. Query GitHub with explicit fields

Request metadata first, then read selected records with explicit `--json` fields:

```sh
agent-gh issue list -R OWNER/REPO --state open --json number,title,state,url --limit 30
agent-gh issue view NUMBER -R OWNER/REPO --json number,title,state,body,parent,subIssues,blockedBy,blocking
agent-gh pr view NUMBER -R OWNER/REPO --json number,title,state,url,body,headRefName,headRefOid,isDraft,reviewDecision,latestReviews,closingIssuesReferences
agent-gh issue list -R OWNER/REPO --state all --search "<PR number or branch> in:body" --json number,title,state,url
```

The last command finds the issue whose Current handoff Work row records a PR or branch.

- Do not request comments during routine selection or resumption. Bare `agent-gh issue view` can
  fetch the latest comment, and filtering `--json comments` with `--jq` still fetches every comment
  body.
- Fetch a checkpoint only when current records leave a specific question unanswered, a finding needs
  its supporting evidence, or the developer requests a retrospective. Request a known comment alone:

  ```sh
  agent-gh api repos/OWNER/REPO/issues/comments/COMMENT_ID --jq '{id,html_url,body,created_at,updated_at}'
  ```

- When the comment ID is unknown, page comment metadata through GraphQL without the `body` field,
  then fetch the selected bodies. For a retrospective, set the issue and time scope first and report
  incomplete coverage. Issue search returns issues, not comments, and is not exhaustive.
- Reuse a read this session already made while its scope and revision are unchanged. Reread after an
  edit, conflicting evidence, or an external change, and reread remote state before writing to it.

## 3. Resolve the target

Resolve an unqualified `#number` against `kvnxiao/orbis`. Honor an explicit GitHub URL or
repository-qualified reference, and clarify only when the target remains materially ambiguous.
Inspect the working tree and branch, then resolve the target by its kind:

- **Issue:** work on that issue.
- **PR:** read its state and closing issues. A closing issue is one that merging the PR closes, such
  as one named by a `Closes #<number>` line. Resume on the first match:
  1. Its closing issue. When the PR closes several, use the one whose Work row records the PR, or
     else the most specific one, such as a task rather than its epic.
  2. An issue whose Work row records the PR or its branch.

  An ordinary reference without a closing keyword does not select an issue. A PR that matches
  neither continues on the PR-only path.

- **Branch:** resolve its PR and continue as a PR target. For a branch without a PR, resume on the
  issue that the request names or whose Work row records the branch. Otherwise, resume it as PR-only
  work interrupted before a PR existed.
- **Package or other direct request:** search open and closed issues for one that already tracks the
  request. Resume on a matching open issue. Treat a closed match as delivered context without
  reopening its scope. Otherwise, the target is a direct request without an issue.

## 4. Read the current state

Read the delivery state first. For issue-backed work, read the issue body, its Current handoff, and
its sub-issue metadata. For the target or linked PR, read its state, draft status, head commit,
review decision, latest reviews, closing issues, and body.

The work awaits developer review when all of these hold:

- The PR is open and is not a draft.
- The PR has no requested changes or unaddressed developer feedback.
- A recorded passing verification covers the PR's current head and the current authorized scope.
- The branch has no unpushed or uncommitted changes.
- The request, the issue's scope, and its Current handoff leave no agent-owned work. For PR-only
  work, the request and the PR body leave none.
- For issue-backed work, the PR closes the issue and each of its unfinished descendants.

When the work awaits developer review, skip the remaining reads, classify the work, and report the
developer's remaining action. Otherwise, continue:

1. Read the issue's relationship metadata, then the related bodies that establish scope, readiness,
   or acceptance: its parent, open blockers, and, for an epic or initiative, its unfinished children
   and their blockers. Read completed children only to establish completion or when a current plan
   depends on their results.
2. Before brainstorming a topic, read its published decision summary and records. Reuse settled
   choices and prior exploration. Recover missing context from public evidence without inventing
   options or approval.
3. Read the affected SPEC and interaction contract, then current source and tests. Compare approved
   decisions with the contract, and identify stale open questions or pending amendments. Keep
   provisional contract changes in chat or private scratch until the developer confirms the complete
   design. For workspace work without a SPEC, use the request and repository constraints.
4. When an issue exists, compare its recorded baseline with relevant changes since then.

Preserve unrelated files and concurrent work. Keep developer-approved behavior, execution
authorization, and remaining verification distinct.

## 5. Classify and state

Classify the work on one work path.

- **Issue-backed:** derive the Stage from issue relationships, dependencies, the Current handoff,
  approval evidence, the contract, source, tests, and linked PRs. When the work awaits developer
  review, the delivery state alone establishes the Review Stage. Board status, checklists, and an
  old handoff do not prove readiness or completion on their own. Use exactly one Stage value, and
  keep blockers, authorization, and Project status in their own fields.
- **PR-only:** a direct request that the PR-only path covers. Do not assign a Stage or create an
  issue, issue plan, or Current handoff.
- **New issue:** a direct request that introduces, improves, or changes package behavior gets an
  issue and continues as issue-backed. Before creating it, confirm that its deliverable is distinct
  from the existing contract and issue plans, and state how its acceptance differs from existing
  work. A host-compatibility refinement or an existing guarantee belongs in the SPEC, and a library
  choice belongs in the existing plan. Keep a small request in one issue, and create children only
  for independent execution or delivery. Apply its labels, add it to
  [Project 1](https://github.com/users/kvnxiao/projects/1), and verify membership. Discover the
  Project's field and option IDs instead of embedding them.

State the classification, its evidence, the next bounded action, and who executes it: the
orchestrator, `orbis-implementer`, or the developer for a review or merge. Restate the assessment
when the contract, plan, implementation, or PR state changes.

## 6. Load the rules

Load the rules skills for the work's domain before any edit.
