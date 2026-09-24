import { createHash } from "node:crypto";

/** Hash UTF-8 text with SHA-256 and return 64 lowercase hex characters. */
export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Serialize a JSON value with object keys sorted at every depth.
 *
 * Object members whose value is `undefined` are omitted and arrays keep their order, so values that
 * are equal by domain meaning serialize to identical text. `value` must hold only JSON-compatible
 * data.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const members = new Map(Object.entries(value));
    const keys = [...members.keys()].filter((key) => members.get(key) !== undefined).toSorted();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(members.get(key))}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
