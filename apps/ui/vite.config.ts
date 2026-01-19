import path from "node:path";
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  plugins: [
    stylex.vite({
      importSources: ["@stylexjs/stylex", "stylex", "~/lib/stylex"],
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: __dirname,
      },
      devMode: "full",
      devPersistToDisk: true,
    }),
    reactRouter(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    noExternal: ["@stylexjs/stylex"],
  },
});
