# Memory

## Status and purpose

**Approved behavioral contract; runtime implementation pending.** This specification defines
`@orbis/memory` for independent implementers. The package prepares context for continuation after Pi
compaction and provides recall of earlier evidence within the selected session lineage.

The core works without a companion. Project knowledge, developer habits, cross-session retrieval,
topic consolidation, generated journeys, and user curation of derived memory are outside the MVP.
Public companion and external-retrieval APIs wait for a concrete consumer. The
[research](docs/research/README.md) explains evidence and trade-offs without adding requirements.
The requirements and conformance table below define the package contract.

Reference baseline: Pi 0.99.1's public
[extension](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts)
and
[session](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/session-manager.ts)
capabilities. This is not a runtime compatibility claim.

## Concepts

Pi owns conversation history and compaction. The **selected lineage** is the ancestry selected by
resume, fork, or tree navigation. **Original evidence** is recorded source; **effective text** is
its content after applicable Pi context edits. A **checkpoint** precedes retained recent history.
The **cut** is Pi's prepared `firstKeptEntryId`, the first retained entry.

An **observer** performs auxiliary inference that proposes memory updates. An **observer job** is
one bounded attempt against identified source versions and an accepted-state basis. A **continuation
snapshot** is the state needed to continue work. It has protected **active obligations** (goals,
constraints, unfinished tasks, and waiting conditions) and **maintained context** (completed work,
decisions and rationale, critical facts, and relevant identifiers). Source-linked **observations**
record events and findings for recall.

**Accepted state** is validated memory reconstructed from selected-lineage records. Its **source
horizon** describes how far its semantic inputs extend in conversation order, independently of when
the observer committed it. **Processing coverage** identifies accepted processing of particular
source portions and versions; it does not prove semantic preservation. A **derived baseline** is an
attributed checkpoint or branch summary accepted as evidence without claiming its originals were
processed. **Recall** retrieves permitted source text or observations on demand.

## Requirements

### Session continuity — `REQ-session-continuity`

A package checkpoint must provide the applicable native information categories: goals and scope;
constraints and preferences; completed, active, paused, and blocked work with verification state;
decisions and rationale; next actions and critical context; relevant exact identifiers; prior
checkpoint information; split-turn context; and cumulative file information.

The semantic snapshot is self-contained. Render applicable accepted items in every category;
observations remain recallable without becoming mandatory checkpoint sections. Recall cannot
compensate for omitted critical continuation context. Distinguish intent, attempts, results, and
verified completion. Preserve attribution and instruction authority. Preserve selected exact
identifiers and quotations unchanged, retaining original wording where paraphrase would weaken
constraints or acceptance criteria.

For every split turn, include the effective user request, relevant progress before the cut, and
context needed to interpret the retained continuation. This applies with or without compaction
instructions. Quoting the request alone does not satisfy missing progress or critical context.

### Session observations — `REQ-session-observations`

One observer response proposes snapshot changes and observations. Each job receives the full active
obligation set, existing maintained items it may change, and bounded effective-text inputs. Input
scope follows Pi's text compaction scope, including assistant thinking and tool arguments,
tool-result text, included custom messages, and derived checkpoint or branch-summary text. Images
remain original evidence under Pi retention; text processing must not claim image coverage.
Arbitrary extension state is not conversation input.

References identify the source session, entry, content portion, and effective version or edit.
Process bounded portions of oversized text without claiming coverage of omitted content. Observing a
summary establishes coverage of that derived text, not its originals. Preserve evidence identity,
attribution, scope, and verification state for bounded internal reads. Session observations do not
automatically become general project facts or developer preferences.

Accept a complete validated response as one logical operation: snapshot changes, observations,
coverage, and an operation identity in one versioned Pi custom entry. The identity distinguishes one
update and its retries from separate updates. A valid response with no changes may advance coverage.
Invalid or partial output applies nothing. Additions require fresh identities and valid resulting
content. Replacements and removals require existing targets supplied to the job. Reject invalid
references and changes outside that supplied basis. Reuse operation identity for uncertain retries,
reconcile an ambiguous append before further commits, and apply each accepted operation once during
reconstruction. Scheduling or receiving a partial response is not acceptance.

### Continuation snapshot — `REQ-continuation-snapshot`

