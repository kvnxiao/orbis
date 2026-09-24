import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { writeDurable } from "../src/storage/files.ts";
import {
  advanceSequence,
  headSchema,
  identitySchema,
  readHead,
  readRevision,
  revisionSchema,
  sequenceSchema,
  writeRevision,
} from "../src/storage/revisions.ts";
import type { Revision } from "../src/storage/revisions.ts";
import { baseProposal, rejectionPaths, test } from "./store-fixture.mts";

const projectId = "a".repeat(64);
const signal = new AbortController().signal;
const access = { signal, write: writeDurable };

function revision(id: string): Revision {
  const { expectedRevision, ...fields } = baseProposal({ sessionId: "session-1", projectId });
  return { version: 1, id, parentRevisionId: expectedRevision, sequence: 1, ...fields };
}

const identity = { version: 1, projectId, projectRoot: "/project", sessionId: "session-1" };
const head = {
  version: 1,
  revisionId: "revision-1",
  views: { notes: { "current-work.md": "b".repeat(64) }, learnings: {} },
  materialized: true,
};

test("identity.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(identitySchema, { ...identity, version: 2 })).toContain("/version");
});

test("identity.json missing its projectRoot is rejected at /projectRoot", () => {
  const { projectRoot: _removed, ...rest } = identity;
  expect(rejectionPaths(identitySchema, rest)).toContain("/projectRoot");
});

test("identity.json with a wrong-typed sessionId is rejected at /sessionId", () => {
  expect(rejectionPaths(identitySchema, { ...identity, sessionId: 7 })).toContain("/sessionId");
});

test("head.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(headSchema, { ...head, version: 2 })).toContain("/version");
});

test("head.json missing its views is rejected at /views", () => {
  const { views: _removed, ...rest } = head;
  expect(rejectionPaths(headSchema, rest)).toContain("/views");
});

test("head.json with a wrong-typed view digest is rejected at /views/notes/current-work.md", () => {
  expect(
    rejectionPaths(headSchema, {
      ...head,
      views: { notes: { "current-work.md": 1 }, learnings: {} },
    }),
  ).toContain("/views/notes/current-work.md");
});

test("a revision file with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(revisionSchema, { ...revision("r"), version: 2 })).toContain("/version");
});

test("a revision file missing its parentRevisionId is rejected at /parentRevisionId", () => {
  const { parentRevisionId: _removed, ...rest } = revision("r");
  expect(rejectionPaths(revisionSchema, rest)).toContain("/parentRevisionId");
});

test("a revision file missing its sequence or with sequence 0 is rejected at /sequence", () => {
  const { sequence: _removed, ...rest } = revision("r");
  expect(rejectionPaths(revisionSchema, rest)).toContain("/sequence");
  expect(rejectionPaths(revisionSchema, { ...revision("r"), sequence: 0 })).toContain("/sequence");
});

test("a revision file with a wrong-typed note body is rejected at /notes/current-work.md", () => {
  expect(
    rejectionPaths(revisionSchema, { ...revision("r"), notes: { "current-work.md": 1 } }),
  ).toContain("/notes/current-work.md");
});

test("sequence.json with an unsupported version is rejected at /version", () => {
  expect(rejectionPaths(sequenceSchema, { version: 2, value: 1 })).toContain("/version");
});

test("sequence.json missing its value is rejected at /value", () => {
  expect(rejectionPaths(sequenceSchema, { version: 1 })).toContain("/value");
});

test("sequence.json with a wrong-typed value is rejected at /value", () => {
  expect(rejectionPaths(sequenceSchema, { version: 1, value: "1" })).toContain("/value");
});

test("readRevision rejects a revision whose id, project, or session differs from its location", async ({
  makeRoot,
}) => {
  const sessionDir = await makeRoot();
  const path = join(sessionDir, "revisions", "revision-1.json");
  await mkdir(join(sessionDir, "revisions"));
  const bytes = JSON.stringify(revision("revision-2"));
  await writeFile(path, bytes);
  await expect(
    readRevision(
      sessionDir,
      { projectId, sessionId: "session-1", revisionId: "revision-1" },
      signal,
    ),
  ).rejects.toThrow(`Invalid record at ${path}: /id`);
  await expect(
    readRevision(
      sessionDir,
      { projectId: "b".repeat(64), sessionId: "session-1", revisionId: "revision-1" },
      signal,
    ),
  ).rejects.toThrow(path);
  expect(await readFile(path, "utf8")).toBe(bytes);
});

test("readRevision returns undefined for a revision id without a file", async ({ makeRoot }) => {
  await expect(
    readRevision(
      await makeRoot(),
      { projectId, sessionId: "session-1", revisionId: "missing" },
      signal,
    ),
  ).resolves.toBeUndefined();
});

test("writeRevision refuses to rewrite an existing revision file", async ({ makeRoot }) => {
  const sessionDir = await makeRoot();
  await writeRevision(sessionDir, revision("revision-1"), access);
  await expect(writeRevision(sessionDir, revision("revision-1"), access)).rejects.toThrow(
    "never rewritten",
  );
});

test("advanceSequence starts at 1 and increments by one", async ({ makeRoot }) => {
  const baseDir = await makeRoot();
  expect(await advanceSequence(baseDir, access)).toBe(1);
  expect(await advanceSequence(baseDir, access)).toBe(2);
});

test("advanceSequence rejects a counter that would exceed the safe-integer range", async ({
  makeRoot,
}) => {
  const baseDir = await makeRoot();
  const path = join(baseDir, "sessions", "_project", "sequence.json");
  await mkdir(join(baseDir, "sessions", "_project"), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, value: Number.MAX_SAFE_INTEGER }));
  await expect(advanceSequence(baseDir, access)).rejects.toThrow(`${path}: /value`);
});

test("a damaged record's bytes are preserved after the read fails", async ({ makeRoot }) => {
  const sessionDir = await makeRoot();
  const path = join(sessionDir, "head.json");
  await writeFile(path, "{damaged");
  await expect(readHead(sessionDir, signal)).rejects.toThrow(`Invalid JSON at ${path}.`);
  expect(await readFile(path, "utf8")).toBe("{damaged");
});
