import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL(".", import.meta.url).pathname, "");
  const apiTarget = `http://127.0.0.1:${env.PORT || "8000"}`;
  return {
    plugins: [
      tailwindcss(),
      // Shared CRE, prover, and shared/ source is bundled by this app. Resolve their
      // bare imports (and the bare imports of anything they pull from cre/node_modules
      // or prover/node_modules) from web, so a web-only install works under Deno as
      // well as Node, without deduping Swarm's older Noble.
      {
        name: "shared-ballot-dependencies",
        async resolveId(source, importer) {
          const bare = !source.startsWith(".") && !source.startsWith("/") && !source.startsWith("\0");
          if (importer && bare && !importer.includes("/web/") && !importer.startsWith("\0")) {
            return this.resolve(source, new URL("./app/lib/ballots.ts", import.meta.url).pathname, { skipSelf: true });
          }
        },
      },
      !process.env.VITEST && reactRouter(),
    ],
    // Match the house frontend's renderer: Deno otherwise selects React's browser
    // export, while React Router's SPA prerender entry needs the Node stream API.
    resolve: {
      dedupe: ["viem"],
      alias: {
        "react-dom/server":
          new URL("./app/lib/react-dom-server.node.mjs", import.meta.url)
            .pathname,
      },
    },
    // Swarm ID needs its cross-origin iframe and popup opener. The isolated Noir
    // coordinator keeps its COOP/COEP headers in the separate prover package.
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/healthz": { target: apiTarget, changeOrigin: true },
      },
      fs: {
        allow: [new URL("..", import.meta.url).pathname],
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/demo/.local/**"],
      },
    },
    // The Noble packages are inlined so the resolver above sees their nested
    // imports too; externalised, Deno would load them from cre/node_modules.
    ssr: { noExternal: ["@noble/curves", "@noble/hashes"] },
    test: {
      server: { deps: { inline: ["@noble/curves", "@noble/hashes"] } },
      environment: "jsdom",
      include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    },
  };
});
