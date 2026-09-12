import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";

const deps: Deps = {
  config: loadConfig({ CHAIN_ID: "31337" }),
  client: {} as Deps["client"],
  snapshots: {
    // deno-lint-ignore require-await
    get: async () => {
      throw new Error("unused");
    },
  },
  // deno-lint-ignore require-await
  content: { get: async () => ({ status: "none", content: null, reason: null }) },
  now: () => 0,
  log: () => {},
};

Deno.test("GET /healthz reports the chain and pool", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/healthz"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, chainId: 31337, pool: null });
});

Deno.test("unknown routes are JSON 404s", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/api/nothing"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not found" });
});

Deno.test("CORS allows a configured origin on GET", async () => {
  const res = await createApp(deps).fetch(
    new Request("http://x/healthz", { headers: { Origin: "http://localhost:5174" } }),
  );
  assertEquals(res.headers.get("access-control-allow-origin"), "http://localhost:5174");
});
