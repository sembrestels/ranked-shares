import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  preview: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  build: { outDir: "../../dist", target: "esnext" },
  optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js"] },
  resolve: { alias: { "@lib": new URL("../cre/src/lib", import.meta.url).pathname } },
});