The observer returns structured additions, replacements, and removals addressing stable item
identities. Additions and replacements supply the resulting content; code validates and applies
operations without another model interpreting prose instructions. Updates are automatic and do not
require per-change user approval. Omitted items persist.

Accepted obligations change only through explicit evidence-linked additions, amendments, completion,
cancellation, or supersession. Omission and age preserve them. Natural-language cancellation and
supersession in source evidence can support retirement without a special user command. Every update
reviews the active set; valid references establish traceability, not correct interpretation.

Maintain completed work, decisions and rationale, critical context, and identifiers through the same
structured update mechanism. The observer may explicitly remove details no longer needed for
continuation, while preserving applicable critical facts. Removal does not erase historical records
from recall. A narrated removal rationale is not mandatory for ordinary context. Checkpoints render
resulting continuation state, not operation logs or deletion explanations.

Present snapshots through checkpoints without routinely injecting background revisions into ordinary
requests. A checkpoint represents semantic state before the cut under the effective source view at
preparation. Its evidence and state dependencies must exclude later retained-history events.
Applicable context edits still affect earlier sources even when those edits were recorded after the
cut. Observer append position alone cannot select the correct state.

If an accepted batch spans the cut, reconstruct a compatible earlier basis and use bounded
same-observer catch-up through the cut. Do not split a semantic update merely by filtering its
citations or overwrite later accepted state with an earlier checkpoint view. If compatible state
cannot be prepared within limits, use native fallback.

When presentation exceeds capacity, attempt bounded condensation without changing authoritative
obligations. Preserve required information, including protected wording and exact identifiers. If it
still cannot fit, report native fallback. Suppress an identical failed repair until relevant
accepted state, evidence, or configuration changes. Observation may accept supported retirement
while required inputs fit. If the full active set cannot fit its input budget, suspend observation
and report the need for an admissible model, budget, or lineage. Presentation condensation cannot
repair that input limit.

### Source recall — `REQ-source-recall`

Expose `memory_recall` with `browse`, `search`, and `read` actions. Discover permitted source text
and observations independently, without requiring an extracted identifier first. Search uses literal
text with explicit case sensitivity; document chronological ordering. Bound search work, page size,
and returned content. Tie opaque references and cursors to lineage and effective source view.

Use effective source content by default: return replacements, and exclude omitted originals from
search hits, snippets, and reads. Direct access to an omitted source reports its omission. Access to
edited-out originals requires both an explicit original-view request and a personal configuration
opt-in, disabled by default. The opt-in applies across sessions until revoked. Project settings,
compaction instructions, and recall arguments cannot grant it. A malformed or unavailable permission
setting does not grant access. Check current permission and source view before returning results;
previously issued references, cursors, or cached results cannot bypass revocation.

Attribute original results as historical and show their omitted or replaced status, with applicable
replacement context or a reference to it. Edits have no reliable reason field; the package must not
assume that removed text was only compressed. This policy governs recall access, not erasure of
content already copied into observations or checkpoints, and does not sandbox other tools or
extensions. Omission alone does not retire an obligation.

Report no matches, unavailable sources, denied original access, stale cursors, invalid arguments,
and bounded partial results distinctly. Retrieval grants no additional instruction authority. The
acting agent chooses when recall helps; the MVP uses neither an auxiliary retrieval model nor
vectors or a generated filesystem mirror.

### Session lineage — `REQ-session-lineage`

Pi custom session entries are authoritative and follow Pi retention. Reconstruct accepted state on
resume; indexes may be rebuilt. Validate selected ancestry as well as identity, since forks can copy
entry IDs into a different session. Reject pending results whose lineage, effective source, or
accepted-state basis became stale. Forks inherit accepted records in their ancestry, not later
observer commits for earlier sources; missing processing needs catch-up.

The applicable prepared `previousSummary` may establish an attributed derived baseline without
replaying the entire archive. Its position follows Pi's projected history and represented source
horizon, not its later append position; the next cut may still lie inside its retained tail. A
branch summary may likewise supply earlier derived evidence within the prepared source view.
Preserve applicable accepted obligations and track original-source coverage separately. Resolve
known invalidations or missing facts from available evidence when needed; a summary cannot silently
repair them or authorize otherwise denied original access.

