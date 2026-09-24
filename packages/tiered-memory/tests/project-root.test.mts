import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { resolveProjectRoot, resolveProjectSettingsPath } from "../src/storage/project-root.ts";

const git = promisify(execFile);

async function workspace(onTestFinished: (fn: () => Promise<void>) => void): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orbis-tiered-root-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("resolves a Git subdirectory to the repository root", async ({ onTestFinished }) => {
  const root = await workspace(onTestFinished);
  await git("git", ["init", "-q", root]);
  const cwd = join(root, "src", "nested");
  await mkdir(cwd, { recursive: true });
  expect(await resolveProjectRoot(cwd)).toBe(root);
  expect(await resolveProjectSettingsPath(cwd)).toBe(
    join(root, ".pi", "tiered-memory", "settings.json"),
  );
});

test("resolves a linked worktree to its own root", async ({ onTestFinished }) => {
  const directory = await workspace(onTestFinished);
  const main = join(directory, "main");
  await mkdir(main);
  await git("git", ["init", "-q", main]);
  await git("git", [
    "-C",
    main,
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "user.name=Fixture",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const linked = join(directory, "linked");
  await git("git", ["-C", main, "worktree", "add", "-q", "--detach", linked, "HEAD"]);
  const cwd = join(linked, "src");
  await mkdir(cwd);
  expect(await resolveProjectRoot(cwd)).toBe(linked);
});

test("resolves a nested repository to the inner root", async ({ onTestFinished }) => {
  const outer = await workspace(onTestFinished);
  await git("git", ["init", "-q", outer]);
  const inner = join(outer, "nested");
  await mkdir(inner);
  await git("git", ["init", "-q", inner]);
  const cwd = join(inner, "src");
  await mkdir(cwd);
  expect(await resolveProjectRoot(cwd)).toBe(inner);
});

test("falls back to cwd outside Git", async ({ onTestFinished }) => {
  const cwd = join(await workspace(onTestFinished), "project");
  await mkdir(cwd);
  expect(await resolveProjectRoot(cwd)).toBe(cwd);
});

test("preserves a trailing space in the root path", async ({ onTestFinished }) => {
  const root = join(await workspace(onTestFinished), "worktree ");
  const cwd = join(root, "src");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  expect(await resolveProjectRoot(cwd)).toBe(root);
});

test("continues the walk past a stat failure other than ENOENT", async ({ onTestFinished }) => {
  const root = await workspace(onTestFinished);
  const cwd = join(root, "src");
  await mkdir(join(root, ".git"));
  await mkdir(join(cwd, ".git"), { recursive: true });
  const denied = join(cwd, ".git");
  const io = {
    async stat(path: string): Promise<unknown> {
      if (path === denied) {
        throw Object.assign(new Error(`EACCES: permission denied, stat '${path}'`), {
          code: "EACCES",
        });
      }
      return await stat(path);
    },
  };
  expect(await resolveProjectRoot(cwd, io)).toBe(root);
});

test("rethrows a non-filesystem error from stat", async ({ onTestFinished }) => {
  const cwd = await workspace(onTestFinished);
  const defect = new TypeError("stat capability is broken");
  const io = {
    async stat(): Promise<unknown> {
      return await Promise.reject(defect);
    },
  };
  await expect(resolveProjectRoot(cwd, io)).rejects.toBe(defect);
});
