import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";

import { assessRevision } from "../domain/evidence.ts";
import type { CurationRecord, InvalidReason } from "../domain/evidence.ts";
import { sameRevision } from "../domain/proposal.ts";
import type { MemoryProposal, RevisionPointer } from "../domain/proposal.ts";
import type { Revision } from "../storage/revisions.ts";
import type { StorageServices } from "../storage/services.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { MemoryStore } from "../storage/store.ts";
import {
  appendReference,
  blockingReferences,
  confirmedReferences,
  referencesIn,
} from "./revision-references.ts";

/**
 * Describe which revision supplies the session's memory snapshot.
 *
 * `none` means the active branch has no confirmed reference. `unavailable` means the newest
 * confirmed reference names a revision that cannot be read; it keeps that revision's identity.
 * `selected` names the revision and its session, which is a fork ancestor's when inherited, with
 * the notes that are no longer current and the first reason one is invalid. Start and navigation
 * derive it from the newest confirmed branch reference; commit confirmation sets it; refresh
 * recomputes `invalidNotes` and `invalidReason` from the active branch's current effective sources
 * and curation.
 */
export type SelectedRevision =
  | { state: "none" }
  | { state: "unavailable"; revisionId: string; sessionId: string; reason: string }
  | {
      state: "selected";
      revisionId: string;
      sessionId: string;
      invalidNotes: string[];
      invalidReason?: InvalidReason;
    };

/**
 * Name the first condition that keeps reconciliation from attaching an orphan head whose anchor is
 * on the branch: `lineage` when the selection is unavailable or the head's base, parent, and the
 * blocking damaged references do not continue the selection; `configuration` when its dependency
 * fingerprint differs; `evidence` when its evidence or curation no longer holds.
 */
export type UnresolvedReason = "lineage" | "configuration" | "evidence";

/**
 * Track a committed revision whose branch reference is not yet confirmed.
 *
 * | State      | Event                                                                           | Next state                      |
 * | ---------- | ------------------------------------------------------------------------------- | ------------------------------- |
 * | none       | Commit durable                                                                  | unappended { revisionId }       |
 * | none       | Reconciliation finds the head referenced nowhere in the session                 | unappended { revisionId }       |
 * | none       | Reconciliation finds the head's reference newest on the branch but unselected   | appended { revisionId }         |
 * | unappended | Reconciliation attaches it and appends the reference entry                      | appended { revisionId }         |
 * | unappended | Reconciliation finds the head unrelated to the branch or no longer the head     | none                            |
 * | unappended | Reconciliation cannot establish that the head continues the selection           | unresolved                      |
 * | unresolved | Next reconciliation                                                             | reconsidered from none          |
 * | appended   | Entry confirmed in the session file after fsync                                 | none; `selected` = the revision |
 * | appended   | Start finds the entry on the branch but the revision unreadable                 | none                            |
 * | appended   | Reconciliation finds the head, anchor, evidence, or curation no longer matching | none                            |
 *
 * `unresolved` carries the head's capture anchor and the first reason it cannot be attached.
 * `captureProposal` refuses new proposals while the state is not `none`.
 */
export type PendingReference =
  | { state: "none" }
  | { state: "unappended"; revisionId: string }
  | { state: "appended"; revisionId: string }
  | { state: "unresolved"; revisionId: string; anchorId: string; reason: UnresolvedReason };

/** Carry the selected revision and pending reference that one lineage step produced. */
export interface LineageState {
  selected: SelectedRevision;
  pending: PendingReference;
}

/** Name the event whose source registration produced the cached counts. */
export type RegistrationEvent = "session_start" | "session_tree" | "commit";

/**
 * Cache the counts the latest refresh used, which status reports without registering again: the
 * source count and event of the registration that refresh read, and the curated-note count of the
 * curation it inspected.
 */
export interface Registration {
  sources: number;
  curatedNotes: number;
  event: RegistrationEvent;
}

/**
 * Carry the records one completed source registration returned and the event that ran it; open
 * storage keeps the newest one for the next refresh.
 */
export interface RegistrationUpdate {
  sources: readonly SourceRecord[];
  event: RegistrationEvent;
}

