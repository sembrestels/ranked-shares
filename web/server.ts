/** Site server (Deno Deploy entrypoint): the API under /api and /healthz, the
 * built SPA from build/client for everything else, with the prerendered
 * shell as fallback for client-side routes such as /project/3. */
import { createServer } from "./api/bootstrap.ts";
import { isApi, serveStatic } from "./api/static.ts";

const { app, config } = createServer();
const ROOT = new URL("./build/client", import.meta.url).pathname;

Deno.serve({ port: config.port }, (req) => {
  return isApi(new URL(req.url).pathname) ? app.fetch(req) : serveStatic(req, ROOT);
});
