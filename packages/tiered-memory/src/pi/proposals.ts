import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import { assessRevision, evidenceMatches, sourceReferences } from "../domain/evidence.ts";
import { validateProposal } from "../domain/proposal.ts";
import type { ConflictReason, MemoryProposal, NoteDependency } from "../domain/proposal.ts";
import { recoverFailure } from "../storage/files.ts";
import type { StorageServices } from "../storage/services.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { StoreCommitResult } from "../storage/store.ts";
import { sameBase, selectedAs, selectedPointer } from "./lineage.ts";
import type { LineageState, ProposalBinding, ProposalContent } from "./lineage.ts";
import {
  appendReference,
  blockingReferences,
  referencesIn,
  tryConfirmReference,
} from "./revision-references.ts";
import type { StorageSession } from "./storage-binding.ts";

/**
 * Report how far a commit got: `registered` carries the records its source registration returned,
 * and `committed` carries the revision id of the durable head.
 */
export type CommitProgress =
  | { stage: "registered"; records: readonly SourceRecord[] }
  | { stage: "committed"; revisionId: string };

/**
 * Carry the binding fields a proposal captures before its content exists: everything except the
 * content and its note dependencies.
 */
export type ProposalFrame = Omit<MemoryProposal, keyof ProposalContent | "noteDependencies">;

/**
 * Capture a proposal frame bound to the branch leaf, `sourceIds`' evidence, the configuration, and
 * the latest head, before worker inference starts; a frame is never rebound to another selection.
 *
 * `sourceIds` must be in `sources`, which defaults to the records registered in `storage.sources`;
 * a range reference needs its entry's record. A worker passes the active branch's current
 * projection, which the commit's registration then writes.
 *
 * @throws Error, checked in this order, when:
 *
 *   - A damaged revision reference makes the lineage ambiguous; the message names the first blocking
 *     entry.
 *   - Reconciliation has not completed for the current configuration, or it failed.
 *   - Reconciliation left an orphan head unresolved; the message names the head.
 *   - A reference is pending.
 *   - The selected revision is unavailable.
 *   - A detected external change to the current-work note awaits recording.
 *   - No configuration is current, or the branch has no leaf.
 *   - A source id is unregistered.
 */
export function captureFrame(
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  sourceIds: readonly string[],
  sources: readonly SourceRecord[] = storage.sources.sources,
): ProposalFrame {
  const { selected } = binding.lineage;
  const refusal = lineageRefusal(binding, ctx.sessionManager.getBranch(), storage.store.projectId);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  const anchorId = ctx.sessionManager.getLeafId();
  if (binding.dependencyFingerprint === undefined || anchorId === null) {
    throw new Error("Memory storage cannot capture a proposal without a configuration and leaf.");
  }
  const { references, evidenceFingerprint } = sourceReferences(sources, sourceIds);
  return {
    sessionId: storage.store.sessionId,
    projectId: storage.store.projectId,
    anchorId,
    sourceIds: references,
    evidenceFingerprint,
    dependencyFingerprint: binding.dependencyFingerprint,
    configurationRevision: binding.configurationRevision,
    expectedRevision: binding.latestRevision,
    baseRevision: selectedPointer(selected),
    excludedInheritedNotes: selected.state === "selected" ? [...selected.invalidNotes] : [],
    curatedNotes: Object.keys(storage.store.curatedNotes),
  };
}

/**
 * Complete a frame with content produced after capture.
 *
 * `noteDependencies` names a dependency for every note in `content.notes`; their references must be
 * registered or retained from the base revision.
 *
 * @throws Error from `validateProposal` when the result is invalid.
 */
export function proposalFrom(
  frame: ProposalFrame,
  content: ProposalContent,
  noteDependencies: Readonly<Record<string, NoteDependency>>,
): MemoryProposal {
  return validateProposal({
    ...structuredClone(frame),
    ...structuredClone(content),
    noteDependencies: structuredClone(noteDependencies),
  });
}

/**
 * Capture a proposal bound to the branch leaf, its evidence, the configuration, and the latest
 * head, with each written note depending on every captured source.
 *
 * @throws The refusals of `captureFrame`, in its order, and the errors of `validateProposal`.
 */
export function captureProposal(
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  content: ProposalContent,
  sourceIds: readonly string[],
): MemoryProposal {
  const frame = captureFrame(storage, ctx, binding, sourceIds);
  const dependency = { sourceIds: frame.sourceIds, evidenceFingerprint: frame.evidenceFingerprint };
  return proposalFrom(
    frame,
    content,
    Object.fromEntries(Object.keys(content.notes).map((name) => [name, dependency])),
  );
}

/**
 * Return the first lineage or readiness condition that refuses proposals on `branch`, in the order
 * `captureFrame` documents, or `undefined` when none applies.
 */
export function lineageRefusal(
  binding: ProposalBinding,
  branch: readonly SessionEntry[],
  projectId: string,
): string | undefined {
  const { selected, pending } = binding.lineage;
  const [blocking] = blockingReferences(branch, projectId, selected);
  if (blocking !== undefined) {
    return `Memory lineage is ambiguous: damaged revision reference entry ${blocking.entryId} can hide a newer revision.`;
  }
  if (binding.reconciliation === "reconciling") {
    return "Memory storage is reconciling with the current settings and models.";
  }
  if (binding.reconciliation === "failed") {
    return "The latest memory reconciliation failed.";
  }
  if (pending.state === "unresolved") {
    return `Memory revision ${pending.revisionId} is not recorded on this branch and cannot be attached.`;
  }
  if (pending.state !== "none") {
    return "A committed memory revision awaits its branch reference.";
  }
  if (selected.state === "unavailable") {
    return `The selected memory revision is unavailable: ${selected.reason}`;
  }
  return binding.pendingCuration
    ? "A detected external change to the current-work note awaits recording."
    : undefined;
}

