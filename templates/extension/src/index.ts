import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

import { parseRecord, readOptional } from "./records.ts";

const settingsSchema = Type.Object(
  { version: Type.Literal(1), message: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
type Settings = Static<typeof settingsSchema>;

/**
 * Register `/orbis-example`, which displays the `message` from `orbis-example.json` in Pi's agent
 * directory, or a fixed loaded notice when that file is absent.
 */
export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("orbis-example", {
    description: "Check that the Orbis extension is loaded",
    handler: async (_args, ctx) => {
      const path = join(getAgentDir(), "orbis-example.json");
      const text = await readOptional(path);
      const settings: Settings | undefined =
        text === undefined ? undefined : parseRecord(settingsSchema, text, path);
      ctx.ui.notify(settings?.message ?? "@orbis/example is loaded", "info");
    },
  });
}
