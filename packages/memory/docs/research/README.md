# Memory design research

Research date: 2026-10-03. This survey supports the draft design of `@orbis/memory`: a small,
independently useful continuation package that can provide evidence to future knowledge packages. It
revisits the former tiered-memory survey against the selected smaller scope and current sources.
Research findings and recommendations are informative; they do not amend the draft SPEC.

The evidence supports keeping the chosen core direction. It also exposes requirements that a small
implementation must still address: complete processing coverage, visible active obligations,
discoverable original evidence, correction ordering, and precise native fallback behavior. No
inspected package or paper establishes that Orbis already achieves native checkpoint parity.

## Reading map

The topic layout follows the earlier survey, with separate modularity and SPEC-evidence documents.
Readers can start with the synthesis below and follow the question they need to resolve.

| Document                                                              | Question it answers                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Memory layers](memory-layers.md)                                     | Which purposes, scopes, representations, and maintenance policies are independent choices?                                        |
| [Agent memory systems](agent-memory-systems.md)                       | What do current frameworks and memory products actually store, expose, and maintain?                                              |
| [Continuity and invariants](continuity-and-invariants.md)             | How should every native category be represented, and what are the recommended answers to the original eight compaction questions? |
| [Evidence and evaluation](evidence-and-evaluation.md)                 | Which results transfer to coding continuation, and how should construction, retrieval, and use be evaluated?                      |
| [Observational-memory packages](observational-memory.md)              | How do the two same-named Pi projects differ, including released and unreleased behavior?                                         |
| [Observational-memory comparison](observational-memory-comparison.md) | What does Mastra add, and which mechanisms are useful or unnecessary for this core?                                               |
| [Pi compaction](pi-compaction.md)                                     | What do Pi 0.99.1 and 1.0.1 expose for summary inputs, persistence, inference, correction, and retry?                             |
| [Prompt caching and compaction](prompt-caching-and-compaction.md)     | How do provider compaction, cache reuse, and Pi's request paths differ?                                                           |
| [Pi cache and compaction ecosystem](pi-cache-compaction-ecosystem.md) | What do Blackhole, cache-oriented compactors, pruning, and cache packages demonstrate?                                            |
| [Modularity and knowledge](modularity-and-knowledge.md)               | How can the core support future companions without adopting their maintenance responsibilities?                                   |
| [SPEC evidence map](spec-evidence.md)                                 | What supports each draft requirement, what remains unproven, and which additions need discussion?                                 |

## Sources and method

The investigation used primary source, published package archives, official documentation, papers,
and the repository's recorded decisions. Each topic identifies source revisions or publication
status where relevant. Mutable documentation was read on the research date. Repository HEAD is not
silently treated as a published release.

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