const evidenceStillValid = Effect.fnUntraced(function* (
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  proposal: MemoryProposal,
  sources?: readonly SourceRecord[],
): Effect.fn.Return<boolean, unknown> {
  const projectId = storage.store.projectId;
  const base =
    proposal.baseRevision === null
      ? undefined
      : yield* storage.store.inheritRevision(proposal.baseRevision);
  const current = sources ?? (yield* storage.sources.current(ctx.sessionManager));
  if (
    !ctx.sessionManager.getBranch().some((entry) => entry.id === proposal.anchorId) ||
    !evidenceMatches(current, proposal, projectId)
  ) {
    return false;
  }
  if (proposal.baseRevision === null) {
    return true;
  }
  const excluded = new Set(proposal.excludedInheritedNotes);
  return (
    base !== undefined &&
    assessRevision(current, {}, base, projectId, storage.store.sessionId).invalidNotes.every(
      (name) => excluded.has(name),
    )
  );
});

/**
 * Register sources once, check the captured evidence, and commit the proposal.
 *
 * Registration writes `sources.json` before `MemoryStore.commit` takes the project lock. The
 * commit's `validate` projects current effective sources without writing and compares them and
 * `binding()` with the captured proposal. After that projection it reads the branch and the current
 * selection and returns `lineage` when:
 *
 * - A damaged revision reference makes the selection ambiguous.
 * - Reconciliation has not completed for the current configuration, or it failed.
 * - A committed revision's branch reference is still pending, or an orphan head is unresolved.
 * - The selection is unavailable.
 * - The selection no longer names the proposal's base revision; a `null` base matches only `none`.
 *
 * It returns `curation` while a detected external change to the current-work note awaits recording.
 * The reasons rank `configuration`, then `curation`, then `lineage`, then `evidence`. `record` runs
 * synchronously with `registered` from `SourceRegistry.register`'s `onRegistered`, in the step that
 * replaces the registry cache. It runs with `committed` as soon as the head is durable. A caller
 * interrupted after either write therefore still learns that progress.
 *
 * @throws Error when the proposal fails `validateProposal`.
 * @throws The failures of `SourceRegistry.register` and `MemoryStore.commit`, unchanged.
 */
export const commitProposal = Effect.fnUntraced(function* (
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: () => ProposalBinding,
  proposal: MemoryProposal,
  record: (progress: CommitProgress) => void,
): Effect.fn.Return<StoreCommitResult, unknown, StorageServices> {
  const captured = validateProposal(structuredClone(proposal));
  const records = yield* storage.sources.register(ctx.sessionManager, {}, (registered) => {
    record({ stage: "registered", records: registered });
  });
  const evidenceValid = yield* evidenceStillValid(storage, ctx, captured, records);
  const validate: Effect.Effect<ConflictReason | undefined, unknown> = Effect.gen(function* () {
    const stillValid = evidenceValid && (yield* evidenceStillValid(storage, ctx, captured));
    const current = binding();
    if (
      current.configurationRevision !== captured.configurationRevision ||
      current.dependencyFingerprint !== captured.dependencyFingerprint
    ) {
      return "configuration";
    }
    if (current.pendingCuration) {
      return "curation";
    }
    const branch = ctx.sessionManager.getBranch();
    if (
      lineageRefusal(current, branch, storage.store.projectId) !== undefined ||
      !sameBase(captured.baseRevision, current.lineage.selected)
    ) {
      return "lineage";
    }
    return stillValid ? undefined : "evidence";
  });
  return yield* storage.store.commit(captured, {
    validate,
    onHeadDurable: (revisionId) => {
      record({ stage: "committed", revisionId });
    },
  });
});

/**
 * Append and confirm the branch reference of a committed revision and return the lineage it
 * produces.
 *
 * Appends before any await, and only when the branch has no reference to the revision for the
 * project; confirms the reference either way. A failed confirmation leaves the reference `appended`
 * for the next refresh to confirm; only interruption fails the returned Effect.
 */
export const attachCommitted = Effect.fnUntraced(function* (
  pi: Pick<ExtensionAPI, "appendEntry">,
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  lineage: LineageState,
  revisionId: string,
): Effect.fn.Return<LineageState> {
  const store = storage.store;
  const branch = referencesIn(ctx.sessionManager.getBranch(), store.projectId);
  if (!branch.some((entry) => entry.revisionId === revisionId)) {
    appendReference(pi, store, revisionId);
  }
  const reference = { projectId: store.projectId, revisionId };
  const confirmed = yield* tryConfirmReference(ctx.sessionManager.getSessionFile(), reference).pipe(
    Effect.catchCause((cause) => recoverFailure(cause, () => false)),
  );
  return confirmed
    ? { selected: selectedAs(revisionId, store.sessionId), pending: { state: "none" } }
    : { ...lineage, pending: { state: "appended", revisionId } };
});
