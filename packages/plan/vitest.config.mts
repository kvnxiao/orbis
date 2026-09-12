import { defineProject } from "vitest/config";

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: "@orbis/plan",
    environment: "node",
    setupFiles: ["./tests/setup.mts"],
    include: ["tests/**/*.test.mts"],
    benchmark: { include: ["tests/**/*.bench.mts"] },
  },
});
