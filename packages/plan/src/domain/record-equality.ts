import { isDeepStrictEqual } from "node:util";

/** Compare JSON values without member ordering, including omitted undefined properties. */
export function sameRecord(left: unknown, right: unknown): boolean {
  if (isDeepStrictEqual(left, right)) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  return isDeepStrictEqual(JSON.parse(a), JSON.parse(b));
}
