import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;
type Dependency = { name: string; specifier: string; source: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): JsonObject {
  assert.ok(isObject(value), "Expected an object");
  return value;
}

function strings(value: unknown): Record<string, string> {
  const entries = Object.entries(object(value));
  return Object.fromEntries(
    entries.map(([key, item]) => {
      assert.ok(typeof item === "string", "Expected string values");
      return [key, item] as const;
    }),
  );
}

export function stableVersions(versions: string[]): string[] {
  return versions
    .filter((version) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    .toSorted((a, b) => {
      const left = a.split(".").map(Number);
      const right = b.split(".").map(Number);
      for (const index of [0, 1, 2]) {
        const difference = (right[index] ?? 0) - (left[index] ?? 0);
        if (difference !== 0) {
          return difference;
        }
      }
      return 0;
    });
}

export function selectRelease(
  times: Record<string, string>,
  now: number,
  ageMinutes: number,
  major?: number,
): string | null {
  assert.ok(
    Number.isFinite(now) && Number.isFinite(ageMinutes) && ageMinutes >= 0,
    "Invalid release cutoff",
  );
  assert.ok(
    major === undefined || (Number.isInteger(major) && major >= 0),
    "Invalid major version",
  );
  const cutoff = now - ageMinutes * 60_000;
  return (
    stableVersions(Object.keys(times)).find((version) => {
      const published = Date.parse(times[version] ?? "");
      return (
        Number.isFinite(published) &&
        published <= cutoff &&
        (major === undefined || Number(version.split(".")[0]) === major)
      );
    }) ?? null
  );
}

export function collectDependencies(
  manifests: Record<string, JsonObject>,
  config: JsonObject,
): Dependency[] {
  const catalogs = object(config.catalogs ?? {});
  const defaults = object(config.catalog ?? catalogs.default ?? {});
  const allCatalogs: JsonObject = { ...catalogs, default: defaults };
  const dependencies: Dependency[] = [];
  for (const [catalog, entries] of Object.entries(allCatalogs)) {
    for (const [name, specifier] of Object.entries(strings(entries))) {
      dependencies.push({ name, specifier, source: `pnpm-workspace.yaml#catalogs.${catalog}` });
    }
  }
  for (const [path, manifest] of Object.entries(manifests)) {
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, specifier] of Object.entries(strings(manifest[section] ?? {}))) {
        if (specifier.startsWith("catalog:")) {
          const catalog = specifier === "catalog:" ? "default" : specifier.slice(8);
          assert.ok(
            name in object(allCatalogs[catalog]),
            `Missing catalog entry: ${catalog}/${name}`,
          );
        }
        dependencies.push({ name, specifier, source: `${path}#${section}` });
      }
    }
  }
  return dependencies.toSorted((a, b) => {
    const nameOrder = a.name.localeCompare(b.name, "en");
    return nameOrder === 0 ? a.source.localeCompare(b.source, "en") : nameOrder;
  });
}

