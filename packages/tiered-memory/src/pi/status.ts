import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { memoryRoles } from "../domain/models.ts";
import type { ModelResolution, Role } from "../domain/models.ts";
import { limitKeys } from "../domain/settings.ts";
import type { EffectiveSettings, Limits, SettingSource } from "../domain/settings.ts";
import type { MemoryStorage } from "./canonical-memory.ts";
import { guardLines } from "./compaction-guard.ts";
import type { CompactionGuardStatus } from "./compaction-guard.ts";
import type {
  PendingReference,
  Reconciliation,
  Registration,
  SelectedRevision,
  UnresolvedReason,
} from "./lineage.ts";
import { storageClosed } from "./note-validity.ts";
import { unopenedLineage } from "./presentation-log.ts";
import { presentationLines } from "./presentation-status.ts";
import type { PresentationStatus } from "./presentation-status.ts";
import {
  blockingReferences,
  damagedReferencesIn,
  referencesIn,
  selectionEntryId,
} from "./revision-references.ts";
import type { DamagedReference } from "./revision-references.ts";
import type { MemoryRuntime, RuntimeSnapshot } from "./runtime.ts";
import type { StorageSnapshot } from "./storage-session.ts";
import { canonicalStatus, freshnessLines, invalidReasons, workLines } from "./work-status.ts";
import type { FreshnessStatus, ProcessingStatus, WorkNoteStatus } from "./work-status.ts";
import type { WorkerStatus } from "./worker.ts";

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
 * order. `storage` is `unavailable` until the store opens, carrying the error that stopped opening
 * and, when the branch has presentation records of its project, the note's unknown freshness;
 * `open` carries the canonical project root, the selected revision, the latest durable revision,
 * the source count and event of the registration the latest refresh used, the curated-note count of
 * the curation it inspected, and the error of the latest failed refresh. Its `blockingReference` is
 * the first damaged revision reference that blocks commits, or undefined while the lineage is not
 * ambiguous; `reconciliation` reports whether reconciliation completed for the current
 * configuration, and `pending` is the pending reference, including an unresolved orphan head.
 * `unavailableEntryId` is the last branch reference entry to an unavailable selected revision, or
 * undefined when the selection is available, absent, or not referenced on the branch.
 * `damagedReferences` lists every damaged revision reference on the active branch in branch order,
 * in every storage state. While storage is open, `workNote` describes the selected revision's
 * current-work note: `valid` with its source boundary and the number of eligible sources not yet
 * observed, `invalid` with its reason, or `absent`; `freshness` is its validity with the latest
 * completed inspection and any detected curation awaiting recording; `processing` lists the
 * processing gaps of the active branch, with exhausted spans as `failed`, or the reason lineage
 * coverage is unavailable. `worker` is the observer queue's status, or undefined while no queue is
 * open. `presentation` describes memory presentation and request capacity, and `compaction` the
 * latest correction cancellation and correction gap, when the caller supplies them. `unavailable`
 * lists the capabilities this version does not provide.
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
    | { state: "unavailable"; error: string | undefined; freshness: FreshnessStatus | undefined }
    | {
        state: "open";
        projectRoot: string;
        selected: SelectedRevision;
        latestRevision: string | null;
        registration: Registration | undefined;
        error: string | undefined;
        blockingReference: DamagedReference | undefined;
        reconciliation: Reconciliation;
        pending: PendingReference;
        unavailableEntryId: string | undefined;
        workNote: WorkNoteStatus;
        freshness: FreshnessStatus;
        processing: ProcessingStatus;
      };
  damagedReferences: readonly DamagedReference[];
  worker: WorkerStatus | undefined;
  presentation?: PresentationStatus;
  compaction?: CompactionGuardStatus;
  unavailable: readonly ("consolidator" | "pool" | "compaction")[];
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
  consolidator: "Consolidator jobs: unavailable in this version.",
  pool: "Active pool and recall: unavailable in this version.",
  compaction:
    "Custom compaction and its usage reports: unavailable in this version; Pi native compaction remains available.",
} satisfies Record<StatusReport["unavailable"][number], string>;

