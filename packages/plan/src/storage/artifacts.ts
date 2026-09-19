import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { PlanningError, describe } from "../domain/errors.ts";
import type { PlanningSession } from "../domain/state.ts";
import { isPlanId, stampReviewPath } from "../domain/state.ts";
import { isFileError, saveFailure } from "./persistence.ts";
import type { SaveResult } from "./persistence.ts";

/** Create an immutable file, or verify an explicitly owned retry target. */
export function writeArtifact(path: string, content: string, retry: boolean): void {
  if (!isAbsolute(path)) {
    throw new PlanningError("invalid-input", "Artifact paths must be absolute.");
  }
  try {
    if (existsSync(path)) {
      if (!retry || readFileSync(path, "utf8") !== content) {
        throw new PlanningError("artifact-conflict", `Artifact conflict at ${path}.`, {
          data: { path },
        });
      }
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx");
    try {
      try {
        writeFileSync(descriptor, content, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      linkSync(temporary, path);
    } finally {
      unlinkSync(temporary);
    }
    if (readFileSync(path, "utf8") !== content) {
      throw new PlanningError(
        "artifact-conflict",
        `Saved artifact bytes differ from their recorded content at ${path}.`,
        { data: { path } },
      );
    }
  } catch (error) {
    if (isFileError(error)) {
      if (error.code === "EEXIST") {
        throw new PlanningError("artifact-conflict", `Artifact conflict at ${path}.`, {
          data: { path },
          cause: error,
        });
      }
      throw new PlanningError(
        "persistence",
        `Cannot write plan artifact ${path}: ${describe(error)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/** Persist the exact revision and its path before permitting review display. */
export function prepareReviewArtifact(
  state: PlanningSession,
  directory: string,
  persist: (state: PlanningSession) => SaveResult,
): PlanningSession {
  const review = state.reviews?.at(-1);
  if (review === undefined || !isPlanId(state.planId) || !isAbsolute(directory)) {
    throw new PlanningError(
      "rejected",
      "Review requires a current revision and an absolute output directory.",
    );
  }
  const path = review.path ?? join(directory, `${state.planId}-${String(review.revision)}.md`);
  const prepared = stampReviewPath(state, review.revision, path);
  const saved = persist(prepared);
  if (!saved.saved) {
    throw saveFailure(saved);
  }
  writeArtifact(path, review.markdown, review.path !== undefined);
  const confirmed = persist(prepared);
  if (!confirmed.saved) {
    throw saveFailure(confirmed);
  }
  return prepared;
}