export function releaseTargets(dependencies: Dependency[]) {
  const localDependencies = dependencies.filter(({ specifier }) =>
    /^(workspace:|file:|link:)/.test(specifier),
  );
  const manualDependencies = dependencies.filter(
    ({ specifier }) =>
      !/^(catalog:|workspace:|file:|link:)/.test(specifier) && /[:/#]|^\.|\.tgz$/.test(specifier),
  );
  const excluded = new Set([...localDependencies, ...manualDependencies].map(({ name }) => name));
  const packages = [
    ...new Set(
      dependencies
        .filter(({ name, specifier }) => !excluded.has(name) && !specifier.startsWith("catalog:"))
        .map(({ name }) => name),
    ),
  ].toSorted();
  return { packages, localDependencies, manualDependencies };
}

export function packageProblems(manifest: JsonObject, expectedName: string): string[] {
  const problems: string[] = [];
  if (manifest.name !== expectedName) {
    problems.push(`name must be ${expectedName}`);
  }
  if (manifest.license !== "GPL-3.0-only") {
    problems.push("license must be GPL-3.0-only");
  }
  if (manifest.type !== "module") {
    problems.push("type must be module");
  }
  if (JSON.stringify(object(manifest.pi ?? {}).extensions) !== JSON.stringify(["./src/index.ts"])) {
    problems.push("pi.extensions must point at ./src/index.ts");
  }
  const files = manifest.files;
  if (!Array.isArray(files) || !files.includes("src") || !files.includes("LICENSE")) {
    problems.push("published files must include src and LICENSE");
  }
  const dependencies = strings(manifest.dependencies ?? {});
  const development = strings(manifest.devDependencies ?? {});
  const peers = strings(manifest.peerDependencies ?? {});
  for (const name of new Set([
    ...Object.keys(dependencies),
    ...Object.keys(development),
    ...Object.keys(peers),
  ])) {
    if (name.startsWith("@earendil-works/pi-") || name === "typebox") {
      if (
        peers[name] !== "*" ||
        development[name] === undefined ||
        dependencies[name] !== undefined
      ) {
        problems.push(
          `${name} requires a * peer and a development dependency, without a runtime dependency`,
        );
      }
    }
  }
  return problems;
}

const root = resolve(import.meta.dirname, "..");
const pnpm = process.env.ORBIS_PNPM ?? "pnpm";
const checks: { cwd: string; command: string[]; milliseconds: number; passed: boolean }[] = [];

function command(executable: string, args: string[], cwd = root, env = process.env): string {
  console.error(`${cwd}: ${executable} ${args.join(" ")}`);
  const start = performance.now();
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  checks.push({
    cwd,
    command: [executable, ...args],
    milliseconds: Math.round(performance.now() - start),
    passed: result.status === 0,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `${executable} failed (${result.status}):\n${result.stderr}\n${result.stdout}`,
  );
  return result.stdout.trim();
}

function jsonCommand(args: string[], cwd = root): JsonObject {
  return object(JSON.parse(command(pnpm, args, cwd)) as unknown);
}

async function jsonFile(path: string): Promise<JsonObject> {
  return object(JSON.parse(await readFile(path, "utf8")) as unknown);
}

async function inventory() {
  const files = command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter((path) => path !== "");
  const paths = [
    ...new Set(
      files.filter(
        (path) =>
          path === "package.json" ||
          /^packages\/[^/]+\/package.json$/.test(path) ||
          path === "templates/extension/package.json",
      ),
    ),
  ].toSorted();
  const manifests = Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await jsonFile(join(root, path))] as const)),
  );
  const config = jsonCommand(["config", "list", "--json"]);
  const manifest = object(manifests["package.json"]);
  const policies = Object.fromEntries(
    [
      "catalog",
      "catalogs",
      "packages",
      "allowBuilds",
      "minimumReleaseAge",
      "minimumReleaseAgeExclude",
    ].map((key) => [key, config[key]]),
  );
  const nodePin = (await readFile(join(root, ".node-version"), "utf8")).trim();
  const manager = manifest.packageManager;
  assert.ok(
    typeof manager === "string" && /^pnpm@\d+\.\d+\.\d+(?:\+.*)?$/.test(manager),
    "Expected an exact pnpm packageManager pin",
  );
  const runtime = strings(manifest.engines).node;
  assert.ok(
    typeof runtime === "string" && /^>=\d+\.\d+\.\d+$/.test(runtime),
    "Review the runtime range and implement minimum-version parsing before proceeding",
  );
  const dependencies = collectDependencies(manifests, policies);
  dependencies.push({
    name: "pnpm",
    specifier: manager.slice(5).split("+")[0] ?? "",
    source: "package.json#packageManager",
  });
  return {
    node: {
      executable: process.execPath,
      actual: process.versions.node,
      pin: nodePin,
      runtimeMinimum: runtime.slice(2),
    },
    pnpm: {
      executable: pnpm,
      actual: command(pnpm, ["--version"]),
      pin: manager.slice(5).split("+")[0],
    },
    manifests,
    policies,
    dependencies,
    reviewFiles: files
      .filter((path) =>
        /(?:AGENTS\.md|README\.md|tsconfig.*\.json|vitest\.config\.mts|\.oxlintrc\.json|\.node-version|\.nvmrc|\.tool-versions|Dockerfile|\.github\/.*)$/.test(
          path,
        ),
      )
      .toSorted(),
  };
}

