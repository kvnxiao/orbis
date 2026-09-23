import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { modelCapacity } from "../domain/models.ts";
import type { ModelResolution, Role } from "../domain/models.ts";
import type { Settings } from "../domain/settings.ts";

/**
 * Resolve a role's model and check its credentials and capacity.
 *
 * A configured override resolves through `ctx.modelRegistry`; an omitted override uses `ctx.model`
 * with its own capacity limits. Another provider or model is never substituted. A credential lookup
 * that throws and one that reports failure produce the same suspended result, and the lookup's
 * error text is discarded.
 */
export async function resolveModel(
  ctx: ExtensionContext,
  settings: Settings,
  role: Role,
): Promise<ModelResolution> {
  const override = settings[`${role}Model`];
  const separator = override?.indexOf("/") ?? -1;
  const model =
    override === undefined
      ? ctx.model
      : ctx.modelRegistry.find(override.slice(0, separator), override.slice(separator + 1));
  const id = override ?? (model === undefined ? "session model" : `${model.provider}/${model.id}`);
  if (model === undefined) {
    return {
      state: "suspended",
      id,
      reason:
        override === undefined ? "No active session model." : "Model identifier is unresolved.",
    };
  }
  // oxlint-disable-next-line typescript/no-unsafe-argument -- ExtensionContext declares ctx.model as Model<any>.
  const authenticated = await ctx.modelRegistry.getApiKeyAndHeaders(model).then(
    (auth) => auth.ok,
    () => false,
  );
  if (!authenticated) {
    return {
      state: "suspended",
      id,
      reason: "Credentials unavailable. Check this provider’s authentication and retry.",
    };
  }
  return modelCapacity(id, settings.limits, model);
}
