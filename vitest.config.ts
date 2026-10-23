import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Native MCP and bounded decoder journeys can exceed the five-second default on shared CI.
    // Provider/process deadlines remain enforced independently by the implementation.
    testTimeout: 30000,
    restoreMocks: true,
  },
});
