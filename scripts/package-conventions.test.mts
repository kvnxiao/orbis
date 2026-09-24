import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { Type } from "typebox";
import { expect, test } from "vitest";

import { parseRecord, readOptional } from "../templates/extension/src/records.ts";

const root = resolve(import.meta.dirname, "..");
const templateRecords = join(root, "templates", "extension", "src", "records.ts");

const manifestSchema = Type.Object({
  exports: Type.Optional(Type.Unknown()),
  pi: Type.Optional(Type.Object({ extensions: Type.Optional(Type.Array(Type.String())) })),
  peerDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  devDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const typeboxTriggers = [
  /from "typebox(?:\/[a-z]+)?"/u,
  /appendEntry\(/u,
  /registerTool\(/u,
  /readFile\(/u,
  /JSON\.parse\(/u,
];

async function packageDirectories(): Promise<string[]> {
  const entries = await readdir(join(root, "packages"), { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name));
  const manifests = await Promise.all(
    directories.map(async (directory) => await readOptional(join(root, directory, "package.json"))),
  );
  return directories.filter((_directory, index) => manifests[index] !== undefined);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory, "src"), { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(directory, "src", entry));
}

async function manifestFailures(directory: string): Promise<string[]> {
  const path = join(directory, "package.json");
  const manifest = parseRecord(manifestSchema, await readFile(join(root, path), "utf8"), path);
  const sources = await Promise.all(
    (await sourceFiles(directory)).map(async (file) => await readFile(join(root, file), "utf8")),
  );
  const failures: string[] = [];
  if (JSON.stringify(manifest.pi?.extensions) !== JSON.stringify(["./src/index.ts"])) {
    failures.push(`${path}: pi.extensions must equal ["./src/index.ts"]`);
  }
  if (manifest.exports === undefined) {
    failures.push(`${path}: exports is missing`);
  }
  if (
    sources.some((source) => typeboxTriggers.some((trigger) => trigger.test(source))) &&
    (manifest.peerDependencies?.typebox !== "*" || manifest.devDependencies?.typebox !== "catalog:")
  ) {
    failures.push(`${path}: typebox requires a "*" peer and a "catalog:" dev dependency`);
  }
  return failures;
}

test("every package manifest declares its entry, exports, and typebox requirements", async () => {
  const failures = (await Promise.all((await packageDirectories()).map(manifestFailures))).flat();
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("every package records module equals the template byte for byte", async () => {
  const template = await readFile(templateRecords);
  const files = (await Promise.all((await packageDirectories()).map(sourceFiles)))
    .flat()
    .filter((file) => basename(file) === "records.ts");
  const contents = await Promise.all(files.map(async (file) => await readFile(join(root, file))));
  const differing = files.filter((_file, index) => contents[index]?.equals(template) !== true);
  assert.deepEqual(
    differing,
    [],
    `Differs from templates/extension/src/records.ts: ${differing.join(", ")}`,
  );
});

const recordSchema = Type.Object({ version: Type.Literal(1), name: Type.String() });

test("template parseRecord returns a record that matches the schema", () => {
  expect(parseRecord(recordSchema, '{"version":1,"name":"fixture"}', "record.json")).toEqual({
    version: 1,
    name: "fixture",
  });
});

test.for([
  { label: "an unsupported version", text: '{"version":2,"name":"fixture"}', path: "/version" },
  {
    label: "a missing required property",
    text: '{"version":1}',
    path: "/: must have required properties name",
  },
  { label: "a wrong-typed property", text: '{"version":1,"name":1}', path: "/name" },
])("template parseRecord rejects $label with the file and instance paths", ({ text, path }) => {
  expect(() => parseRecord(recordSchema, text, "record.json")).toThrow(
    `Invalid record at record.json: ${path}`,
  );
});

test("template parseRecord reports invalid JSON with the SyntaxError as cause", () => {
  let failure: unknown;
  try {
    parseRecord(recordSchema, "{", "record.json");
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ message: "Invalid JSON at record.json." });
  expect(failure instanceof Error && failure.cause).toBeInstanceOf(SyntaxError);
});

test("template readOptional returns undefined for a missing file and rethrows other errors", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "orbis-records-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  expect(await readOptional(join(directory, "missing.json"))).toBeUndefined();
  await expect(readOptional(directory)).rejects.toMatchObject({ code: "EISDIR" });
});