Malformed, unsupported, or inconsistent memory records stop reconstruction at the last validated
state whose dependencies remain valid. Do not accept descendants of an invalid dependency. Report
degradation and use native compaction until eligibility can be established again. Recall remains
available where provenance and access policy permit. Pi append can change memory before persistence
fails, and ephemeral or unflushed sessions can lose records. Do not promise transactional rollback
or crash durability.

### Unified compaction — `REQ-unified-compaction`

Preserve Pi's automatic settings and prepared `firstKeptEntryId`. Let Pi execute its incoming
`willRetry` decision: package failure must not cancel compaction to force fallback, since
cancellation can suppress overflow retry. Through `session_before_compact`, use the same bounded
preparation pipeline for automatic, manual, SDK, and extension calls that reach the hook.

A candidate is **eligible** only when all these conditions hold:

- Its accepted records and dependencies are valid for the selected lineage and effective source
  versions. Freshness compares these inputs and its state basis, not elapsed time.
- Accepted processing accounts for all effective text portions in `messagesToSummarize` and
  `turnPrefixMessages`, plus the applicable `previousSummary`. An accepted derived baseline can
  account for earlier history without inventing original-source coverage. Scheduled, partial, or
  failed processing does not count.
- Its source horizon and state basis satisfy the snapshot's before-cut rule. Later completion or
  cancellation in retained history has not been applied early.
- Presentation includes every applicable accepted continuation item and the split-turn context.
  Selected exact strings remain intact. Structural inclusion is checkable; semantic completeness and
  justified retirement are separate quality questions.
- The complete rendered checkpoint fits its documented budget, accounting for deterministic file
  information and wrappers within the model request's available capacity.

Use an eligible prepared candidate immediately when it also satisfies supplied compaction
instructions. Otherwise perform bounded same-observer catch-up where it can repair missing coverage
or a mismatched source horizon, and condense presentation when needed. Apply supplied instructions
through bounded presentation using accepted state and Pi's prepared inputs before returning a
checkpoint. Do not change accepted state or initiate archive search. Report requested detail that
cannot be supplied. Ordinary rendering does not require another model call.

Recheck eligibility before returning one complete custom checkpoint. If it remains ineligible,
**decline** by returning no custom compaction result, permitting whole-checkpoint native fallback
while the host attempt remains active. Never append a native summary of the same evidence to a
custom checkpoint. Report fallback reasons separately from the eventual host outcome.

Catch-up, condensation, and instructed generation share one foreground deadline, including waiting,
inference, validation, and rechecking. Use the resolved observer model policy with explicit routing,
credential resolution, and cancellation handling. Native summarization has separate host controls.
Missing helper credentials need not invalidate an already eligible candidate. A helper timeout can
permit decline; host cancellation ends the attempt. Throwing is not a general fallback mechanism.

Single checkpoint ownership is an operating assumption. Later handlers can replace a candidate.
`turn_end` and `agent_before_settle` handlers can return compaction drafts that Pi stores directly,
bypassing the usual compaction hooks. The success event finds the first matching summary text across
all stored branches, so identical text can identify an older checkpoint. Check selected stored
identity and ownership rather than relying on that match or `fromHook`. Treat other writers'
checkpoints as derived evidence. Handle failure reporting without a preceding before-hook.

### File inventory — `REQ-file-inventory`

A file inventory records recognized file-operation invocations, not proof of successful effects or
arbitrary shell changes. Provide deterministic cumulative file information in custom checkpoints and
a bounded, request-local supplement to native checkpoints while enabled. Reconcile repeated file
blocks and keep inventory fixed to the checkpoint cut; later operations remain in recent history.
Report unavailable or incomplete inventory.

The model-facing supplement does not repair stored checkpoints, TUI rendering, or native metadata
inheritance. Use public context transformation, not undocumented preparation-object mutation.
Supported upstream inheritance may remove this integration need after verification; it is not a
shipping prerequisite.

### Memory activation — `REQ-memory-activation`

Package loading alone does not enable auxiliary inference. `/memory on` enables it; new sessions
default to disabled. Persist enablement and the selected observer model with the lineage. Forks
inherit those records in their ancestry. Unless settings specify a model, select the acting model at
activation. Pin configuration per job and make explicit configuration changes visible.

