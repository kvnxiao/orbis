import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Settings } from "./settings.ts";

export type Role = "observer" | "consolidator";
export type ModelResolution =
  | { state: "ready"; id: string; inputTokens: number; outputTokens: number }
  | { state: "suspended"; id: string; reason: string };

export async function resolveModel(
  ctx: ExtensionContext,
  settings: Settings,
  role: Role,
): Promise<ModelResolution> {
  const override = role === "observer" ? settings.observerModel : settings.consolidatorModel;
  const separator = override?.indexOf("/") ?? -1;
  let model: Model<Api> | undefined;
  if (override === undefined) {
    const active: unknown = ctx.model;
    model = isUsableModel(active) ? active : undefined;
  } else {
    model = ctx.modelRegistry.find(override.slice(0, separator), override.slice(separator + 1));
  }
  const id = override ?? (model === undefined ? "session model" : `${model.provider}/${model.id}`);
  if (model === undefined) {
    return {
      state: "suspended",
      id,
      reason:
        override === undefined ? "No active session model." : "Model identifier is unresolved.",
    };
  }
  let auth: Awaited<ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>>;
  try {
    auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  } catch {
    return {
      state: "suspended",
      id,
      reason: "Credentials unavailable. Check this provider’s authentication and retry.",
    };
  }
  if (!auth.ok) {
    return {
      state: "suspended",
      id,
      reason: "Credentials unavailable. Check this provider’s authentication and retry.",
    };
  }
  const outputTokens = Math.min(settings.limits.workerOutputTokens, model.maxTokens);
  const inputTokens = Math.min(
    settings.limits.workerInputTokens,
    model.contextWindow - outputTokens,
  );
  if (
    outputTokens < settings.limits.workNoteTokens ||
    inputTokens < settings.limits.workNoteTokens + settings.limits.indexTokens
  ) {
    return {
      state: "suspended",
      id,
      reason: "Model capacity is smaller than mandatory memory budgets.",
    };
  }
  return { state: "ready", id, inputTokens, outputTokens };
}

function isUsableModel(value: unknown): value is Model<Api> {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    typeof value.provider === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    "api" in value &&
    typeof value.api === "string" &&
    "contextWindow" in value &&
    typeof value.contextWindow === "number" &&
    "maxTokens" in value &&
    typeof value.maxTokens === "number"
  );
}
