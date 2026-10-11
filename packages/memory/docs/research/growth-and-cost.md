---
date: 2026-10-11
questions:
  - How does complete-snapshot observation scale relative to native compaction?
  - What policy limits repeated presentation overflow without preventing autonomous recovery?
  - Does available native Pi session evidence establish retention loss or checkpoint-only catch-up frequency?
observed-in: [Pi 1.1.0 source, local session metadata inspected 2026-10-11]
recheck-when: Representative repeated-compaction histories, observer scheduling measurements, or authorized continuation evaluations become available.
---

# Snapshot growth, cost, and available continuation evidence

Complete-snapshot observation has a predictable input cost and an unmeasured continuation benefit. Checkpoint capacity can become limiting well before observer input capacity. The recommended design gives ordinary observer jobs a checkpoint maintenance target, suppresses repeated overflowing presentation calls until fit can improve, and continues bounded observation so new evidence can retire work. It does not add a reflector or silently shorten active obligations.

## Two capacity limits

The checkpoint budget limits what can be presented alongside the retained acting conversation. The observer budget limits its complete snapshot, source batch, instructions, protocol, and output reserve. Increasing the observer budget can postpone observation suspension without making the checkpoint fit. Condensing a checkpoint changes neither stored snapshot size nor the next observer's full-state input.

A maintenance target gives the observer a reason to remove obsolete context and keep applicable context concise during the jobs already required for observation. It cannot justify deleting an active constraint merely to hit a size target. Explicit structured retirement remains semantically fallible; the [structured-update analysis](structured-memory-updates.md) distinguishes validation from correct interpretation.

After a repaired presentation exceeds capacity, unrelated new evidence does not itself improve fit. A smaller deterministic rendering, larger available capacity, or changed presentation instructions provides a concrete reason for another bounded attempt. Recording that failure avoids spending the same presentation work on each compaction. Observation can still process completion or cancellation evidence and recover naturally. Native fallback remains available while the host attempt is active; native fallback can fail or lose information too.

An aggregate observer-spend cutoff would provide a stronger cost bound, but requires a reset and recovery policy. Automatically stopping after an arbitrary number of compactions would also prevent processing the evidence that could retire obligations. The recommended core therefore keeps finite job, retry, concurrency, and foreground limits, stops observation when complete input cannot fit, and exposes the total cost. Session-wide spending controls or partial-state maintenance remain separate policies to consider if measurements show persistent paid work without useful recovery. There is no claim that this policy minimizes cost.

## A token accounting model

Let J be observer jobs, S_j snapshot input at job j, B_j new effective evidence, F fixed observer instructions and protocol, and O_j output. Observer input is approximately:

```text
I_observer = sum(B_j) + J * F + sum(S_j)
O_observer = sum(O_j)
```

Repeated evidence, rejected responses, and retries add their actual inputs and outputs again. Catch-up processes evidence missing at compaction. If current state includes evidence retained after the boundary, it instead starts from a compatible earlier state. That checkpoint-only work serves one presentation without committing new accepted memory, but still incurs observer cost. Presentation and native fallback add separate terms. Delta output reduces emitted edits, not repeated full-snapshot input.

If each job adds g snapshot tokens and the initial snapshot is S_0, then:

```text
sum(S_j) = J * S_0 + g * J * (J - 1) / 2
```