/** Supply the proposal fields a caller provides; `captureProposal` adds the binding fields. */
export type ProposalContent = Pick<
  MemoryProposal,
  "notes" | "observations" | "consumedObservationIds" | "learnings" | "expectedLearnings"
>;

/**
 * Report whether reconciliation completed for the current storage session and configuration:
 * `reconciling` while it runs or has not run since a transition or a configuration change, `failed`
 * when it failed for the current configuration, and `current` otherwise.
 */
export type Reconciliation = "reconciling" | "failed" | "current";

/**
 * Carry the runtime state a proposal binds to.
 *
 * `dependencyFingerprint` is `undefined` while no configuration is current. `latestRevision` is the
 * head seen by the latest refresh and becomes `expectedRevision`. Proposals proceed only while
 * `reconciliation` is `current` and no detected curation of the current-work note awaits its
 * recording (`pendingCuration`).
 */
export interface ProposalBinding {
  configurationRevision: number;
  dependencyFingerprint: string | undefined;
  lineage: LineageState;
  latestRevision: string | null;
  reconciliation: Reconciliation;
  pendingCuration: boolean;
}

/** Return the pointer of a selected revision, or `null` when none is selected. */
export function selectedPointer(selected: SelectedRevision): RevisionPointer | null {
  return selected.state === "selected"
    ? { sessionId: selected.sessionId, revisionId: selected.revisionId }
    : null;
}

/** Select a revision with every note still current, before the next refresh assesses it. */
export function selectedAs(
  revisionId: string,
  sessionId: string,
): Extract<SelectedRevision, { state: "selected" }> {
  return { state: "selected", revisionId, sessionId, invalidNotes: [] };
}

/**
 * Derive the selected revision and pending reference from the active branch at start or navigation.
 *
 * Selects the newest reference confirmed in the session file. A newer unconfirmed reference of this
 * session becomes `appended` when its revision is readable and is dropped otherwise.
 *
 * @throws Error when a referenced revision is damaged.
 * @throws The failures of `confirmedReferences`.
 */
export const selectFromBranch = Effect.fnUntraced(function* (
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
): Effect.fn.Return<LineageState, unknown> {
  const references = referencesIn(ctx.sessionManager.getBranch(), store.projectId);
  const confirmed = yield* confirmedReferences(
    ctx.sessionManager.getSessionFile(),
    store.projectId,
  );
  const index = references.findLastIndex((reference) => confirmed.has(reference.revisionId));
  const chosen = references[index];
  let selected: SelectedRevision = { state: "none" };
  if (chosen !== undefined) {
    const revision = yield* store.inheritRevision(chosen);
    selected =
      revision === undefined
        ? {
            state: "unavailable",
            revisionId: chosen.revisionId,
            sessionId: chosen.sessionId,
            reason: `Selected revision ${chosen.revisionId} is unavailable.`,
          }
        : selectedAs(chosen.revisionId, chosen.sessionId);
  }
  const latest = references.at(-1);
  const pending: PendingReference =
    latest !== undefined &&
    references.length - 1 > index &&
    latest.sessionId === store.sessionId &&
    (yield* store.readRevision(latest.revisionId)) !== undefined
      ? { state: "appended", revisionId: latest.revisionId }
      : { state: "none" };
  return { selected, pending };
});

/** Report whether `base` names the selected revision; `null` matches both `none` and `unavailable`. */
export function sameBase(base: RevisionPointer | null, selected: SelectedRevision): boolean {
  return sameRevision(base, selectedPointer(selected));
}

interface Evidence {
  curation: Readonly<Record<string, CurationRecord>>;
  sources: readonly SourceRecord[];
}

function evidenceHolds(
  revision: Revision,
  ctx: Pick<ExtensionContext, "sessionManager">,
  evidence: Evidence,
): boolean {
  return (
    assessRevision(
      evidence.sources,
      evidence.curation,
      revision,
      revision.projectId,
      ctx.sessionManager.getSessionId(),
    ).invalidReason === undefined
  );
}

function onBranch(ctx: Pick<ExtensionContext, "sessionManager">, entryId: string): boolean {
  return ctx.sessionManager.getBranch().some((entry) => entry.id === entryId);
}

