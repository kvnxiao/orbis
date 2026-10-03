import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerTieredMemory } from "./pi/extension.ts";
import { liveStorage } from "./storage/services.ts";

/** Register tiered-memory session handlers and the `/tiered-memory` command. */
export default function extension(pi: ExtensionAPI): void {
  registerTieredMemory(pi, liveStorage);
}
