import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import { sameRevision } from "../domain/proposal.ts";
import { digestSchema, safeIdSchema } from "../domain/references.ts";
import type { MemoryStore } from "../storage/store.ts";
import type { SelectedRevision } from "./lineage.ts";
import { confirmedInSessionFile } from "./session-file.ts";

const revisionEntryType = "orbis-tiered-memory-revision";

const revisionReferenceSchema = Type.Object(
  {
    version: Type.Literal(1),
    projectId: digestSchema,
    sessionId: safeIdSchema,
    revisionId: safeIdSchema,
  },
  { additionalProperties: false },
);

/**
 * Carry the `orbis-tiered-memory-revision` custom entry; a reference selects its revision only once
 * the entry is confirmed in the session file.
 */
export type RevisionReference = Static<typeof revisionReferenceSchema>;

/**
 * Identify an `orbis-tiered-memory-revision` entry whose data fails `revisionReferenceSchema`.
 *
 * `entryId` is the Pi session entry ID. `path` is the first failing instance path, `/` for the data
 * itself, and names the missing property for a required-property failure.
 */
export interface DamagedReference {
  entryId: string;
  path: string;
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

/**
 * Return the `orbis-tiered-memory-revision` entries whose data fails `revisionReferenceSchema`, in
 * entry order and for every project, since a damaged record's project cannot be trusted.
 */
export function damagedReferencesIn(entries: readonly SessionEntry[]): DamagedReference[] {
  return entries.flatMap((entry) => {
    if (entry.type !== "custom" || entry.customType !== revisionEntryType) {
      return [];
    }
    const [error] = Value.Errors(revisionReferenceSchema, entry.data);
    if (error === undefined) {
      return [];
    }
    const path = error.instancePath.length === 0 ? "/" : error.instancePath;
    const missing = error.keyword === "required" ? error.params.requiredProperties[0] : undefined;
    return [
      {
        entryId: entry.id,
        path: missing === undefined ? path : `${path === "/" ? "" : path}/${missing}`,
      },
    ];
  });
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
  const boundary = selected.state === "selected" ? selectionIndex(branch, projectId, selected) : -1;
  return damagedReferencesIn(branch.slice(boundary + 1));
}

function selectionIndex(
  branch: readonly SessionEntry[],
  projectId: string,
  pointer: Pick<RevisionReference, "sessionId" | "revisionId">,
): number {
  return branch.findLastIndex((entry) =>
    referencesIn([entry], projectId).some((reference) => sameRevision(reference, pointer)),
  );
}

/**
 * Return the ID of the last valid reference entry on `branch` that names `projectId` and the
 * pointer's session and revision, the boundary `blockingReferences` uses, or `undefined`.
 */
export function selectionEntryId(
  branch: readonly SessionEntry[],
  projectId: string,
  pointer: Pick<RevisionReference, "sessionId" | "revisionId">,
): string | undefined {
  return branch[selectionIndex(branch, projectId, pointer)]?.id;
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

function revisionIds(entries: readonly { type: string }[], projectId: string): string[] {
  return referencesIn(entries, projectId).map((entry) => entry.revisionId);
}

/**
 * Return the revision IDs that the session file references for `projectId`, fsyncing the file
 * before returning a nonempty set.
 *
 * Returns an empty set while the session has no file; Pi defers a new session's first write until
 * an assistant message exists.
 *
 * @throws The original read or fsync error other than `ENOENT`.
 */
export function confirmedReferences(
  sessionFile: string | undefined,
  projectId: string,
): Effect.Effect<Set<string>, unknown> {
  return confirmedInSessionFile(sessionFile, (entries) => revisionIds(entries, projectId), "fail");
}

/**
 * Report whether the session file has the reference entry for `revisionId` as `confirmedReferences`
 * does, except that a failed fsync reports false.
 *
 * @throws The original read error other than `ENOENT`.
 */
export function tryConfirmReference(
  sessionFile: string | undefined,
  reference: Pick<RevisionReference, "projectId" | "revisionId">,
): Effect.Effect<boolean, unknown> {
  return confirmedInSessionFile(
    sessionFile,
    (entries) => revisionIds(entries, reference.projectId),
    "unconfirmed",
  ).pipe(Effect.map((ids) => ids.has(reference.revisionId)));
}