function continuesSelection(
  revision: Revision,
  selected: SelectedRevision,
  sessionId: string,
  blocking: number,
): boolean {
  if (selected.state === "unavailable") {
    return false;
  }
  if (selected.state === "none") {
    return revision.baseRevision === null && revision.parentRevisionId === null && blocking === 0;
  }
  if (!sameBase(revision.baseRevision, selected)) {
    return false;
  }
  return selected.sessionId === sessionId
    ? revision.parentRevisionId === selected.revisionId && blocking <= 1
    : revision.parentRevisionId === null && blocking === 0;
}

function unconfirmedOnBranch(
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
): boolean {
  const newest = referencesIn(ctx.sessionManager.getBranch(), store.projectId).at(-1);
  const pointer = selectedPointer(binding.lineage.selected);
  return (
    newest?.revisionId === binding.latestRevision &&
    newest.sessionId === store.sessionId &&
    !sameRevision(pointer, { sessionId: store.sessionId, revisionId: newest.revisionId })
  );
}

// Classifies an unreferenced head whose anchor is on the branch; it counts the blocking damaged
// entries but never interprets their payloads, and never walks parent revisions.
function orphanOutcome(
  revision: Revision,
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  evidence: Evidence,
): "attach" | "unrelated" | UnresolvedReason {
  const { selected } = binding.lineage;
  const branch = ctx.sessionManager.getBranch();
  const blocking = blockingReferences(branch, store.projectId, selected).length;
  const otherBase = !sameBase(revision.baseRevision, selected);
  if (selected.state === "selected" && blocking === 0 && otherBase) {
    return "unrelated";
  }
  if (!continuesSelection(revision, selected, store.sessionId, blocking)) {
    return "lineage";
  }
  if (revision.dependencyFingerprint !== binding.dependencyFingerprint) {
    return "configuration";
  }
  return evidenceHolds(revision, ctx, evidence) ? "attach" : "evidence";
}

/**
 * Attach, confirm, leave unresolved, or drop the pending reference after a refresh.
 *
 * An `unresolved` state, and an `unappended` one whose head a valid session entry already
 * references, is reconsidered from `none`, so a reference is never appended twice. When nothing is
 * pending and the head is referenced nowhere in the session, the head becomes an `unappended`
 * orphan; when the newest valid branch reference of this project names the unselected head of this
 * session, as one that a superseded reconciliation appended does, it becomes `appended`. An orphan
 * whose anchor is off the branch, or whose base differs from an available selection that no damaged
 * reference blocks, is unrelated and pending becomes `none`. Otherwise it is attached only when its
 * base, parent, and the blocking damaged references continue the selection, its fingerprint equals
 * `binding.dependencyFingerprint`, and its evidence and curation hold; the first failing condition
 * becomes the `unresolved` reason. An attachable orphan is appended only while `current()` holds;
 * when it does not, nothing is appended and the original pending state is returned: a
 * reconciliation discards it, and a superseded startup publishes it with storage `reconciling`. An
 * `appended` reference stays attachable across a configuration change while it is the head, its
 * anchor is on the branch, and its evidence and curation hold, and pending becomes `none`
 * otherwise. An appended reference confirmed in the session file selects its revision.
 *
 * @throws The failures of `MemoryStore.readRevision` and `confirmedReferences`.
 */
