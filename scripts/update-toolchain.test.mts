import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { test } from "vitest";

import {
  collectDependencies,
  packageProblems,
  parseArgs,
  releaseTargets,
  selectPackageRelease,
  selectRelease,
  stableVersions,
} from "./update-toolchain.mts";

test("selects the newest stable release eligible at the exact age boundary", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const times = {
    "1.9.9": "2026-09-01T00:00:00Z",
    "1.10.0": "2026-09-07T12:00:00Z",
    "1.11.0": "2026-09-07T12:00:01Z",
    "2.0.0-rc.1": "2026-09-01T00:00:00Z",
    "3.0.0": "invalid",
    "4.0.0": "2026-09-09T00:00:00Z",
    modified: "2026-09-08T00:00:00Z",
  };
  assert.equal(selectRelease(times, now, 1440), "1.10.0");
  assert.equal(selectRelease(times, now, 1440, 22), null);
  assert.deepEqual(stableVersions(["2.0.0", "10.0.0", "1.10.0", "1.9.9", "1.0.0-beta", "01.0.0"]), [
    "10.0.0",
    "2.0.0",
    "1.10.0",
    "1.9.9",
  ]);
});

test("restricts Node.js type candidates to the supported runtime generation", () => {
  assert.equal(
    selectRelease(
      { "22.20.0": "2026-01-01", "24.0.0": "2026-01-01", "22.19.0": "2025-01-01" },
      Date.parse("2026-09-08"),
      1440,
      22,
    ),
    "22.20.0",
  );
});

test("package-name exclusions bypass release-age checks but exact-version exclusions do not", () => {
  const now = Date.parse("2026-09-21T20:00:00Z");
  const times = {
    "0.86.0": "2026-09-19T20:00:00Z",
    "0.87.0": "2026-09-21T16:00:00Z",
  };
  const exclusions = ["@earendil-works/pi-coding-agent"];

  assert.equal(
    selectPackageRelease(times, now, 1440, "@earendil-works/pi-coding-agent", exclusions),
    "0.87.0",
  );
  assert.equal(selectPackageRelease(times, now, 1440, "other", exclusions), "0.86.0");
  assert.equal(selectPackageRelease(times, now, 1440, "other", ["other@0.87.0"]), "0.86.0");
});

test("rejects invalid release cutoffs and major versions", () => {
  for (const [now, age, major] of [
    [NaN, 1440, 22],
    [0, -1, 22],
    [0, Infinity, 22],
    [0, 1440, -1],
    [0, 1440, 22.5],
  ]) {
    assert.throws(() => selectRelease({}, now ?? 0, age ?? 0, major));
  }
});

test("inventories unused named catalogs, template dependencies, peers, and local references", () => {
  const dependencies = collectDependencies(
    {
      "package.json": { devDependencies: { typescript: "catalog:" } },
      "templates/extension/package.json": {
        devDependencies: { vitest: "catalog:test" },
        peerDependencies: { pi: "*" },
      },
      "packages/a/package.json": {
        dependencies: { "@orbis/b": "workspace:^", runtime: "^1.0.0" },
        optionalDependencies: { optional: "1.0.0" },
      },
    },
    { catalog: { typescript: "7.0.2" }, catalogs: { test: { vitest: "5.0.0", unused: "1.0.0" } } },
  );
  assert.ok(dependencies.some((item) => item.name === "unused" && item.specifier === "1.0.0"));
  assert.ok(
    dependencies.some((item) => item.name === "pi" && item.source.endsWith("#peerDependencies")),
  );
  assert.ok(dependencies.some((item) => item.name === "optional"));
  assert.ok(dependencies.some((item) => item.specifier === "workspace:^"));
  assert.equal(dependencies.filter((item) => item.name === "typescript").length, 2);
});

test("rejects missing catalog entries and malformed dependency maps", () => {
  assert.throws(() => collectDependencies({ root: { dependencies: { missing: "catalog:" } } }, {}));
  assert.throws(() =>
    collectDependencies({ root: { dependencies: { missing: "catalog:absent" } } }, {}),
  );
  assert.throws(() => collectDependencies({ root: { dependencies: { invalid: 1 } } }, {}));
});

test("reports aliases and Git sources without querying unrelated registry identities", () => {
  const targets = releaseTargets(
    collectDependencies(
      {
        root: {
          dependencies: {
            compiler: "npm:typescript@7.0.2",
            typescript: "github:example/typescript-fork#commit",
            tarball: "https://example.test/package.tgz",
            shorthand: "example/fork#commit",
            local: "file:../local",
            shared: "workspace:^",
            vitest: "catalog:",
          },
          peerDependencies: { compiler: "*", shared: "*" },
        },
      },
      { catalog: { vitest: "5.0.0", unused: "1.0.0" } },
    ),
  );
  assert.deepEqual(targets.packages, ["unused", "vitest"]);
  assert.deepEqual(
    targets.manualDependencies.map(({ name }) => name),
    ["compiler", "shorthand", "tarball", "typescript"],
  );
  assert.deepEqual(
    targets.localDependencies.map(({ name }) => name),
    ["local", "shared"],
  );
});

test("validates package licenses, source publication, and Pi peers", () => {
  const valid = {
    name: "@orbis/example",
    type: "module",
    license: "MIT",
    files: ["src", "LICENSE"],
    pi: { extensions: ["./src/index.ts"] },
    devDependencies: { "@earendil-works/pi-coding-agent": "catalog:" },
    peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
  };
  assert.deepEqual(packageProblems(valid, "@orbis/example"), []);
  for (const license of [undefined, null, "", "GPL-3.0-only"]) {
    assert.deepEqual(packageProblems({ ...valid, license }, "@orbis/example"), [
      "license must be MIT",
    ]);
  }
  for (const change of [
    { name: "example" },
    { pi: { extensions: ["./dist/index.js"] } },
    { files: ["dist"] },
    { dependencies: { "@earendil-works/pi-coding-agent": "1.0.0" } },
    { peerDependencies: {} },
    { devDependencies: {} },
  ]) {
    assert.ok(packageProblems({ ...valid, ...change }, "@orbis/example").length > 0);
  }
});

test("requires an explicit minimum-runtime executable for verification", () => {
  assert.deepEqual(parseArgs(["verify", "C:/node minimum/node.exe"]), {
    mode: "verify",
    runtime: "C:/node minimum/node.exe",
  });
  assert.equal(parseArgs(["inventory"]).mode, "inventory");
  for (const args of [
    [],
    ["unknown"],
    ["verify"],
    ["verify", ""],
    ["inventory", "extra"],
    ["verify", "node", "extra"],
  ]) {
    assert.throws(() => parseArgs(args));
  }
});

test("invalid CLI input exits nonzero with a JSON failure before running commands", () => {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "update-toolchain.mts"), "unknown"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  const output: unknown = JSON.parse(result.stdout);
  assert.ok(typeof output === "object" && output !== null && "ok" in output && "checks" in output);
  assert.equal(output.ok, false);
  assert.deepEqual(output.checks, []);
});