const unresolvedReasons = {
  lineage: "its lineage from the selected revision cannot be established",
  configuration: "it was committed with other settings or models",
  evidence: "its evidence or curated notes changed after it was committed",
} satisfies Record<UnresolvedReason, string>;

/**
 * Collect status from the runtime snapshot, its cached canonical memory, the active branch, the
 * observer queue's `worker` status, and the acting model's context usage; writes nothing and starts
 * no model call.
 */
export function buildStatus(
  runtime: MemoryRuntime,
  ctx: ExtensionContext,
  worker?: WorkerStatus,
  owners: { presentation?: PresentationStatus; compaction?: CompactionGuardStatus } = {},
): StatusReport {
  const { presentation, compaction } = owners;
  const { configuration, override, error, configurationRevision, roles, storage } =
    runtime.snapshot;
  const branch = ctx.sessionManager.getBranch();
  const memory = runtime.memoryStorage(ctx);
  return {
    enabled: runtime.enabled,
    activationSource:
      override === undefined ? (configuration?.sources.enabled ?? "unavailable") : "session",
    configurationRevision,
    error,
    configuration:
      configuration === undefined ? undefined : configurationStatus(configuration, roles, ctx),
    storage: storageStatus(storage, ctx, memory, worker?.exhausted ?? new Set()),
    damagedReferences: damagedReferencesIn(branch),
    worker,
    ...(presentation === undefined ? {} : { presentation }),
    ...(compaction === undefined ? {} : { compaction }),
    unavailable: ["consolidator", "pool", "compaction"],
  };
}

