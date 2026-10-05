# Continuity and invariants

Research date: 2026-10-04. The product objective is effective continuation: after compaction, the
acting model can perform the right next action under the current instructions. A shorter checkpoint,
a successful observer call, and an available archive are each insufficient evidence of that outcome.

The policy comparisons below fall under **Design inference** in the
[research index](README.md#how-to-read-a-claim). They record trade-offs behind the
[continuation contract](../../SPEC.md). The [Pi audit](pi-compaction.md) establishes host mechanics;
[evidence and evaluation](evidence-and-evaluation.md) distinguishes measured results from proposed
checks.

## What continuation evidence establishes

Factory's [compression evaluation](https://factory.com/news/evaluating-compression), published
December 2025, uses 36,611 production messages and four probe categories: recall, artifacts,
continuation, and decisions. GPT-5.2 judges the answers. Artifact tracking is a weak area in the
report. A continuation probe asks about subsequent work; it does not execute repository acceptance
tasks. Structured summaries are a useful candidate from this experiment, not a guarantee that
important information survives. Its provider comparison does not establish the quality of current Pi
or the proposed Orbis package.

Anthropic's
[context-engineering account](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
describes compaction, structured notes, and retrieval as complementary approaches, and identifies
information loss from aggressive compression. It is an engineering account rather than a controlled
Pi comparison. It supports considering separate presentation and retrieval responsibilities without
establishing the right number of components.

Its
[long-running-agent account](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
reports incomplete handoffs and premature completion despite compaction. Progress artifacts,
incremental work, and verification form a combined harness for web application tasks. The result
supports evaluating actual continuation and completion; it does not isolate a memory-policy effect
or require a memory extension to become a task planner.

The Orbis proposals below follow the user's objectives and the inspected host behavior. They are not
reported outcomes from these articles.

## Category-level parity

The table allocates information by its role in continuation. "Snapshot" means the complete
continuation state presented in a checkpoint. An observation is an interpreted account with source
references. Recall provides supporting detail after the checkpoint; it cannot replace an active
obligation the model has no reason to search for.

| Native information or mechanism | Proposed visible checkpoint content                                                                                                      | Supporting observations or recall                                                                   | Gap or verification obligation                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal and scope                  | Snapshot states the operative objective and exclusions.                                                                                  | Earlier objectives remain attributable history.                                                     | Distinguish a changed objective from an additional pending task.                                                                                    |
| Constraints and preferences     | Snapshot preserves applicable instructions and corrections.                                                                              | Source lookup provides exact wording and scope.                                                     | Old active constraints cannot expire by age, frequency, or recency selection alone.                                                                 |
| Done work                       | Snapshot records confirmed completion and verification status relevant to continuation.                                                  | Observations retain outcomes and supporting command/tool evidence.                                  | A planned action or successful tool invocation is not proof of the whole task's completion.                                                         |
| In-progress work                | Snapshot states partial work and the next continuation point.                                                                            | Observations retain exact partial artifacts and attempted approaches.                               | Preserve unfinished work across topic changes and repeated checkpoints.                                                                             |
| Blocked and paused work         | Snapshot names the blocker, waiting condition, and still-open obligation.                                                                | Source evidence explains failure and previous attempts.                                             | A pause is neither completion nor cancellation.                                                                                                     |
| Key decisions and rationale     | Include decisions that govern next actions with enough rationale to avoid repeating rejected work.                                       | Historical alternatives and supporting evidence remain recallable.                                  | Check whether the acting model retains the reason for a decision.                                                                                   |
| Next steps                      | Snapshot identifies the next action or waiting condition.                                                                                | Recall supplies detailed procedures when needed.                                                    | A suggestion must remain distinct from user authorization and confirmed execution.                                                                  |
| Critical context                | Snapshot states necessary environment and task facts.                                                                                    | Source lookup retrieves longer evidence.                                                            | An observation index alone cannot establish that critical facts are visible.                                                                        |
| Exact paths, names, and errors  | Preserve exact values when they constrain the next action.                                                                               | Search and source reads recover permitted recorded details without relying only on observation IDs. | Extraction may omit a detail; effective source must remain discoverable independently. Historical originals need the personal opt-in after an edit. |
| Incremental previous summary    | Reconcile still-applicable prior checkpoint content with newer evidence and corrections.                                                 | Previous records retain provenance.                                                                 | Native fallback reads custom summary text but cannot reconstruct previously omitted facts from the archive automatically.                           |
| Mid-turn context                | Present the original request, progress so far, and continuation context for the portion before the fixed cut.                            | Source references identify the relevant turn and partial tool exchanges.                            | Every split prefix needs this content, even without special compaction instructions.                                                                |
| Read and modified files         | Render available file-operation facts deterministically from preparation plus explicitly retained prior inventory.                       | Source lookup explains what an invocation actually did.                                             | Pi excludes custom-checkpoint details from native metadata inheritance. Tool invocation is not proof of success.                                    |
| Summarized source coverage      | Eligibility accounts for prepared `messagesToSummarize`, `turnPrefixMessages`, and any applicable `previousSummary` or derived baseline. | Coverage records identify accepted processing and gaps.                                             | Processing derived text does not imply replay or coverage of its originals. Mechanical coverage does not prove semantic preservation.               |

The native baseline itself has limits: source serialization truncates tool text, omits images, and
can make separate history and turn-prefix calls. The qualitative comparison should use what native
Pi actually receives and requests, while allowing Orbis to retain richer recorded evidence. It
should not describe native compaction as a lossless read of every byte.

## 1. Allocate native information without duplicating a summary

The [continuation snapshot](../../SPEC.md#continuation-snapshot--req-continuation-snapshot) is
self-contained for current semantic state; observations support historical recall. This distinction
makes missing active obligations visible in evaluation. A separate native summary of the same
messages would duplicate content and obscure which representation preserved the obligation.

The snapshot represents state as of Pi's prepared cut under the effective source view at
preparation. A later context edit may still affect a source before the cut. An observer append
timestamp only records when processing finished. It does not make later evidence valid at an earlier
cut. When an observation batch spans the cut, start from the latest accepted state whose source
horizon ends before the cut and use bounded catch-up through the cut. That catch-up serves only the
checkpoint and is not committed, so the main accepted state keeps one chain. If it cannot produce
eligible state, the candidate needs fallback. Inferring earlier state by removing facts that appear
recent can project later corrections or completions backward.

A context edit to an already processed source is new evidence rather than an invalidation. The
source becomes uncovered and the observer processes its effective version against the current
snapshot. Rolling back every later update would make one early edit cost near-complete
re-observation. Pi's overflow recovery also omits its failed final attempt through context edits, so
edits to processed sources are routine.

The observer receives the complete snapshot, with every obligation and maintained item, and bounded
evidence. Supplying everything lets each job review and prune any item without a selection policy;
the cost is earlier suspension when the snapshot outgrows the observer's input budget. Tool results
above a documented size may be processed as start-and-end excerpts and recorded as reduced, because
native compaction reads only the first 2,000 characters of each tool result and full processing
would make eligibility costlier than the native baseline. The observer proposes machine-readable
add, replace, and remove operations with complete replacement content. Validation and application
are automatic, without per-update user approval. An omitted item persists; the observer need not
restate every unchanged decision, completed result, or identifier. Those non-obligation facts also
need explicit removal when no longer needed. An obligation needs linked evidence to retire; its
removal does not require a narrative in the final checkpoint. These operations keep the accepted
state distinct from a new free-form state replacement or an extra model interpretation pass.

An observation-only checkpoint is a viable experimental comparison, but neither inspected
observational-memory package proves that selection by recency or importance protects all active
obligations. A snapshot-only checkpoint also has merit as a diagnostic arm; dropping source-linked
observations would change a settled direction without evidence that their discovery role is
unnecessary.

The retention rule protects accepted state from omission in a later response. It cannot detect an
initial extraction miss or prove that a proposed supersession is correct. Preserve exact source
wording when paraphrase would weaken a condition, prohibition, scope, or acceptance criterion.

## 2. Handle unprocessed evidence at the prepared cut

The [unified compaction contract](../../SPEC.md#unified-compaction--req-unified-compaction) uses
bounded catch-up through the existing observer, followed by whole-checkpoint native fallback when
the candidate remains ineligible. The candidate needs accepted state whose source horizon matches
the prepared cut. A deadline must include waiting for existing work; a chunk-count bound alone is
not an elapsed deadline. Late or competing work must not commit after the selected lineage changes.

### Basis in inspected implementations

The inspected systems do not converge on one recovery policy. Incremental preparation is common;
catch-up, retention of uncovered source, and another compaction representation are different ways to
handle lag.

| Implementation              | Handling of incomplete preparation                                                             | Limit of the comparison                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Amos observational memory   | Waits for observer work and adjusts the cut toward observed chunks.                            | Waiting does not prove every chunk succeeded; changing the prepared cut is outside Orbis's contract. |
| Elpapi released 3.1.4       | Renders available observations and delegates when the result is empty.                         | A nonempty checkpoint does not prove complete coverage.                                              |
| Elpapi development revision | Attempts bounded catch-up, rereads committed state, then changes the cut or delegates.         | Direct precedent for catch-up, with a boundary adjustment Orbis excludes.                            |
| Mastra stable 1.35.0        | Prepares buffers ahead of time and can observe synchronously when preparation is insufficient. | Supports foreground completion, but operates in its own context processor without Pi fallback.       |
| Blackhole 0.5.10            | Builds a structural summary from source plus available observations.                           | Structural output is a separate representation; full observation coverage is not required.           |
| Hermes                      | Attempts a bounded memory save and then permits native Pi compaction.                          | Pi owns the checkpoint throughout, so this is not recovery from a custom checkpoint.                 |

Sources and pinned implementation details:
[both observational-memory projects](observational-memory.md),
[Mastra](observational-memory-comparison.md), [Blackhole](pi-cache-compaction-ecosystem.md),
[Hermes](agent-memory-systems.md).

The supported design principle is to avoid treating unprocessed source as covered: finish its
representation, retain it, or let another complete compaction path process it. Not every inspected
package enforces that principle completely. Catch-up has the clearest direct precedent in current
Elpapi and a related mechanism in Mastra. None of these inspected paths implements a native-style
model summary of only the uncovered span.

### Trade-offs and alternatives

Catch-up addresses a specific failure: a small missing span prevents use of otherwise useful
prepared memory. Reusing the observer keeps one accepted representation for the snapshot and
observations. This is an engineering recommendation for the continuation objective, not measured
evidence of better quality, lower cost, or lower latency in Orbis. Catch-up can add foreground delay
and still end in native fallback.

| Alternative                                            | Benefit                                                                                         | Reason not to select it as the default                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immediate whole-checkpoint native fallback             | Avoids foreground observer coordination and remains the recovery when catch-up cannot complete. | Even a small fillable gap discards the opportunity to use prepared memory. Prefer it directly when catch-up cannot make the candidate eligible.         |
| Native-style summary of only the uncovered span        | Avoids duplicating processed content and can address an unusually large gap.                    | Adds a second representation and reconciliation rules for corrections, ongoing work, and prior checkpoints; no direct precedent in the inspected paths. |
| Move the cut to the last observed source               | Retains unprocessed material verbatim and appears in other packages.                            | Conflicts with the requirement to preserve Pi's prepared boundary.                                                                                      |
| Treat scheduled or partially completed work as covered | Increases apparent eligibility.                                                                 | Provides no accepted account of the missing sources. Reject it.                                                                                         |

Exact limits and queue mechanisms remain implementation choices within the
[resource budget contract](../../SPEC.md#resource-budgets--req-resource-budgets); model-free
fixtures verify limits and cancellation. Evaluation should measure how often catch-up completes,
foreground waiting, fallback frequency, and subsequent continuation. Whole-checkpoint fallback still
cannot recover information omitted from a prior custom checkpoint automatically. Catch-up also does
not fix native inheritance of custom file metadata; that obligation uses the selected model-facing
inventory augmentation described below.

## 3. Define whole-checkpoint fallback and its reports

The host's [hook outcomes](pi-compaction.md#hook-outcomes-failure-and-retry) distinguish a complete
custom result, decline, and cancellation. Decline invokes native compaction; it does not establish
that the native attempt succeeded. Cancellation can stop an overflow retry, while a thrown hook
error is reported and swallowed. Observer credentials matter only if preparation needs them; native
credentials are resolved after decline.

Native fallback reads prior custom summary prose but does not inherit its file metadata. The
[file-operation analysis](pi-compaction.md#file-operation-history-is-an-exception) explains why the
[file-inventory contract](../../SPEC.md#file-inventory--req-file-inventory) supplements the
model-facing cumulative inventory through the context hook. Recognized tool invocations do not prove
successful filesystem effects. The inventory remains fixed at a checkpoint boundary under the
[request construction policy](prompt-caching-and-compaction.md#stable-checkpoint-presentation).

## 4. Handle an oversized snapshot

The [continuation snapshot contract](../../SPEC.md#continuation-snapshot--req-continuation-snapshot)
permits bounded condensation of checkpoint presentation while keeping accepted obligations
authoritative. Obligations render verbatim, and condensation shortens only maintained items through
a structured output keyed by item identity. Code can then check that every applicable item and
protected string survived. Condensing maintained context is still lossy inference: structural checks
cannot prove that a shortened item kept its meaning. Repeated repair, corrections, and overflow need
evaluation. Neither condensation nor native fallback guarantees that arbitrarily large active state
fits a fixed context budget.

## 5. Choose when the snapshot appears

The [continuation snapshot](../../SPEC.md#continuation-snapshot--req-continuation-snapshot) appears
in checkpoints. Ordinary turns supply recent changes between checkpoints. Routine snapshot insertion
would add duplication, capacity, and freshness behavior. Any cache or token benefit from the chosen
placement remains unmeasured.

## 6. Honor `/compact <instructions>`

Pi passes supplied instructions to a history-summary call, but not to a separate turn-prefix call.
If only the prefix needs summarization, native inference does not receive the supplied compaction
instructions. This host limit motivates the contract's bounded instruction-aware presentation path.
The hook's instruction string is not a persisted user message; an SDK or extension can initiate a
manual compaction. The package still presents request, progress, and continuation context for a
split prefix when no special instructions are supplied. Instructions about presentation do not
themselves authorize retiring an obligation.

## 7. Handle corrections without blanket cancellation

Visible later corrections can supersede older checkpoint prose in chronological context, as in
native Pi. Off-transcript edits and deletion differ: native summarization cannot discover a change
that is absent from its input. The
[effective-context analysis](pi-compaction.md#original-records-and-effective-context) explains the
distinction. It does not justify blanket cancellation, which can suppress host retry. The
[lineage contract](../../SPEC.md#session-lineage--req-session-lineage) governs which sources are
current; source attribution remains necessary when historical originals and effective edits differ.

## 8. Evaluate category parity and actual continuation

The [evaluation protocol](evidence-and-evaluation.md#proposed-evaluation-design) compares applicable
source facts, checkpoint visibility, and subsequent action. A hand-authored expected checkpoint can
test rendering, while scripted providers test host mechanics. Neither measures real extraction
quality. Token count, compression ratio, and vendor question-answering scores are useful diagnostics
but cannot substitute for actual continuation tasks.
