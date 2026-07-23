import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "..");

test("scaffolds scoped TypeScript packages and preserves an existing package", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-scaffold-"));
  t.onTestFinished(() => rm(fixture, { recursive: true, force: true }));
  await cp(join(root, "scripts"), join(fixture, "scripts"), {
    recursive: true,
  });
  await cp(join(root, "templates"), join(fixture, "templates"), {
    recursive: true,
  });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const script = join(fixture, "scripts", "new-extension.mts");
  const result = spawnSync(process.execPath, [script, "review"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const destination = join(fixture, "packages", "review");
  const manifest: unknown = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  assert.ok(
    typeof manifest === "object" && manifest !== null && "name" in manifest && "pi" in manifest,
  );
  assert.equal(manifest.name, "@orbis/review");
  assert.deepEqual(manifest.pi, { extensions: ["./src/index.ts"] });
  const source = await readFile(join(destination, "src", "index.ts"), "utf8");
  assert.match(source, /registerCommand\("orbis-review"/);
  assert.match(source, /@orbis\/review is loaded/);
  assert.equal(
    await readFile(join(destination, "LICENSE"), "utf8"),
    await readFile(join(root, "LICENSE"), "utf8"),
  );

  const loader = new DefaultResourceLoader({
    cwd: fixture,
    agentDir: join(fixture, "agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [destination],
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
  assert.equal(loaded.extensions[0]?.commands.has("orbis-review"), true);

  const duplicate = spawnSync(process.execPath, [script, "review"], {
    encoding: "utf8",
  });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.equal(await readFile(join(destination, "src", "index.ts"), "utf8"), source);

  for (const args of [
    [],
    ["../escape"],
    ["@orbis/review"],
    ["Review"],
    ["a/b"],
    ["a\\b"],
    ["a--b"],
    ["a".repeat(208)],
    ["con"],
    ["nul"],
    ["com1"],
    ["review", "extra"],
  ]) {
    const invalid = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1, JSON.stringify(args));
    assert.match(invalid.stderr, /Usage:/);
  }
  assert.deepEqual(await readdir(join(fixture, "packages")), ["review"]);
});
