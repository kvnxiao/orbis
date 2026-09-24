import { Type } from "typebox";

const safeIdPattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const digestPattern = "[a-f0-9]{64}";
const referencePattern = `tm1:(${digestPattern}):(${safeIdPattern}):(${safeIdPattern}):(0)`;
const referenceExpression = new RegExp(`^${referencePattern}$`, "u");

/** Match a storage-safe identifier for sessions, revisions, entries, and anchors. */
export const safeIdSchema = Type.String({ pattern: `^${safeIdPattern}$` });

/** Match a SHA-256 digest in lowercase hex, as `digest` produces it. */
export const digestSchema = Type.String({ pattern: `^${digestPattern}$` });

/**
 * Match a session note file name: `current-work.md`, `journey.md`, `topics-index.md`, or
 * `topic-<name>.md`.
 */
export const noteNameSchema = Type.String({
  pattern: "^(current-work|journey|topics-index|topic-[A-Za-z0-9_-]+)\\.md$",
});

/** Match a project learning file name: `index.md` or `<name>.md`. */
export const learningNameSchema = Type.String({ pattern: "^(index|[A-Za-z0-9_-]+)\\.md$" });

/**
 * Match a `tm1:<projectId>:<sessionId>:<entryId>:<span>` source reference; span `0` is the only
 * span.
 */
export const sourceReferenceSchema = Type.String({ pattern: `^${referencePattern}$` });

/** Match a proposal source id: a `tm1:` reference or a bare Pi entry id. */
export const sourceIdSchema = Type.Union([safeIdSchema, sourceReferenceSchema]);

/**
 * Locate an original Pi session entry; `span` 0 covers the whole entry and is the only span this
 * version emits.
 */
export interface SourceLocation {
  projectId: string;
  sessionId: string;
  entryId: string;
  span: 0;
}

/**
 * Encode a location as `tm1:<projectId>:<sessionId>:<entryId>:<span>`.
 *
 * The components must satisfy `digestSchema` and `safeIdSchema`, which exclude the colon separator.
 */
export function encodeReference(location: SourceLocation): string {
  return `tm1:${location.projectId}:${location.sessionId}:${location.entryId}:${String(location.span)}`;
}

/**
 * Decode a `tm1:` reference, or return `undefined` for any text that `sourceReferenceSchema`
 * rejects.
 */
export function decodeReference(reference: string): SourceLocation | undefined {
  const [, projectId, sessionId, entryId] = referenceExpression.exec(reference) ?? [];
  if (projectId === undefined || sessionId === undefined || entryId === undefined) {
    return undefined;
  }
  return { projectId, sessionId, entryId, span: 0 };
}

/**
 * Rebind a fork ancestor's source reference to the child session.
 *
 * Only a reference in `fork.projectId` whose session is in `fork.lineage` is rebound; every other
 * string, including a bare entry id, is returned unchanged.
 */
export function rebindReference(
  reference: string,
  fork: { projectId: string; lineage: ReadonlySet<string>; childSessionId: string },
): string {
  const location = decodeReference(reference);
  if (
    location === undefined ||
    location.projectId !== fork.projectId ||
    !fork.lineage.has(location.sessionId)
  ) {
    return reference;
  }
  return encodeReference({ ...location, sessionId: fork.childSessionId });
}
