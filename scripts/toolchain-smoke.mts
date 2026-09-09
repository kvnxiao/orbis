import assert from "node:assert/strict";
import { join } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const [extension, command] = process.argv.slice(2);
assert.ok(
  extension !== undefined && command !== undefined,
  "Expected extension path and command name",
);
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: join(process.cwd(), ".pi-smoke"),
  settingsManager: SettingsManager.inMemory(),
  additionalExtensionPaths: [extension],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
assert.equal(loaded.extensions[0]?.commands.has(command), true);
console.log(`Node.js ${process.versions.node}: registered /${command}`);
