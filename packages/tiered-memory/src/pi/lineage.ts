import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { assessRevision } from "../domain/evidence.ts";
import type { CurationRecord, InvalidReason } from "../domain/evidence.ts";
import type { MemoryProposal, RevisionPointer } from "../domain/proposal.ts";
import { digestSchema, safeIdSchema } from "../domain/references.ts";
import type { Revision } from "../storage/revisions.ts";
import type { StorageServices } from "../storage/services.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { MemoryStore } from "../storage/store.ts";
import {
  appendReference,
  confirmedReferences,
  damagedReferencesIn,
  referencesIn,
} from "./revision-references.ts";
import type { DamagedReference } from "./revision-references.ts";

const projectEntryType = "orbis-tiered-memory-project";

/**
 * Validate the project entry that binds a Pi session to a canonical project root and memory
 * session.
 */
export const projectEntrySchema = Type.Object(
  {
    version: Type.Literal(1),
    root: Type.String({ minLength: 1 }),
    projectId: digestSchema,
    sessionId: safeIdSchema,
  },
  { additionalProperties: false },
);

/** Carry the `orbis-tiered-memory-project` custom entry. */
export type ProjectEntry = Static<typeof projectEntrySchema>;

/**
 * Describe which revision supplies the session's memory snapshot.
 *
 * `none` means the active branch has no confirmed reference. `unavailable` means the newest
 * confirmed reference names a revision that cannot be read. `selected` names the revision and its
 * session, which is a fork ancestor's when inherited, with the notes that are no longer current and
 * the first reason one is invalid. Start and navigation derive it from the newest confirmed branch
 * reference; commit confirmation sets it; refresh recomputes `invalidNotes` and `invalidReason`
 * from registered sources and curation.
 */
export type SelectedRevision =
  | { state: "none" }
  | { state: "unavailable"; reason: string }
  | {
      state: "selected";
      revisionId: string;
      sessionId: string;
      invalidNotes: string[];
      invalidReason?: InvalidReason;
    };

/**
 * Track a committed revision whose branch reference is not yet confirmed.
 *
 * | State                  | Event                                                                           | Next state                      |
 * | ---------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
 * | none                   | Commit durable                                                                  | unappended { revisionId }       |
 * | unappended             | Reference entry appended                                                        | appended { revisionId }         |
 * | appended               | Entry confirmed in the session file after fsync                                 | none; `selected` = the revision |
 * | appended               | Start finds the entry on the branch but the revision unreadable                 | none                            |
 * | unappended or appended | Reconciliation finds the head, anchor, evidence, or curation no longer matching | none                            |
 *
 * `captureProposal` refuses new proposals while the state is not `none`.
 */
export type PendingReference =
  | { state: "none" }
  | { state: "unappended"; revisionId: string }
  | { state: "appended"; revisionId: string };

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
  "notes" | "consumedObservationIds" | "learnings" | "expectedLearnings"
>;

/**
 * Carry the runtime state a proposal binds to.
 *
 * `dependencyFingerprint` is `undefined` while no configuration is current. `latestRevision` is the
 * head seen by the latest refresh and becomes `expectedRevision`.
 */
