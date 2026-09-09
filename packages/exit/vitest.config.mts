import { defineProject } from "vitest/config";

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: "@orbis/exit",
    environment: "node",
    include: ["tests/**/*.test.mts"],
  },
});
