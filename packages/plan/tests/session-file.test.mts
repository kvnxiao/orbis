import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { SessionFile } from "../src/storage/session-file.ts";

test("cached session parsing rereads bytes across replacement, truncation, and partial tails", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "orbis-session-file-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, "session.jsonl");
  const file = new SessionFile();
  const header = { type: "session", id: "one" };
  const original = `${JSON.stringify(header)}\n`;
  await writeFile(path, original);
  expect(file.read(path)).toEqual([header]);
  const metadata = await stat(path);
  await writeFile(path, original.replace("one", "two"));
  await utimes(path, metadata.atime, metadata.mtime);
  expect(file.read(path)).toEqual([{ type: "session", id: "two" }]);
  await appendFile(path, '{"type":"custom","id":');
  expect(file.read(path)).toEqual([{ type: "session", id: "two" }]);
  await appendFile(path, '"entry","data":"界🙂"}\n');
  expect(file.read(path)).toEqual([
    { type: "session", id: "two" },
    { type: "custom", id: "entry", data: "界🙂" },
  ]);
  await appendFile(path, "malformed\n");
  expect(file.read(path)).toHaveLength(2);
  await rename(path, `${path}.old`);
  await writeFile(path, original);
  expect(file.read(path)).toEqual([header]);
  await writeFile(path, "");
  expect(file.read(path)).toEqual([]);
  await rm(path);
  expect(() => file.read(path)).toThrow("ENOENT");
  await writeFile(path, original);
  expect(file.read(path)).toEqual([header]);
  expect(await readFile(path, "utf8")).toBe(original);
});

test("cache limits preserve large valid session contents", async ({ onTestFinished }) => {
  const directory = await mkdtemp(join(tmpdir(), "orbis-session-large-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, "session.jsonl");
  const file = new SessionFile();
  const entry = { type: "custom", id: "large", data: "x".repeat(2 * 1024 * 1024) };
  await writeFile(path, `${JSON.stringify(entry)}\n`);
  expect(file.read(path)).toEqual([entry]);
  await appendFile(path, '{"type":"custom","id":"next"}\n');
  expect(file.read(path)).toEqual([entry, { type: "custom", id: "next" }]);
});
