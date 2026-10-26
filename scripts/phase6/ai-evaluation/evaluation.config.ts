import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "server-only": path.resolve("tests/server-only.ts"),
    },
  },
  test: {
    include: ["scripts/phase6/ai-evaluation/evaluation.run.ts"],
    maxWorkers: 1,
    testTimeout: 1250000,
    hookTimeout: 30000,
    reporters: ["dot"],
  },
});
