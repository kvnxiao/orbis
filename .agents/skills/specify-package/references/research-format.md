# Research format

Research records the evidence behind a package contract or a repository standard. It is dated
evidence: write it when a decision needs facts, and do not edit it to follow later contract changes.
The SPEC and decision records own the choices, and research never adds requirements.

## Location and index

- Save package research in `packages/<name>/docs/research/` and repository research in
  `docs/research/`.
- Give every research directory a `README.md` index that lists each document and the question it
  answers. Keep dates and versions in the documents themselves.

## Required content

Choose headings that fit the topic. Each document has:

1. A header with the research date. When one version or condition covers the whole document, put the
   marker before its opening statement, such as
   `Research date: 2026-10-05. **Observed in Pi 0.99.1:** Pi exposes one compaction hook.`
2. The questions investigated.
3. Sources pinned to a version, tag, or commit.
4. Findings, with observed findings marked.
5. Implications for the package or standard.
6. Gaps: what remains unobserved or unmeasured.

## Mark observed findings

Mark a claim, table cell, section, or document `**Observed in <version or conditions>:**` when Orbis
inspected source or documentation at that version, ran a bounded probe, or measured an outcome under
the stated conditions, such as `**Observed in 20 paired runs, <model>, Pi 0.99.1:**`. A marked
finding can be rechecked, and its marker states when it can go stale.

- Leave reasoning, comparisons, and claims made by others unmarked.
- State a paper's publication status and evaluation limits, such as
  `Preprint; evaluated on Python repositories only.`
- Treat download counts as adoption signals dated to their retrieval, not as evidence of quality.
- Link the SPEC requirement or decision record instead of restating a selected design.

## Write a synthesis

- Synthesize the evidence instead of substituting a link list or raw tool output.
- Distinguish a shipped feature from an example or proposal, and source inspection from runtime
  verification.
- Cite external sources, not Orbis implementation code.
- In package research, link repository-only files with absolute GitHub URLs, because the package's
  `docs/` directory ships to npm.
- If online access is unavailable, record the local evidence and its limits.

## Replace research

- When a re-check covers the same topic, rewrite the document in place with the new date and
  versions.
- When a different document replaces it, delete it in the same change, link its last version at a
  pinned commit from the replacement, and remove its index row.
