import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@ftops/webhooks": resolve(__dirname, "../../packages/webhooks/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    fileParallelism: false,
    // Each test includes Miniflare startup and all D1 migrations. Shared CI runners
    // can exceed Vitest's 5-second default before the assertions finish.
    testTimeout: 30_000,
  },
});
