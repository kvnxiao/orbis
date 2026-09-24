import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";

import { guardManagedWrite } from "../src/pi/write-guard.ts";
import { test } from "./store-fixture.mts";

async function project(makeRoot: () => Promise<string>) {
  const root = await makeRoot();
  const cwd = join(root, "workspace");
  const sessions = join(root, ".pi", "tiered-memory", "sessions");
  const learnings = join(root, ".pi", "tiered-memory", "learnings");
  await mkdir(join(root, ".git"));
  await mkdir(cwd);
  await mkdir(sessions, { recursive: true });
  await mkdir(learnings);
  return { root, cwd, sessions, learnings };
}

test("normalized managed paths are blocked while adjacent settings and ordinary files stay writable", async ({
  makeRoot,
}) => {
  const { root, cwd, sessions, learnings } = await project(makeRoot);
  for (const path of [
    join(sessions, "new", "current-work.md"),
    join(learnings, "index.md"),
    join(cwd, "..", ".pi", "tiered-memory", "sessions", "new", "current-work.md"),
    `@${join(sessions, "new.md")}`,
    pathToFileURL(join(learnings, "new.md")).href,
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Each case resolves the guard against the same fixture.
    await expect(guardManagedWrite(cwd, path)).resolves.toMatchObject({ block: true });
  }
  for (const path of [
    join(root, ".pi", "tiered-memory", "settings.json"),
    join(root, ".pi", "tiered-memory", "sessions-extra", "note.md"),
    join(cwd, "draft.md"),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Each case resolves the guard against the same fixture.
    await expect(guardManagedWrite(cwd, path)).resolves.toBeUndefined();
  }
});

test("the blocked-write reason directs the agent to automatic observation and user curation", async ({
  makeRoot,
}) => {
  const { cwd, sessions } = await project(makeRoot);
  const result = await guardManagedWrite(cwd, join(sessions, "new", "current-work.md"));
  expect(result?.reason).toContain("Automatic observation records the conversation.");
  expect(result?.reason).toContain("Direct file maintenance belongs to user curation");
});

test("aliases through existing symlink ancestors and a symlinked file are blocked", async ({
  makeRoot,
}) => {
  const { cwd, sessions, learnings } = await project(makeRoot);
  const note = join(learnings, "index.md");
  await writeFile(note, "learning\n");
  await symlink(sessions, join(cwd, "session-alias"), "dir");
  await symlink(note, join(cwd, "note-alias"), "file");
  await expect(guardManagedWrite(cwd, "session-alias/new/current-work.md")).resolves.toMatchObject({
    block: true,
  });
  await expect(guardManagedWrite(cwd, "note-alias")).resolves.toMatchObject({ block: true });
});

test("aliases whose managed targets do not exist yet are blocked", async ({ makeRoot }) => {
  const { cwd, sessions, learnings } = await project(makeRoot);
  await symlink(join(sessions, "not-created"), join(cwd, "new-session"), "dir");
  await symlink(join(learnings, "not-created.md"), join(cwd, "new-learning"), "file");
  await expect(guardManagedWrite(cwd, "new-session/current-work.md")).resolves.toMatchObject({
    block: true,
  });
  await expect(guardManagedWrite(cwd, "new-learning")).resolves.toMatchObject({ block: true });
});

test("aliases to unrelated targets are allowed and a leading tilde expands", async ({
  makeRoot,
}) => {
  const { root, cwd } = await project(makeRoot);
  const ordinary = join(root, "ordinary");
  await mkdir(ordinary);
  await symlink(ordinary, join(cwd, "ordinary-alias"), "dir");
  await expect(guardManagedWrite(cwd, "ordinary-alias/new.md")).resolves.toBeUndefined();
  await expect(guardManagedWrite(cwd, "~/draft.md")).resolves.toBeUndefined();
  await expect(
    guardManagedWrite(homedir(), "~/.pi/tiered-memory/sessions/new.md"),
  ).resolves.toMatchObject({ block: true });
});

test("a project-relative alias resolves and a symlink loop is blocked", async ({ makeRoot }) => {
  const { cwd, sessions } = await project(makeRoot);
  await symlink(relative(cwd, sessions), join(cwd, "relative-alias"), "dir");
  await symlink("loop", join(cwd, "loop"), "file");
  await expect(guardManagedWrite(cwd, "relative-alias/new.md")).resolves.toMatchObject({
    block: true,
  });
  await expect(guardManagedWrite(cwd, "loop")).resolves.toMatchObject({ block: true });
});

test("empty paths are blocked and a path Node.js rejects is rethrown so Pi blocks the call", async ({
  makeRoot,
}) => {
  const { cwd } = await project(makeRoot);
  await expect(guardManagedWrite(cwd, "")).resolves.toMatchObject({ block: true });
  await expect(guardManagedWrite(cwd, "@")).resolves.toMatchObject({ block: true });
  await expect(guardManagedWrite(cwd, "\0bad")).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
});

test("the guard resolves the project root from cwd when storage failed to open", async ({
  createFixture,
}) => {
  const f = await createFixture();
  const sessions = join(f.cwd, ".pi", "tiered-memory", "sessions");
  const sessionDir = join(sessions, f.session.sessionManager.getSessionId());
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "identity.json"), "damaged identity");
  await f.reload();
  await f.command("off");
  expect(f.report()).toContain("Storage error:");
  const result = await f.session.extensionRunner.emitToolCall({
    type: "tool_call",
    toolName: "write",
    toolCallId: "fixture-write",
    input: { path: join(sessions, "note.md"), content: "overwrite" },
  });
  expect(result?.block).toBe(true);
});

