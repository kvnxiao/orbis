import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  sortImports: true,
  sortTailwindcss: true,
  sortPackageJson: true,
  arrowParens: "always",
  endOfLine: "lf",
  ignorePatterns: [
    "pnpm-lock.yaml",
    "LICENSE",
    "**/LICENSE",
    "node_modules/**",
    ".artifacts/**",
    ".agents/**",
  ],
  proseWrap: "always",
  jsdoc: {
    addDefaultToDescription: true,
    bracketSpacing: false,
    capitalizeDescriptions: true,
    commentLineStrategy: "singleLine",
    preferCodeFences: true,
  },
  jsxSingleQuote: false,
});
