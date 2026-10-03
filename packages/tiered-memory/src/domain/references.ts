import { Type } from "typebox";

const safeIdPattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const digestPattern = "[a-f0-9]{64}";
const referencePattern = `tm1:(${digestPattern}):(${safeIdPattern}):(${safeIdPattern}):(0)`;
const referenceExpression = new RegExp(`^${referencePattern}$`, "u");
const spanReferencePattern = `tm1:(${digestPattern}):(${safeIdPattern}):(${safeIdPattern}):(0|(0|[1-9][0-9]{0,14})-([1-9][0-9]{0,14}))`;
const spanReferenceExpression = new RegExp(`^${spanReferencePattern}$`, "u");

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
 * Match a whole-entry `tm1:<projectId>:<sessionId>:<entryId>:0` source reference, the form that
 * registered source records use.
 */
export const sourceReferenceSchema = Type.String({ pattern: `^${referencePattern}$` });

/**
 * Match a source span reference: span `0` covers an entry's whole text, and `<start>-<end>` covers
 * a range of its effective text.
 *
 * Bounds are decimal without leading zeros, so each range has one spelling; `decodeSpanReference`
 * also requires `start < end`. Every `sourceReferenceSchema` match is a span reference.
 */
export const spanReferenceSchema = Type.String({ pattern: `^${spanReferencePattern}$` });

/**
 * Match a proposal source id: a span reference or a bare Pi entry id; a bare id names a whole
 * entry.
 */
export const sourceIdSchema = Type.Union([safeIdSchema, spanReferenceSchema]);

/**
 * Name a range of an entry's effective text in UTF-16 code units, end exclusive.
 *
 * Ranges start and end on code-point boundaries, so a split never separates a surrogate pair.
 */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Locate an original Pi session entry; `span` 0 covers the whole entry, and `encodeSpanReference`
 * adds a text range.
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
 * Encode an entry location with a text range as
 * `tm1:<projectId>:<sessionId>:<entryId>:<start>-<end>`, or as the span-`0` reference when `range`
 * is `undefined`.
 *
 * `range` must satisfy `0 <= start < end`.
 */
export function encodeSpanReference(
  location: SourceLocation,
  range: TextRange | undefined,
): string {
  const entry = encodeReference(location);
  return range === undefined
    ? entry
    : `${entry.slice(0, -1)}${String(range.start)}-${String(range.end)}`;
}

/**
 * Decode a span reference into its entry location and range, or return `undefined` for text that
 * `spanReferenceSchema` rejects or whose range is empty or reversed.
 *
 * `range` is `undefined` for span `0`.
 */
export function decodeSpanReference(
  reference: string,
): { location: SourceLocation; range: TextRange | undefined } | undefined {
  const [, projectId, sessionId, entryId, , startText, endText] =
    spanReferenceExpression.exec(reference) ?? [];
  if (projectId === undefined || sessionId === undefined || entryId === undefined) {
    return undefined;
  }
  const location: SourceLocation = { projectId, sessionId, entryId, span: 0 };
  if (startText === undefined || endText === undefined) {
    return { location, range: undefined };
  }
  const range = { start: Number(startText), end: Number(endText) };
  return range.start < range.end ? { location, range } : undefined;
}

/**
 * Rebind a fork ancestor's source reference to the child session, keeping its span.
 *
 * Only a span reference in `fork.projectId` whose session is in `fork.lineage` is rebound; every
 * other string, including a bare entry id, is returned unchanged.
 */
export function rebindReference(
  reference: string,
  fork: { projectId: string; lineage: ReadonlySet<string>; childSessionId: string },
): string {
  const decoded = decodeSpanReference(reference);
  if (
    decoded === undefined ||
    decoded.location.projectId !== fork.projectId ||
    !fork.lineage.has(decoded.location.sessionId)
  ) {
    return reference;
  }
  return encodeSpanReference(
    { ...decoded.location, sessionId: fork.childSessionId },
    decoded.range,
  );
}

/**
 * Rebind every same-project span reference of a selected note to `scope.sessionId`, keeping spans.
 *
 * A selected note's same-project references belong to sessions of its fork lineage, so rebinding
 * each one from its own session matches the rebinding of the lineage's processed coverage. Other
 * strings are returned unchanged.
 */
export function rebindToSession(
  references: readonly string[],
  scope: { projectId: string; sessionId: string },
): string[] {
  return references.map((reference) => {
    const decoded = decodeSpanReference(reference);
    return decoded === undefined
      ? reference
      : rebindReference(reference, {
          projectId: scope.projectId,
          lineage: new Set([decoded.location.sessionId]),
          childSessionId: scope.sessionId,
        });
  });
}

/**
 * Return the whole-entry reference of a span reference, or `undefined` for text that
 * `decodeSpanReference` rejects.
 */
export function entryReferenceOf(reference: string): string | undefined {
  const decoded = decodeSpanReference(reference);
  return decoded === undefined ? undefined : encodeReference(decoded.location);
}
