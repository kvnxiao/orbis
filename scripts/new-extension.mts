import { cp, lstat, readFile, readdir, writeFile } from "node:fs/promises";
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

function reject(message: string): never {
  console.error(message);
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const destination = join(root, "packages", name);
const missingSpecification = `Missing packages/${name}/SPEC.md: write the package specification before scaffolding.`;
const invalidLayout = `packages/${name} must be a directory, not a link, and may contain only SPEC.md, docs/research/, docs/tui-interactions.md, and implementation/.`;

let existing;
try {
  existing = await lstat(destination);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    reject(missingSpecification);
  }
  throw error;
}
if (!existing.isDirectory()) {
  reject(invalidLayout);
}

const entries = await readdir(destination, { withFileTypes: true });
const specification = entries.find((entry) => entry.name === "SPEC.md");
if (specification === undefined) {
  reject(missingSpecification);
}
let validDocs = true;
if (entries.some((entry) => entry.name === "docs" && entry.isDirectory())) {
  const docs = await readdir(join(destination, "docs"), { withFileTypes: true });
  validDocs =
    docs.length > 0 &&
    docs.every(
      (entry) =>
        (entry.name === "research" && entry.isDirectory()) ||
        (entry.name === "tui-interactions.md" && entry.isFile()),
    );
}
if (
  !specification.isFile() ||
  !validDocs ||
  !entries.every(
    (entry) =>
      entry.name === "SPEC.md" ||
      ((entry.name === "docs" || entry.name === "implementation") && entry.isDirectory()),
  )
) {
  reject(invalidLayout);
}

const template = join(root, "templates", "extension");
await Promise.all(
  (await readdir(template)).map(async (entry) => {
    await cp(join(template, entry), join(destination, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }),
);
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
console.log(`Run pnpm install, then pi install ./packages/${name}`);
