---
spec: ../SPEC.md
depends-on: [session-state.md]
---

# Recall

This area defines bounded discovery and access to source text and observations. It assumes the shared contract and session-state rules. Recall remains available without auxiliary inference while memory is disabled.

## Evidence access

### REQ-source-recall — Source recall

Expose `memory_recall` with `browse`, `search`, and `read` actions. Discover permitted source text and observations independently, without requiring an extracted identifier first. Search uses literal text with explicit case sensitivity; document chronological ordering. Bound search work, page size, and returned content. Tie opaque references and cursors to lineage and effective source view.

**Intent:** Make evidence discoverable even when observation did not extract it.

Default results use effective text: return replacements and exclude omitted originals from hits, snippets, and reads. Direct access to an omitted source reports omission. Observations citing replaced or omitted text are excluded from the default view and require original access.

Report no matches, unavailable sources, denied original access, stale cursors, invalid arguments, and bounded partial results distinctly. Retrieval does not increase the instruction authority of returned text. The acting agent chooses when recall helps; the MVP uses neither an auxiliary retrieval model nor vectors or a generated filesystem mirror.

**Permitted choices:** Implementations document argument schemas and opaque reference and cursor encodings within these actions, access policy, and bounds.

**Scenarios:**

- Search for an identifier absent from observations but present in permitted source. **Expected:** Discovery does not require an observation ID.
- Search or read text edited to remove a synthetic secret and an observation citing that text. **Expected:** Default results disclose neither the original nor the citing observation.
- Exhaust work or output limits. **Expected:** Partial results identify the applicable bound.
- Change selected source view, then reuse a cursor. **Expected:** Report a stale cursor rather than serving another view's results.

### REQ-original-access — Original access

Access to edited-out originals requires both an explicit original-view request and a valid personal configuration opt-in, disabled by default. The opt-in applies across sessions until revoked. It is read from a user-controlled location outside the project tree; project configuration cannot redirect, substitute, or override that source. Compaction instructions and recall arguments cannot grant permission.

**Intent:** Restrict deliberate access to historical text without treating context edits as archive erasure.

Malformed or unavailable settings do not grant access. Check current permission and source view before returning results, including cached content and previously issued references or cursors. Attribute permitted originals as historical, state their omitted or replaced status, and provide replacement context or a reference to it. These rules also govern package-internal source reads.

This policy does not erase content already copied into observations, snapshots, or checkpoints, and does not sandbox other tools or extensions. An edit has no reliable reason field; do not assume removed text was only compressed. Omission alone does not retire an obligation.

**Note:** This diagram illustrates result access. Every returned result still requires lineage and bound checks.

```mermaid
flowchart TD
    Q["Browse, search, read, or internal source read"] --> O{"Explicit original view?"}
    O -->|No| E["Use effective text; exclude edited-out originals and citing observations"]
    O -->|Yes| P{"Current valid personal opt-in?"}
    P -->|No| D["Deny original access"]
    P -->|Yes| H["Select historical text with edit attribution"]
    E --> V["Check current lineage, source view, permission, and bounds"]
    H --> V
    V --> R["Return permitted results or specific failure"]
```

**Scenarios:**

- Request original text through tool arguments without personal opt-in. **Expected:** Deny access.
- Point project settings at a replacement personal-permission file. **Expected:** The project cannot grant original access.
- Enable personal access and change sessions. **Expected:** Explicit original requests remain permitted with historical attribution.
- Revoke access, then reuse a cached result or old reference. **Expected:** Current permission denies disclosure.
- Make the personal permission file malformed or unavailable. **Expected:** Access fails closed without treating cached permission as current.
