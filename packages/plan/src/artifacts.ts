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

import type { SaveResult } from "./persistence.ts";
import type { PlanningSession } from "./state.ts";

/** Create an immutable file, or verify an explicitly owned retry target. */
export function writeArtifact(path: string, content: string, retry: boolean): void {
  if (!isAbsolute(path)) {
    throw new Error("Artifact paths must be absolute.");
  }
  if (existsSync(path)) {
    if (!retry || readFileSync(path, "utf8") !== content) {
      throw new Error(
        `Artifact conflict at ${path}. Preserve the file and resolve the conflict before retrying.`,
      );
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
    throw new Error("Saved artifact bytes differ from their recorded content.");
  }
}

/** Persist the exact revision and its path before permitting review display. */
export function prepareReviewArtifact(
  state: PlanningSession,
  directory: string,
  persist: (state: PlanningSession) => SaveResult,
): PlanningSession {
  const review = state.reviews?.at(-1);
  if (review === undefined || !/^[a-f0-9-]{36}$/.test(state.planId) || !isAbsolute(directory)) {
    throw new Error("Review requires a current revision and an absolute output directory.");
  }
  const path = review.path ?? join(directory, `${state.planId}-${String(review.revision)}.md`);
  const prepared = {
    ...state,
    reviews: [...(state.reviews?.slice(0, -1) ?? []), { ...review, path }],
  };
  const saved = persist(prepared);
  if (!saved.saved) {
    throw new Error(saved.message);
  }
  writeArtifact(path, review.markdown, review.path !== undefined);
  const confirmed = persist(prepared);
  if (!confirmed.saved) {
    throw new Error(confirmed.message);
  }
  return prepared;
}
