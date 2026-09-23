import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

/**
 * Validate a `provider/model` identifier; the first slash ends the provider, and the model part may
 * contain further slashes but no whitespace.
 */
export const modelIdSchema = Type.String({ pattern: "^[^\\s/]+/[^\\s]+$" });

const positiveLimit = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

/**
 * Validate a complete limits object; every limit is a positive safe integer except `retries`, which
 * permits zero.
 */
export const limitsSchema = Type.Object(
  {
    queuedJobs: positiveLimit,
    workerInputTokens: positiveLimit,
    workerOutputTokens: positiveLimit,
    jobTimeoutMs: positiveLimit,
    retries: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    compactionWaitMs: positiveLimit,
    workNoteTokens: positiveLimit,
    consolidationThresholdTokens: positiveLimit,
    activeObservationTokens: positiveLimit,
    indexTokens: positiveLimit,
    checkpointTokens: positiveLimit,
    recallTokens: positiveLimit,
    recallBytes: positiveLimit,
  },
  { additionalProperties: false },
);

/**
 * Validate a user-authored personal or project settings file; an omitted field inherits the lower
 * scope, and `null` is invalid.
 */
export const settingsFileSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    observerModel: Type.Optional(modelIdSchema),
    consolidatorModel: Type.Optional(modelIdSchema),
    limits: Type.Optional(Type.Partial(limitsSchema, { additionalProperties: false })),
  },
  { additionalProperties: false },
);

/**
 * Validate the scope that supplied an effective value; the `default` annotation makes
 * `Value.Create` fill unsupplied sources with `default`.
 */
export const settingSourceSchema = Type.Union(
  [Type.Literal("default"), Type.Literal("personal"), Type.Literal("project")],
  { default: "default" },
);

const settingsSchema = Type.Object(
  { ...settingsFileSchema.properties, enabled: Type.Boolean(), limits: limitsSchema },
  { additionalProperties: false },
);

const settingFieldSchema = Type.KeyOf(Type.Omit(settingsFileSchema, ["limits"]));
const limitKeySchema = Type.KeyOf(limitsSchema);

