import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function extension(pi: ExtensionAPI) {
  pi.registerCommand("orbis-example", {
    description: "Check that the Orbis extension is loaded",
    handler: async (_args, ctx) => {
      ctx.ui.notify("@orbis/example is loaded", "info");
    },
  });
}
