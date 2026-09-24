import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { assessRevision, evidenceMatches, sourceFingerprint } from "../domain/evidence.ts";
import { validateProposal } from "../domain/proposal.ts";
import type { CommitResult, ConflictReason, MemoryProposal } from "../domain/proposal.ts";
import { cancelledBy } from "../storage/files.ts";
import type { SourceRecord } from "../storage/sources.ts";
import { appendReference, confirmReference, selectedAs, selectedPointer } from "./lineage.ts";
import type { LineageState, ProposalBinding, ProposalContent } from "./lineage.ts";
import type { StorageSession } from "./storage-session.ts";

/**
 * Capture a proposal bound to the branch leaf, its evidence, the configuration, and the latest
 * head.
 *
 * `sourceIds` must be registered in `storage.sources`.
 *
 * @throws Error when a reference is pending, the selected revision is unavailable, no configuration
 *   is current, the branch has no leaf, or a source id is unregistered.
 */
export function captureProposal(
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  content: ProposalContent,
  sourceIds: readonly string[],
): MemoryProposal {
  const { selected, pending } = binding.lineage;
  if (pending.state !== "none") {
    throw new Error("A committed memory revision awaits its branch reference.");
  }
  if (selected.state === "unavailable") {
    throw new Error(`The selected memory revision is unavailable: ${selected.reason}`);
  }
  const anchorId = ctx.sessionManager.getLeafId();
  if (binding.dependencyFingerprint === undefined || anchorId === null) {
    throw new Error("Memory storage cannot capture a proposal without a configuration and leaf.");
  }
  const evidenceFingerprint = sourceFingerprint(storage.sources.sources, sourceIds);
  return validateProposal({
    ...structuredClone(content),
    sessionId: storage.store.sessionId,
    projectId: storage.store.projectId,
    anchorId,
    sourceIds: [...sourceIds],
    evidenceFingerprint,
    dependencyFingerprint: binding.dependencyFingerprint,
    configurationRevision: binding.configurationRevision,
    expectedRevision: binding.latestRevision,
    baseRevision: selectedPointer(selected),
    noteDependencies: Object.fromEntries(
      Object.keys(content.notes).map((name) => [
        name,
        { sourceIds: [...sourceIds], evidenceFingerprint },
      ]),
    ),
    excludedInheritedNotes: selected.state === "selected" ? [...selected.invalidNotes] : [],
  });
}

async function evidenceStillValid(
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  proposal: MemoryProposal,
  sources: readonly SourceRecord[],
): Promise<boolean> {
  const projectId = storage.store.projectId;
  if (
    !ctx.sessionManager.getBranch().some((entry) => entry.id === proposal.anchorId) ||
    !evidenceMatches(sources, proposal, projectId)
  ) {
    return false;
  }
  if (proposal.baseRevision === null) {
    return true;
  }
  const base = await storage.store.inheritRevision(proposal.baseRevision);
  const excluded = new Set(proposal.excludedInheritedNotes);
  return (
    base !== undefined &&
    assessRevision(sources, {}, base, projectId).invalidNotes.every((name) => excluded.has(name))
  );
}

/**
 * Register sources once, commit the proposal, and append and confirm its branch reference.
 *
 * Registration writes `sources.json` before the lock is taken; the store's `validate` callback then
 * compares the evidence checked at that registration and the current `binding()` without writing.
 * An abort of `storage.signal` or `ctx.signal` yields `cancelled` with that signal's reason and is
 * never reported as a conflict. `records` holds the registration's sources for the refresh that
 * follows, and is `undefined` when cancellation came first. After a commit, a failed or cancelled
 * confirmation leaves the reference `appended`, and the next refresh confirms it or reports the
 * error.
 *
 * @throws Error when the proposal fails `validateProposal`, and errors from registration or the
 *   store other than cancellation.
 */
export async function commitProposal(
  pi: Pick<ExtensionAPI, "appendEntry">,
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager" | "signal">,
  binding: () => ProposalBinding,
  proposal: MemoryProposal,
): Promise<{
  result: CommitResult;
  lineage: LineageState;
  records: readonly SourceRecord[] | undefined;
}> {
  const captured = validateProposal(structuredClone(proposal));
  const store = storage.store;
  const signal =
    ctx.signal === undefined ? storage.signal : AbortSignal.any([storage.signal, ctx.signal]);
  let lineage = binding().lineage;
  let records: readonly SourceRecord[];
  let evidenceValid: boolean;
  try {
    signal.throwIfAborted();
    records = await storage.sources.register(ctx.sessionManager);
    signal.throwIfAborted();
    evidenceValid = await evidenceStillValid(storage, ctx, captured, records);
    signal.throwIfAborted();
  } catch (error) {
    if (cancelledBy(signal, error)) {
      return { result: { kind: "cancelled", reason: signal.reason }, lineage, records: undefined };
    }
    throw error;
  }
  const validate = (): ConflictReason | undefined => {
    const current = binding();
    if (
      current.configurationRevision !== captured.configurationRevision ||
      current.dependencyFingerprint !== captured.dependencyFingerprint
    ) {
      return "configuration";
    }
    return evidenceValid ? undefined : "evidence";
  };
  const result = await store.commit(captured, { validate, signal });
  if (result.kind !== "committed" || signal.aborted) {
    return {
      result,
      lineage:
        result.kind === "committed"
          ? { ...lineage, pending: { state: "unappended", revisionId: result.revisionId } }
          : lineage,
      records,
    };
  }
  appendReference(pi, store, result.revisionId);
  lineage = { ...lineage, pending: { state: "appended", revisionId: result.revisionId } };
  const reference = { projectId: store.projectId, revisionId: result.revisionId };
  const confirmed = await confirmReference(
    ctx.sessionManager.getSessionFile(),
    reference,
    signal,
  ).catch(() => false);
  if (confirmed) {
    lineage = {
      selected: selectedAs(result.revisionId, store.sessionId),
      pending: { state: "none" },
    };
  }
  return { result, lineage, records };
}
