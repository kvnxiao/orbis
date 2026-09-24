import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { InvalidReason } from "../domain/evidence.ts";
import { memoryRoles } from "../domain/models.ts";
import type { ModelResolution, Role } from "../domain/models.ts";
import { limitKeys } from "../domain/settings.ts";
import type { EffectiveSettings, Limits, SettingSource } from "../domain/settings.ts";
import type { Registration, SelectedRevision } from "./lineage.ts";
import type { MemoryRuntime, RuntimeSnapshot, StorageSnapshot } from "./runtime.ts";

/**
 * Describe tiered-memory status as data.
 *
 * `activationSource` is `session` while a session override applies and `unavailable` while no
 * configuration is current and no override applies. `configuration` is undefined while no
 * configuration is current, which suspends automatic work. Within it, `ignoredProject` is true when
 * the untrusted project file was not read, a role's `configuredId` is undefined when the role uses
 * the active session model, and its `resolution` is undefined until a role check completes.
 * `actingModel` is `none` without an active model, `insufficient` when the work-note reserve
 * exceeds the context window or the estimated remaining context, and `available` otherwise, where
 * `remainingTokens` is undefined while Pi has no context-usage estimate. `limits` is in `limitKeys`
 * order. `storage` is `unavailable` until the store opens, carrying the error that stopped opening;
 * `open` carries the canonical project root, the selected revision, the latest durable revision,
 * the counts cached by the latest registration with the event that produced them, and the error of
 * the latest failed refresh. `unavailable` lists the capabilities this version does not provide.
 */
export interface StatusReport {
  enabled: boolean;
  activationSource: SettingSource | "session" | "unavailable";
  configurationRevision: number;
  error: string | undefined;
  configuration:
    | {
        personalPath: string;
        projectPath: string;
        ignoredProject: boolean;
        roles: Record<
          Role,
          {
            configuredId: string | undefined;
            source: SettingSource;
            resolution: ModelResolution | undefined;
          }
        >;
        actingModel:
          | { state: "none" }
          | { state: "insufficient" }
          | {
              state: "available";
              id: string;
              reserveTokens: number;
              remainingTokens: number | undefined;
            };
        limits: readonly { key: keyof Limits; value: number; source: SettingSource }[];
      }
    | undefined;
  storage:
    | { state: "unavailable"; error: string | undefined }
    | {
        state: "open";
        projectRoot: string;
        selected: SelectedRevision;
        latestRevision: string | null;
        registration: Registration | undefined;
        error: string | undefined;
      };
  unavailable: readonly ("workers" | "pool" | "compaction")[];
}

type ConfigurationStatus = NonNullable<StatusReport["configuration"]>;

const activationLabels = {
  default: "default",
  personal: "personal",
  project: "project",
  session: "session override",
  unavailable: "configuration unavailable",
} satisfies Record<StatusReport["activationSource"], string>;

const unavailableNotes = {
  workers: "Observer and consolidator jobs: unavailable in this version.",
  pool: "Active pool, pending worker jobs, and recall: unavailable in this version.",
  compaction:
    "Custom compaction and usage reports: unavailable in this version; Pi native compaction remains available.",
} satisfies Record<StatusReport["unavailable"][number], string>;

const invalidReasons = {
  "note-evidence": "Selected revision evidence changed in effective context.",
  curation: "Selected revision contains an externally curated note.",
  "assigned-evidence": "Selected revision assigned evidence changed in effective context.",
} satisfies Record<InvalidReason, string>;

/**
 * Collect status from the runtime snapshot and the acting model's context usage; writes nothing and
 * starts no model call.
 */
export function buildStatus(runtime: MemoryRuntime, ctx: ExtensionContext): StatusReport {
  const { configuration, override, error, configurationRevision, roles, storage } =
    runtime.snapshot;
  return {
    enabled: runtime.enabled,
    activationSource:
      override === undefined ? (configuration?.sources.enabled ?? "unavailable") : "session",
    configurationRevision,
    error,
    configuration:
      configuration === undefined ? undefined : configurationStatus(configuration, roles, ctx),
    storage: storageStatus(storage),
    unavailable: ["workers", "pool", "compaction"],
  };
}

function storageStatus(storage: StorageSnapshot): StatusReport["storage"] {
  if (storage.state !== "open") {
    return { state: "unavailable", error: storage.state === "failed" ? storage.error : undefined };
  }
  return {
    state: "open",
    projectRoot: storage.projectRoot,
    selected: storage.lineage.selected,
    latestRevision: storage.latestRevision,
    registration: storage.registration,
    error: storage.error,
  };
}

function configurationStatus(
  configuration: EffectiveSettings,
  roles: RuntimeSnapshot["roles"],
  ctx: ExtensionContext,
): ConfigurationStatus {
  const { settings, sources } = configuration;
  const role = (name: Role): ConfigurationStatus["roles"][Role] => ({
    configuredId: settings[`${name}Model`],
    source: sources[`${name}Model`],
    resolution: roles?.[name],
  });
  return {
    personalPath: configuration.personalPath,
    projectPath: configuration.projectPath,
    ignoredProject: !configuration.projectTrusted,
    roles: { observer: role("observer"), consolidator: role("consolidator") },
    actingModel: actingModel(ctx, settings.limits.workNoteTokens),
    limits: limitKeys.map((key) => ({
      key,
      value: settings.limits[key],
      source: sources.limits[key],
    })),
  };
}

