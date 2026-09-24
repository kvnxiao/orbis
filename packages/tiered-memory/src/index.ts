import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MemoryRuntime } from "./pi/runtime.ts";
import { buildStatus, renderStatus } from "./pi/status.ts";

/** Register tiered-memory session handlers and the `/tiered-memory` command. */
export default function extension(pi: ExtensionAPI): void {
  const runtime = new MemoryRuntime(pi);
  pi.on("session_start", async (_event, ctx) => {
    await runtime.start(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    await runtime.selectBranch(ctx);
  });
  pi.on("session_shutdown", () => {
    runtime.stop();
  });
  pi.on("model_select", async (_event, ctx) => {
    await runtime.refreshRoles(ctx);
  });
  pi.registerCommand("tiered-memory", {
    description: "Show or change tiered memory activation for this session",
    async handler(args, ctx) {
      const action = args.trim();
      if (action === "on") {
        await runtime.enable(ctx);
      } else if (action === "off") {
        runtime.disable();
      } else if (action !== "" && action !== "status") {
        ctx.ui.notify("Usage: /tiered-memory [on|off|status]", "warning");
        return;
      }
      const report = renderStatus(buildStatus(runtime, ctx));
      runtime.report(report);
      ctx.ui.notify(report, "info");
    },
  });
}
