import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { HttpError } from "../app.ts";
import { readVoter } from "../chain/read.ts";
import type { Deps } from "../deps.ts";
import { minBlockFrom, poolFrom } from "./round.ts";

export function voterRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/:address", async (c) => {
    const raw = c.req.param("address");
    if (!isAddress(raw)) throw new HttpError(400, "address is not an address");
    const address = getAddress(raw);
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot, roster } = await deps.snapshots.get(pool, minBlockFrom(c.req.query("after")));
    const facts = await readVoter(
      deps.client,
      pool,
      snapshot.kind,
      address,
      BigInt(snapshot.block),
    );
    return c.json({
      address,
      block: snapshot.block,
      ...facts,
      inRoster: roster.has(address.toLowerCase()),
    });
  });
  return r;
}
