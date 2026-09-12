import { Hono } from "hono";
import { type Address, getAddress, isAddress } from "viem";
import { HttpError } from "../app.ts";
import type { Config } from "../config.ts";
import type { Deps } from "../deps.ts";

/** ?pool= overrides the configured pool so the SPA's round picker keeps working. */
export function poolFrom(param: string | undefined, config: Config): Address {
  if (param !== undefined) {
    if (!isAddress(param)) throw new HttpError(400, "pool must be an address");
    return getAddress(param);
  }
  if (!config.poolAddress) throw new HttpError(400, "no pool configured; pass ?pool=");
  return config.poolAddress;
}

export function minBlockFrom(param: string | undefined): number | undefined {
  if (param === undefined) return undefined;
  const n = Number(param);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, "after must be a block number");
  return n;
}

export function roundRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/", async (c) => {
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot } = await deps.snapshots.get(pool, minBlockFrom(c.req.query("after")));
    return c.json(snapshot);
  });
  return r;
}
