import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Deps } from "./deps.ts";
import { healthRoutes } from "./routes/health.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    deps.log(`unhandled: ${err.stack ?? err}`);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.use(
    "*",
    cors({ origin: deps.config.webOrigins, allowMethods: ["GET", "OPTIONS"], maxAge: 600 }),
  );
  app.route("/healthz", healthRoutes(deps));
  return app;
}
