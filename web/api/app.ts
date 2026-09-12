import { Hono } from "hono";
import { cors } from "hono/cors";
import { isRpcDown } from "./chain/rpc-down.ts";
import { PoolTooLargeError } from "./chain/read.ts";
import type { Deps } from "./deps.ts";
import { healthRoutes } from "./routes/health.ts";
import { projectRoutes } from "./routes/project.ts";
import { roundRoutes } from "./routes/round.ts";
import { voterRoutes } from "./routes/voter.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof PoolTooLargeError) return c.json({ error: "pool too large" }, 400);
    if (isRpcDown(err)) {
      deps.log(`rpc unavailable: ${err.message}`);
      return c.json({ error: "rpc unavailable" }, 502);
    }
    deps.log(`unhandled: ${err.stack ?? err}`);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.use(
    "*",
    cors({ origin: deps.config.webOrigins, allowMethods: ["GET", "OPTIONS"], maxAge: 600 }),
  );
  app.route("/healthz", healthRoutes(deps));
  app.route("/api/round", roundRoutes(deps));
  app.route("/api/project", projectRoutes(deps));
  app.route("/api/voter", voterRoutes(deps));
  return app;
}
