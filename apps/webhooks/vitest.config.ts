import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@ftops/webhooks": resolve(
        __dirname,
        "../../packages/webhooks/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
