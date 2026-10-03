# Continuity and invariants

Research date: 2026-10-03. The product objective is effective continuation: after compaction, the
acting model can perform the right next action under the current instructions. A shorter checkpoint,
a successful observer call, and an available archive are each insufficient evidence of that outcome.

This document answers the original eight compaction questions against the smaller core. All
recommendations are proposals for discussion. They do not amend the draft SPEC or import the former
package's policies. The [Pi audit](pi-compaction.md) establishes host mechanics;
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
current-work note presented in a checkpoint. An observation is an interpreted account with source
references. Recall provides supporting detail after the checkpoint; it cannot replace an active
obligation the model has no reason to search for.

| Native information or mechanism | Proposed visible checkpoint content                                                                                | Supporting observations or recall                                                               | Gap or verification obligation                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Goal and scope                  | Snapshot states the operative objective and exclusions.                                                            | Earlier objectives remain attributable history.                                                 | Distinguish a changed objective from an additional pending task.                                                          |
| Constraints and preferences     | Snapshot preserves applicable instructions and corrections.                                                        | Source lookup provides exact wording and scope.                                                 | Old active constraints cannot expire by age, frequency, or recency selection alone.                                       |
| Done work                       | Snapshot records confirmed completion and verification status relevant to continuation.                            | Observations retain outcomes and supporting command/tool evidence.                              | A planned action or successful tool invocation is not proof of the whole task's completion.                               |
| In-progress work                | Snapshot states partial work and the next continuation point.                                                      | Observations retain exact partial artifacts and attempted approaches.                           | Preserve unfinished work across topic changes and repeated checkpoints.                                                   |
| Blocked and paused work         | Snapshot names the blocker, waiting condition, and still-open obligation.                                          | Source evidence explains failure and previous attempts.                                         | A pause is neither completion nor cancellation.                                                                           |
| Key decisions and rationale     | Include decisions that govern next actions with enough rationale to avoid repeating rejected work.                 | Historical alternatives and supporting evidence remain recallable.                              | The draft's note fields do not yet allocate rationale explicitly.                                                         |
| Next steps                      | Snapshot identifies the next action or waiting condition.                                                          | Recall supplies detailed procedures when needed.                                                | A suggestion must remain distinct from user authorization and confirmed execution.                                        |
| Critical context                | Snapshot or selected observations state necessary environment and task facts.                                      | Source lookup retrieves longer evidence.                                                        | An observation index alone cannot establish that critical facts are visible.                                              |
| Exact paths, names, and errors  | Preserve exact values when they constrain the next action.                                                         | Search and source reads recover other recorded details without relying only on observation IDs. | Extraction may omit a detail; original source must remain discoverable independently.                                     |
| Incremental previous summary    | Reconcile still-applicable prior checkpoint content with newer evidence and corrections.                           | Previous records retain provenance.                                                             | Native fallback reads custom summary text but cannot reconstruct previously omitted facts from the archive automatically. |
| Mid-turn context                | Present the original request, progress so far, and continuation context for the portion before the fixed cut.      | Source references identify the relevant turn and partial tool exchanges.                        | The observer or renderer must cover the prepared turn prefix; a generic observation list is not enough.                   |
| Read and modified files         | Render available file-operation facts deterministically from preparation plus explicitly retained prior inventory. | Source lookup explains what an invocation actually did.                                         | Pi excludes custom-checkpoint details from native metadata inheritance. Tool invocation is not proof of success.          |
| Summarized source coverage      | Eligibility accounts for every prepared source kind, previous checkpoint, and turn prefix.                         | Coverage records identify accepted processing and gaps.                                         | Contiguous processing is a mechanical property; semantic preservation needs separate evaluation.                          |

The native baseline itself has limits: source serialization truncates tool text, omits images, and
can make separate history and turn-prefix calls. The qualitative comparison should use what native
Pi actually receives and requests, while allowing Orbis to retain richer recorded evidence. It
should not describe native compaction as a lossless read of every byte.

## 1. Allocate native information without duplicating a summary

**(Recommended) Keep the snapshot, observations, and deterministic rendering, with an explicit
category allocation.** Protect current obligations and relevant decision rationale in visible
checkpoint content. Use observations for concise evidence and historical results. Derive file lists
from source metadata where possible. Use recall for additional detail, not as the only location of
critical continuation facts.

This preserves the settled architecture and gives it a falsifiable contract. A separate native
summary of the same messages remains rejected: it duplicates content and makes the custom sections'
sufficiency impossible to assess independently.

