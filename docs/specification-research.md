# Evidence for package specifications

Explicit behavioral contracts and checks have supporting evidence. A universally
best Markdown structure for specification-driven coding agents does not emerge
from the sources reviewed here. Orbis uses a small contract structure and adapts
its sections to each package.

This review covers sources available on 2026-09-08 and records publication status
and paper versions. Findings concern the authors' evaluated settings;
the Orbis recommendations are design judgments, not measured Orbis results.

## Specification approaches

| Approach                                                                                                           | Relevant practice                                                                                                                                | Orbis application and boundary                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Symphony specification](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/SPEC.md) | A separately implementable contract defines behavior, state, failures, implementation choices, and conformance.                                  | Keep a durable package `SPEC.md`; select domain sections for the Pi extension being specified.                                                                                       |
| [W3C Specification Guidelines](https://www.w3.org/TR/qaframe-spec/)                                                | A conformance clause identifies what conforms and which obligations apply; normative requirements are distinguishable from informative material. | State that all bespoke package requirements apply. Label examples and allowed variation. Profiles and partial conformance levels are not required.                                   |
| [GitHub Spec Kit template](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)                | User stories have independently testable outcomes, acceptance scenarios, requirements, and measurable success criteria.                          | Define observable outcomes before implementation tasks. Feature branches, story priorities, and a fixed document hierarchy are not part of the Orbis package template.               |
| [OpenSpec concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)                             | Requirements have scenarios; proposed changes are distinct from the agreed specification.                                                        | Link checks to requirements and distinguish proposed contract changes from approved behavior. Orbis uses version control and review without adopting change and archive directories. |
| [CommonMark specification repository](https://github.com/commonmark/commonmark-spec)                               | Input/output examples in the specification also serve as conformance tests; reference implementations are separate.                              | Make expected outcomes usable by independent implementations. Pi lifecycle and interaction requirements also need integration or manual checks.                                      |
| [Gherkin reference](https://cucumber.io/docs/gherkin/reference/)                                                   | Scenarios describe initial context, an event, and an observable result.                                                                          | Use that relationship in plain Markdown. A scenario language or test-framework dependency is unnecessary.                                                                            |

These sources establish specification-writing practices and concrete workflows.
Their existence does not demonstrate improved coding-agent performance. Stable
`REQ-###` identifiers are an Orbis traceability convention, not an empirically
validated prompt technique.

## Scholarly evidence

### Clarification can help, but additional questions can hurt

[HumanEvalComm](https://arxiv.org/html/2406.00215v3), Wu and Fard, was published in
_ACM Transactions on Software Engineering and Methodology_ in 2025; the
[authors' repository](https://github.com/jie-jw-wu/human-eval-comm#reference) identifies
the journal and DOI. The benchmark introduces ambiguity, inconsistency, and
incompleteness into small programming tasks. Its Okanagan workflow improves some
results with clarification, but gains depend on the base model. Unnecessary
questions can reduce performance on the original tasks. Answers are simulated by
an LLM, and question-quality scoring is sensitive to prompts.

**Orbis judgment:** Resolve discoverable facts before questioning the user. Ask
about decisions that affect the contract, preserve settled answers, and stop
asking when the relevant uncertainty is resolved. This study does not establish
that frontier rounds or either proposed UI outperform other interfaces.

### Checkable conditions can detect defects without proving completeness

[Can Large Language Models Transform Natural Language Intent into Formal Method
Postconditions?](https://arxiv.org/html/2310.01831v2), Endres and colleagues, was
published in _Proceedings of the ACM on Software Engineering_, FSE 2024; the
[conference program](https://2024.esec-fse.org/details/fse-2024-research-papers/51/Can-Large-Language-Models-Transform-Natural-Language-Intent-into-Formal-Method-Postco)
confirms the venue. The study evaluates generated assertions for correctness and
their ability to reject buggy behavior. Across model and prompt variants,
postconditions detect 64 of 525 considered Defects4J bugs. This is assertion
generation from natural-language intent, not end-to-end package construction.

**Orbis judgment:** Specify expected results and relevant invariants precisely
enough to check. An assertion that passes correct code must also distinguish
relevant violations; its existence does not establish complete coverage.

### Contract-driven test generation improves detection at additional cost

[Grounding AI Agents in Contracts](https://arxiv.org/html/2608.17177v2), Tufano and
colleagues, is an August 2026 preprint whose authors report acceptance for SpecOps
2026, co-located with SPLASH. In a comparison on 90 historical Google bugs,
documenting contracts before generating tests improves detection by 9.8 percentage
points across five attempts, with reported statistical significance. The
single-attempt difference is not statistically significant. Aggregate token use
increases 38%. The study uses one model family, one organization, and fixes
limited to a single source file.

**Orbis judgment:** Include preconditions, expected state changes, failure cases,
and ordering where behavior depends on them. The result supports targeted contract
reasoning; it does not establish a superior general-purpose SPEC template or a
productivity gain.

### More repository context does not reliably improve task completion

[Evaluating AGENTS.md](https://arxiv.org/html/2602.11988v2), Gloaguen and colleagues,
compares absent, generated, and developer-provided repository instructions using
SWE-bench Lite and CTXbench. The June 2026 revision reports no general improvement
in task success and more than 20% average inference-cost overhead. Results vary
by model and context source. The
[authors' publication record](https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd)
lists MemAgents at ICLR 2026, a workshop rather than the main conference.

**Orbis judgment:** Keep shared instructions short, link detailed references, and
omit redundant repository summaries. This is adjacent evidence about context
files; it does not show that task-specific behavioral specifications are harmful.

### Repository inspection has promising but mixed workflow evidence

[Spec Kit Agents](https://arxiv.org/html/2604.05278v1), Taghavi and Bhavani, is an
April 2026 preprint. Across 32 feature tasks, adding repository discovery and
validation to its full workflow raises an LLM-judged quality score from 3.51 to
3.66 out of 5. In completed paired runs, the original full workflow takes 24.0
minutes and the augmented workflow takes 37.2 minutes. The small human
comparison favors the original workflow in 19 votes, the augmented workflow in
8, and ties in 33, across six tasks. Direct-coding and full-workflow conditions
have different time budgets.

**Orbis judgment:** Verify referenced APIs, paths, and dependencies during design
and task planning. The evaluation does not justify treating extra phases,
artifacts, or agents as a general quality improvement.

### Specifications need review

[SpecBench](https://arxiv.org/html/2605.30314v1), Hamblin and colleagues, is a May
2026 preprint evaluating agents against deficiencies raised in historical RFC
reviews from Kubernetes, React, Rust, TVM, and vLLM. Its best reported score is
44.4%. The metric credits matches to a weighted set of historical critiques under
a bounded prediction budget; it is not a general specification-correctness rate.
LLMs classify and match critiques, and the metric does not credit valid concerns
outside the historical set.

**Orbis judgment:** Review assumptions, omissions, contradictions, and acceptance
criteria before deriving implementation tasks. Generated specifications and
generated tests can share the same misunderstanding; agreement between them is
insufficient evidence of user intent.

### Adoption data does not establish effectiveness

[SpecMine](https://arxiv.org/abs/2608.25202v3), Agarwal and colleagues, is a September
2026 revision of an August preprint. It supplies a large public corpus of SDD
artifacts, histories, and links between specifications and code. It supports study
of actual adoption and workflow patterns, but does not establish that a particular
template reduces defects or improves agent productivity.

## Consequences for the Orbis template

The [specification guide](specifications.md) defines the authoring rules. The
template requests the content needed to implement and evaluate the package:

- **Purpose and scope:** the user problem, Pi boundary, and intended implementer.
- **Behavioral contract:** stable `REQ-###` requirements with triggers, results,
  and relevant interface, state, ordering, and failure rules.
- **Explicit variation:** implementation-defined choices, informative examples,
  and unresolved decisions that cannot be treated as approved behavior.
- **Conformance:** the complete required behavior and checks that expose whether
  each requirement is satisfied.

Headings remain adaptable. Requirement identifiers do not correspond one-to-one
with implementation tasks. A small command specification may omit architecture,
persistence, or workflow sections. When those topics affect a planning UI's
observable behavior, its specification defines those contracts.

The reviewed evidence does not establish an optimal question-round size, a best
Markdown table of contents, or the effectiveness of Orbis on Pi. Evaluating Orbis
would require comparable tasks and budgets, independently reviewed acceptance
checks, and measurement of defects, user corrections, completion, time, and cost.
That evaluation remains separate from writing the package specification.