const sourcesSchema = Type.Object(
  {
    ...Type.Record(settingFieldSchema, settingSourceSchema).properties,
    limits: Type.Record(limitKeySchema, settingSourceSchema, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/**
 * Validate effective settings with the scope of each value and the paths and trust state they were
 * loaded under.
 */
export const effectiveSettingsSchema = Type.Object(
  {
    settings: settingsSchema,
    sources: sourcesSchema,
    personalPath: Type.String(),
    projectPath: Type.String(),
    projectTrusted: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Validate the effective-settings snapshot entry; readers reject every `version` other than 1. */
export const configurationEntrySchema = Type.Object({
  version: Type.Literal(1),
  configuration: effectiveSettingsSchema,
});

/** Validate the session activation override entry; readers reject every `version` other than 1. */
export const activationEntrySchema = Type.Object({
  version: Type.Literal(1),
  enabled: Type.Boolean(),
});

/** Validate the saved status report entry; readers reject every `version` other than 1. */
export const reportEntrySchema = Type.Object({
  version: Type.Literal(1),
  text: Type.String(),
});

/** Bound memory work; token values are estimates or caps, and `*Ms` values are milliseconds. */
export type Limits = Static<typeof limitsSchema>;
/** Hold one scope's overrides; omitted fields and limits inherit the lower scope. */
export type SettingsFile = Static<typeof settingsFileSchema>;
/** Hold resolved settings; an omitted model override means the active session model. */
export type Settings = Static<typeof settingsSchema>;
/** Name `personal` or `project` for a supplied value and `default` for a built-in one. */
export type SettingSource = Static<typeof settingSourceSchema>;
/**
 * Hold effective settings with their sources; the project file was not read when `projectTrusted`
 * is false.
 */
export type EffectiveSettings = Static<typeof effectiveSettingsSchema>;
/**
 * Define the `orbis-tiered-memory-configuration` custom entry payload: an effective-settings
 * snapshot.
 */
export type ConfigurationEntry = Static<typeof configurationEntrySchema>;
/**
 * Define the `orbis-tiered-memory-activation` custom entry payload: the session activation
 * override.
 */
export type ActivationEntry = Static<typeof activationEntrySchema>;
/** Define the `orbis-tiered-memory-report` custom entry payload: rendered status text. */
export type ReportEntry = Static<typeof reportEntrySchema>;
/** Identify the settings files and trust state a snapshot must share with the session to be reused. */
export type SnapshotScope = Pick<
  EffectiveSettings,
  "personalPath" | "projectPath" | "projectTrusted"
>;

/**
 * Supply built-in limits before personal and project overrides; the values satisfy `limitsSchema`
 * and `validateBudgets`.
 */
export const defaultLimits: Readonly<Limits> = {
  queuedJobs: 8,
  workerInputTokens: 8192,
  workerOutputTokens: 2048,
  jobTimeoutMs: 60000,
  retries: 1,
  compactionWaitMs: 5000,
  workNoteTokens: 1024,
  consolidationThresholdTokens: 4096,
  activeObservationTokens: 8192,
  indexTokens: 512,
  checkpointTokens: 4096,
  recallTokens: 2048,
  recallBytes: 16384,
};

/** List limit keys in `limitsSchema` declaration order, which status output follows. */
export const limitKeys = limitKeySchema.anyOf.map((literal) => literal.const);

/** List the non-limit settings fields in `settingsFileSchema` declaration order. */
export const settingFields = settingFieldSchema.anyOf.map((literal) => literal.const);

/**
 * Merge scope overrides over the defaults, recording the scope that supplied each field and limit.
 *
 * Later layers take precedence; `limits` merge per key. Each layer must already satisfy
 * `settingsFileSchema`.
 *
 * @throws Error from `validateBudgets` when the merged limits conflict.
 */
export function mergeSettings(
  layers: readonly { scope: Exclude<SettingSource, "default">; overrides: SettingsFile }[],
): { settings: Settings; sources: EffectiveSettings["sources"] } {
  const settings: Settings = { enabled: true, limits: { ...defaultLimits } };
  const sources = Value.Create(sourcesSchema);
  for (const { scope, overrides } of layers) {
    overlay(settings, sources, settingFields, scope, overrides);
    overlay(settings.limits, sources.limits, limitKeys, scope, overrides.limits ?? {});
  }
  validateBudgets(settings.limits);
  return { settings, sources };
}

function overlay<T, K extends keyof T>(
  target: T,
  sources: Record<K, SettingSource>,
  keys: readonly K[],
  scope: SettingSource,
  supplied: Partial<Pick<T, K>>,
): void {
  for (const key of keys) {
    const value = supplied[key];
    if (value !== undefined) {
      target[key] = value;
      sources[key] = scope;
    }
  }
}

/**
 * Report whether the work note, consolidation threshold, or index exceeds its containing budget.
 *
 * A conflict exists when `workNoteTokens` exceeds `checkpointTokens` or `workerOutputTokens`, when
 * `consolidationThresholdTokens` exceeds `activeObservationTokens`, or when `workNoteTokens` plus
 * `indexTokens` exceeds `workerInputTokens`. `limits` must already satisfy `limitsSchema`.
 */
export function budgetsConflict(limits: Limits): boolean {
  return (
    limits.workNoteTokens > limits.checkpointTokens ||
    limits.workNoteTokens > limits.workerOutputTokens ||
    limits.consolidationThresholdTokens > limits.activeObservationTokens ||
    limits.workNoteTokens + limits.indexTokens > limits.workerInputTokens
  );
}

/**
 * Reject limits whose budgets conflict.
 *
 * `limits` must already satisfy `limitsSchema`.
 *
 * @throws Error when `budgetsConflict` reports a conflict.
 */
export function validateBudgets(limits: Limits): void {
  if (budgetsConflict(limits)) {
    throw new Error(
      "Tiered-memory limits conflict: the work note, threshold, or index exceeds its containing budget.",
    );
  }
}

/**
 * Report whether a snapshot was loaded under the current personal path, project path, and trust
 * state.
 *
 * Paths compare as exact strings without normalization.
 */
export function snapshotMatches(
  configuration: EffectiveSettings,
  expected: SnapshotScope,
): boolean {
  return (
    configuration.personalPath === expected.personalPath &&
    configuration.projectPath === expected.projectPath &&
    configuration.projectTrusted === expected.projectTrusted
  );
}
