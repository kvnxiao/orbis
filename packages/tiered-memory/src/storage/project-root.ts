import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Return the nearest directory at or above `cwd` that contains a `.git` file or directory, or `cwd`
 * when none does.
 *
 * `cwd` must be absolute and is used as supplied, without resolving symbolic links. Directories are
 * checked nearest first, one `stat` per level, and the first `.git` entry found is accepted without
 * reading it. A `stat` rejection that is an `Error` whose string `code` is an `E*` code or
 * `UNKNOWN` counts as absent, and the walk stops at the path root. `GIT_DIR`, `GIT_WORK_TREE`, and
 * device boundaries are not honored.
 *
 * @throws The original error when `stat` rejects with anything else.
 */
export async function resolveProjectRoot(
  cwd: string,
  io: { stat: (path: string) => Promise<unknown> } = { stat },
): Promise<string> {
  return (await nearestGitDirectory(cwd, io)) ?? cwd;
}

async function nearestGitDirectory(
  directory: string,
  io: { stat: (path: string) => Promise<unknown> },
): Promise<string | undefined> {
  try {
    await io.stat(join(directory, ".git"));
    return directory;
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        /^(E[A-Z]+|UNKNOWN)$/u.test(error.code)
      )
    ) {
      throw error;
    }
  }
  const parent = dirname(directory);
  return parent === directory ? undefined : await nearestGitDirectory(parent, io);
}

/**
 * Return `.pi/tiered-memory/settings.json` under the project root that `resolveProjectRoot` finds
 * for `cwd`.
 */
export async function resolveProjectSettingsPath(cwd: string): Promise<string> {
  return join(await resolveProjectRoot(cwd), ".pi", "tiered-memory", "settings.json");
}
