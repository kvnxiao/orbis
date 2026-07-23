import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const name = args[0];

if (
  args.length !== 1 ||
  typeof name !== "string" ||
  name.length > 207 ||
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) ||
  !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)
) {
  console.error("Usage: pnpm new:extension <name> (lowercase letters, digits, and hyphens)");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const packages = join(root, "packages");
const destination = join(packages, name);

try {
  await mkdir(packages, { recursive: true });
  await mkdir(destination);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") {
    console.error(`Package directory already exists: packages/${name}`);
    process.exit(1);
  }
  throw error;
}

await cp(join(root, "templates", "extension"), destination, {
  recursive: true,
});
await cp(join(root, "LICENSE"), join(destination, "LICENSE"));

await Promise.all(
  ["package.json", "README.md", "src/index.ts", "vitest.config.mts", "tests/index.test.mts"].map(
    async (file) => {
      const path = join(destination, file);
      const content = await readFile(path, "utf8");
      await writeFile(
        path,
        content
          .replaceAll("@orbis/example", `@orbis/${name}`)
          .replaceAll("orbis-example", `orbis-${name}`)
          .replaceAll("packages/example", `packages/${name}`),
      );
    },
  ),
);

console.log(`Created @orbis/${name} in packages/${name}`);
console.log(`Run pnpm install, then pnpm exec pi -e ./packages/${name}`);
