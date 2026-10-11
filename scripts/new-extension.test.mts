import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const invalidLayout = /must be a directory, not a link, and may contain only SPEC\.md/;

function missingSpecification(name: string): RegExp {
  return new RegExp(`Missing packages/${name}/SPEC\\.md: write .* before scaffolding`);
}

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
  const destination = join(fixture, "packages", "review");
  await mkdir(destination, { recursive: true });
  const specification = Buffer.from("# Review specification\r\nPreserve @orbis/example.\r\n");
  await writeFile(join(destination, "SPEC.md"), specification);
  const result = spawnSync(process.execPath, [script, "review"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "Created @orbis/review in packages/review\nRun pnpm install, then pi install ./packages/review\n",
  );

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
  assert.deepEqual(await readFile(join(destination, "SPEC.md")), specification);
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
  assert.match(duplicate.stderr, invalidLayout);
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
      assert.match(rejected.stderr, name === "empty" ? missingSpecification(name) : invalidLayout);
      assert.deepEqual(await readdir(existing), before);
    }),
  );

  const linkedTarget = join(fixture, "linked-target");
  await mkdir(linkedTarget);
  await writeFile(join(linkedTarget, "SPEC.md"), specification);
  await symlink(linkedTarget, join(fixture, "packages", "linked"), "junction");
  const linked = spawnSync(process.execPath, [script, "linked"], { encoding: "utf8" });
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, invalidLayout);
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
      assert.match(
        rejected.stderr,
        name === "research-only" ? missingSpecification(name) : invalidLayout,
      );
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
      assert.match(
        rejected.stderr,
        name === "plans-only" ? missingSpecification(name) : invalidLayout,
      );
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
      assert.match(result.stderr, invalidLayout);
      assert.deepEqual((await readdir(destination)).toSorted(), ["SPEC.md", "docs"]);
      assert.deepEqual(await readFile(join(destination, "SPEC.md")), content);
    }),
  );
  assert.deepEqual(await readFile(join(target, "untouched.md")), content);
});

test("refuses to scaffold a package without a specification and leaves the filesystem unchanged", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-missing-spec-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));
  const script = join(fixture, "scripts", "new-extension.mts");
  const packages = join(fixture, "packages");

  const withoutPackages = spawnSync(process.execPath, [script, "absent"], { encoding: "utf8" });
  assert.equal(withoutPackages.status, 1);
  assert.match(withoutPackages.stderr, missingSpecification("absent"));
  assert.equal(withoutPackages.stdout, "");
  await assert.rejects(lstat(packages), { code: "ENOENT" });

  await mkdir(packages);
  const withPackages = spawnSync(process.execPath, [script, "absent"], { encoding: "utf8" });
  assert.equal(withPackages.status, 1);
  assert.match(withPackages.stderr, missingSpecification("absent"));
  assert.deepEqual(await readdir(packages), []);

  const destination = join(packages, "research-only");
  const synthesis = Buffer.from("# Research\r\nPreserve @orbis/example.\r\n");
  await mkdir(join(destination, "docs", "research"), { recursive: true });
  await writeFile(join(destination, "docs", "research", "pi.md"), synthesis);
  const researchOnly = spawnSync(process.execPath, [script, "research-only"], {
    encoding: "utf8",
  });
  assert.equal(researchOnly.status, 1);
  assert.match(researchOnly.stderr, missingSpecification("research-only"));
  assert.deepEqual((await readdir(destination, { recursive: true })).toSorted(), [
    "docs",
    join("docs", "research"),
    join("docs", "research", "pi.md"),
  ]);
  assert.deepEqual(await readFile(join(destination, "docs", "research", "pi.md")), synthesis);
  assert.deepEqual(await readdir(packages), ["research-only"]);
});

test("preserves split specification bytes and nested area files when scaffolding", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-split-spec-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const destination = join(fixture, "packages", "split-contract");
  await mkdir(join(destination, "specs", "terminal"), { recursive: true });
  const specification = Buffer.from(
    "# Split specification\r\n\r\nAreas: [Core](specs/core.md), [Terminal](specs/terminal/input.md).\r\nPreserve @orbis/example.\r\n",
  );
  const core = Buffer.from("# Core area\r\nPreserve orbis-example and é.\r\n");
  const terminal = Buffer.from("# Terminal area\r\nPreserve packages/example.\r\n");
  await writeFile(join(destination, "SPEC.md"), specification);
  await writeFile(join(destination, "specs", "core.md"), core);
  await writeFile(join(destination, "specs", "terminal", "input.md"), terminal);

  const result = spawnSync(
    process.execPath,
    [join(fixture, "scripts", "new-extension.mts"), "split-contract"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(join(destination, "SPEC.md")), specification);
  assert.deepEqual(await readFile(join(destination, "specs", "core.md")), core);
  assert.deepEqual(await readFile(join(destination, "specs", "terminal", "input.md")), terminal);
  assert.deepEqual((await readdir(join(destination, "specs"), { recursive: true })).toSorted(), [
    "core.md",
    "terminal",
    join("terminal", "input.md"),
  ]);
  assert.match(
    await readFile(join(destination, "src", "index.ts"), "utf8"),
    /@orbis\/split-contract/,
  );
});

