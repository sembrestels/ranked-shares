/** The API on its own (dev). Production serves API and SPA from ../server.ts. */
import { createServer } from "./bootstrap.ts";

const { app, config } = createServer();
Deno.serve({ hostname: "127.0.0.1", port: config.port }, app.fetch);
