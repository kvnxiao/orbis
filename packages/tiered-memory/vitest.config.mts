import { defineProject } from "vitest/config";

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: "@orbis/tiered-memory",
    environment: "node",
    setupFiles: ["./tests/setup.mts"],
    include: ["tests/**/*.test.mts"],
  },
});