Disablement cancels package work, prevents late commits, stops custom checkpoint production, and
removes request-local file supplements. It does not erase stored checkpoints or memory. Keep recall
registered and usable while disabled under its normal bounds and access policy, without auxiliary
inference. Native compaction remains available. Re-enablement reconstructs eligible lineage state
and handles missing coverage before supplying a custom checkpoint.

Provide status, disablement, and configuration inspection through commands usable interactively and
noninteractively, with validated file-based settings. Status reports the effective model, coverage,
pending work, capacity degradation, fallback reasons, and original-access policy. No settings dialog
or per-update approval interface is required.

### Resource budgets — `REQ-resource-budgets`

Enforce documented finite limits on observation, foreground preparation, retries, concurrency,
checkpoint size, and recall. Bound maintained-context input and output without silently dropping
required items to meet a target. Account for auxiliary work, failures, fallback, recall, and acting
work without double-counting; mark unavailable usage as unknown.

### Request stability — `REQ-request-stability`

Keep fixed checkpoint rendering idempotent and deterministic, background revisions out of the acting
prefix, and tool definitions stable across enablement changes. Put stable observer instructions and
schemas before variable inputs. Lineage correctness, access revocation, and required corrections
take precedence over cache stability. Stable tool definitions do not determine tool permissions.

## Implementation-defined choices

Document record and argument schemas, source-reference encoding, remaining command spelling,
settings locations and reload triggers, scheduling, and model-aware numerical defaults. Document
settings precedence while preserving the personal-only original-access policy. These choices cannot
introduce unbounded work, change the lineage's selected model implicitly, or weaken failure
reporting. Provider-specific prefix reuse, replay/warming, and immutable checkpoint segments are
post-MVP experiments. Background pre-condensation is not required.

## Conformance scenarios

Use local fixtures and scripted providers for automated checks, with no real-model calls. The
following scenarios check mechanics and preservation of supplied accepted state. An early scripted
native-baseline harness is recommended for host integration. Separately authorized, bounded,
supervised evaluations compare extracted information and subsequent actions with native Pi; these
checks do not establish semantic parity, provider-cache savings, or lower total cost.

