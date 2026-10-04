# Continuity and invariants

Research date: 2026-10-04. The product objective is effective continuation: after compaction, the
acting model can perform the right next action under the current instructions. A shorter checkpoint,
a successful observer call, and an available archive are each insufficient evidence of that outcome.

This document examines eight compaction policy questions for the core. Selected directions are
identified separately from recommendations and do not amend the draft SPEC by themselves. The
[Pi audit](pi-compaction.md) establishes host mechanics;
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
| Critical context                | Snapshot states necessary environment and task facts.                                                              | Source lookup retrieves longer evidence.                                                        | An observation index alone cannot establish that critical facts are visible.                                              |
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

**Selected direction: a self-contained semantic snapshot plus deterministic file information.** The
snapshot presents every applicable native semantic category, including current obligations, decision
rationale, blockers, and split-turn continuation. Observations retain supporting history for recall.
They are not required to compensate for missing semantic checkpoint categories. Deterministic
rendering can assemble accepted records; this does not require a complete generative rewrite after
every observation.

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

Accepted obligations persist unless an explicit, evidence-linked proposal changes, completes,
cancels, or supersedes them. An omitted item in a later proposal is not a deletion. This mechanical
rule protects already accepted state; it cannot detect every initial extraction miss or prove that a
proposed semantic change is correct. Preserve exact source wording when paraphrase would weaken
conditions, prohibitions, scope, or acceptance criteria. The precise update schema remains open.

## 2. Handle unprocessed evidence at the prepared cut

**Selected direction: bounded catch-up through the existing observer, then whole-checkpoint native
fallback if the candidate remains ineligible.** Return an already eligible checkpoint immediately.
If missing coverage is the reason a custom checkpoint cannot be used, wait for or extend observer
work within a finite budget. Reuse the same extraction, validation, and commit protocol as
background preparation.

After catch-up, reread accepted state and check coverage through Pi's prepared cut. Return a custom
checkpoint only when the source selection, snapshot, and capacity checks also pass. Otherwise,
decline and let Pi produce the whole checkpoint. Keep the prepared `firstKeptEntryId` and the host's
retry decision throughout; moving the cut is not a recovery option for this package.

This puts work needed to preserve continuation inside the core. It does not introduce a separate
model role, reflection pipeline, or broader knowledge maintenance. The implementation still needs
foreground coordination: a deadline must include waiting for existing work, late results must not
commit after invalidation, and competing jobs must not process or publish the same span twice. A
chunk-count bound alone is not an elapsed deadline.

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

Exact limits and queue/cancellation behavior need design and model-free fixtures. Evaluation should
measure how often catch-up completes, foreground waiting, fallback frequency, and subsequent
continuation. Whole-checkpoint fallback still cannot recover information omitted from a prior custom
checkpoint automatically. Catch-up also does not fix native inheritance of custom file metadata;
that obligation uses the selected displayed-inventory augmentation described below.

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

Native fallback receives custom checkpoint prose but not its deterministic file metadata through the
native inheritance path. The selected integration lets the host produce its native checkpoint and
uses the public context hook to add deterministic cumulative file information to the displayed
checkpoint. It adds no second summary or model call. The guarantee applies while the core is
enabled; Pi's persisted native summary and later `previousSummary` do not receive this augmentation.

