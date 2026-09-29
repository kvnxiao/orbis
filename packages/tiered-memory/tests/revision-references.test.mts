import { expect, test } from "vitest";

import { damagedReferencesIn, referencesIn } from "../src/pi/revision-references.ts";
import { customEntry } from "./store-fixture.mts";

const projectId = "a".repeat(64);
const reference = { version: 1, projectId, sessionId: "s", revisionId: "r" };

test("referencesIn skips a damaged reference and keeps the valid ones for its project", () => {
  const entries = [
    customEntry("e1", reference),
    customEntry("e2", { ...reference, version: 2 }),
    customEntry("e3", { ...reference, revisionId: "r2" }),
  ];
  expect(referencesIn(entries, projectId)).toEqual([reference, { ...reference, revisionId: "r2" }]);
});

test("damagedReferencesIn reports a reference with an unsupported version at /version", () => {
  expect(damagedReferencesIn([customEntry("e1", { ...reference, version: 2 })])).toEqual([
    { entryId: "e1", path: "/version" },
  ]);
});

test("damagedReferencesIn reports a reference missing its revisionId at /revisionId", () => {
  const { revisionId: _removed, ...rest } = reference;
  expect(damagedReferencesIn([customEntry("e1", rest)])).toEqual([
    { entryId: "e1", path: "/revisionId" },
  ]);
});

test("damagedReferencesIn reports a reference with a wrong-typed sessionId at /sessionId", () => {
  expect(damagedReferencesIn([customEntry("e1", { ...reference, sessionId: 5 })])).toEqual([
    { entryId: "e1", path: "/sessionId" },
  ]);
});

test.for([
  { label: "a string", data: "junk" },
  { label: "null", data: null },
  { label: "absent", data: undefined },
])("damagedReferencesIn reports a reference whose data is $label at /", ({ data }) => {
  expect(damagedReferencesIn([customEntry("e1", data)])).toEqual([{ entryId: "e1", path: "/" }]);
});

test("damagedReferencesIn lists several damaged references in branch order by entry id", () => {
  const entries = [
    customEntry("e9", { ...reference, version: 2 }),
    customEntry("e5", reference),
    customEntry("e1", { ...reference, sessionId: 5 }),
  ];
  expect(damagedReferencesIn(entries)).toEqual([
    { entryId: "e9", path: "/version" },
    { entryId: "e1", path: "/sessionId" },
  ]);
});

test("damagedReferencesIn skips valid references, other custom types, and valid references for another project", () => {
  const entries = [
    customEntry("e1", reference),
    customEntry("e2", { junk: true }, "orbis-tiered-memory-project"),
    customEntry("e3", { ...reference, projectId: "b".repeat(64) }),
  ];
  expect(damagedReferencesIn(entries)).toEqual([]);
});
