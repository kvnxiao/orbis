import { expect, test } from "vitest";

import { dependencyFingerprint, validateProposal } from "../src/domain/proposal.ts";
import { defaultLimits } from "../src/domain/settings.ts";
import { baseProposal } from "./store-fixture.mts";

const store = { sessionId: "session-1", projectId: "a".repeat(64) };

test("validateProposal accepts a proposal whose dependencies and learnings are consistent", () => {
  const proposal = baseProposal(store, {
    noteDependencies: {
      "current-work.md": { sourceIds: ["source-1"], evidenceFingerprint: "d".repeat(64) },
    },
    learnings: { "index.md": "learning\n" },
    expectedLearnings: { "index.md": { digest: null, sequence: null } },
  });
  expect(validateProposal(proposal)).toEqual(proposal);
});

test("validateProposal rejects a proposal missing configurationRevision and names the path", () => {
  const { configurationRevision: _removed, ...rest } = baseProposal(store);
  expect(() => validateProposal(rest)).toThrow(
    "/: must have required properties configurationRevision",
  );
});

test("validateProposal rejects a wrong-typed expectedRevision and names /expectedRevision", () => {
  expect(() => validateProposal({ ...baseProposal(store), expectedRevision: 3 })).toThrow(
    "/expectedRevision",
  );
});

test("validateProposal rejects an unknown note name under /notes", () => {
  expect(() => validateProposal({ ...baseProposal(store), notes: { "bad.md": "x" } })).toThrow(
    "/notes",
  );
});

test("validateProposal rejects a note dependency for a note the proposal does not write", () => {
  const proposal = baseProposal(store, {
    noteDependencies: {
      "journey.md": { sourceIds: ["source-1"], evidenceFingerprint: "d".repeat(64) },
    },
  });
  expect(() => validateProposal(proposal)).toThrow("/noteDependencies/journey.md");
});

test("validateProposal rejects a learning without an expectedLearnings entry", () => {
  expect(() =>
    validateProposal(baseProposal(store, { learnings: { "index.md": "learning\n" } })),
  ).toThrow("/learnings/index.md");
});

const settings = { enabled: true, limits: { ...defaultLimits } };

test("dependencyFingerprint is independent of key order", () => {
  const reordered = {
    limits: Object.fromEntries(Object.entries(defaultLimits).toReversed()),
    enabled: true,
  };
  expect(
    dependencyFingerprint({
      settings: { ...reordered, limits: { ...defaultLimits, ...reordered.limits } },
      roles: undefined,
      projectRoot: "/p",
    }),
  ).toBe(dependencyFingerprint({ settings, roles: undefined, projectRoot: "/p" }));
});

test("dependencyFingerprint changes when settings, roles, or the project root change", () => {
  const original = dependencyFingerprint({ settings, roles: undefined, projectRoot: "/p" });
  const ready = { state: "ready" as const, id: "p/m", inputTokens: 1, outputTokens: 1 };
  expect(
    dependencyFingerprint({
      settings: { ...settings, enabled: false },
      roles: undefined,
      projectRoot: "/p",
    }),
  ).not.toBe(original);
  expect(
    dependencyFingerprint({
      settings,
      roles: { observer: ready, consolidator: ready },
      projectRoot: "/p",
    }),
  ).not.toBe(original);
  expect(dependencyFingerprint({ settings, roles: undefined, projectRoot: "/q" })).not.toBe(
    original,
  );
});
