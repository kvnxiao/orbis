import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "workspace", environment: "node", include: ["scripts/**/*.test.mts"] } },
      {
        test: {
          name: "extension-template",
          environment: "node",
          include: ["templates/extension/tests/**/*.test.mts"],
        },
      },
      "./packages/*/vitest.config.mts",
    ],
  },
});