function storageStatus(
  storage: StorageSnapshot,
  ctx: ExtensionContext,
  memory: MemoryStorage | undefined,
  exhausted: ReadonlySet<string>,
): StatusReport["storage"] {
  const branch = ctx.sessionManager.getBranch();
  if (storage.state !== "open") {
    const presented = unopenedLineage(branch, ctx.sessionManager.getSessionId()) !== undefined;
    return {
      state: "unavailable",
      error: storage.state === "failed" ? storage.error : undefined,
      freshness: presented
        ? { validity: storageClosed, observation: undefined, detection: undefined }
        : undefined,
    };
  }
  const { selected, pending } = storage.lineage;
  const { projectId } = storage;
  // A superseded or failed reconciliation can append the reference without publishing that state.
  const recorded =
    pending.state === "unappended" &&
    referencesIn(branch, projectId).some(
      (reference) => reference.revisionId === pending.revisionId,
    );
  return {
    state: "open",
    projectRoot: storage.projectRoot,
    selected,
    latestRevision: storage.latestRevision,
    registration: storage.registration,
    error: storage.error,
    blockingReference: blockingReferences(branch, projectId, selected)[0],
    reconciliation: storage.reconciliation,
    pending: recorded ? { state: "appended", revisionId: pending.revisionId } : pending,
    unavailableEntryId:
      selected.state === "unavailable" ? selectionEntryId(branch, projectId, selected) : undefined,
    ...canonicalStatus(memory, branch, exhausted),
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
  lines.push(
    ...storageLines(report.storage),
    ...lineageLines(report),
    ...(report.storage.state === "unavailable" && report.storage.freshness !== undefined
      ? freshnessLines(report.storage.freshness)
      : []),
    ...workLines(report.storage.state === "open" ? report.storage : undefined, report.worker),
    ...(report.presentation === undefined ? [] : presentationLines(report.presentation)),
    ...(report.compaction === undefined ? [] : guardLines(report.compaction)),
  );
  if (report.configuration === undefined) {
    lines.push("Automatic work: suspended; native Pi remains available.");
  } else {
    lines.push(...configurationLines(report.configuration));
  }
  lines.push(...report.unavailable.map((capability) => unavailableNotes[capability]));
  return lines.join("\n");
}

function selectedLines(selected: SelectedRevision, ambiguous: boolean): string[] {
  if (selected.state === "none") {
    return ["Selected memory revision: none"];
  }
  if (selected.state === "unavailable") {
    return [`Selected memory revision: unavailable (${selected.reason})`];
  }
  const uncertain = "damaged revision references follow the selected revision";
  const notes =
    selected.invalidNotes.length === 0
      ? ""
      : ` Invalid notes: ${selected.invalidNotes.join(", ")}.`;
  const validity =
    selected.invalidReason === undefined
      ? `${ambiguous ? `uncertain: ${uncertain}` : "current"}${notes}`
      : `invalid: ${invalidReasons[selected.invalidReason]}${notes}${ambiguous ? ` Uncertain: ${uncertain}.` : ""}`;
  return [
    `Selected memory revision: ${selected.revisionId}`,
    `Selected memory validity: ${validity}`,
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
    ...selectedLines(storage.selected, storage.blockingReference !== undefined),
    `Latest durable revision: ${storage.latestRevision ?? "none"}`,
    ...counts,
    ...error,
  ];
}

function lineageLines(report: StatusReport): string[] {
  const damaged = report.damagedReferences;
  const lines =
    damaged.length === 0
      ? []
      : [
          `Damaged revision references on the active branch: ${String(damaged.length)} excluded from lineage selection (${damaged.map(({ entryId, path }) => `entry ${entryId} at ${path}`).join(", ")})`,
        ];
  const storage = report.storage;
  if (storage.state !== "open") {
    return lines;
  }
  if (storage.blockingReference !== undefined) {
    lines.push(
      `Memory commits: blocked by damaged revision reference entry ${storage.blockingReference.entryId}. Navigate with /tree to a point before that entry to remove this lineage block.`,
    );
  }
  const { pending } = storage;
  if (storage.selected.state === "unavailable") {
    const entry = storage.unavailableEntryId;
    lines.push(
      `Memory commits: blocked because the selected revision is unavailable.${entry === undefined ? "" : ` Navigate with /tree to a point before entry ${entry} to continue memory work without it.`}`,
    );
  }
  const readiness = report.enabled ? readinessLine(storage) : undefined;
  if (readiness !== undefined) {
    lines.push(readiness);
  }
  if (pending.state === "unappended") {
    lines.push(
      `Memory commits: blocked until revision ${pending.revisionId} is recorded on this branch. If its commit failed, run /reload to record it.`,
    );
  } else if (pending.state === "appended") {
    lines.push(
      `Memory commits: blocked until the branch reference to revision ${pending.revisionId} is saved in the session file. Pi saves a new session file after its first assistant response.`,
    );
  }
  return lines;
}

function readinessLine(
  storage: Extract<StatusReport["storage"], { state: "open" }>,
): string | undefined {
  const { pending } = storage;
  if (storage.reconciliation === "reconciling") {
    return "Memory commits: blocked while memory reconciles with the current settings and models.";
  }
  if (storage.reconciliation === "failed") {
    return "Memory commits: blocked because the latest memory reconciliation failed. Run /reload to retry.";
  }
  return pending.state === "unresolved"
    ? `Memory commits: blocked by revision ${pending.revisionId}, which is not recorded on this branch: ${unresolvedReasons[pending.reason]}. Navigate with /tree to a point before entry ${pending.anchorId} to continue memory work without it.`
    : undefined;
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
    return "Acting model: mandatory work note does not fit remaining context; a request that presents the note stops before dispatch. Run /compact, or select a model with a larger context window.";
  }
  const reserve = `Acting model: ${acting.id}; mandatory work-note reserve ${String(acting.reserveTokens)} estimated tokens;`;
  return acting.remainingTokens === undefined
    ? `${reserve} remaining context unknown.`
    : `${reserve} preliminary remaining capacity ${String(acting.remainingTokens)} estimated tokens. See Request capacity for the latest request's fit check.`;
}
