import { expect, test } from "vitest";

import { digest } from "../src/domain/canonical.ts";
import {
  assessRevision,
  curationRecordSchema,
  evidenceMatches,
  mayUseNote,
  sourceFingerprint,
} from "../src/domain/evidence.ts";
import type { SourceEvidence } from "../src/domain/evidence.ts";
import { encodeReference } from "../src/domain/references.ts";
import { rejectionPaths } from "./store-fixture.mts";

const projectId = "a".repeat(64);
const scope = { projectId, sessionId: "child" };

function source(entryId: string, text: string, sessionId = "child"): SourceEvidence {
  return {
    reference: encodeReference({ projectId, sessionId, entryId, span: 0 }),
    entryId,
    rawDigest: digest(text),
    effectiveDigest: digest(text),
    omitted: false,
  };
}

const first = source("entry-a", "first");
const second = source("entry-b", "second");
const sources = [first, second];

test("sourceFingerprint follows caller order and matches references and entry ids", () => {
  const forward = sourceFingerprint(sources, [first.reference, second.reference]);
  expect(sourceFingerprint(sources, ["entry-a", "entry-b"])).toBe(forward);
  expect(sourceFingerprint(sources, [second.reference, first.reference])).not.toBe(forward);
});

test("sourceFingerprint throws naming the first unregistered id", () => {
  expect(() => sourceFingerprint(sources, [first.reference, "missing", "other"])).toThrow(
    "Unregistered source: missing",
  );
});

test("evidenceMatches admits a rebound fork reference by its entry id", () => {
  const parentReference = encodeReference({
    projectId,
    sessionId: "parent",
    entryId: "entry-a",
    span: 0,
  });
  const dependency = {
    sourceIds: [parentReference],
    evidenceFingerprint: sourceFingerprint(sources, ["entry-a"]),
  };
  expect(evidenceMatches(sources, dependency, projectId)).toBe(true);
  expect(evidenceMatches(sources, dependency, "b".repeat(64))).toBe(false);
});

test("evidenceMatches is false after an effective-context edit changes a source digest", () => {
  const dependency = {
    sourceIds: [first.reference],
    evidenceFingerprint: sourceFingerprint(sources, [first.reference]),
  };
  const edited = [{ ...first, effectiveDigest: digest("edited") }, second];
  expect(evidenceMatches(sources, dependency, projectId)).toBe(true);
  expect(evidenceMatches(edited, dependency, projectId)).toBe(false);
});

test("evidenceMatches is false for an unregistered source instead of throwing", () => {
  expect(
    evidenceMatches(
      sources,
      { sourceIds: ["missing"], evidenceFingerprint: "f".repeat(64) },
      projectId,
    ),
  ).toBe(false);
});

test("assessRevision reports note evidence before curation before assigned evidence", () => {
  const valid = {
    sourceIds: [first.reference],
    evidenceFingerprint: sourceFingerprint(sources, [first.reference]),
  };
  const stale = { sourceIds: [first.reference], evidenceFingerprint: "f".repeat(64) };
  const edited = { kind: "edited" as const, digest: digest("user"), consumedSourceIds: [] };
  const curation = { "journey.md": edited };
  expect(
    assessRevision(
      sources,
      curation,
      {
        ...valid,
        noteDependencies: { "current-work.md": stale, "journey.md": valid },
      },
      projectId,
      scope.sessionId,
    ),
  ).toEqual({ invalidNotes: ["current-work.md", "journey.md"], invalidReason: "note-evidence" });
  expect(
    assessRevision(
      sources,
      curation,
      { ...valid, noteDependencies: { "journey.md": valid } },
      projectId,
      scope.sessionId,
    ),
  ).toEqual({ invalidNotes: ["journey.md"], invalidReason: "curation" });
  expect(
    assessRevision(
      sources,
      {},
      { ...stale, noteDependencies: { "journey.md": valid } },
      projectId,
      scope.sessionId,
    ),
  ).toEqual({ invalidNotes: [], invalidReason: "assigned-evidence" });
});

test("assessRevision lists every invalid note and reports no reason when all checks pass", () => {
  const valid = {
    sourceIds: [first.reference],
    evidenceFingerprint: sourceFingerprint(sources, [first.reference]),
  };
  expect(
    assessRevision(
      sources,
      {},
      { ...valid, noteDependencies: { "current-work.md": valid } },
      projectId,
      scope.sessionId,
    ),
  ).toEqual({ invalidNotes: [], invalidReason: undefined });
});

test("mayUseNote forbids replacing an edited note", () => {
  expect(
    mayUseNote({ kind: "edited", digest: digest("user"), consumedSourceIds: [] }, ["new"], scope),
  ).toBe(false);
  expect(mayUseNote(undefined, ["any"], scope)).toBe(true);
});

test("mayUseNote permits recreating a deleted note only with evidence it did not consume", () => {
  const deleted = { kind: "deleted" as const, consumedSourceIds: ["old"] };
  expect(mayUseNote(deleted, ["old"], scope)).toBe(false);
  expect(mayUseNote(deleted, ["old", "new"], scope)).toBe(true);
});

test("a bare entry id aliases its local full reference without conflating sessions", () => {
  const parent = encodeReference({ projectId, sessionId: "parent", entryId: "entry-a", span: 0 });
  const child = first.reference;
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: [child] }, ["entry-a"], scope)).toBe(
    false,
  );
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: ["entry-a"] }, [child], scope)).toBe(
    false,
  );
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: [parent] }, [child], scope)).toBe(true);
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: [parent, child] }, [child], scope)).toBe(
    false,
  );
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: [parent] }, ["entry-b"], scope)).toBe(
    true,
  );
  const foreign = encodeReference({
    projectId: "b".repeat(64),
    sessionId: "parent",
    entryId: "entry-a",
    span: 0,
  });
  expect(mayUseNote({ kind: "deleted", consumedSourceIds: [foreign] }, [child], scope)).toBe(true);
});

test("curation record schema rejects an edited record without a digest", () => {
  expect(rejectionPaths(curationRecordSchema, { kind: "edited", consumedSourceIds: [] })).toContain(
    "/digest",
  );
});
