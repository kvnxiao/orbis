import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
let preserveSpecification = false;

try {
  await mkdir(packages, { recursive: true });
  await mkdir(destination);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") {
    const existing = await lstat(destination);
    const entries = existing.isDirectory()
      ? await readdir(destination, { withFileTypes: true })
      : [];
    const specification = entries.find((entry) => entry.name === "SPEC.md");
    let validResearch = true;
    if (entries.some((entry) => entry.name === "docs" && entry.isDirectory())) {
      const docs = await readdir(join(destination, "docs"), { withFileTypes: true });
      validResearch = docs.length === 1 && docs[0]?.name === "research" && docs[0].isDirectory();
    }
    preserveSpecification =
      specification?.isFile() === true &&
      validResearch &&
      entries.every(
        (entry) =>
          entry.name === "SPEC.md" ||
          ((entry.name === "docs" || entry.name === "implementation") && entry.isDirectory()),
      );
    if (!preserveSpecification) {
      console.error(`Package directory already exists: packages/${name}`);
      process.exit(1);
    }
  } else {
    throw error;
  }
}

const template = join(root, "templates", "extension");
await Promise.all(
  (await readdir(template))
    .filter((entry) => !preserveSpecification || entry !== "SPEC.md")
    .map(async (entry) => {
      await cp(join(template, entry), join(destination, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }),
);
await cp(join(root, "LICENSE"), join(destination, "LICENSE"));

await Promise.all(
  [
    "package.json",
    "README.md",
    ...(!preserveSpecification ? ["SPEC.md"] : []),
    "src/index.ts",
    "vitest.config.mts",
    "tests/index.test.mts",
  ].map(async (file) => {
    const path = join(destination, file);
    const content = await readFile(path, "utf8");
    await writeFile(
      path,
      content
        .replaceAll("@orbis/example", `@orbis/${name}`)
        .replaceAll("orbis-example", `orbis-${name}`)
        .replaceAll("packages/example", `packages/${name}`),
    );
  }),
);

console.log(`Created @orbis/${name} in packages/${name}`);
console.log(`Run pnpm install, then pi install ./packages/${name}`);