function actingModel(
  ctx: ExtensionContext,
  reserveTokens: number,
): ConfigurationStatus["actingModel"] {
  const acting = ctx.model;
  if (acting === undefined) {
    return { state: "none" };
  }
  const used = ctx.getContextUsage()?.tokens ?? undefined;
  const remainingTokens = used === undefined ? undefined : acting.contextWindow - used;
  if (
    reserveTokens > acting.contextWindow ||
    (remainingTokens !== undefined && reserveTokens > remainingTokens)
  ) {
    return { state: "insufficient" };
  }
  return {
    state: "available",
    id: `${acting.provider}/${acting.id}`,
    reserveTokens,
    remainingTokens,
  };
}

/**
 * Render status as the line-oriented text that `docs/usage.md` documents; the wording is a
 * user-facing contract.
 */
export function renderStatus(report: StatusReport): string {
  const lines = [
    `Tiered memory: ${report.enabled ? "enabled" : "disabled"} (${activationLabels[report.activationSource]})`,
    `Configuration revision: ${String(report.configurationRevision)}`,
  ];
  if (report.error !== undefined) {
    lines.push(`Configuration error: ${report.error}`);
  }
  lines.push(...storageLines(report.storage));
  if (report.configuration === undefined) {
    lines.push("Automatic work: suspended; native Pi remains available.");
  } else {
    lines.push(...configurationLines(report.configuration));
  }
  lines.push(...report.unavailable.map((capability) => unavailableNotes[capability]));
  return lines.join("\n");
}

function selectedLines(selected: SelectedRevision): string[] {
  if (selected.state === "none") {
    return ["Selected memory revision: none"];
  }
  if (selected.state === "unavailable") {
    return [`Selected memory revision: unavailable (${selected.reason})`];
  }
  const validity =
    selected.invalidReason === undefined
      ? "current"
      : `invalid: ${invalidReasons[selected.invalidReason]}`;
  const notes =
    selected.invalidNotes.length === 0
      ? ""
      : ` Invalid notes: ${selected.invalidNotes.join(", ")}.`;
  return [
    `Selected memory revision: ${selected.revisionId}`,
    `Selected memory validity: ${validity}${notes}`,
  ];
}

function storageLines(storage: StatusReport["storage"]): string[] {
  const error = storage.error === undefined ? [] : [`Storage error: ${storage.error}`];
  if (storage.state === "unavailable") {
    return ["Memory storage: unavailable", ...error];
  }
  const registration = storage.registration;
  const counts =
    registration === undefined
      ? ["Registered original sources: not registered", "Curated session notes: not inspected"]
      : [
          `Registered original sources: ${String(registration.sources)} (${registration.event})`,
          `Curated session notes: ${String(registration.curatedNotes)} (${registration.event})`,
        ];
  return [
    `Memory project root: ${storage.projectRoot}`,
    ...selectedLines(storage.selected),
    `Latest durable revision: ${storage.latestRevision ?? "none"}`,
    ...counts,
    ...error,
  ];
}

function configurationLines(configuration: ConfigurationStatus): string[] {
  const roleLines = memoryRoles.map((name) => {
    const { configuredId, source, resolution } = configuration.roles[name];
    return `${name} model: ${configuredId ?? "active session model"} (${source}); ${resolutionText(resolution)}`;
  });
  return [
    `Personal settings: ${configuration.personalPath}`,
    `Project settings: ${configuration.projectPath}${configuration.ignoredProject ? " (ignored: project is untrusted)" : ""}`,
    ...roleLines,
    actingModelText(configuration.actingModel),
    ...configuration.limits.map(
      ({ key, value, source }) => `limits.${key}: ${String(value)} (${source})`,
    ),
  ];
}

function resolutionText(resolution: ModelResolution | undefined): string {
  if (resolution === undefined) {
    return "not resolved";
  }
  if (resolution.state === "ready") {
    return `${resolution.id}; input cap ${String(resolution.inputTokens)} estimated tokens, output cap ${String(resolution.outputTokens)} tokens`;
  }
  return `${resolution.id}; suspended: ${resolution.reason}`;
}

function actingModelText(acting: ConfigurationStatus["actingModel"]): string {
  if (acting.state === "none") {
    return "Acting model: suspended; no active model is selected.";
  }
  if (acting.state === "insufficient") {
    return "Acting model: mandatory work note does not fit remaining context; memory work is suspended. Free context or select a larger model.";
  }
  const reserve = `Acting model: ${acting.id}; mandatory work-note reserve ${String(acting.reserveTokens)} estimated tokens;`;
  return acting.remainingTokens === undefined
    ? `${reserve} remaining context unknown.`
    : `${reserve} preliminary remaining capacity ${String(acting.remainingTokens)} estimated tokens. Request fit is unverified.`;
}
