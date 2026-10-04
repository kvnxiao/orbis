# Memory design research

Research date: 2026-10-04. This survey supports the draft design of `@orbis/memory`: a small,
independently useful continuation package that can provide evidence to future knowledge packages. It
examines current primary sources, implementation mechanisms, and evaluation evidence. Research
findings and recommendations are informative; they do not amend the draft SPEC.

The evidence supports keeping the chosen core direction. It also exposes requirements that a small
implementation must still address: complete processing coverage, visible active obligations,
discoverable original evidence, correction ordering, and precise native fallback behavior. No
inspected package or paper establishes that Orbis already achieves native checkpoint parity.

## Reading map

Start with the synthesis below, then use the topic documents to examine a specific design question.
The SPEC evidence map separates source facts, product choices, and outcomes that need evaluation.

| Document                                                              | Question it answers                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Memory layers](memory-layers.md)                                     | Which purposes, scopes, representations, and maintenance policies are independent choices?                                      |
| [Agent memory systems](agent-memory-systems.md)                       | What do current frameworks and memory products actually store, expose, and maintain?                                            |
| [Continuity and invariants](continuity-and-invariants.md)             | How should every native category be represented, and what are the recommended answers to the eight compaction policy questions? |
| [Evidence and evaluation](evidence-and-evaluation.md)                 | Which results transfer to coding continuation, and how should construction, retrieval, and use be evaluated?                    |
| [Observational-memory packages](observational-memory.md)              | How do the two same-named Pi projects differ, including released and unreleased behavior?                                       |
| [Observational-memory comparison](observational-memory-comparison.md) | What does Mastra add, and which mechanisms are useful or unnecessary for this core?                                             |
| [Pi compaction](pi-compaction.md)                                     | What do Pi 0.99.1 and 1.0.1 expose for summary inputs, persistence, inference, correction, and retry?                           |
| [Prompt caching and compaction](prompt-caching-and-compaction.md)     | How do provider compaction, cache reuse, and Pi's request paths differ?                                                         |
| [Pi cache and compaction ecosystem](pi-cache-compaction-ecosystem.md) | What do Blackhole, cache-oriented compactors, pruning, and cache packages demonstrate?                                          |
| [Modularity and knowledge](modularity-and-knowledge.md)               | How can the core support future companions without adopting their maintenance responsibilities?                                 |
| [SPEC evidence map](spec-evidence.md)                                 | What supports each draft requirement, what remains unproven, and which additions need discussion?                               |

## Sources and method

The investigation used primary source, published package archives, official documentation, and
papers. Each topic identifies source revisions or publication status where relevant. Mutable
documentation was read on the research date. Repository HEAD is not silently treated as a published
release.

Installed Pi 0.99.1 was compared with published Pi 1.0.1, the latest release verified during this
pass. The latter was released on 2026-10-03 at 16:14 UTC. Relevant core compaction files were
byte-identical, while surrounding provider and tool behavior changed. This is source inspection, not
a claim that an Orbis implementation was tested with Pi 1.0.1.

Important comparison pins are:

