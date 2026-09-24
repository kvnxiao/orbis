import { expect, test } from "vitest";

import { digest, stableStringify } from "../src/domain/canonical.ts";

test("digest returns the lowercase SHA-256 hex of the UTF-8 text", () => {
  expect(digest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(digest("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("stableStringify sorts object keys at every depth", () => {
  expect(stableStringify({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: "x" } })).toBe(
    '{"a":{"c":"x","d":[2,{"e":0,"f":1}]},"b":1}',
  );
});

test("stableStringify omits undefined members and keeps array order", () => {
  expect(stableStringify({ kept: [3, 1, 2], dropped: undefined, empty: null })).toBe(
    '{"empty":null,"kept":[3,1,2]}',
  );
});

test("stableStringify serializes objects equal by value but ordered differently to identical text", () => {
  const first = { settings: { enabled: true, limits: { a: 1, b: 2 } }, root: "/p" };
  const second = { root: "/p", settings: { limits: { b: 2, a: 1 }, enabled: true } };
  expect(stableStringify(first)).toBe(stableStringify(second));
  expect(stableStringify({ list: [1, 2] })).not.toBe(stableStringify({ list: [2, 1] }));
});
