import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@lib": new URL("../cre/src/lib", import.meta.url).pathname } },
  test: {
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
