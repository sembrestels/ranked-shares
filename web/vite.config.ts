import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), !process.env.VITEST && reactRouter()],
  // Match the house frontend's renderer: Deno otherwise selects React's browser
  // export, while React Router's SPA prerender entry needs the Node stream API.
  resolve: {
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
    fs: { allow: [new URL("..", import.meta.url).pathname] },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
