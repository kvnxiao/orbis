import { open } from "node:fs/promises";

import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { assessRevision } from "../domain/evidence.ts";
import type { CurationRecord, InvalidReason } from "../domain/evidence.ts";
import type { MemoryProposal, RevisionPointer } from "../domain/proposal.ts";
import { digestSchema, safeIdSchema } from "../domain/references.ts";
import { readText } from "../storage/files.ts";
import type { Revision } from "../storage/revisions.ts";
import type { SourceRecord } from "../storage/sources.ts";
import type { MemoryStore } from "../storage/store.ts";
import type { StorageSession } from "./storage-session.ts";

const projectEntryType = "orbis-tiered-memory-project";
const revisionEntryType = "orbis-tiered-memory-revision";

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

/**
 * Validate a revision reference entry; a reference selects its revision only once the entry is
 * confirmed in the session file.
 */
export const revisionReferenceSchema = Type.Object(
  {
    version: Type.Literal(1),
    projectId: digestSchema,
    sessionId: safeIdSchema,
    revisionId: safeIdSchema,
  },
  { additionalProperties: false },
);

/** Carry the `orbis-tiered-memory-project` custom entry. */
export type ProjectEntry = Static<typeof projectEntrySchema>;
/** Carry the `orbis-tiered-memory-revision` custom entry. */
export type RevisionReference = Static<typeof revisionReferenceSchema>;

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
 * Cache the source and curated-note counts of the latest registration, which status reports without
 * registering again.
 */
export interface Registration {
  sources: number;
  curatedNotes: number;
  event: RegistrationEvent;
}

/** Carry the records one source registration returned and the event that ran it. */
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
 * Return the revision reference entries for `projectId`, oldest first, skipping entries that fail
 * `revisionReferenceSchema`.
 */
export function referencesIn(
  entries: readonly { type: string }[],
  projectId: string,
): RevisionReference[] {
  return entries.flatMap((entry) =>
    entry.type === "custom" &&
    "customType" in entry &&
    entry.customType === revisionEntryType &&
    "data" in entry &&
    Value.Check(revisionReferenceSchema, entry.data) &&
    entry.data.projectId === projectId
      ? [entry.data]
      : [],
  );
}

async function confirmedReferences(
  sessionFile: string | undefined,
  projectId: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const text = sessionFile === undefined ? undefined : await readText(sessionFile, signal);
  if (sessionFile === undefined || text === undefined) {
    return new Set();
  }
  const ids = new Set(
    referencesIn(parseSessionEntries(text), projectId).map((entry) => entry.revisionId),
  );
  if (ids.size > 0) {
    const handle = await open(sessionFile, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal.throwIfAborted();
  }
  return ids;
}

/**
 * Append the `orbis-tiered-memory-revision` entry that references a committed revision of this
 * store's session.
 */
export function appendReference(
  pi: Pick<ExtensionAPI, "appendEntry">,
  store: MemoryStore,
  revisionId: string,
): void {
  const entry: RevisionReference = {
    version: 1,
    projectId: store.projectId,
    sessionId: store.sessionId,
    revisionId,
  };
  pi.appendEntry(revisionEntryType, entry);
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
 * Report whether the session file holds the reference entry for `revisionId`, fsyncing the file
 * before reporting true.
 *
 * Returns false while the session has no file or its file lacks the entry; Pi defers a new
 * session's first write until an assistant message exists.
 *
 * @throws The original read or fsync error other than `ENOENT`; `signal.reason` when `signal`
 *   aborts.
 */
export async function confirmReference(
  sessionFile: string | undefined,
  reference: Pick<RevisionReference, "projectId" | "revisionId">,
  signal: AbortSignal,
): Promise<boolean> {
  return (await confirmedReferences(sessionFile, reference.projectId, signal)).has(
    reference.revisionId,
  );
}

/**
 * Derive the selected revision and pending reference from the active branch at start or navigation.
 *
 * Selects the newest reference confirmed in the session file. A newer unconfirmed reference of this
 * session becomes `appended` when its revision is readable and is dropped otherwise.
 *
 * @throws Error when a referenced revision is damaged; `storage.signal.reason` when it aborts.
 */
export async function selectFromBranch(
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
): Promise<LineageState> {
  const store = storage.store;
  const references = referencesIn(ctx.sessionManager.getBranch(), store.projectId);
  const confirmed = await confirmedReferences(
    ctx.sessionManager.getSessionFile(),
    store.projectId,
    storage.signal,
  );
  const index = references.findLastIndex((reference) => confirmed.has(reference.revisionId));
  const chosen = references[index];
  let selected: SelectedRevision = { state: "none" };
  if (chosen !== undefined) {
    const revision = await store.inheritRevision(chosen);
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
    (await store.readRevision(latest.revisionId)) !== undefined
      ? { state: "appended", revisionId: latest.revisionId }
      : { state: "none" };
  return { selected, pending };
}

function sameBase(base: RevisionPointer | null, selected: SelectedRevision): boolean {
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
    assessRevision(evidence.sources, evidence.curation, revision, revision.projectId)
      .invalidReason === undefined
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
 * @throws `storage.signal.reason` when it aborts.
 */
export async function reconcilePending(
  pi: Pick<ExtensionAPI, "appendEntry">,
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  evidence: {
    curation: Readonly<Record<string, CurationRecord>>;
    sources: readonly SourceRecord[];
  },
): Promise<LineageState> {
  const store = storage.store;
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
  const revision = await store.readRevision(pending.revisionId);
  if (revision === undefined || !attachable(revision, pending, ctx, binding, evidence)) {
    return { selected, pending: { state: "none" } };
  }
  if (pending.state === "unappended") {
    appendReference(pi, store, pending.revisionId);
    pending = { state: "appended", revisionId: pending.revisionId };
  }
  const reference = { projectId: store.projectId, revisionId: pending.revisionId };
  if (await confirmReference(ctx.sessionManager.getSessionFile(), reference, storage.signal)) {
    return {
      selected: selectedAs(pending.revisionId, store.sessionId),
      pending: { state: "none" },
    };
  }
  return { selected, pending };
}

/**
 * Recompute the selected revision's validity, the latest head, and the pending reference from
 * registered sources and curation.
 *
 * `sources` are the records of the latest registration, whose count and curated-note count are
 * cached under `event`. Inspecting curation takes the project lock.
 *
 * @throws Error when a curation, head, or revision record is damaged; `storage.signal.reason` when
 *   it aborts.
 */
export async function refreshLineage(
  pi: Pick<ExtensionAPI, "appendEntry">,
  storage: StorageSession,
  ctx: Pick<ExtensionContext, "sessionManager">,
  binding: ProposalBinding,
  update: RegistrationUpdate,
): Promise<{ lineage: LineageState; latestRevision: string | null; registration: Registration }> {
  const store = storage.store;
  const pointer = selectedPointer(binding.lineage.selected);
  const curation = await store.inspectCuration(pointer);
  let selected = binding.lineage.selected;
  if (pointer !== null) {
    const revision = await store.inheritRevision(pointer);
    const assessed =
      revision === undefined
        ? undefined
        : assessRevision(update.sources, curation.notes, revision, store.projectId);
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
  const latestRevision = await store.currentHead();
  const lineage = await reconcilePending(
    pi,
    storage,
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
}
