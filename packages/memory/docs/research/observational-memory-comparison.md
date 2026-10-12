---
date: 2026-10-11
questions:
  - What do the latest Mastra release and default-branch source establish about preparation, activation, current-task extraction, reflection, source recall, and effective context compared with the Pi implementations?
observed-in:
  [
    Pi 1.1.0 host baseline,
    Mastra memory 1.37.0,
    Mastra main retrieved 2026-10-11,
    Pi comparison sources retrieved 2026-10-11,
  ]
recheck-when: Mastra changes observation acceptance, activation, extraction, or retrieval, either Pi implementation changes, or the Pi host baseline changes.
---

# Observational memory, activation, and current work

Mastra's latest stable implementation reinforces the distinction between preparing memory and activating it, but does not establish a reason to change Orbis's independent continuation core. It supports current-task extraction during synchronous observation, while background buffering deliberately omits those continuation hints. Its reflection rewrites observation text, and its retrieval scopes and processor-owned message history differ from Pi's selected branch and effective-source contracts. These are useful mechanisms and limits, not measured evidence of a continuation advantage for Orbis.

This research informs whether Orbis needs additional reflection or knowledge-maintenance roles, different source recall, or a different checkpoint preparation policy. The comparison uses Amos's current `main` at `78a1efc`, Elpapi's current `master` at `022da5e`, and the latest stable Mastra memory package and default branch retrieved on 2026-10-11. The [detailed Pi comparison](observational-memory.md) records those repositories' current source and release qualifications. Pi 1.1.0 remains the fixed host baseline; Mastra is a host-level context processor with storage integration, not a Pi extension.

All implementation findings below are source or documentation observations at these baselines. Neither package installation nor runtime or model evaluation was performed. Recommendations are reasoning from those findings.

## Three different meanings of reflection

| Approach              | Transformation                                                                                    | Separate consequence                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Amos topics           | File older observations into subject notes and update a retrospective chronology of earlier work. | Mutable external history needs ownership and branch policies.               |
| Elpapi v3 reflections | Append conclusions with supporting observation references; later drop records from active use.    | The active view can shrink while evidence remains in the ledger.            |
| Mastra reflection     | Rewrite the active observation log or a buffered prefix, including previously reflected content.  | Repeated rewriting can lose detail; source recall is a separate capability. |

These are not interchangeable tiers. A package that needs bounded active context can choose among several mechanisms; their shared name does not establish the same retention or correction behavior.

## Mastra baseline and release boundary