export interface ProposalBinding {
  configurationRevision: number;
  dependencyFingerprint: string | undefined;
  lineage: LineageState;
  latestRevision: string | null;
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
 * Return the damaged revision references that make `selected` ambiguous, in branch order; an empty
 * result means the lineage does not block commits.
 *
 * - The boundary is the last valid reference that names `projectId` and the selected session and
 *   revision; only damaged entries after it block.
 * - Every damaged entry blocks when `selected` is `none` or `unavailable`, or when no reference
 *   matches it.
 */
export function blockingReferences(
  branch: readonly SessionEntry[],
  projectId: string,
  selected: SelectedRevision,
): DamagedReference[] {
  const boundary =
    selected.state === "selected"
      ? branch.findLastIndex((entry) =>
          referencesIn([entry], projectId).some(
            (reference) =>
              reference.sessionId === selected.sessionId &&
              reference.revisionId === selected.revisionId,
          ),
        )
      : -1;
  return damagedReferencesIn(branch.slice(boundary + 1));
}

/**
 * Bind the session's branch to its project, appending a project entry when the branch has none for
 * this root and session.
 *
 * @throws Error when the branch carries a project entry for another root or project, whose memory
 *   must not attach to this session.
 */
export function attachProject(
  pi: Pick<ExtensionAPI, "appendEntry">,
  branch: readonly SessionEntry[],
  store: MemoryStore,
): void {
  const entries = branch.flatMap((entry) =>
    entry.type === "custom" &&
    entry.customType === projectEntryType &&
    Value.Check(projectEntrySchema, entry.data)
      ? [entry.data]
      : [],
  );
  if (
    entries.some((entry) => entry.root !== store.projectRoot || entry.projectId !== store.projectId)
  ) {
    throw new Error("Session memory belongs to a different project root.");
  }
  if (!entries.some((entry) => entry.sessionId === store.sessionId)) {
    const entry: ProjectEntry = {
      version: 1,
      root: store.projectRoot,
      projectId: store.projectId,
      sessionId: store.sessionId,
    };
    pi.appendEntry(projectEntryType, entry);
  }
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
        ? { state: "unavailable", reason: `Selected revision ${chosen.revisionId} is unavailable.` }
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
  const pointer = selectedPointer(selected);
  return (
    (base === null && pointer === null) ||
    (base !== null &&
      pointer !== null &&
      base.sessionId === pointer.sessionId &&
      base.revisionId === pointer.revisionId)
  );
}

function attachable(
  revision: Revision,
  pending: Exclude<PendingReference, { state: "none" }>,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  evidence: {
    curation: Readonly<Record<string, CurationRecord>>;
    sources: readonly SourceRecord[];
  },
): boolean {
  const bindingMatches =
    pending.state === "appended" ||
    (revision.dependencyFingerprint === binding.dependencyFingerprint &&
      sameBase(revision.baseRevision, binding.lineage.selected));
  return (
    binding.latestRevision === revision.id &&
    ctx.sessionManager.getBranch().some((entry) => entry.id === revision.anchorId) &&
    bindingMatches &&
    assessRevision(
      evidence.sources,
      evidence.curation,
      revision,
      revision.projectId,
      ctx.sessionManager.getSessionId(),
    ).invalidReason === undefined
  );
}

/**
 * Attach, confirm, or drop the pending reference after a refresh.
 *
 * When nothing is pending and the head is referenced nowhere in the session, the head becomes the
 * pending candidate. A pending revision stays attachable only while it is the head, its anchor is
 * on the branch, and its evidence and curation still hold; an `unappended` revision must also have
 * a dependency fingerprint equal to `binding.dependencyFingerprint` and the selected revision as
 * its base, while an `appended` one stays attachable across a configuration change. Otherwise
 * pending becomes `none`. An attachable `unappended` reference is appended and an `appended` one is
 * confirmed, which selects its revision.
 *
 * @throws The failures of `MemoryStore.readRevision` and `confirmedReferences`.
 */
export const reconcilePending = Effect.fnUntraced(function* (
  pi: Pick<ExtensionAPI, "appendEntry">,
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  evidence: {
    curation: Readonly<Record<string, CurationRecord>>;
    sources: readonly SourceRecord[];
  },
): Effect.fn.Return<LineageState, unknown> {
  const { selected } = binding.lineage;
  let pending = binding.lineage.pending;
  const head = binding.latestRevision;
  const referenced = new Set(
    referencesIn(ctx.sessionManager.getEntries(), store.projectId).map((entry) => entry.revisionId),
  );
  if (pending.state === "none" && head !== null && !referenced.has(head)) {
    pending = { state: "unappended", revisionId: head };
  }
  if (pending.state === "none") {
    return { selected, pending };
  }
  const revision = yield* store.readRevision(pending.revisionId);
  if (revision === undefined || !attachable(revision, pending, ctx, binding, evidence)) {
    return { selected, pending: { state: "none" } };
  }
  if (pending.state === "unappended") {
    appendReference(pi, store, pending.revisionId);
    pending = { state: "appended", revisionId: pending.revisionId };
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
 * Recompute the selected revision's validity, the latest head, and the pending reference from
 * registered sources and curation.
 *
 * `update` is the newest completed registration when the refresh starts; its source count and
 * `event`, with the count of the curation this refresh inspects, become the cached `registration`.
 * Inspecting curation takes the project lock.
 *
 * @throws Error when a curation, head, or revision record is damaged.
 * @throws The failures of `MemoryStore.inspectCuration` and `reconcilePending`.
 */
export const refreshLineage = Effect.fnUntraced(function* (
  pi: Pick<ExtensionAPI, "appendEntry">,
  store: MemoryStore,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  update: RegistrationUpdate,
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
            update.sources,
            curation.notes,
            revision,
            store.projectId,
            store.sessionId,
          );
    selected =
      assessed === undefined
        ? {
            state: "unavailable",
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
    { curation: curation.notes, sources: update.sources },
  );
  const registration: Registration = {
    sources: update.sources.length,
    curatedNotes: Object.keys(curation.notes).length,
    event: update.event,
  };
  return { lineage, latestRevision, registration };
});
