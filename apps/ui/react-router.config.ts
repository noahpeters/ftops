import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  serverBuildPath: "dist/server/index.js",
  serverModuleFormat: "esm",
  ssr: true,
} satisfies Config;
