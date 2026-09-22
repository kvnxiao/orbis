# Effective session continuity

Effective continuity means that an agent continues the intended work across repeated context
reductions and user steering without losing applicable constraints, reviving superseded plans, or
mistaking incomplete work for completion. The objective is to minimize work-relevant loss within a
bounded prompt. Exact reproduction of the entire conversation is neither attainable nor required.

Research dates: 2026-09-12 and 2026-09-21. The evaluation design below is a proposal for this
package, informed by primary engineering reports and the
[model-quality evidence](evidence-and-evaluation.md). It does not report an implemented extension or
measured improvement.

## Priority order

Continuation quality comes first. Simplicity, acting-agent ceremony, total token cost, and
foreground waiting come next. A smaller checkpoint that causes repeated mistakes or requires the
user to reconstruct the task has not achieved the primary objective.

Simplicity has several independent costs: extension code, auxiliary inference, acting-agent tool
calls, user intervention, and maintenance of competing representations. A field produced inside an
existing observation call can add output tokens without adding a tool round for the acting agent.
Whether that field improves continuation still needs measurement.

The architecture should use comparative continuation and cost data to select the next experiment. A
tier count, compression ratio, or number of successful memory writes cannot substitute for the
quality of the next action.

## What continuation must retain

| Work state                        | Failure to detect                                                                         | Observable continuation check                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Operative objective and scope     | A steering round is mistaken for a new unrelated task, or the original task is abandoned. | The next action advances the latest agreed objective and retains earlier requirements that still apply.       |
| Active constraints and exclusions | An old prohibition disappears during consolidation.                                       | The agent applies the prohibition before the governed action, even after distracting turns.                   |
| Supersession and corrections      | An old preference or abandoned approach returns as current.                               | A later correction controls the next decision; historical material is identified as historical.               |
| Pending and paused work           | An unfinished subtask disappears or completed work is repeated.                           | The agent resumes the appropriate obligation and distinguishes confirmed completion from intention.           |
| Decisions and failed attempts     | A known dead end is retried without new evidence.                                         | The agent uses the recorded outcome or recalls its source before deciding to repeat the approach.             |
| Artifacts and verification state  | An attempted edit or test is remembered as successful.                                    | The agent identifies the actual artifact state and checks current files when stored information may be stale. |
| Missing or conflicting evidence   | The agent invents a detail or asks the user to repeat an available fact.                  | The agent recalls relevant evidence or reports that the source is unavailable or inconclusive.                |

These are semantic outcomes. The observer's prompt can request them, but structural validation
cannot prove that its prose captures them correctly or that the acting model will apply them.

## Mechanical invariants and semantic outcomes

The inspected [memory implementations](observational-memory-comparison.md) and
[Pi lifecycle](pi-compaction.md) motivate the candidate mechanisms below. These are design
implications of the source analysis, not additional package requirements or measured improvements.

| Boundary          | Candidate mechanism                                                                     | Remaining quality question                                                     |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Source processing | Completion records distinguish committed spans from gaps.                               | Did the observer select the information needed later?                          |
| Persistence       | Retained originals provide evidence beyond generated summaries.                         | Can the agent find and interpret the relevant original?                        |
| Consolidation     | Durable revision boundaries separate accepted output from interrupted writes.           | Did consolidation preserve current commitments and distinguish obsolete facts? |
| Scope             | Lineage-specific snapshots separate session state from project knowledge.               | Does a historical project fact still apply to the current checkout?            |
| Curation          | Revision checks and deletion records expose stale proposals and old evidence.           | Does the surviving note express the intended correction clearly?               |
| Compaction        | Shared preparation and outcome handling reduce differences between native entry points. | Does the accepted checkpoint support correct continuation?                     |
| Budgets           | Finite input, output, queue, and wait limits bound auxiliary work.                      | Is the allocation large enough for useful continuity with the selected model?  |
| Authority         | Attribution distinguishes recalled evidence from current instructions.                  | Does the model recognize the distinction in a difficult continuation?          |

Passing invariant tests establishes the tested state transitions and protocol behavior. It does not
establish lossless extraction, useful recall, or improved coding performance. Conversely, a good
benchmark score does not excuse a stale write, hidden processing gap, or incorrect cancellation.

