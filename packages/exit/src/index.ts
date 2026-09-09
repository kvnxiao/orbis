import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("exit", {
    description: "Quit Pi",
    handler: async (_args, ctx) => {
      ctx.shutdown();
      await Promise.resolve();
    },
  });
}
