/** Select recovery by the caller's required action. */
export type PlanningErrorKind = keyof PlanningErrorData;

/** Carry revision and path data without parsing failure text. */
export interface PlanningErrorData {
  "invalid-input": undefined;
  rejected: undefined;
  "revision-conflict": { expected: number; current: number };
  "interaction-closed": undefined;
  persistence: { deferred?: true } | undefined;
  settings: { path: string };
  "artifact-conflict": { path: string };
}

/** Preserve the underlying failure while identifying the caller's recovery action. */
export class PlanningError<K extends PlanningErrorKind = PlanningErrorKind> extends Error {
  readonly kind: K;
  readonly data?: PlanningErrorData[K];

  constructor(
    kind: K,
    message: string,
    ...[options]: undefined extends PlanningErrorData[K]
      ? [options?: { data?: PlanningErrorData[K]; cause?: unknown }]
      : [options: { data: PlanningErrorData[K]; cause?: unknown }]
  ) {
    super(message, options);
    this.name = "PlanningError";
    this.kind = kind;
    if (options?.data !== undefined) {
      this.data = options.data;
    }
  }
}

/** Narrow independently loaded error copies using their kind and required data. */
export type PlanningFailure = {
  [K in PlanningErrorKind]: {
    kind: K;
    data: PlanningErrorData[K];
    message: string;
    cause?: unknown;
  };
}[PlanningErrorKind];

/** Recognize the error contract without relying on extension-local class identity. */
export function isPlanningError(value: unknown): value is PlanningFailure {
  if (
    typeof value !== "object" ||
    value === null ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    !("kind" in value)
  ) {
    return false;
  }
  const data: unknown = "data" in value ? value.data : undefined;
  switch (value.kind) {
    case "invalid-input":
    case "rejected":
    case "interaction-closed":
      return data === undefined;
    case "revision-conflict":
      return (
        typeof data === "object" &&
        data !== null &&
        "expected" in data &&
        typeof data.expected === "number" &&
        Number.isSafeInteger(data.expected) &&
        data.expected >= 0 &&
        "current" in data &&
        typeof data.current === "number" &&
        Number.isSafeInteger(data.current) &&
        data.current >= 0
      );
    case "settings":
    case "artifact-conflict":
      return (
        typeof data === "object" &&
        data !== null &&
        "path" in data &&
        typeof data.path === "string" &&
        data.path.length > 0
      );
    case "persistence":
      return (
        data === undefined ||
        (typeof data === "object" &&
          data !== null &&
          (!("deferred" in data) || data.deferred === true))
      );
    default:
      return false;
  }
}

/** Read failure text from native errors and structurally compatible extension errors. */
export function describe(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

/** Retain the failure until the tool, command, or terminal boundary renders it. */
export function errorResult(error: unknown): { outcome: "error"; message: string; error: unknown } {
  return { outcome: "error", message: describe(error), error };
}

/** Discard superseded work without pausing the replacement owner. */
export const superseded = { kind: "superseded" } as const;
