import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import stylex from "@stylexjs/unplugin";

// The compiler processes the package’s published StyleX source along with FTOPS styles.
const sharedStylexSources = { externalPackages: ["@from-trees/ui"] };

export default defineConfig({
  plugins: [
    stylex.vite({
      importSources: ["@stylexjs/stylex", "stylex", "~/lib/stylex"],
      ...sharedStylexSources,
      useCSSLayers: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: __dirname,
      },
      devMode: "full",
      devPersistToDisk: true,
    }) as unknown as PluginOption,
    reactRouter() as unknown as PluginOption,
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["@from-trees/ui"],
    include: ["@from-trees/ui > react-aria-components", "@from-trees/ui > lucide-react"],
  },
  ssr: {
    noExternal: ["@stylexjs/stylex", "@from-trees/ui"],
  },
});