Additional pins appear in the system and ecosystem documents. The
[earlier survey](https://github.com/kvnxiao/orbis/blob/3627f33eaeeb72b1e985e86f6e6ef3b8e27f4eee/packages/tiered-memory/docs/research/README.md)
remains a historical input. The [decision index](https://github.com/kvnxiao/orbis/wiki/Decisions)
and specific records cited in the modularity analysis explain the former architecture's constraints.

## Synthesis

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
routing and stream wrapper. Native credentials are resolved after a hook declines, correcting the
older survey's ordering assumption.

Custom checkpoint prose becomes later native `previousSummary`. Custom file-operation metadata is
excluded from native metadata inheritance. `/compact` instructions reach the history summarizer, but
not the separate turn-prefix call. Cancellation can suppress the host retry, and a thrown hook error
does not reliably veto native fallthrough. These distinctions affect the recovery contract.

Pi 1.0.1 does not add a supported native-summary correction hook. Current provider compaction APIs
also require representations and replay semantics that Pi's inspected adapters do not preserve.
Provider capability is not automatically an extension capability.

### Prefer the smaller recovery design until evidence justifies more

The [eight-question analysis](continuity-and-invariants.md) recommends native fallback for
incomplete coverage, invalid state, and capacity failure in the initial implementation. Bounded
catch-up remains a candidate if preparation lag makes fallback too common. A separate summary of
only an uncovered span would avoid duplication, but adds another reconciliation path.

Checkpoint-only presentation supports removing the former ordinary-request note-fitting abort. It
also removes the main premise of blanket stale-note cancellation. Visible chronological corrections
differ from off-transcript curation or erasure promises. The latter need a separate contract before
choosing a special correction summarizer or host change.

These are proposals, not settled policies. Native delegation has concrete file-metadata and
split-instruction limitations; the product must decide whether native semantics are sufficient in
those cases. The research should not hide that choice behind the word "fallback."

### Build modularity around evidence and scope

Session entries are a promising persistence candidate if editable external memory and independent
retention are deferred. They do not decide source lifetime, corruption, or fork behavior by
themselves. An external store remains reasonable when those additional responsibilities are needed.

The core can preserve stable evidence references, attribution, verification state, and bounded read
operations before it publishes a companion API. The first concrete companion should determine the
public integration. Project learning and developer preferences need admission, applicability,
contradiction, and retirement policies beyond session continuation.

### Evaluate what the acting model does

Source inspection proves mechanisms, and scripted providers prove selected control-flow properties.
Neither establishes semantic preservation. The proposed evaluation separates construction loss,
retrieval failure, and incorrect use of available evidence. It compares native Pi with the core on
actual continuation tasks as well as category-level checkpoint diagnostics.

The total accounting includes observer work, retries, fallback, retrieval, cache writes and reads
where exposed, and acting work. A smaller checkpoint is not automatically cheaper overall. This
research made no real-model calls and reports no measured Orbis quality or cache savings.

## Updated facts and continuing constraints

Some findings update source behavior or publication status. Others reaffirm cautions already present
in the earlier survey, including the distinction between the two observational projects, processing
coverage versus semantic preservation, and retrieval quality versus coding continuation.

| Question                                                            | Refreshed finding                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Can the same-named observational projects be treated as one design? | They differ in storage, lineage, recall, consolidation, and compaction; Elpapi's released and current catch-up behavior also differ.          |
| Does worker completion or cursor advance prove accepted coverage?   | Partial/empty worker outcomes and scheduling semantics can leave gaps; compare the precise acceptance rule.                                   |
| Does Pi 1.0 resolve the recovery questions?                         | Core compaction is unchanged from 0.99.1; the public-hook limitations remain.                                                                 |
| When does native authentication run?                                | Current native authentication follows hook decline.                                                                                           |
| Do native-shaped custom file details enable native inheritance?     | Hook-produced checkpoint details are explicitly excluded.                                                                                     |
| Does the old cancellation guard follow from the new scope?          | The new presentation and curation scope determine whether its premise exists.                                                                 |
| Is a payload field sufficient for provider compaction?              | Block replay, persistence, stop reasons, and usage integration are also required.                                                             |
| Does every tool change rewrite the Anthropic tool prefix?           | Pi 1.0.1 supports compatible inline additions/redefinitions.                                                                                  |
| Which product and publication descriptions need refreshing?         | Hindsight has additional retention modes; Mem0 OSS is ADD-only; Letta's current SDK uses MemFS; several papers have newer publication status. |
| Does retrieval quality establish successful coding continuation?    | It tests a narrower outcome; task actions and verification need their own evaluation.                                                         |

## Next design discussion

Use the [SPEC evidence map](spec-evidence.md) to discuss only changes supported by these findings.
Settle the MVP's curation and retention promises before persistence. Decide whether native
delegation is sufficient for recovery and instructed compaction, then define any needed catch-up or
rewrite path. Complete the source discovery and category allocation contracts before selecting
budgets and implementation details. Keep the approved core direction unless the discussion
identifies a better option for its actual objective.
