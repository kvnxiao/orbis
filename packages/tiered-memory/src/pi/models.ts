import type { Api, Model } from "@earendil-works/pi-ai";
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
  const model = roleModel(ctx, settings, role);
  const id = override ?? (model === undefined ? "session model" : `${model.provider}/${model.id}`);
  if (model === undefined) {
    return {
      state: "suspended",
      id,
      reason:
        override === undefined ? "No active session model." : "Model identifier is unresolved.",
    };
  }
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

/**
 * Return the model a role dispatches to now: the configured override from `ctx.modelRegistry`, or
 * `ctx.model` when the override is omitted, with the same lookup as `resolveModel` and no
 * substitution.
 *
 * Returns `undefined` when the override is unresolved or no session model is active. Credentials
 * are checked by the request itself.
 */
export function roleModel(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  settings: Settings,
  role: Role,
): Model<Api> | undefined {
  const override = settings[`${role}Model`];
  if (override === undefined) {
    return ctx.model;
  }
  const separator = override.indexOf("/");
  return ctx.modelRegistry.find(override.slice(0, separator), override.slice(separator + 1));
}

/** Resolve both memory roles concurrently through `resolveModel`. */
export async function resolveRoles(
  ctx: ExtensionContext,
  settings: Settings,
): Promise<Record<Role, ModelResolution>> {
  const [observer, consolidator] = await Promise.all([
    resolveModel(ctx, settings, "observer"),
    resolveModel(ctx, settings, "consolidator"),
  ]);
  return { observer, consolidator };
}