async function releases(state: Awaited<ReturnType<typeof inventory>>) {
  const now = Date.now();
  assert.equal(state.policies.minimumReleaseAge, 1440, "minimumReleaseAge must remain 1440");
  const { packages, localDependencies, manualDependencies } = releaseTargets(state.dependencies);
  const candidates = packages.map((name) => {
    const metadata = jsonCommand(["view", name, "versions", "time", "dist-tags", "--json"]);
    const versions = metadata.versions;
    assert.ok(
      Array.isArray(versions) && versions.every((version) => typeof version === "string"),
      "Expected published package versions",
    );
    const times = Object.fromEntries(
      Object.entries(strings(metadata.time)).filter(([version]) => versions.includes(version)),
    );
    const major =
      name === "@types/node" ? Number(state.node.runtimeMinimum.split(".")[0]) : undefined;
    const selected = selectRelease(times, now, 1440, major);
    const details =
      selected === null
        ? null
        : jsonCommand([
            "view",
            `${name}@${selected}`,
            "version",
            "engines",
            "peerDependencies",
            "dependencies",
            "repository",
            "deprecated",
            "dist",
            "--json",
          ]);
    return {
      name,
      current: state.dependencies.filter((item) => item.name === name),
      latestStable: stableVersions(Object.keys(times))[0] ?? null,
      candidate: selected,
      published: selected === null ? null : times[selected],
      distTags: metadata["dist-tags"],
      details,
    };
  });
  const exclusions = state.policies.minimumReleaseAgeExclude ?? [];
  assert.ok(
    Array.isArray(exclusions) && exclusions.every((entry) => typeof entry === "string"),
    "Expected release-age exclusion strings",
  );
  const exclusionDecisions = exclusions.map((entry) => {
    const match = /^(.+)@(\d+\.\d+\.\d+)$/.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined) {
      return { entry, action: "review-pattern" };
    }
    const metadata = jsonCommand(["view", match[1], "time", "--json"]);
    const times = strings(metadata);
    const published = times[match[2]];
    return {
      entry,
      published: published ?? null,
      action:
        published !== undefined &&
        Number.isFinite(Date.parse(published)) &&
        Date.parse(published) <= now - 1440 * 60_000
          ? "remove"
          : "retain-or-investigate",
    };
  });
  const response = await fetch("https://nodejs.org/dist/index.json", {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Node release index returned ${response.status}`);
  const nodes: unknown = await response.json();
  assert.ok(Array.isArray(nodes), "Expected Node release index");
  const versions = nodes
    .map((item: unknown) => object(item).version)
    .filter((version): version is string => typeof version === "string")
    .map((version) => version.replace(/^v/, ""));
  return {
    asOf: new Date(now).toISOString(),
    ageMinutes: 1440,
    node: { current: state.node.pin, candidate: stableVersions(versions)[0], source: response.url },
    candidates,
    localDependencies,
    manualDependencies,
    exclusionDecisions,
  };
}

async function verify(state: Awaited<ReturnType<typeof inventory>>, minimumNode: string) {
  assert.equal(
    state.node.actual,
    state.node.pin,
    "Run verification with the pinned development Node.js",
  );
  assert.equal(state.pnpm.actual, state.pnpm.pin, "Run verification with the pinned pnpm");
  assert.equal(
    command(minimumNode, ["--version"]).replace(/^v/, ""),
    state.node.runtimeMinimum,
    "The minimum runtime executable must match engines.node exactly",
  );
  assert.equal(state.policies.minimumReleaseAge, 1440);
  for (const [path, manifest] of Object.entries(state.manifests)) {
    if (path !== "package.json") {
      const name = path.startsWith("templates/")
        ? "@orbis/example"
        : `@orbis/${basename(dirname(path))}`;
      assert.deepEqual(packageProblems(manifest, name), [], path);
    }
  }
  command(pnpm, ["install", "--frozen-lockfile"]);
  command(pnpm, ["check"]);
  const compiler = jsonCommand(["exec", "tsc", "--showConfig"]);
  const options = object(compiler.compilerOptions);
  for (const key of [
    "noEmit",
    "erasableSyntaxOnly",
    "strict",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "verbatimModuleSyntax",
  ]) {
    assert.equal(options[key], true, key);
  }
  const lint = jsonCommand(["exec", "oxlint", "--print-config"]);
  assert.equal(object(lint.options).typeAware, true, "Oxlint type-aware analysis must be enabled");

  const temporary = await mkdtemp(join(tmpdir(), "orbis-toolchain-"));
  console.error(`Retained verification artifacts: ${temporary}`);
  const workspace = join(temporary, "workspace");
  await cp(root, workspace, {
    recursive: true,
    filter: async (source) =>
      !["node_modules", ".git", ".artifacts", ".pi", "coverage", "pnpm-lock.yaml"].includes(
        basename(source),
      ) && !(await lstat(source)).isSymbolicLink(),
  });
  const name = "toolchain-verification";
  command(process.execPath, ["scripts/new-extension.mts", name], workspace);
  command(pnpm, ["install", "--no-frozen-lockfile"], workspace);
  command(pnpm, ["format"], workspace);
  command(pnpm, ["check"], workspace);
  command(pnpm, ["--filter", `@orbis/${name}`, "test"], workspace);
  const packed = join(temporary, "packed");
  await mkdir(packed);
  command(pnpm, ["pack", "--pack-destination", packed], join(workspace, "packages", name));
  const tarballs = (await readdir(packed)).filter((file) => file.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  const tarball = tarballs[0];
  assert.ok(tarball !== undefined);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  const piManifest = await jsonFile(
    join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
  );
  assert.equal(typeof piManifest.version, "string");
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        [`@orbis/${name}`]: `file:${join(packed, tarball).replaceAll("\\", "/")}`,
        "@earendil-works/pi-coding-agent": piManifest.version,
      },
    }),
  );
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    JSON.stringify({
      minimumReleaseAge: 1440,
      minimumReleaseAgeExclude: state.policies.minimumReleaseAgeExclude ?? [],
      allowBuilds: state.policies.allowBuilds ?? {},
    }),
  );
  command(pnpm, ["install", "--prod"], consumer);
  const installed = join(consumer, "node_modules", "@orbis", name);
  const packedManifest = await jsonFile(join(installed, "package.json"));
  assert.deepEqual(packageProblems(packedManifest, `@orbis/${name}`), []);
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    assert.ok(
      Object.values(strings(packedManifest[section] ?? {})).every(
        (value) => !/^(catalog:|workspace:)/.test(value),
      ),
      `Unresolved ${section} in tarball`,
    );
  }
  await Promise.all(
    ["src/index.ts", "README.md", "LICENSE"].map((file) => readFile(join(installed, file))),
  );
  await cp(join(root, "scripts", "toolchain-smoke.mts"), join(consumer, "smoke.mts"));
  for (const runtime of [process.execPath, minimumNode]) {
    command(runtime, [join(consumer, "smoke.mts"), installed, `orbis-${name}`], consumer);
  }
  const agentDir = join(temporary, "pi-settings");
  command(pnpm, ["exec", "pi", "install", "."], workspace, {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
  });
  const settings = await jsonFile(join(agentDir, "settings.json"));
  assert.ok(
    Array.isArray(settings.packages) &&
      settings.packages.some(
        (entry: unknown) =>
          typeof entry === "string" && resolve(agentDir, entry) === resolve(workspace),
      ),
    "Pi must register the isolated workspace",
  );
  return {
    temporary,
    compiler,
    lint,
    runtimes: [state.node.pin, state.node.runtimeMinimum],
    standalonePi: "not-tested",
    existingPackageTarballs: "not-tested",
  };
}

export function parseArgs(args: string[]) {
  const [mode, runtime, ...extra] = args;
  assert.ok(
    mode === "inventory" || mode === "baseline" || mode === "releases" || mode === "verify",
    "Usage: node scripts/update-toolchain.mts <inventory|baseline|releases|verify MINIMUM_NODE_EXECUTABLE>",
  );
  assert.ok(
    mode === "inventory" || mode === "baseline" || mode === "releases"
      ? runtime === undefined
      : typeof runtime === "string" && runtime !== "",
    "Usage: node scripts/update-toolchain.mts <inventory|baseline|releases|verify MINIMUM_NODE_EXECUTABLE>",
  );
  assert.equal(extra.length, 0, "Unexpected arguments");
  return { mode, runtime };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let result: unknown;
  try {
    const { mode, runtime } = parseArgs(process.argv.slice(2));
    const state = await inventory();
    switch (mode) {
      case "inventory":
        result = state;
        break;
      case "baseline":
        command(pnpm, ["check"]);
        result = state;
        break;
      case "releases":
        result = await releases(state);
        break;
      case "verify":
        assert.ok(runtime !== undefined);
        result = await verify(state, runtime);
        break;
    }
    console.log(JSON.stringify({ ok: true, result, checks }, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify(
        { ok: false, error: error instanceof Error ? error.message : String(error), checks },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