**Observed in metadata retrieved 2026-10-11:** The latest npm release is `@mastra/memory` 1.37.0, published 2026-10-11. Its annotated release tag resolves to `81299c921d6f499d4c62f14c38e4d4d88b4fbfae`. The latest default branch, `main`, is `eaa9d12407f4962e94e0d5cd49a643e6e317d60a`, committed 2026-10-11, and also declares 1.37.0. [npm metadata](https://registry.npmjs.org/@mastra%2Fmemory/latest), [release source](https://github.com/mastra-ai/mastra/tree/%40mastra%2Fmemory%401.37.0/packages/memory), [current source](https://github.com/mastra-ai/mastra/tree/main/packages/memory).

**Observed in release-tag and default-branch source:** Their complete `packages/memory/src/` trees are byte-identical. The relevant behavior below therefore belongs to the latest stable release source as well as current development; earlier development-only qualifications do not apply. This comparison does not verify the built npm artifact or execute its dependencies. Current documentation and source links are qualified by the retrieval date above.

### Prepare first, activate separately

**Observed in Mastra memory 1.37.0 and current `main`:** Mastra can prepare observation buffers before older messages need replacement. It activates prepared content under context pressure and can process synchronously when preparation is insufficient. Default message/observation thresholds are 30,000/40,000 estimated tokens; these are activation thresholds, not strict maximum request sizes. [Observation engine](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observational-memory.ts).

Idle activation settings can use provider-specific lifetimes, and an optional setting activates prepared observations after a model or provider change. These are now stable source features. Activation uses the live pending-token count, updates the stored count before swapping buffered chunks, and checks remaining pressure before deciding whether synchronous observation is still needed. Optional `bufferOnIdle` starts preparation at turn end and defaults to false. It processes a safe completed-message prefix rather than an unfinished tool call. These policies control when memory becomes active; they do not prove a provider cache hit or complete semantic preservation. [Activation engine](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observational-memory.ts), [activation lifetime](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/activation-ttl.ts), [step preparation](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observation-turn/step.ts), [turn finalization](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observation-turn/turn.ts).

Reflection is a separate model stage. Buffered reflection can condense an earlier prefix, then combine that result with the newer unreflected tail when activated. Subsequent reflection can process previously reflected text. This differs from Elpapi's separately appended conclusions and Amos's mutable topic notes. [Reflector runner](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/reflector-runner.ts).

This reinforces two different questions for Orbis: has evidence been prepared, and may the host's specific discarded span be replaced now? A background worker completing does not answer both.

### One response can maintain current work, with an async qualification

**Observed in Mastra memory 1.37.0 and current `main`:** Mastra's [built-in extractors](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/built-in-extractors.ts) can return observation text and named continuation fields in one response. The built-in current-task value is a string, not a validated set of protected obligation identities. Current-task extraction asks about primary work, pending/waiting work, and activity begun without approval. Suggested responses are a different extractor. Keeping work state distinct from prescribing the acting model's next sentence is useful for the core snapshot.

However, asynchronous buffering passes `skipContinuationHints: true`, and observer filtering omits current-task and suggested-response extractors. The background observer call also does not receive an abort signal there, although later persistence/extraction steps use the supplied signal. It would be incorrect to claim that every background observation refreshes current work or inherits the acting request's cancellation. [Async buffer](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observation-strategies/async-buffer.ts), [observer runner](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observer-runner.ts).

### Recall is separate from active observation scope

**Observed in Mastra memory 1.37.0 and current `main`:** Source ranges connect observation groups to messages. Raw-message browsing does not require a vector store; semantic search requires a vector store and embedder. The `observations` paging mode also requires search configuration and suitable observation-history storage, so it is not part of the vector-free browsing path. Raw-message results support bounded paging and expansion of individual parts. A thread is one conversation; a resource identifies its user or owning entity. Retrieval is opt-in and defaults to resource scope when enabled, even though active observations default to thread scope. The recall implementation checks resource ownership and, under thread scope, restricts the selected thread. Guidance distinguishes a search miss from missing history and identifies reflection as lossy. [Retrieval configuration](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/index.ts), [recall tools](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/tools/om-tools.ts), [observation paging](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/tools/om-observations.ts), [guidance](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/constants.ts).

This supports bounded discovery plus exact retrieval without making vector search mandatory. It does not supply Pi's branch policy: scope must be defined separately for source selection, active memory, and each retrieval operation.

### Retries are not elapsed deadlines

**Observed in Mastra memory 1.37.0 and current `main`:** The observer and reflector support per-stage retries and failure policy. Defaults are eight retries for transient failures and abort on exhaustion. Continuing after failure retains failed input for later processing; it does not permit advancing the observed boundary or dropping uncovered source. Underlying model retries are disabled in favor of this retry owner. The observer and reflector reject model responses whose finish reason is `other` or `unknown` and retry the whole call; this detects those incomplete responses without proving semantic completeness.

The default backoff totals 247 seconds before jitter and model time. This is finite retry scheduling, not a total elapsed bound. Static in-process coordination maps do not establish distributed locking. [Retry implementation](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/retry.ts), [coordination](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/buffering-coordinator.ts).

### Knowledge maintenance and risky transfer of prompt assumptions

**Observed in Mastra memory 1.37.0 and current `main`:** Optional working-memory maintenance and the separately configured, explicitly experimental `Subconscious` subsystem support broader curation, pinned state, and reminders. This is evidence that compression, retrieval, and maintained knowledge can use different policies. It does not establish that every subsystem was enabled in a reported observational-memory benchmark. [Knowledge subsystem](https://github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory/subconscious), [working-memory extractor](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/working-memory-extractor.ts).

The current [context instruction](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/constants.ts) tells the model to assume a user-stated plan was completed when its planned date has passed, unless evidence contradicts that assumption. That policy should not transfer to the core's distinction between attempted and verified work. This is a prompt-content finding, not a measured rate of false completion.

### Effective context and persistence are separate concerns

**Observed in Mastra memory 1.37.0 and current `main`:** Final persistence and optional idle buffering use the terminal message list accepted by the processor pipeline, rather than always using the list captured when the observation turn began. If observation preparation fails before the next model step, the processor attempts to finalize input and completed outputs before aborting. The catch path suppresses a finalization failure, so this is not a guarantee of durable saving under storage failure. [Processor](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/processor.ts), [turn finalization](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observation-turn/turn.ts).

`beforeObservation` can replace or filter what the observer sees. `afterObservation` and `afterReflection` replace the corresponding text, but do not automatically recompute the separately extracted metadata. Source ranges and progress use the strategy's selected messages, so transformed observer input, stored source, and extracted metadata must be distinguished. These hooks are not evidence of Pi-compatible tracking of effective source versions, original-access restrictions, or authorization after an edit. [Transform hooks](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/transform-hooks.ts), [observer runner](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observer-runner.ts), [async strategy](https://github.com/mastra-ai/mastra/blob/main/packages/memory/src/processors/observational-memory/observation-strategies/async-buffer.ts).

## Comparison against the core

| Concern                 | Amos                                       | Elpapi current development                          | Mastra stable 1.37.0                                           |
| ----------------------- | ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| Preparation             | Background Pi workers                      | In-process role pipeline                            | Buffered observer with activation                              |
| Current work            | Descriptive journey, no protected snapshot | No separate protected snapshot                      | Named task field, omitted in async path                        |
| Older detail            | External topics and historical ledger      | Retained observations and reflections, active drops | Rewritten log with separately configured source paging         |
| Coverage at replacement | Incomplete-span risks                      | Catch-up, gap retention, fallback                   | Preparation and activation checks                              |
| Retrieval               | Ordinary detailed-file access              | Exact-ID recall                                     | Raw-history browsing; search-enabled observation paging        |
| Scope                   | Mixed ledger and mutable session files     | Selected branch                                     | Separate thread/resource settings for active memory and recall |

These differences informed the [memory contract](../../SPEC.md): one response updates current state and observations, source discovery is separate from known-ID lookup, and broader consolidation is deferred. The comparisons establish available mechanisms, not an optimal role pipeline or measured continuation advantage for Orbis.

Retain the approved independent core: one observer maintains current continuation state and observations, accepted processing remains distinct from semantic preservation, and bounded source discovery does not require topic maintenance or vector search. Mastra's latest source supplies additional examples for preparation, activation, and processor-owned persistence; it does not resolve the core's separate obligations for Pi lineage, effective-source coverage, or instruction authority.

## Evidence gaps

Source inspection does not measure extraction quality, successful continuation, prompt-cache reuse, total cost, or distributed failure behavior. The current-task extractor's prompt does not establish faithful retention of every active obligation. Provider-aware activation lifetimes are application policy, not measurements of actual provider cache state. Mastra's experimental knowledge features were not evaluated here, and their availability does not establish their participation in any reported benchmark.

Scripted integration cases could test transformed messages, stale buffers, cancellation, storage failure, retrieval scope, and accepted-output persistence. Separately authorized task evaluations would be needed to compare continuation with native Pi. This research identifies no new decision that requires reopening the approved core.

## Sources

All current source and documentation links were retrieved on 2026-10-11. The [npm registry record](https://registry.npmjs.org/@mastra%2Fmemory), [Mastra repository metadata](https://api.github.com/repos/mastra-ai/mastra), and [release tag](https://github.com/mastra-ai/mastra/tree/%40mastra%2Fmemory%401.37.0/packages/memory) establish the release boundary. [Current Mastra documentation](https://mastra.ai/docs/memory/observational-memory) describes the public preparation, activation, extraction, and retrieval settings; the linked source establishes the path-specific qualifications above. The [current Pi implementation comparison](observational-memory.md) supplies the Amos and Elpapi evidence, and the [Pi compaction analysis](pi-compaction.md) records the fixed Pi 1.1.0 host baseline.