test("the guard blocks managed writes in an in-memory session that has no storage", async ({
  createFixture,
}) => {
  const f = await createFixture({ inMemory: true });
  await f.command("status");
  expect(f.report()).toContain("Storage error: Pi keeps this session in memory");
  const result = await f.session.extensionRunner.emitToolCall({
    type: "tool_call",
    toolName: "write",
    toolCallId: "fixture-write",
    input: { path: join(f.cwd, ".pi", "tiered-memory", "learnings", "note.md"), content: "x" },
  });
  expect(result?.block).toBe(true);
});

test("scripted Pi built-in write and edit calls cannot change managed files", async ({
  createFixture,
}) => {
  const f = await createFixture({
    builtinTools: true,
    toolCalls: [
      {
        name: "write",
        arguments: { path: ".pi/tiered-memory/sessions/direct.md", content: "blocked" },
      },
      {
        name: "edit",
        arguments: {
          path: ".pi/tiered-memory/sessions/existing.md",
          oldText: "original",
          newText: "changed",
        },
      },
    ],
  });
  const managed = join(f.cwd, ".pi", "tiered-memory", "sessions");
  await mkdir(managed, { recursive: true });
  await writeFile(join(managed, "existing.md"), "original");
  await f.session.prompt("Attempt both managed writes.");
  expect(await readFile(join(managed, "existing.md"), "utf8")).toBe("original");
  await expect(readFile(join(managed, "direct.md"), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  const results = f.session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === "message" && entry.message.role === "toolResult");
  expect(results).toHaveLength(2);
  expect(
    results.every(
      (entry) =>
        entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError,
    ),
  ).toBe(true);
});

test("a scripted Pi write through a symlink is blocked while memory is disabled", async ({
  createFixture,
}) => {
  const f = await createFixture({
    builtinTools: true,
    toolCalls: [
      { name: "write", arguments: { path: "memory-alias/blocked.md", content: "blocked" } },
    ],
  });
  const managed = join(f.cwd, ".pi", "tiered-memory", "sessions");
  await symlink(managed, join(f.cwd, "memory-alias"), "dir");
  await f.command("off");
  await f.session.prompt("Attempt the aliased write.");
  await expect(readFile(join(managed, "blocked.md"), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  const result = f.session.sessionManager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  expect(
    result?.type === "message" && result.message.role === "toolResult" && result.message.isError,
  ).toBe(true);
});