export const reconcilePending = Effect.fnUntraced(function* (
  pi: Pick<ExtensionAPI, "appendEntry">,
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  evidence: Evidence,
  current: () => boolean,
): Effect.fn.Return<LineageState, unknown> {
  const { selected } = binding.lineage;
  const head = binding.latestRevision;
  const referenced = new Set(
    referencesIn(ctx.sessionManager.getEntries(), store.projectId).map((entry) => entry.revisionId),
  );
  const stored = binding.lineage.pending;
  let pending: PendingReference =
    stored.state === "unresolved" ||
    (stored.state === "unappended" && referenced.has(stored.revisionId))
      ? { state: "none" }
      : stored;
  if (pending.state === "none" && head !== null && !referenced.has(head)) {
    pending = { state: "unappended", revisionId: head };
  } else if (
    pending.state === "none" &&
    head !== null &&
    unconfirmedOnBranch(store, ctx, binding)
  ) {
    pending = { state: "appended", revisionId: head };
  }
  if (pending.state === "none") {
    return { selected, pending };
  }
  const revision = yield* store.readRevision(pending.revisionId);
  if (revision === undefined || head !== revision.id || !onBranch(ctx, revision.anchorId)) {
    return { selected, pending: { state: "none" } };
  }
  if (pending.state === "unappended") {
    const outcome = orphanOutcome(revision, store, ctx, binding, evidence);
    if (outcome === "unrelated") {
      return { selected, pending: { state: "none" } };
    }
    if (outcome !== "attach") {
      const { id: revisionId, anchorId } = revision;
      return { selected, pending: { state: "unresolved", revisionId, anchorId, reason: outcome } };
    }
    if (!current()) {
      return binding.lineage;
    }
    appendReference(pi, store, pending.revisionId);
    pending = { state: "appended", revisionId: pending.revisionId };
  } else if (!evidenceHolds(revision, ctx, evidence)) {
    return { selected, pending: { state: "none" } };
  }
  const confirmed = yield* confirmedReferences(
    ctx.sessionManager.getSessionFile(),
    store.projectId,
  );
  if (confirmed.has(pending.revisionId)) {
    return {
      selected: selectedAs(pending.revisionId, store.sessionId),
      pending: { state: "none" },
    };
  }
  return { selected, pending };
});

/**
 * Recompute the selected revision's validity, the latest head, and the pending reference from the
 * active branch's effective sources and curation.
 *
 * `sources.effective` are the active branch's current effective sources, which decide note validity
 * and orphan recovery. `sources.newest` is the newest completed registration when the refresh
 * starts; its source count and `event`, with the count of the curation this refresh inspects,
 * become the cached `registration`. Inspecting curation takes the project lock and first repairs
 * this session's unfinished head, then the fork ancestor's when the selection is inherited; a
 * failed repair propagates before curation is written. `current` reports whether the refresh still
 * belongs to the current configuration; `reconcilePending` checks it immediately before appending a
 * reference.
 *
 * @throws Error when a curation, head, or revision record is damaged.
 * @throws The failures of `MemoryStore.inspectCuration` and `reconcilePending`.
 */
export const refreshLineage = Effect.fnUntraced(function* (
  pi: Pick<ExtensionAPI, "appendEntry">,
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  sources: { effective: readonly SourceRecord[]; newest: RegistrationUpdate },
  current: () => boolean,
): Effect.fn.Return<
  { lineage: LineageState; latestRevision: string | null; registration: Registration },
  unknown,
  StorageServices
> {
  const pointer = selectedPointer(binding.lineage.selected);
  const curation = yield* store.inspectCuration(pointer);
  let selected = binding.lineage.selected;
  if (pointer !== null) {
    const revision = yield* store.inheritRevision(pointer);
    const assessed =
      revision === undefined
        ? undefined
        : assessRevision(
            sources.effective,
            curation.notes,
            revision,
            store.projectId,
            store.sessionId,
          );
    selected =
      assessed === undefined
        ? {
            state: "unavailable",
            ...pointer,
            reason: `Selected revision ${pointer.revisionId} is unavailable.`,
          }
        : {
            ...selectedAs(pointer.revisionId, pointer.sessionId),
            invalidNotes: assessed.invalidNotes,
            ...(assessed.invalidReason === undefined
              ? {}
              : { invalidReason: assessed.invalidReason }),
          };
  }
  const latestRevision = yield* store.currentHead();
  const lineage = yield* reconcilePending(
    pi,
    store,
    ctx,
    { ...binding, latestRevision, lineage: { selected, pending: binding.lineage.pending } },
    { curation: curation.notes, sources: sources.effective },
    current,
  );
  const registration: Registration = {
    sources: sources.newest.sources.length,
    curatedNotes: Object.keys(curation.notes).length,
    event: sources.newest.event,
  };
  return { lineage, latestRevision, registration };
});
