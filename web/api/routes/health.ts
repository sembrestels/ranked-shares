import { Hono } from "hono";
import type { Deps } from "../deps.ts";

export function healthRoutes(deps: Deps) {
  const r = new Hono();
  r.get(
    "/",
    (c) => c.json({ ok: true, chainId: deps.config.chainId, pool: deps.config.poolAddress }),
  );
  return r;
}
