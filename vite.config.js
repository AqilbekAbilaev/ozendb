import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  clearScreen: false,
  resolve: {
    alias: {
      // mongodb-query-parser resolves (via its "import" export condition) to an
      // ESM wrapper (dist/.esm-wrapper.mjs) that re-exports the CJS build with
      // `import mod from "./index.js"; export const parseFilter = mod.parseFilter`.
      // Under Rollup's default CJS-default interop, `mod` becomes the module's
      // `default` export, so `mod.parseFilter` (and every other named re-export)
      // is undefined — freezing parseFilter as undefined in the PRODUCTION bundle
      // only. The dev server pre-bundles the dep with esbuild and is unaffected,
      // which is why this passed in `tauri dev` but threw "… is not a function"
      // in the packaged app. Aliasing to the CJS entry lets Rollup bundle it
      // correctly. See the ESM-wrapper re-export shape in the package's dist/.
      "mongodb-query-parser": require.resolve("mongodb-query-parser"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        document: "src/pages/document.html",
      },
    },
  },
}));
