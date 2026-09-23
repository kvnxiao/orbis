import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { MemoryRuntime } from "./runtime.ts";
import { isLimitKey } from "./settings.ts";

export function status(runtime: MemoryRuntime, ctx: ExtensionContext): string {
  const { configuration, override, error, roles, revision } = runtime.snapshot;
  const activationSource =
    override === undefined
      ? (configuration?.sources.enabled ?? "configuration unavailable")
      : "session override";
  const lines = [
    `Tiered memory: ${runtime.enabled ? "enabled" : "disabled"} (${activationSource})`,
    `Configuration revision: ${String(revision)}`,
  ];
  if (error !== undefined) {
    lines.push(`Configuration error: ${error}`);
  }
  if (configuration === undefined) {
    lines.push("Automatic work: suspended; native Pi remains available.");
  } else {
    lines.push(`Personal settings: ${configuration.personalPath}`);
    lines.push(
      `Project settings: ${configuration.projectPath}${configuration.ignoredProject ? " (ignored: project is untrusted)" : ""}`,
    );
    for (const role of ["observer", "consolidator"] as const) {
      const configured = configuration.settings[`${role}Model`] ?? "active session model";
      const source = configuration.sources[`${role}Model`];
      const resolution = roles?.[role];
      let detail = "not resolved";
      if (resolution?.state === "ready") {
        detail = `${resolution.id}; input cap ${String(resolution.inputTokens)} estimated tokens, output cap ${String(resolution.outputTokens)} tokens`;
      } else if (resolution?.state === "suspended") {
        detail = `${resolution.id}; suspended: ${resolution.reason}`;
      }
      lines.push(`${role} model: ${configured} (${source}); ${detail}`);
    }
    const acting = ctx.model;
    const used = ctx.getContextUsage()?.tokens;
    if (acting === undefined) {
      lines.push("Acting model: suspended; no active model is selected.");
    } else if (
      configuration.settings.limits.workNoteTokens > acting.contextWindow ||
      (used !== null &&
        used !== undefined &&
        configuration.settings.limits.workNoteTokens > acting.contextWindow - used)
    ) {
      lines.push(
        "Acting model: mandatory work note does not fit remaining context; memory work is suspended. Free context or select a larger model.",
      );
    } else if (used === null || used === undefined) {
      lines.push(
        `Acting model: ${acting.provider}/${acting.id}; mandatory work-note reserve ${String(configuration.settings.limits.workNoteTokens)} estimated tokens; remaining context unknown.`,
      );
    } else {
      lines.push(
        `Acting model: ${acting.provider}/${acting.id}; mandatory work-note reserve ${String(configuration.settings.limits.workNoteTokens)} estimated tokens; preliminary remaining capacity ${String(acting.contextWindow - used)} estimated tokens. Request fit is unverified.`,
      );
    }
    for (const key of Object.keys(configuration.settings.limits).filter(isLimitKey)) {
      lines.push(
        `limits.${key}: ${String(configuration.settings.limits[key])} (${configuration.sources.limits[key]})`,
      );
    }
  }
  lines.push("Observer and consolidator jobs: unavailable in this version.");
  lines.push(
    "Memory paths, revisions, source coverage, active pool, pending work, and recall: unavailable in this version.",
  );
  lines.push(
    "Custom compaction and usage reports: unavailable in this version; Pi native compaction remains available.",
  );
  return lines.join("\n");
}
