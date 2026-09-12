import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import type { Deps } from "../deps.ts";
import { openSnapshot } from "./fixtures.ts";
import { POOL } from "./fake-pool.ts";

const deps: Deps = {
  config: loadConfig({ POOL_ADDRESS: POOL }),
  client: {} as Deps["client"],
  // deno-lint-ignore require-await
  snapshots: { get: async () => ({ snapshot: openSnapshot, roster: new Set() }) },
  content: {
    // deno-lint-ignore require-await
    get: async (ref) =>
      ref.startsWith("0xabab")
        ? {
          status: "ok",
          content: { version: 1, title: "Audit", body: "Hello", attachments: [] } as any,
          reason: null,
        }
        : { status: "none", content: null, reason: null },
  },
  now: () => 0,
  log: () => {},
};

Deno.test("GET /api/project/0 returns the project, its round slice, and the pitch", async () => {
  const res = await createApp(deps).fetch(new Request("http://x/api/project/0"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.project, openSnapshot.projects[0]);
  assertEquals(body.round, {
    pool: openSnapshot.pool,
    kind: "zisk",
    block: 123,
    at: 1_700_000_000,
    token: openSnapshot.token,
    phase: "open",
    finality: null,
    stage: openSnapshot.stage,
  });
  assertEquals(body.contentStatus, "ok");
  assertEquals(body.content.title, "Audit");
  assertEquals(body.reason, null);
});

Deno.test("GET /api/project/1 with a zero reference has no pitch", async () => {
  const body = await (await createApp(deps).fetch(new Request("http://x/api/project/1"))).json();
  assertEquals(body.contentStatus, "none");
  assertEquals(body.content, null);
});

Deno.test("GET /api/project rejects bad ids and unknown projects", async () => {
  const app = createApp(deps);
  assertEquals((await app.fetch(new Request("http://x/api/project/x"))).status, 400);
  assertEquals((await app.fetch(new Request("http://x/api/project/-1"))).status, 400);
  const missing = await app.fetch(new Request("http://x/api/project/7"));
  assertEquals(missing.status, 404);
  assertEquals(await missing.json(), { error: "unknown project" });
});