| Requirement                 | Input and action                                                                                                                                  | Expected output or state change                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-session-continuity`    | Supply accepted items in every applicable category, a prior baseline, exact identifiers, and quoted constraints; render a checkpoint.             | Every supplied applicable item is presented; identifiers and quotations are unchanged; baseline information is reconciled with newer evidence.                                                     |
| `REQ-session-continuity`    | Compact the same split turn with and without instructions.                                                                                        | Both checkpoints include the effective request, progress before the cut, and context for the retained continuation.                                                                                |
| `REQ-session-observations`  | Process edited text, a derived summary, and image-bearing records in bounded portions.                                                            | Coverage names only accepted effective text portions; it does not claim images, omitted portions, or summary originals.                                                                            |
| `REQ-session-observations`  | Add an item to empty state; return empty, partial, malformed, unknown replacement/removal, and retried updates; make an append outcome uncertain. | A valid fresh addition is accepted; valid empty output may advance coverage; rejected output changes nothing; retry reconciliation applies one logical update once.                                |
| `REQ-continuation-snapshot` | Omit a decision and obligation; then explicitly remove obsolete context and supply supported obligation retirement.                               | Omission preserves both items; valid explicit operations change only their targets automatically; checkpoint text excludes the operation log.                                                      |
| `REQ-continuation-snapshot` | Accept a batch spanning the cut and a delayed batch about earlier sources; compact while a completion remains in retained history.                | State selection follows source dependencies rather than append time; the checkpoint does not apply the retained completion early; unrepairable preparation falls back.                             |
| `REQ-continuation-snapshot` | Exceed presentation and full-active-set input budgets separately; repeat unchanged failed preparation.                                            | Presentation condensation preserves authoritative obligations; failed repair falls back without an identical repeated attempt; oversized active input suspends observation with a capacity report. |
| `REQ-source-recall`         | Search, browse, and read text edited to remove a synthetic secret; attempt original access through tool arguments and project settings.           | Default results do not return the edited-out original; only a personal opt-in plus explicit original request permits it, with historical attribution.                                              |
| `REQ-source-recall`         | Enable personal original access, change sessions, revoke it, and reuse an old reference or cursor.                                                | The personal policy applies across sessions; revocation denies subsequent original results, including cached or previously referenced content.                                                     |
| `REQ-source-recall`         | Search for an unextracted identifier, exhaust work/output limits, and change the selected view.                                                   | Source discovery needs no observation ID; partial results identify their limits; no-match, unavailable, denied, invalid, and stale-view outcomes remain distinct.                                  |
| `REQ-session-lineage`       | Resume, fork before an observer commit, navigate, or context-edit a source during pending work.                                                   | Only selected-ancestry records reconstruct; copied IDs do not admit foreign state; stale work is rejected; missing pre-fork processing requires catch-up.                                          |
| `REQ-session-lineage`       | Introduce an invalid dependency and an external derived baseline.                                                                                 | Reconstruction stops at valid dependencies; recovery does not invent original coverage or bypass known invalidations.                                                                              |
| `REQ-unified-compaction`    | Leave one prepared text portion or previous summary unprocessed; exercise both retry values, helper timeout, missing credentials, and host abort. | A gap prevents eligibility until accepted catch-up; failed preparation declines without package cancellation; host abort ends the attempt; eligible rendering needs no helper credentials.         |
| `REQ-unified-compaction`    | Use repeated identical summaries, a later replacement handler, a boundary draft, and failure before hook entry.                                   | Ownership follows selected stored state; foreign checkpoints supply only derived evidence; failure reporting does not depend on a matched before-hook.                                             |
| `REQ-file-inventory`        | Alternate custom/native checkpoints and repeat requests, with file invocations on both sides of the cut.                                          | Available earlier inventory appears once and stays fixed; later invocations remain in recent history; incomplete inventory is reported without claiming stored-metadata repair.                    |
| `REQ-memory-activation`     | Load disabled, enable and resume, change settings, then disable with a job and eligible snapshot pending.                                         | Disabled operation performs no observation, custom checkpoint, or supplement; late work cannot commit; recall remains usable; enabled jobs use pinned configuration and inherited ancestry state.  |
| `REQ-resource-budgets`      | Exhaust each configured work limit and supply missing usage counters.                                                                             | Work stops at the documented bound; required items are not silently discarded; each inference is counted once and unavailable usage is unknown.                                                    |
| `REQ-request-stability`     | Compare request fixtures across unchanged state, background updates, and enablement changes.                                                      | Fixed checkpoint text and tool definitions stay stable; background updates do not rewrite the acting prefix; permission revocation still takes effect.                                             |
| `REQ-session-lineage`       | Compact twice with the second cut inside the first checkpoint's retained tail.                                                                    | The applicable prepared previous summary remains an admissible derived baseline despite its later append position; original-source coverage remains separate.                                      |
| `REQ-unified-compaction`    | Supply an eligible prepared candidate and instructions requiring a presentation change.                                                           | The bounded presentation step applies the instructions before return; an unusable candidate triggers reported fallback.                                                                            |

## Explored alternatives

- **Latest accepted state regardless of cut:** can apply retained-history events before their place
  in the conversation. Source horizons govern presentation instead.
- **Complete section rewrites on ordinary updates:** omission can remove still-applicable context;
  explicit operations preserve unmentioned items. Operations need structured identities and output.
- **Unrestricted historical-original recall:** can restore text removed for sensitive content.
  Personal opt-in permits deliberate access; temporary approvals and excluding originals entirely
  were not selected for the MVP.
- **Native summary plus memory sections as first delivery:** duplicates semantic content and changes
  the checkpoint-only design. It remains an optional evaluation comparison.
- **Routine snapshot injection:** adds changing ordinary-request state and another capacity path.
- **Move the cut to observed coverage:** changes Pi's prepared retention policy.
- **Separate gap summarizer or helper-owned recovery checkpoint:** adds another representation or
  inference owner; bounded same-observer catch-up and actual native fallback remain selected.
- **Dropping obligations or condensing authoritative state to fit:** can weaken accepted
  constraints; presentation condensation leaves that authority unchanged.
- **Checkpoints built only from selected observations:** adds selection risk for required context;
  the snapshot itself must supply applicable continuation information.
- **Separate authoritative storage or regeneration on resume:** adds lineage coordination or
  repeated inference; Pi entries follow the selected retention scope.
- **Mandatory archive replay or search during compaction:** adds cost and recovery dependencies;
  attributed derived baselines and optional recall cover the MVP needs.
- **Vectors, knowledge maintenance, and speculative companion APIs:** expand the core before a
  concrete consumer or evaluation establishes their value.

## Supporting evidence

This section is informative and adds no requirements. It links each requirement to the research
behind it and names the outcome that still needs measurement. The
[research index](docs/research/README.md#how-to-read-a-claim) defines the evidence kinds, and the
[evaluation design](docs/research/evidence-and-evaluation.md#proposed-evaluation-design) separates
construction loss, retrieval failure, and incorrect use.

| Requirement                                                                | Supporting evidence                                                                                                                                                                                                                                          | Open measurement                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Session continuity](#session-continuity--req-session-continuity)          | **Host fact:** [native information categories](docs/research/pi-compaction.md#native-checkpoint-information). **Design inference:** [continuation analysis](docs/research/continuity-and-invariants.md).                                                     | Whether checkpoints preserve required information and lead to correct subsequent actions across repeated compactions, compared with native Pi on representative tasks.                                       |
| [Session observations](#session-observations--req-session-observations)    | **Host fact:** [Pi source scope](docs/research/pi-compaction.md#actual-source-coverage). **Design inference:** [observational-memory comparison](docs/research/observational-memory-comparison.md).                                                          | Extraction loss, valid empty acceptance, stale work, and logical commit recovery.                                                                                                                            |
| [Continuation snapshot](#continuation-snapshot--req-continuation-snapshot) | **Design inference:** [structured updates and capacity](docs/research/continuity-and-invariants.md#1-allocate-native-information-without-duplicating-a-summary).                                                                                             | Whether active-set review retires superseded work and keeps needed decisions and context before input capacity becomes limiting.                                                                             |
| [Source recall](#source-recall--req-source-recall)                         | **Host fact:** [original and effective records](docs/research/pi-compaction.md#original-records-and-effective-context). **Design inference:** [retrieval and use](docs/research/evidence-and-evaluation.md#retrieval-construction-loss-and-reader-behavior). | Whether acting models discover and use details omitted by extraction through bounded literal recall, with correct attribution.                                                                               |
| [Session lineage](#session-lineage--req-session-lineage)                   | **Host fact:** [persistence and ancestry](docs/research/pi-compaction.md#persistence-and-selected-lineage).                                                                                                                                                  | Resume, forks, context edits, corruption, and uncertain appends through real host fixtures.                                                                                                                  |
| [Unified compaction](#unified-compaction--req-unified-compaction)          | **Host fact:** [hook outcomes](docs/research/pi-compaction.md#hook-outcomes-failure-and-retry). **Design inference:** [recovery trade-offs](docs/research/continuity-and-invariants.md#2-handle-unprocessed-evidence-at-the-prepared-cut).                   | Whether catch-up recovers enough checkpoints to justify foreground waiting and auxiliary cost; prepared-cut preservation, instruction failure, external checkpoints, and repeated custom/native transitions. |
| [File inventory](#file-inventory--req-file-inventory)                      | **Host fact:** [native inheritance limit](docs/research/pi-compaction.md#file-operation-history-is-an-exception). **Design inference:** [bounded supplement](docs/research/continuity-and-invariants.md#3-define-whole-checkpoint-fallback-and-its-reports). | Whether the supplement preserves useful cumulative context across custom and native checkpoints at reasonable integration cost, including incomplete-source reports.                                         |
| [Memory activation](#memory-activation--req-memory-activation)             | **Host fact:** [session persistence and lineage](docs/research/pi-compaction.md#persistence-and-selected-lineage). **Design inference:** [explicit-activation precedent](docs/research/observational-memory.md#compaction-and-coverage).                     | Disabled observation and file supplement with policy-consistent recall; fork and resume inheritance.                                                                                                         |
| [Resource budgets](#resource-budgets--req-resource-budgets)                | **Design inference:** [evaluation controls](docs/research/evidence-and-evaluation.md#reporting-and-controls).                                                                                                                                                | Foreground delay, bounded work, fallback frequency, observer overhead, and complete task cost.                                                                                                               |
| [Request stability](#request-stability--req-request-stability)             | **Host fact:** [stable checkpoint presentation](docs/research/prompt-caching-and-compaction.md#stable-checkpoint-presentation).                                                                                                                              | Stable constructed requests across unchanged state, measured separately from provider cache behavior.                                                                                                        |
