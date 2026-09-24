import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "..");

test("scaffolds scoped TypeScript packages and preserves an existing package", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
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
  assert.ok("peerDependencies" in manifest && "devDependencies" in manifest);
  assert.deepEqual(
    [manifest.peerDependencies, manifest.devDependencies].map((dependencies) =>
      typeof dependencies === "object" && dependencies !== null && "typebox" in dependencies
        ? dependencies.typebox
        : undefined,
    ),
    ["*", "catalog:"],
  );
  const source = await readFile(join(destination, "src", "index.ts"), "utf8");
  assert.match(source, /from "typebox"/);
  assert.match(source, /registerCommand\("orbis-review"/);
  assert.match(source, /@orbis\/review is loaded/);
  assert.match(await readFile(join(destination, "SPEC.md"), "utf8"), /@orbis\/review/);
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

test("preserves a package specification and rejects other existing directory contents", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-spec-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const script = join(fixture, "scripts", "new-extension.mts");
  const destination = join(fixture, "packages", "plan");
  await mkdir(destination, { recursive: true });
  const specification = "# Planning specification\n\nPreserve @orbis/example literally.\n";
  await writeFile(join(destination, "SPEC.md"), specification);
  const result = spawnSync(process.execPath, [script, "plan"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(destination, "SPEC.md"), "utf8"), specification);
  assert.match(await readFile(join(destination, "src", "index.ts"), "utf8"), /@orbis\/plan/);

  await Promise.all(
    ["empty", "extra", "directory"].map(async (name) => {
      const existing = join(fixture, "packages", name);
      await mkdir(existing);
      if (name === "extra") {
        await writeFile(join(existing, "SPEC.md"), specification);
        await writeFile(join(existing, "notes.md"), "Keep these notes.\n");
      }
      if (name === "directory") {
        await mkdir(join(existing, "SPEC.md"));
      }
      const before = await readdir(existing);
      const rejected = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /already exists/);
      assert.deepEqual(await readdir(existing), before);
    }),
  );

  const linkedTarget = join(fixture, "linked-target");
  await mkdir(linkedTarget);
  await writeFile(join(linkedTarget, "SPEC.md"), specification);
  await symlink(linkedTarget, join(fixture, "packages", "linked"), "junction");
  const linked = spawnSync(process.execPath, [script, "linked"], { encoding: "utf8" });
  assert.equal(linked.status, 1);
  assert.deepEqual(await readdir(linkedTarget), ["SPEC.md"]);
});

test("preserves package research and rejects conflicting or linked research directories", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-research-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const script = join(fixture, "scripts", "new-extension.mts");
  const destination = join(fixture, "packages", "researched");
  const research = join(destination, "docs", "research");
  await mkdir(join(research, "comparisons"), { recursive: true });
  const specification = Buffer.from("# Specification\r\nPreserve @orbis/example.\r\n");
  const synthesis = Buffer.from("# Research\r\nPreserve orbis-example and packages/example.\r\n");
  await writeFile(join(destination, "SPEC.md"), specification);
  await writeFile(join(research, "summary.md"), synthesis);
  await writeFile(join(research, "comparisons", "pi.md"), synthesis);

  const result = spawnSync(process.execPath, [script, "researched"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(join(destination, "SPEC.md")), specification);
  assert.deepEqual(await readFile(join(research, "summary.md")), synthesis);
  assert.deepEqual(await readFile(join(research, "comparisons", "pi.md")), synthesis);
  assert.match(await readFile(join(destination, "src", "index.ts"), "utf8"), /@orbis\/researched/);

  await Promise.all(
    [
      "research-only",
      "docs-file",
      "research-file",
      "extra-docs",
      "linked-docs",
      "linked-research",
    ].map(async (name) => {
      const existing = join(fixture, "packages", name);
      await mkdir(existing);
      if (name !== "research-only") {
        await writeFile(join(existing, "SPEC.md"), specification);
      }
      const docs = join(existing, "docs");
      if (name === "docs-file") {
        await writeFile(docs, synthesis);
      } else if (name === "linked-docs") {
        await symlink(join(destination, "docs"), docs, "junction");
      } else {
        await mkdir(docs);
        if (name === "research-file") {
          await writeFile(join(docs, "research"), synthesis);
        } else if (name === "linked-research") {
          await symlink(research, join(docs, "research"), "junction");
        } else {
          await mkdir(join(docs, "research"));
          if (name === "extra-docs") {
            await writeFile(join(docs, "notes.md"), synthesis);
          }
        }
      }
      const before = await readdir(existing);
      const rejected = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(rejected.status, 1, name);
      assert.match(rejected.stderr, /already exists/);
      assert.deepEqual(await readdir(existing), before);
    }),
  );
  assert.deepEqual(await readFile(join(research, "summary.md")), synthesis);
});