## Evidence from coding harnesses

Factory's December 2025 evaluation probes factual recall, artifacts, continuation, and decisions
after compression of production coding conversations. It reports that artifact tracking remains weak
across the compared methods. Its useful lesson is the evaluation target: work-relevant details and
total task cost matter more than compression ratio. The report uses an LLM judge and does not
establish a public, independent Pi benchmark or prove that a structured summary always preserves
intent. [Context-compression evaluation](https://factory.ai/news/evaluating-compression).

Anthropic's November 2025 long-running-agent report describes incomplete handoffs and premature
completion despite compaction. Its proposed harness combines progress artifacts, incremental work,
and verification. This supports testing resumption and actual completion, but it does not require
this memory extension to own a task planner or automatically commit repository work. The report is
an engineering account of a specific harness, not an isolated memory-policy experiment.
[Long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Anthropic's context-engineering guidance treats compaction, persistent notes, and selective
retrieval as complementary techniques. Those techniques reduce prompt pressure while retaining
access to relevant state; their combination still requires selection and validation.
[Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

## Comparative evaluation

Before comparing implementations, declare the task set, continuation horizon, steering schedule,
models, context budgets, scoring criteria, and run limits. The horizon includes multiple
compactions, changes of direction, interruptions, and returns to paused work; it must not be
represented as a proof about arbitrarily many future turns.

Use paired tasks with the same acting model, repository revision, tools, and source history:

- Native Pi with the extension unloaded establishes the required baseline.
- The selected design runs from session start with isolated stores and all auxiliary work counted.
- An optional native-Pi-plus-recall variant isolates retrieval value.
- An optional observations/topics variant without the protected note isolates its contribution.
- An optional oracle-evidence condition supplies the small set of relevant original facts directly
  and estimates how much error remains in the acting model after memory selection is corrected.

Score actual continuation actions and repository acceptance checks. A verbal answer about the next
step is supporting evidence, not a substitute for taking that step correctly. Include silent drift,
discarded obligations, revived superseded constraints, repeated failed work, false completion, and
user interventions required to restore direction.

Report successful-continuation rate and work-relevant omissions across the declared horizon, with
critical constraint violations listed separately. Also report the point at which a session first
requires repair and whether source recall restores useful continuation. Plotting these outcomes
against compaction count and steering density can expose degradation hidden by an aggregate score.

Evaluate auxiliary writers and acting readers separately before changing them together. For local
models, record serving configuration and quantization as well as model identity. Include variations
where the relevant constraint is old, phrased indirectly, corrected later, or separated from the
action by unrelated work.

Measure total task tokens, known cost, compaction attempts and outcomes, total elapsed time,
foreground pauses, retrieval calls, redundant work, and user intervention, including failed runs.
Efficiency comparisons accompany the continuity assessment; lower prompt size alone does not
establish a better result. Report uncertainty across tasks and runs, rather than treating every
checkpoint in one session as an independent trial.

An improvement claim requires comparative evidence over the declared horizon. A protocol, passing
scripted providers, successful storage, or a vendor leaderboard is insufficient. When results are
mixed or uncertain, report which conditions improved and which remain unresolved. Comparison data
guides iteration; positive results are not a prerequisite for completing an experimental version.
There is no fixed numerical MVP quality or efficiency gate. The
[evaluation design](evidence-and-evaluation.md#evaluation-design) defines paired runs and
accounting. Automated repository checks use scripted providers; live-model evaluation requires
separate supervision.

## Implications for the initial design

The selected design combines observations and topics with a protected current-work note. The
extension reserves prompt space for the note's active intentions; retained originals supply detailed
evidence. The observer updates the note alongside observations, and the writer rejects stale
revisions. Newer visible user instructions remain authoritative while the note awaits an update.

Freshness and budget failures still need explicit fallback. A protected note can omit an important
constraint. An optional comparison with observations/topics alone can isolate the note's
contribution; claims about that contribution require this comparison. A structured task-state system
adds task transitions and dependencies and remains outside the initial design.