An observation-only checkpoint is a viable experimental comparison, but neither inspected
observational-memory package proves that selection by recency or importance protects all active
obligations. A snapshot-only checkpoint also has merit as a diagnostic arm; dropping source-linked
observations would change a settled direction without evidence that their discovery role is
unnecessary.

The schema should distinguish statements of intent, attempts, observed outcomes, and verified
completion. Exact field names and format remain design choices. A prompt requesting these categories
is not a semantic guarantee.

## 2. Handle unprocessed evidence at the prepared cut

**(Recommended) Start with whole-checkpoint native fallback when accepted observation coverage is
incomplete.** Background preparation remains useful, but the MVP does not require a new foreground
extraction or summarization path. Preserve the prepared cut even when the observer is behind.

This keeps one accepted-processing protocol and uses the host's existing recovery. It is viable only
if fallback frequency and resulting continuation are acceptable. Measure those outcomes before
claiming the custom checkpoint is normally available. This policy cannot repair information already
lost from a prior custom checkpoint.

| Alternative                                            | Benefit                                                                      | Reason to defer or reject for this MVP                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bounded observer catch-up                              | Reuses the observer contract and can make more custom checkpoints eligible.  | Adds foreground latency, cancellation, deadline, partial-commit, and navigation races. Consider it if measured lag makes fallback common.                    |
| Native-style summary of only the uncovered span        | Avoids duplicating processed content and can address an unusually large gap. | Adds a second extraction representation and reconciliation rules. Prior checkpoint updates, corrections, and split turns still require coherent integration. |
| Move the cut to the last observed source               | Retains unprocessed material verbatim and appears in other packages.         | Conflicts with the settled requirement to preserve Pi's prepared `firstKeptEntryId`.                                                                         |
| Treat scheduled or partially completed work as covered | Increases apparent eligibility.                                              | Provides no accepted account of the missing sources. Reject it.                                                                                              |

Bounded catch-up is technically feasible through public APIs. Source inspection does not establish
that its extra complexity produces better continuation or lower total cost. If selected later, a
finite number of chunks is not a substitute for an elapsed deadline and cancellation policy.

## 3. Define whole-checkpoint fallback and its reports

**(Recommended) Decline before returning any custom checkpoint when eligibility fails, and report
the specific failed condition.** Do not combine a partially accepted checkpoint with a full native
summary of the same messages. A fallback attempt does not imply that native summarization succeeded.

Candidate conditions for the completed contract are:

- Accepted coverage does not include the required prepared source span.
- The snapshot is missing, invalid, or inconsistent with accepted processing state.
- The complete candidate checkpoint exceeds its declared capacity.
- Observation failed, was cancelled, or became stale after lineage navigation.
- Source or persisted state needed to prove eligibility is unavailable or invalid.
- Manual instructions require a transformation the package has not defined.

Missing observer credentials are relevant when they prevented preparation; they need not invalidate
an already prepared checkpoint. Native credentials are resolved only after the hook declines in the
inspected Pi versions. Report an attempted fallback and then its actual outcome separately.

A useful bounded report identifies the trigger, missing span or invalid record where applicable,
incoming reason and retry decision, selected path, and final outcome. It should avoid dumping source
content. Exact UI, event names, and persistence remain open. The report must not claim Pi retried
merely because compaction was triggered by overflow.

Cancellation and throwing are rejected as generic substitutes for fallback. Cancellation can stop
the pending overflow retry. A thrown hook error is reported and swallowed by Pi, so it does not
provide a reliable veto. Stale or unverified partial rendering is also rejected.

There is one inherited-host limitation: later native fallback receives custom checkpoint prose but
not its deterministic file metadata through the native inheritance path. Preserving a visible file
list in the prose helps, but does not prove exact cumulative native file lists. If the product
requires that stronger guarantee across every fallback, discuss a host change or a different
recovery contract explicitly; do not claim it already exists.

## 4. Handle an oversized snapshot

**(Recommended) Keep ordinary requests independent of snapshot fitting; decline custom compaction if
the complete eligible checkpoint cannot fit.** This follows checkpoint-only presentation and avoids
copying the former ordinary-request abort. Set finite generation and rendering budgets, and report
capacity fallback separately from invalid output.

Observer condensation is a reasonable later option: the observer can restate the same obligations
more compactly. It adds another semantic-loss opportunity and needs a bounded repair protocol. A
successful rewrite still needs validation and continuity evaluation. It cannot promise that every
possible set of active obligations fits a fixed budget.

Priority sections can allocate space among optional historical details and indexes. They must not
silently discard an old active obligation to make a checkpoint fit. Truncating the complete snapshot
and calling the remaining prefix sufficient is rejected. Returning the former request-time abort is
also rejected for this checkpoint-only product unless a new ordinary-request responsibility is
explicitly selected.