test("preserves implementation plans with or without research and rejects invalid plan directories", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-implementation-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const script = join(fixture, "scripts", "new-extension.mts");
  const specification = Buffer.from("# Specification\r\nPreserve @orbis/example.\r\n");
  const plan = Buffer.from("# Implement orbis-example\r\nPreserve packages/example.\r\n");

  await Promise.all(
    ["planned", "researched"].map(async (name) => {
      const destination = join(fixture, "packages", name);
      const implementation = join(destination, "implementation");
      await mkdir(implementation, { recursive: true });
      await writeFile(join(destination, "SPEC.md"), specification);
      await writeFile(join(implementation, "PLAN.md"), plan);
      await writeFile(join(implementation, "01-terminal.md"), plan);
      if (name === "researched") {
        await mkdir(join(destination, "docs", "research"), { recursive: true });
        await writeFile(join(destination, "docs", "research", "pi.md"), specification);
      }

      const result = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(await readFile(join(destination, "SPEC.md")), specification);
      assert.deepEqual(await readFile(join(implementation, "PLAN.md")), plan);
      assert.deepEqual(await readFile(join(implementation, "01-terminal.md")), plan);
      assert.deepEqual(await readdir(implementation), ["01-terminal.md", "PLAN.md"]);
      if (name === "researched") {
        assert.deepEqual(
          await readFile(join(destination, "docs", "research", "pi.md")),
          specification,
        );
      }
      assert.match(await readFile(join(destination, "src", "index.ts"), "utf8"), /registerCommand/);
    }),
  );

  const linkedTarget = join(fixture, "linked-plans");
  await mkdir(linkedTarget);
  await writeFile(join(linkedTarget, "PLAN.md"), plan);
  await Promise.all(
    ["plans-only", "plans-file", "linked-plans", "extra-directory"].map(async (name) => {
      const destination = join(fixture, "packages", name);
      await mkdir(destination);
      if (name !== "plans-only") {
        await writeFile(join(destination, "SPEC.md"), specification);
      }
      const implementation = join(destination, "implementation");
      if (name === "plans-file") {
        await writeFile(implementation, plan);
      } else if (name === "linked-plans") {
        await symlink(linkedTarget, implementation, "junction");
      } else {
        await mkdir(implementation);
        if (name === "extra-directory") {
          await mkdir(join(destination, "notes"));
        }
      }
      const before = await readdir(destination);
      const rejected = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(rejected.status, 1, name);
      assert.match(rejected.stderr, /already exists/);
      assert.deepEqual(await readdir(destination), before);
    }),
  );
  assert.deepEqual(await readFile(join(linkedTarget, "PLAN.md")), plan);
  assert.deepEqual(await readdir(linkedTarget), ["PLAN.md"]);
});

test("preserves TUI interaction documents and rejects directories or links in their place", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-tui-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));
  const script = join(fixture, "scripts", "new-extension.mts");
  const content = Buffer.from("# Interaction\r\nPreserve @orbis/example and é.\r\n");

  await Promise.all(
    ["interactive", "researched-interactive"].map(async (name) => {
      const destination = join(fixture, "packages", name);
      const docs = join(destination, "docs");
      await mkdir(docs, { recursive: true });
      await writeFile(join(destination, "SPEC.md"), content);
      await writeFile(join(docs, "tui-interactions.md"), content);
      if (name === "researched-interactive") {
        await mkdir(join(docs, "research"));
        await writeFile(join(docs, "research", "pi.md"), content);
        await mkdir(join(destination, "implementation"));
        await writeFile(join(destination, "implementation", "PLAN.md"), content);
      }
      const result = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(await readFile(join(destination, "SPEC.md")), content);
      assert.deepEqual(await readFile(join(docs, "tui-interactions.md")), content);
      const manifest: unknown = JSON.parse(
        await readFile(join(destination, "package.json"), "utf8"),
      );
      assert.ok(typeof manifest === "object" && manifest !== null && "files" in manifest);
      assert.ok(Array.isArray(manifest.files) && manifest.files.includes("docs"));
      assert.match(await readFile(join(destination, "src", "index.ts"), "utf8"), /registerCommand/);
    }),
  );

  const target = join(fixture, "linked-interactions-target");
  await mkdir(target);
  await writeFile(join(target, "untouched.md"), content);
  await Promise.all(
    ["document-directory", "linked-document"].map(async (name) => {
      const destination = join(fixture, "packages", name);
      const docs = join(destination, "docs");
      await mkdir(docs, { recursive: true });
      await writeFile(join(destination, "SPEC.md"), content);
      const document = join(docs, "tui-interactions.md");
      if (name === "linked-document") {
        await symlink(target, document, "junction");
      } else {
        await mkdir(document);
      }
      const result = spawnSync(process.execPath, [script, name], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /already exists/);
      assert.deepEqual((await readdir(destination)).toSorted(), ["SPEC.md", "docs"]);
      assert.deepEqual(await readFile(join(destination, "SPEC.md")), content);
    }),
  );
  assert.deepEqual(await readFile(join(target, "untouched.md")), content);
});