| Project                     | Inspected source and release qualification                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi                          | [1.0.1 / a7229dd](https://github.com/earendil-works/pi/tree/a7229ddc21810d6245105978033b7df645ecc2f7), compared with installed 0.99.1.                                                                                                    |
| Amos observational memory   | [78a1efc](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e), manifest 0.1.0; no verified GitHub release.                                                                            |
| Elpapi observational memory | [886f7a6](https://github.com/elpapi42/pi-observational-memory/tree/886f7a6628d10ea420eb6ceecaee36691489b2fb), newer than released 3.1.4 despite the same manifest version.                                                                |
| Mastra memory               | [Stable 1.35.0](https://github.com/mastra-ai/mastra/tree/b21e46e19b469a25c8896bcee90afd58d6f1a890), separately compared with [HEAD](https://github.com/mastra-ai/mastra/tree/b2433eb8d90597295de0327c3756d7a2b83a65ff) at 1.36.0-alpha.2. |
| Blackhole                   | [be64de8](https://github.com/k0valik/pi-blackhole/tree/be64de823f27d8be4195dbe0734409017b05240f), npm 0.5.10.                                                                                                                             |
| Hermes                      | [d5e2d13](https://github.com/chandra447/pi-hermes-memory/tree/d5e2d1384b2f78d7a304f24383ad3aae1da5749e), manifest 0.9.10 with substantial Unreleased changes.                                                                             |

Additional pins appear in the system and ecosystem documents. Each comparison distinguishes
published releases, inspected source revisions, and mutable documentation.

## Synthesis

The core's scope follows its responsibilities: continuation and evidence access belong here; broader
knowledge maintenance belongs in companions. Choose mechanisms for how well they satisfy those
requirements. Reducing implementation work alone is not a reason to omit needed core behavior.

### Keep the selected core

The chosen product combines a continuation snapshot and source-linked observations in one observer
response. Checkpoints present the snapshot; recall accesses older observations and recorded source.
It does not require topics, a generated journey, reflection, or project-learning maintenance.

This separation remains coherent. The snapshot makes active obligations visible. Observations
organize evidence, while original source can recover omitted details. Future companions decide which
experience justifies broader knowledge. A retained observation does not become a reusable lesson
merely because it is old or frequently retrieved.

The research does not select a universal memory hierarchy, shared database, or plugin framework. It
also does not show that removing all interpreted memory and keeping raw search would be worse. That
is a useful diagnostic alternative, but changing the settled observer direction requires relevant
evaluation rather than terminology or a vendor score.

### Treat native parity as an information and action obligation

Native Pi asks for goals, constraints, progress, blockers, decisions and rationale, next steps, and
critical context. It supplies the previous summary as input and adds split-turn handling and file
lists. The [parity table](continuity-and-invariants.md#category-level-parity) maps every category to
proposed core content and identifies the remaining gap.

Recall cannot establish parity merely because omitted obligations exist somewhere in storage.
Conversely, native compaction is not lossless: it truncates serialized tool text, omits images,
separates some turns, and relies on earlier summary text. Evaluate the actual baseline rather than
an idealized one. No native summary of the same processed evidence should be layered into the
package's checkpoint; that settled exclusion remains.

### Use the newer Pi capabilities precisely

Public APIs permit nested inference, credential resolution, selected-lineage reads, custom records,
and custom compaction. They do not provide one operation that reproduces the host's exact native
routing and stream wrapper. Native credentials are resolved after a hook declines.

Custom checkpoint prose becomes later native `previousSummary`. Custom file-operation metadata is
excluded from native metadata inheritance. `/compact` instructions reach the history summarizer, but
not the separate turn-prefix call. Cancellation can suppress the host retry, and a thrown hook error
does not reliably veto native fallthrough. These distinctions affect the recovery contract.

Pi 1.0.1 does not add a supported native-summary correction hook. Current provider compaction APIs
also require representations and replay semantics that Pi's inspected adapters do not preserve.
Provider capability is not automatically an extension capability.

### Complete coverage before replacing source

The selected [compaction policy](continuity-and-invariants.md) uses bounded catch-up through the
existing observer when missing coverage prevents an otherwise eligible checkpoint. Recheck accepted
state afterward and use whole-checkpoint native fallback if coverage or another eligibility
condition still fails. This reuses the core's extraction contract without adding another model role.
A separate summary of only an uncovered span would add another representation to reconcile.

Checkpoint-only presentation does not require an ordinary-request snapshot-fitting abort. It also
avoids repeated standalone snapshot messages that could become stale. Visible chronological
corrections differ from off-transcript curation or erasure promises. The latter need a separate
contract before choosing a special correction summarizer or host change.

The selected recovery direction uses bounded catch-up, presentation-only snapshot condensation, and
instruction-aware checkpoint generation. Their acceptance and failure protocols still need a
complete contract. Native fallback remains the host's summarizer, with deterministic cumulative file
information added to its displayed checkpoint while the core is enabled. That augmentation does not
repair Pi's persisted native summary or its later native metadata inheritance.

### Build modularity around evidence and scope

The MVP follows Pi session retention, uses custom session entries as its authoritative store, and
defers user curation of derived memory. The record format, corruption handling, fork behavior, and
unavailable-source results still need a contract.

The core preserves evidence references, attribution, verification state, and bounded internal read
operations. A public companion API is deferred until a concrete consumer determines its needs.
Project learning and developer preferences need admission, applicability, contradiction, and
retirement policies beyond session continuation.

### Evaluate what the acting model does

Source inspection proves mechanisms, and scripted providers prove selected control-flow properties.
Neither establishes semantic preservation. The proposed evaluation separates construction loss,
retrieval failure, and incorrect use of available evidence. It compares native Pi with the core on
actual continuation tasks as well as category-level checkpoint diagnostics.

The total accounting includes observer work, retries, fallback, retrieval, cache writes and reads
where exposed, and acting work. A smaller checkpoint is not automatically cheaper overall. This
research made no real-model calls and reports no measured Orbis quality or cache savings.

## Selected directions and open details

These choices guide the completed contract; the draft SPEC has not yet incorporated them.

| Area                         | Selected direction                                                                                                    | Remaining detail                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkpoint meaning           | Self-contained semantic continuation snapshot plus deterministic file information.                                    | Exact representation, freshness, and evaluation thresholds.                                                                                                   |
| Accepted obligations         | Preserve unchanged obligations mechanically; require explicit evidence-linked changes.                                | Proposal schema, source validation, and commit/recovery protocol. Initial extraction can still miss meaning.                                                  |
| Exact wording                | Summarize intent while retaining wording whose paraphrase would weaken constraints, scope, or acceptance.             | Extraction and validation tests.                                                                                                                              |
| Missing observation coverage | Bounded catch-up using the existing observer, then whole-checkpoint native fallback.                                  | Source domain, oversized inputs, deadlines, cancellation, and stale work.                                                                                     |
| Oversized snapshot           | Bounded presentation-only condensation, then fallback if ineligible.                                                  | Canonical state remains unchanged; semantic sufficiency needs evaluation.                                                                                     |
| Compaction entry paths       | Shared hook for automatic, manual, SDK, and extension-triggered compaction; supplied instructions shape presentation. | Instruction failure and unavailable evidence, without changing protected canonical obligations.                                                               |
| Fallback file information    | Host native summarization plus deterministic augmentation of the displayed checkpoint.                                | Stable inventory at the checkpoint boundary is the cache recommendation; missing-inventory behavior remains open. No repaired native persistence is promised. |
| Storage and retention        | Pi custom session entries, following session lifetime; derived-memory curation deferred.                              | Record schema, reconstruction, corruption, ephemeral sessions, and fork identity.                                                                             |
| Historical recall            | Preserve original source with historical/effective status and applicable replacement information.                     | Precise archived-view semantics; omission is not automatic obligation retirement.                                                                             |
| Recall surface               | One model-callable tool with bounded browse, text search, and exact reads.                                            | Arguments, pagination, errors, and invocation guidance. No vector database or semantic retrieval in the MVP.                                                  |
| Companion integration        | Evidence identity and narrow internal reads now; public external-retrieval integration after MVP.                     | Concrete consumer/provider API and broader knowledge policies.                                                                                                |

The [cache analysis](prompt-caching-and-compaction.md) compares stable construction, request replay,
warming, and immutable checkpoint segments. The cache-specific MVP choice remains open. None of
these choices promises lossless extraction, measured native parity, or lower total cost.

## Next design discussion

Use the [SPEC evidence map](spec-evidence.md) to discuss only changes supported by these findings.
Complete the remaining source, acceptance, failure, and budget contracts within the selected
directions above. Decide the scope of cache optimization after distinguishing summary generation
from first and later continuation costs. Define observer scheduling/model controls, recall behavior,
and evaluation acceptance before implementation. Reopen a selected direction when evidence reveals a
better way to meet the continuation objective.