Native fallback has its own context and summary limits. This recommendation is a recovery policy,
not proof that the native model can always fit or perfectly preserve an arbitrarily large task.

## 5. Choose when the snapshot appears

**(Recommended) Keep checkpoint-only presentation.** This is settled direction and remains suitable
for the MVP. Recent conversation provides the immediate task state between compactions. The observer
can prepare a new snapshot without repeatedly inserting it into that conversation.

Routine revisions would add freshness, duplication, prompt-size, and ordinary-request failure
behavior. Stable append-only notes or change notifications are possible future experiments if
measured failures between compactions justify them. No current evidence establishes that they are
needed for the selected core. Cache or token savings from checkpoint-only presentation remain
unmeasured.

## 6. Honor `/compact <instructions>`

**(Recommended) Initially delegate instructed compaction to native Pi and document the host's exact
behavior.** The extension should not accept instructions and silently ignore them while returning
its ordinary checkpoint. Native delegation avoids a separate package-owned instruction interpreter
or rewriting call in the first implementation.

This recommendation has a material qualification: native Pi passes instructions to the history
summary, but not the separate turn-prefix summary. When only the prefix is summarized, no inference
call receives those instructions. Delegation therefore preserves native semantics; it does not
promise that every instruction governs every summarized span.

If the product requires stronger instructed-compaction behavior, select it explicitly. One option is
a bounded package-owned checkpoint rewrite using the instructions and all eligible inputs. That is
feasible through public inference APIs, but needs routing, failure, and capacity rules. Ignoring
instructions or trying to infer arbitrary instructions through deterministic section selection is
rejected. A host-level fix is another option for improving native behavior without introducing a
second package inference path.

## 7. Reassess stale-note cancellation

**(Recommended) Do not import the former blanket cancellation guard.** Checkpoint-only presentation
removes repeated standalone note messages. A visible later correction can supersede an earlier
checkpoint statement in chronological context, as it does in native Pi.

For a custom checkpoint, inconsistent accepted state should make the candidate ineligible. That is
different from declaring native fallback unsafe whenever an older statement exists. Whole-checkpoint
fallback remains a reasonable recovery for ordinary visible corrections.

Off-transcript edits and erasure promises are separate product decisions. Deleting a stored record
cannot automatically retract a sentence already summarized into a previous checkpoint. Native
fallback cannot discover an invisible correction. If user curation is deferred, these stronger
retraction semantics need not enter the MVP through a speculative guard.

Retaining cancellation without that distinction is rejected because it complicates recovery and can
suppress host retry. A package-owned correction summarizer or host enhancement remains an option if
a future curation contract requires it. Neither is currently proven necessary for the core.

## 8. Evaluate category parity and actual continuation

**(Recommended) Keep qualitative native parity and evaluate both checkpoint information and
subsequent actions.** For each category in the table, identify applicable source facts, whether they
are visible after compaction, whether they remain accurate after corrections, and whether the acting
model uses them correctly. Score an applicable omission separately from a category that was absent
from the source.

Use native Pi as the baseline with the same acting model, tools, starting repository, and native
settings. Compare fixed compaction milestones separately from automatic-compaction runs. Add
repeated custom-to-native transitions, split turns, paused work, failed verification, and selected
branch navigation. Record recall discovery and source availability independently of answer quality.

A hand-authored expected checkpoint can test the renderer, but it cannot establish real extraction
quality. Scripted providers test mechanics without charges. Separately authorized live evaluations
must execute meaningful continuation tasks and report the total cost of preparation, retrieval,
fallback, and acting work. Numerical thresholds and live-run budgets remain open.

Equal token counts, compression ratios, and vendor QA scores are rejected as substitutes for this
comparison. They can be measurements or diagnostics, but they do not define success.

## Findings that support keeping the selected direction

The native mechanism already supplies a useful fallback and stores custom checkpoint prose for later
summarization. Public session entries and source reads make a small continuation package plausible
without an external memory service. Neither observational-memory implementation proves that
reflection, topics, or a journey are prerequisites for effective continuation.

The snapshot protects information whose omission may prevent the model from knowing it should use
recall. Source-linked observations organize historical evidence without claiming it is generally
applicable knowledge. Checkpoint-only presentation avoids routine note freshness and capacity
mechanisms. These are coherent responsibilities for an independently useful core.

The unresolved choices remain material. A minimally viable custom checkpoint must still define
coverage, prior-summary reconciliation, source discovery, capacity failure, and host interaction.
Removing knowledge maintenance does not remove these continuation obligations.
