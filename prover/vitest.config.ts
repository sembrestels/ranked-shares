import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@lib": new URL("../cre/src/lib", import.meta.url).pathname } },
  // The jsdom pool (page.test.ts) routes module loads through Vite's dev-server fs
  // boundary, which otherwise denies anything above this package — including the repo
  // root `out/` forge artifacts the anvil test helper reads and `../cre` this aliases to.
  server: { fs: { allow: [new URL("..", import.meta.url).pathname] } },
  test: {
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
