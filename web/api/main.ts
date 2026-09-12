/** The API on its own (dev). Production serves API and SPA from ../server.ts. */
import { createServer } from "./bootstrap.ts";

const { app, config } = createServer();
Deno.serve({ port: config.port }, app.fetch);