test("rejects files and links named specs before changing package contents", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-invalid-split-spec-scaffold-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));

  const specification = Buffer.from("# Specification\r\nPreserve @orbis/example.\r\n");
  const area = Buffer.from("# Area\r\nPreserve packages/example.\r\n");
  const target = join(fixture, "linked-areas");
  await mkdir(target);
  await writeFile(join(target, "core.md"), area);

  await Promise.all(
    ["specs-file", "linked-specs", "dangling-specs", "split-with-runtime"].map(async (name) => {
      const destination = join(fixture, "packages", name);
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "SPEC.md"), specification);
      const specs = join(destination, "specs");
      const linkTarget = name === "linked-specs" ? target : join(fixture, "absent");
      if (name === "specs-file") {
        await writeFile(specs, area);
      } else if (name === "split-with-runtime") {
        await mkdir(specs);
        await writeFile(join(specs, "core.md"), area);
        await mkdir(join(destination, "src"));
        await writeFile(join(destination, "src", "index.ts"), "existing runtime\n");
      } else {
        await symlink(linkTarget, specs, "junction");
      }
      const before = (await readdir(destination, { recursive: true })).toSorted();
      const result = spawnSync(
        process.execPath,
        [join(fixture, "scripts", "new-extension.mts"), name],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, invalidLayout);
      assert.equal(result.stdout, "");
      assert.deepEqual((await readdir(destination, { recursive: true })).toSorted(), before);
      assert.deepEqual(await readFile(join(destination, "SPEC.md")), specification);
      if (name === "specs-file") {
        assert.deepEqual(await readFile(specs), area);
      } else if (name === "split-with-runtime") {
        assert.deepEqual(await readFile(join(specs, "core.md")), area);
        assert.equal(
          await readFile(join(destination, "src", "index.ts"), "utf8"),
          "existing runtime\n",
        );
      } else {
        assert.equal((await lstat(specs)).isSymbolicLink(), true);
        assert.equal(await readlink(specs), linkTarget);
      }
    }),
  );
  assert.deepEqual(await readdir(target), ["core.md"]);
  assert.deepEqual(await readFile(join(target, "core.md")), area);
});

test("packs the root specification and every declared nested area file", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "orbis-packed-split-spec-"));
  t.onTestFinished(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
  await cp(join(root, "templates"), join(fixture, "templates"), { recursive: true });
  await cp(join(root, "LICENSE"), join(fixture, "LICENSE"));
  await cp(join(root, "package.json"), join(fixture, "package.json"));
  await cp(join(root, "pnpm-workspace.yaml"), join(fixture, "pnpm-workspace.yaml"));

  const destination = join(fixture, "packages", "packed-contract");
  await mkdir(join(destination, "specs", "terminal"), { recursive: true });
  const documents = [
    [
      "SPEC.md",
      Buffer.from(
        "# Specification\r\n\r\nAreas: [Core](specs/core.md), [Terminal](specs/terminal/input.md).\r\n",
      ),
    ],
    ["specs/core.md", Buffer.from("# Core area\r\nPreserve @orbis/example and é.\r\n")],
    ["specs/terminal/input.md", Buffer.from("# Terminal area\r\nPreserve packages/example.\r\n")],
  ] as const;
  await Promise.all(
    documents.map(async ([path, content]) => {
      await writeFile(join(destination, path), content);
    }),
  );
  const scaffolded = spawnSync(
    process.execPath,
    [join(fixture, "scripts", "new-extension.mts"), "packed-contract"],
    { encoding: "utf8" },
  );
  assert.equal(scaffolded.status, 0, scaffolded.stderr);

  const packed = join(fixture, "packed");
  await mkdir(packed);
  const result = spawnSync("pnpm", ["pack", "--pack-destination", packed], {
    cwd: destination,
    encoding: "utf8",
    env: { ...process.env, npm_config_offline: "true" },
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  const tarballs = (await readdir(packed)).filter((path) => path.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  const tarball = tarballs[0];
  assert.ok(tarball !== undefined);
  const archive = join(packed, tarball);
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const paths = listing.stdout.trim().split("\n");
  for (const [path, content] of documents) {
    assert.ok(paths.includes(`package/${path}`), `Missing packed contract: ${path}`);
    const document = spawnSync("tar", ["-xOzf", archive, `package/${path}`]);
    assert.equal(document.status, 0, document.stderr.toString());
    assert.deepEqual(document.stdout, content);
  }
});
