import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type * as Layer from "effect/Layer";

import { presentationMessageType } from "../presentation/entries.ts";
import type { StorageServices } from "../storage/services.ts";
import { CompactionGuard } from "./compaction-guard.ts";
import { appendReport } from "./configuration.ts";
import { PresentationCoordinator } from "./context.ts";
import type { InspectionPoint } from "./freshness-monitor.ts";
import { MemoryWork } from "./memory-work.ts";
import { presentationMessageRenderer } from "./presentation-log.ts";
import { MemoryRuntime } from "./runtime.ts";
import { buildStatus, renderStatus } from "./status.ts";
import { guardManagedWrite } from "./write-guard.ts";

/** Carry the owners one registered extension instance creates. */
export interface TieredMemory {
  runtime: MemoryRuntime;
  work: MemoryWork;
  presentation: PresentationCoordinator;
  compaction: CompactionGuard;
}

/**
 * Register tiered-memory session handlers and the `/tiered-memory` command over `services`, and
 * return the instance's owners.
 *
 * Observer scheduling follows storage opening on `session_start` and `session_tree`, each
 * `turn_end`, which Pi emits once the turn's assistant message and tool results are on the branch,
 * and `/tiered-memory on`. `/tiered-memory off` discards waiting jobs before the runtime cancels
 * the running one. Presentation reconstructs after storage opens, confirms appends on `turn_start`
 * and `agent_settled`, transforms each acting request in `context`, and measures it in
 * `context_with_system`. `services` must build synchronously.
 *
 * The managed note file is inspected at `input`, which Pi awaits before its pre-prompt compaction
 * check while idle, at `before_agent_start`, which precedes the first routed request, and at
 * `turn_end`, whose send Pi flushes right after the handlers and before between-turn, post-run, and
 * overflow compaction; at `turn_start` only when no inspection began since the last idle point; and
 * before each compaction. Each of these hooks sends the corrections the inspection made due, so a
 * correction precedes compaction preparation whenever the change was detected by the last turn's
 * end. `session_before_compact` cancels a compaction that would summarize a stale note without a
 * durable correction, and `session_compact_failed` publishes that correction.
 */
export function registerTieredMemory(
  pi: ExtensionAPI,
  services: Layer.Layer<StorageServices>,
): TieredMemory {
  const runtime = new MemoryRuntime(pi, services);
  const work = new MemoryWork(runtime);
  const presentation = new PresentationCoordinator(pi, {
    enabled: () => runtime.enabled,
    memory: () => runtime.openStorage,
    budget: () => {
      const configuration = runtime.snapshot.configuration;
      return configuration === undefined
        ? undefined
        : {
            tokens: configuration.settings.limits.presentationTokens,
            source: configuration.sources.limits.presentationTokens,
          };
    },
  });
  const compaction = new CompactionGuard(pi, {
    freshness: runtime.freshness,
    presentation,
    memory: () => runtime.openStorage,
  });
  const owners: TieredMemory = { runtime, work, presentation, compaction };
  runtime.freshness.whenSettled((ctx) => {
    work.schedule(ctx);
  });
  pi.registerMessageRenderer(presentationMessageType, presentationMessageRenderer);
  pi.on("session_start", async (_event, ctx) => {
    runtime.freshness.markIdle();
    compaction.reset();
    await runtime.start(ctx);
    await presentation.restore(ctx);
    work.schedule(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    runtime.freshness.markIdle();
    compaction.reset();
    await runtime.selectBranch(ctx);
    await presentation.restore(ctx);
    work.schedule(ctx);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    runtime.freshness.markIdle();
    await presentation.settle(ctx);
  });
  pi.on("context", (event, ctx) => presentation.transform(event, ctx));
  pi.on("context_with_system", (event, ctx) => presentation.account(event, ctx));
  registerFreshnessHooks(pi, owners);
  pi.on("session_shutdown", async () => {
    await runtime.shutdown();
  });
  pi.on("model_select", async (_event, ctx) => {
    await runtime.refreshRoles(ctx);
  });
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      return await guardManagedWrite(ctx.cwd, event.input.path);
    }
    return undefined;
  });
  registerCommand(pi, owners);
  return owners;
}

function registerFreshnessHooks(pi: ExtensionAPI, owners: TieredMemory): void {
  const { runtime, work, presentation, compaction } = owners;
  const inspect = async (ctx: ExtensionContext, point: InspectionPoint): Promise<void> => {
    await runtime.freshness.inspect(ctx, point);
    presentation.sendCorrections(ctx);
  };
  pi.on("input", async (_event, ctx) => {
    await inspect(ctx, "input");
    return { action: "continue" };
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    await inspect(ctx, "before_agent_start");
  });
  pi.on("turn_start", async (_event, ctx) => {
    await inspect(ctx, "turn_start");
    await presentation.confirm(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    await inspect(ctx, "turn_end");
    work.schedule(ctx);
  });
  pi.on("session_before_compact", async (event, ctx) => await compaction.beforeCompact(event, ctx));
  pi.on("session_compact_failed", (event, ctx) => {
    compaction.failed(event, ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    compaction.compacted(ctx);
  });
}

function registerCommand(pi: ExtensionAPI, owners: TieredMemory): void {
  const { runtime, work, presentation, compaction } = owners;
  pi.registerCommand("tiered-memory", {
    description: "Show or change tiered memory activation for this session",
    async handler(args, ctx) {
      const action = args.trim();
      if (action === "on") {
        await runtime.enable(ctx);
        work.schedule(ctx);
      } else if (action === "off") {
        work.discard();
        runtime.disable();
      } else if (action !== "" && action !== "status") {
        ctx.ui.notify("Usage: /tiered-memory [on|off|status]", "warning");
        return;
      }
      const report = renderStatus(
        buildStatus(runtime, ctx, work.status, {
          presentation: presentation.status(ctx),
          compaction: compaction.status,
        }),
      );
      appendReport(pi, report);
      ctx.ui.notify(report, "info");
    },
  });
}
