import { assertEquals } from "@std/assert";
import { HttpRequestError } from "viem";
import { createApp } from "../app.ts";
import { PoolTooLargeError } from "../chain/read.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

function depsWith(
  overrides: Partial<Deps> = {},
  env: Record<string, string> = { POOL_ADDRESS: POOL },
): Deps {
  return {
    config: loadConfig(env),
    client: {} as Deps["client"],
    // deno-lint-ignore require-await
    snapshots: { get: async () => ({ snapshot: openSnapshot, roster: new Set() }) },
    // deno-lint-ignore require-await
    content: { get: async () => ({ status: "none", content: null, reason: null }) },
    now: () => 0,
    log: () => {},
    ...overrides,
  };
}

Deno.test("GET /api/round returns the configured pool's snapshot", async () => {
  const res = await createApp(depsWith()).fetch(new Request("http://x/api/round"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), openSnapshot);
});

Deno.test("GET /api/round?pool= overrides and ?after= is passed as the minimum block", async () => {
  const seen: unknown[] = [];
  const deps = depsWith({
    snapshots: {
      // deno-lint-ignore require-await
      get: async (pool, minBlock) => {
        seen.push([pool, minBlock]);
        return { snapshot: openSnapshot, roster: new Set() };
      },
    },
  }, {});
  const res = await createApp(deps).fetch(
    new Request(`http://x/api/round?pool=${POOL.toLowerCase()}&after=130`),
  );
  assertEquals(res.status, 200);
  assertEquals(seen, [[POOL, 130]]);
});

Deno.test("GET /api/round rejects a bad pool, a bad after, and no pool at all", async () => {
  const app = createApp(depsWith({}, {}));
  assertEquals((await app.fetch(new Request("http://x/api/round?pool=0x12"))).status, 400);
  assertEquals((await app.fetch(new Request("http://x/api/round"))).status, 400);
  const bad = await createApp(depsWith()).fetch(new Request("http://x/api/round?after=soon"));
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "after must be a block number" });
});

Deno.test("GET /api/round answers 502 when the RPC is down", async () => {
  const deps = depsWith({
    snapshots: {
      // deno-lint-ignore require-await
      get: async () => {
        throw new HttpRequestError({ url: "http://rpc", details: "connection refused" });
      },
    },
  });
  const res = await createApp(deps).fetch(new Request("http://x/api/round"));
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "rpc unavailable" });
});

Deno.test("GET /api/round answers 400 when the pool reports too much work", async () => {
  const deps = depsWith({
    snapshots: {
      // deno-lint-ignore require-await
      get: async () => {
        throw new PoolTooLargeError("pool too large: 1 projects, 10001 voters");
      },
    },
  });
  const res = await createApp(deps).fetch(new Request("http://x/api/round"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "pool too large" });
});