The [selected cache policy](prompt-caching-and-compaction.md#stable-checkpoint-presentation) fixes
that inventory at the checkpoint boundary rather than rebuilding it from later activity. The core
still needs missing-inventory behavior, reconstruction tests, and custom/native transition fixtures.
Preserving file names generatively in summary prose alone is not the selected parity mechanism.

## 4. Handle an oversized snapshot

**Selected direction: bounded presentation-only condensation, then fallback if the complete
candidate still cannot fit.** Keep ordinary requests independent of snapshot fitting:
checkpoint-only presentation does not routinely inject the snapshot between compactions.

First remove optional checkpoint material under the chosen selection policy. If the complete
snapshot still exceeds capacity, a bounded repair can restate its obligations more compactly. Retain
the authoritative accepted state unchanged; condensation produces a checkpoint presentation rather
than replacing canonical obligations. A condensed checkpoint is not fresh independent evidence.
Validate presentation eligibility for the current source selection. Limit attempts and elapsed work;
exact defaults remain open. Report capacity fallback separately from invalid output.

Condensation serves current continuation. It does not introduce topic consolidation, reflection on
broader knowledge, or a new model role. It is still lossy inference: structural validation cannot
prove every obligation survived, so evaluation must test repeated repair and corrections. Native
fallback also summarizes through inference; avoiding an additional repair call alone does not
establish that immediate fallback preserves more information.

Priority sections can allocate space among optional historical details and indexes. They must not
silently discard an active obligation to make a checkpoint fit. Truncating the snapshot and calling
the remaining prefix sufficient is rejected. Aborting an ordinary request because an uninjected
snapshot is oversized is also rejected unless the product adds a request-time snapshot
responsibility.

Immediate native fallback remains appropriate when repair cannot make the candidate eligible or
exhausts its budget. Neither repair nor native fallback can promise that every possible set of
active obligations fits a fixed budget. The recommendation is a bounded recovery policy whose
quality and cost require evaluation.

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

**Selected direction: bounded instruction-aware checkpoint presentation through the shared
compaction hook.** The hook participates in automatic, manual, SDK, and extension-triggered
compaction. Supplied instructions shape the checkpoint, including relevant split-turn content; they
do not silently change canonical obligations. The package must not accept instructions and return
its ordinary rendering without considering them.

Native Pi passes instructions to the history summary, but not the separate turn-prefix summary. When
only the prefix is summarized, no inference call receives those instructions. Native delegation
therefore preserves host semantics but does not establish that instructions govern every summarized
span.

The bounded package-owned generation path uses the instructions and eligible checkpoint inputs,
reusing observer capabilities where their contract fits. It needs explicit behavior for routing,
capacity, cancellation, and unsuccessful generation. Presentation instructions must not silently
rewrite canonical task state or weaken required continuation content. The exact output and failure
contract need design; this is not a claim that the ordinary observer already implements instructed
compaction. The hook's instruction string is not itself a persisted user message, and a manual
reason can originate from SDK or extension code. Presentation scope does not prove human authorship
or authorization to retire an obligation.

A host fix could make native delegation cover the split prefix as well as history. That would
benefit native and extension-assisted compaction, but depends on host support. Native delegation
without that fix remains a comparison and recovery candidate with a known semantic limit. Avoiding
package-owned inference is not sufficient reason to accept the limit silently.

Ignoring instructions and trying to interpret arbitrary instructions through deterministic section
selection are rejected. No option may append a native summary of the same processed messages below
the package's memory sections.

## 7. Handle corrections without blanket cancellation

**(Recommended) Do not cancel compaction solely because a previous checkpoint has a superseded
statement.** Checkpoint-only presentation avoids repeated standalone note messages. A visible later
correction can supersede an earlier checkpoint statement in chronological context, as it does in
native Pi.

For a custom checkpoint, inconsistent accepted state should make the candidate ineligible. That is
different from declaring native fallback unsafe whenever an older statement exists. Whole-checkpoint
fallback remains a reasonable recovery for ordinary visible corrections.

Off-transcript edits and erasure promises are separate product decisions. Deleting a stored record
cannot automatically retract a sentence already summarized into a previous checkpoint. Native
fallback cannot discover an invisible correction. User curation of derived records is outside the
MVP. Historical recall retains originals with their status/provenance and applicable replacement
information. New observation uses the effective source view; omission is not automatic retirement of
an obligation. Exact archived-view and disable behavior still need a contract. The core does not
promise invisible retraction through a speculative guard.

Using cancellation without that distinction is rejected because it complicates recovery and can
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
