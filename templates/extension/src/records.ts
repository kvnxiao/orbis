import { readFile } from "node:fs/promises";

import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Parse JSON text and validate it against a schema.
 *
 * @throws Error naming `path` when the text is not JSON, with the `SyntaxError` as its cause.
 * @throws Error naming `path` and each failing instance path when the value does not match
 *   `schema`.
 */
export function parseRecord<T extends TSchema>(schema: T, text: string, path: string): Static<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) {
      throw cause;
    }
    throw new Error(`Invalid JSON at ${path}.`, { cause });
  }
  if (!Value.Check(schema, value)) {
    const detail = Value.Errors(schema, value)
      .map(
        (error) =>
          `${error.instancePath.length === 0 ? "/" : error.instancePath}: ${error.message}`,
      )
      .join("; ");
    throw new Error(`Invalid record at ${path}: ${detail}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-return -- tsgolint resolves the narrowed generic Static<T> as any while tsc checks it.
  return value;
}

/**
 * Read a UTF-8 file, or return `undefined` when it does not exist.
 *
 * @throws The original read error for every failure other than `ENOENT`, including Node's
 *   `AbortError` when `signal` aborts.
 */
export async function readOptional(
  path: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await readFile(path, { encoding: "utf8", signal });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
