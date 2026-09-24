import { Value } from "typebox/value";
import { expect, test } from "vitest";

import {
  decodeReference,
  encodeReference,
  rebindReference,
  sourceReferenceSchema,
} from "../src/domain/references.ts";

const projectId = "a".repeat(64);
const location = { projectId, sessionId: "parent-session", entryId: "entry_1", span: 0 } as const;

test("encodeReference and decodeReference round-trip a whole-entry location", () => {
  const reference = encodeReference(location);
  expect(reference).toBe(`tm1:${projectId}:parent-session:entry_1:0`);
  expect(Value.Check(sourceReferenceSchema, reference)).toBe(true);
  expect(decodeReference(reference)).toEqual(location);
});

test("decodeReference rejects a reference without the tm1 prefix", () => {
  expect(decodeReference(`tm2:${projectId}:parent-session:entry_1:0`)).toBeUndefined();
  expect(decodeReference(`${projectId}:parent-session:entry_1:0`)).toBeUndefined();
});

test("decodeReference rejects extra components and components longer than their schemas", () => {
  expect(decodeReference(`tm1:${projectId}:parent-session:entry_1:0:extra`)).toBeUndefined();
  expect(decodeReference(`tm1:${projectId}:${"s".repeat(129)}:entry_1:0`)).toBeUndefined();
});

test("decodeReference rejects a nonzero span, a non-digest project id, and an unsafe entry id", () => {
  expect(decodeReference(`tm1:${projectId}:parent-session:entry_1:1`)).toBeUndefined();
  expect(decodeReference(`tm1:${"A".repeat(64)}:parent-session:entry_1:0`)).toBeUndefined();
  expect(decodeReference(`tm1:${projectId}:parent-session:../entry:0`)).toBeUndefined();
});

test("rebindReference rebinds a same-project reference whose session is in the fork lineage", () => {
  expect(
    rebindReference(encodeReference(location), {
      projectId,
      lineage: new Set(["parent-session"]),
      childSessionId: "child-session",
    }),
  ).toBe(`tm1:${projectId}:child-session:entry_1:0`);
});

test("rebindReference returns foreign-project, out-of-lineage, and bare entry ids unchanged", () => {
  const reference = encodeReference(location);
  const fork = { projectId, lineage: new Set(["other-session"]), childSessionId: "child" };
  expect(rebindReference(reference, fork)).toBe(reference);
  expect(rebindReference(reference, { ...fork, projectId: "b".repeat(64) })).toBe(reference);
  expect(rebindReference("entry_1", { ...fork, lineage: new Set(["parent-session"]) })).toBe(
    "entry_1",
  );
});