The quadratic term is an accounting consequence under linear retained-state growth, not a measured growth curve. Evidence-supported pruning can change that curve. Prompt caching can lower billed input or latency, but changing early snapshot content limits exact-prefix reuse. Even cached input consumes context capacity. [Provider cache conditions and input ordering](prompt-caching-and-compaction.md), [structured-update cost limits](structured-memory-updates.md#memory-growth-caching-and-error-costs).

### Illustrative scale, not a benchmark

Assume the same 200,000 effective evidence tokens, no retries or catch-up, and 1,000 fixed input tokens per observer job. The assumed mean snapshot size includes every active item. These values are examples, not selected defaults or observations of Pi sessions.

| Observer schedule | Mean snapshot | Total observer input | Observer output at 500 tokens per job |
| ----------------- | ------------- | -------------------- | ------------------------------------- |
| 10 jobs           | 2,000 tokens  | 230,000 tokens       | 5,000 tokens                          |
| 40 jobs           | 8,000 tokens  | 560,000 tokens       | 20,000 tokens                         |
| 40 jobs           | 20,000 tokens | 1,040,000 tokens     | 20,000 tokens                         |

For comparison, assume four native summary calls each process 50,000 new evidence tokens, use 1,000 fixed tokens, and produce a 3,000-token checkpoint. Reusing that checkpoint in the final three calls gives approximately 213,000 input tokens and 12,000 output tokens. Native split-turn calls, serialization differences, and failed attempts are excluded from this illustration. Actual Pi and observer inputs can differ, including tool-result reduction. The examples therefore show order of magnitude rather than equal-quality costs.

The prepared-memory path can replace those native calls, but adds presentation when needed and native calls on fallback. Total task cost also includes subsequent acting requests: a useful compact checkpoint might reduce those, while a missing obligation can cause expensive repeated work. Token counts alone cannot establish the net result, and equal token counts at different models or cache rates do not mean equal prices.

## Native Pi evidence and cut-crossing frequency

**Observed in the available local corpus:** A metadata-only audit enumerated all JSONL files in the default Pi session store available on this machine on 2026-10-11. It found four sessions and no compaction entries. The session headers exposed format version 3 but did not identify the Pi runtime version. No raw conversation was published, and no model was called.

This sample has zero qualifying repeated-native-compaction histories. It cannot establish which obligations, decisions, or paths survive native checkpoints, a native loss rate, or a rate of observer batches crossing a cut. A lack of qualifying sessions is not evidence that native Pi preserves everything or that cut crossing is rare. An observer scheduler also does not yet exist in this core, so native histories alone would require an explicitly modeled schedule to estimate crossings.

**Observed in Pi 1.1.0 source:** Native summary prompts request goals, constraints, progress, decisions, exact identifiers, and split-turn context. Subsequent compactions can use a previous summary instead of replaying original history. Custom checkpoint file metadata is excluded from native inheritance, and separate native prefix summarization does not receive compaction instructions. These are mechanisms and concrete integration limits, not measured semantic failure rates. [Native compaction and source scope](pi-compaction.md#native-checkpoint-information), [file inheritance](pi-compaction.md#file-operation-history-is-an-exception), [split instructions](pi-compaction.md#split-turns-and-manual-instructions).

The package's problem statement rests on an explicit current-state and evidence-discovery contract that native summary generation does not supply. Its proposed benefit remains a hypothesis. Factory and Anthropic results motivate evaluation but do not measure native Pi losses; see [evidence and evaluation](evidence-and-evaluation.md).

### Why the earlier basis remains necessary

A semantic update can use source on both sides of a later cut. For example, a batch processes an unfinished task and its completion, but Pi retains the completion after the cut. Rendering that batch's final state before the retained completion would apply it early. Filtering citations cannot reliably undo the semantic update, because the model may not cite every contributing source.

Keeping observation behind recent history can reduce this case. It prevents it only when the scheduling bound actually remains before Pi's eventual cut, including boundaries that keep tool calls together with their results, model or retention changes, delayed jobs, and edits. A fixed lag is not a measured guarantee. The [Pi runtime probe](pi-runtime-feasibility.md#prepared-checkpoint-and-split-turn-evidence) establishes available prepared source and cut mechanics; it does not measure a production schedule's crossing rate.

There is no empirical basis here to replace compatible earlier-state selection and bounded checkpoint-only catch-up with immediate fallback. Keep the current contract. A future offline replay can compare schedules against actual prepared cuts without models, recording how often an accepted batch crosses a cut, missing-source size, availability of valid earlier state whose evidence ends before the cut, and a conservative catch-up work estimate. Only then compare the extra complexity with the rate at which immediate native fallback would discard prepared state.

## Recommended decision branches

| Condition                                               | Recommended path                                                                                                                                         | Reconsider when                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Ordinary snapshot growth still fits observer input      | Pass a checkpoint maintenance target and process evidence-linked retirement in the existing observer                                                     | Unsupported removals or poor compression persist in measured continuation tasks                         |
| Repaired presentation still overflows                   | Fall back and suppress presentation inference until fit can improve                                                                                      | Suppression blocks useful recovery despite unchanged deterministic size; evaluate a bounded alternative |
| Applicable obligations alone exceed checkpoint capacity | Preserve them in accepted state and use native fallback; continue bounded observation for retirement evidence                                            | Sustained costs exceed measured recovery benefit; define an aggregate suspension and reset policy       |
| Complete observer input cannot fit                      | Suspend with a capacity report; recover through a permitted budget or model that fits complete input, or a user-selected branch with smaller valid state | Real suspension frequency justifies evaluating partial-state input and its selection losses             |
| Cut-crossing frequency is unknown                       | Keep before-cut state and bounded checkpoint-only catch-up                                                                                               | Offline replay provides enough cases to compare immediate fallback meaningfully                         |
| Quality or cost remains unmeasured                      | Use scripted integration checks, then separately authorized matched continuation evaluation                                                              | Results identify extraction, retirement, presentation, recall, or acting-use failure specifically       |

The branches preserve the autonomous single-observer design. They do not prescribe internal response schemas, scheduler algorithms, or numerical defaults. Those choices need executable plans and measured limits after approval of the written contract.
