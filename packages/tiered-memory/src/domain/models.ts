import type { Limits } from "./settings.ts";

/** List the memory worker roles in status order. */
export const memoryRoles = ["observer", "consolidator"] as const;

/** Name a memory worker role; each role selects its model independently. */
export type Role = (typeof memoryRoles)[number];

/**
 * Describe one role's model check.
 *
 * `id` is the configured override, the active model's `provider/id`, or `session model` when no
 * model is active. `ready` carries the capped worker budgets; `suspended` carries a user-facing
 * reason that never includes credential-command output.
 */
export type ModelResolution =
  | { state: "ready"; id: string; inputTokens: number; outputTokens: number }
  | { state: "suspended"; id: string; reason: string };

/**
 * Cap worker input and output to a model's limits, or suspend when the caps cannot hold the
 * mandatory budgets.
 *
 * The output cap is the smaller of `workerOutputTokens` and `maxTokens`; the input cap is the
 * smaller of `workerInputTokens` and `contextWindow` minus the output cap. The result is suspended
 * when the output cap is below `workNoteTokens` or the input cap is below `workNoteTokens` plus
 * `indexTokens`.
 */
export function modelCapacity(
  id: string,
  limits: Limits,
  model: { contextWindow: number; maxTokens: number },
): ModelResolution {
  const outputTokens = Math.min(limits.workerOutputTokens, model.maxTokens);
  const inputTokens = Math.min(limits.workerInputTokens, model.contextWindow - outputTokens);
  if (
    outputTokens < limits.workNoteTokens ||
    inputTokens < limits.workNoteTokens + limits.indexTokens
  ) {
    return {
      state: "suspended",
      id,
      reason: "Model capacity is smaller than mandatory memory budgets.",
    };
  }
  return { state: "ready", id, inputTokens, outputTokens };
}
