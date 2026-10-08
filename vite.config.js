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
      // mongodb-query-parser (the package this replaced) resolved, via its "import"
      // export condition, to an ESM wrapper (dist/.esm-wrapper.mjs) that re-exports the
      // CJS build with `import mod from "./index.js"; export const parseFilter =
      // mod.parseFilter`. Under Rollup's default CJS-default interop, `mod` became the
      // module's `default` export, so `mod.parseFilter` (and every other named
      // re-export) was undefined — freezing parseFilter as undefined in the PRODUCTION
      // bundle only; `tauri dev` pre-bundles with esbuild and was unaffected, which is
      // why this passed there but threw "… is not a function" in the packaged app.
      // @mongodb-js/shell-bson-parser has the identical wrapper shape, but this project
      // now builds with Rolldown (vite 8, since #245) rather than Rollup, and
      // queryParser.build.test.js — which builds through this config and calls the
      // result — passes with the alias removed. The alias stays anyway as cheap
      // insurance should that bundler behaviour return; the test is the real guard.
      "@mongodb-js/shell-bson-parser": require.resolve("@mongodb-js/shell-bson-parser"),
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
