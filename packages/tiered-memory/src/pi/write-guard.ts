import { lstat, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { errorCode } from "../storage/files.ts";
import { resolveProjectRoot } from "../storage/project-root.ts";

const managedDirectories = ["sessions", "learnings"] as const;
const linkLimit = 40;
const blockedReason =
  "Tiered memory controls files under .pi/tiered-memory/sessions/ and learnings/. Automatic observation records the conversation. Direct file maintenance belongs to user curation; ask the user to make the change outside ordinary write or edit calls.";

class UnresolvablePathError extends Error {}

function toolAbsolutePath(cwd: string, toolPath: string): string {
  let normalized = toolPath.replace(/[  -   　]/gu, " ");
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  if (normalized.length === 0) {
    throw new UnresolvablePathError("The path is empty.");
  }
  if (normalized === "~") {
    normalized = homedir();
  } else if (normalized.startsWith("~/")) {
    normalized = join(homedir(), normalized.slice(2));
  } else if (normalized.startsWith("file://")) {
    normalized = fileURLToPath(normalized);
  }
  return resolve(cwd, normalized);
}

async function resolveComponents(current: string, parts: string[], links: number): Promise<string> {
  const [part, ...remaining] = parts;
  if (part === undefined) {
    return current;
  }
  const candidate = join(current, part);
  let isLink: boolean;
  try {
    isLink = (await lstat(candidate)).isSymbolicLink();
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return resolve(candidate, ...remaining);
    }
    throw error;
  }
  if (!isLink) {
    return await resolveComponents(candidate, remaining, links);
  }
  if (links >= linkLimit) {
    throw new UnresolvablePathError("Too many symbolic links in path.");
  }
  return await resolveAliases(resolve(current, await readlink(candidate), ...remaining), links + 1);
}

async function resolveAliases(absolutePath: string, links = 0): Promise<string> {
  const { root } = parse(absolutePath);
  const parts = absolutePath.slice(root.length).split(sep).filter(Boolean);
  return await resolveComponents(root, parts, links);
}

function containsPath(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return (
    suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

/**
 * Block a `write` or `edit` whose target resolves into the project's managed memory directories.
 *
 * Normalizes `toolPath` as Pi's file tools do (a leading `@`, `~`, `file://` URLs, and Unicode
 * spaces) against `cwd`, then resolves symbolic links in every existing component. Blocks when the
 * lexical or the resolved target is inside `.pi/tiered-memory/sessions/` or `learnings/` under the
 * project root that `resolveProjectRoot` finds for `cwd`, compared lexically and with that
 * directory's own links resolved. A target that cannot be resolved because of a filesystem error,
 * an empty path, or more than 40 links is blocked.
 *
 * @throws The original error when resolution fails for any other cause; Pi blocks a tool call whose
 *   `tool_call` handler throws and reports the extension failure.
 */
export async function guardManagedWrite(
  cwd: string,
  toolPath: string,
): Promise<{ block: true; reason: string } | undefined> {
  const projectRoot = await resolveProjectRoot(cwd);
  try {
    const candidate = toolAbsolutePath(cwd, toolPath);
    const canonical = await resolveAliases(candidate);
    const managedPaths = await Promise.all(
      managedDirectories.map(async (directory) => {
        const lexical = resolve(projectRoot, ".pi", "tiered-memory", directory);
        return { lexical, canonical: await resolveAliases(lexical) };
      }),
    );
    if (
      managedPaths.some(
        (managed) =>
          containsPath(managed.lexical, candidate) || containsPath(managed.canonical, canonical),
      )
    ) {
      return { block: true, reason: blockedReason };
    }
    return undefined;
  } catch (error) {
    const code = errorCode(error);
    if (
      error instanceof UnresolvablePathError ||
      (code !== undefined && /^(E[A-Z]+|UNKNOWN)$/u.test(code))
    ) {
      return { block: true, reason: `Cannot safely resolve the write path. ${blockedReason}` };
    }
    throw error;
  }
}
