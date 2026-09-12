/** Builds the API from the environment. Shared by main.ts (API alone) and
 * ../server.ts (API next to the built SPA). */
import { createApp } from "./app.ts";
import { createClient } from "./chain/client.ts";
import { readRound } from "./chain/read.ts";
import { loadConfig } from "./config.ts";
import type { Deps } from "./deps.ts";
import { createSnapshots } from "./services/snapshot.ts";

export function createServer(env: Record<string, string | undefined> = Deno.env.toObject()) {
  const config = loadConfig(env);
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
  const now = () => Math.floor(Date.now() / 1000);
  const client = createClient({ rpcUrls: config.rpcUrls, chainId: config.chainId });
  const snapshots = createSnapshots({
    read: (pool) =>
      readRound(client, pool, { rosterPage: config.rosterPage, chainId: config.chainId }),
    // deno-lint-ignore require-await
    titleOf: async () => null, // Task 7 wires the content service here
    ttlMs: config.snapshotTtlMs,
    now,
  });
  const deps: Deps = { config, client, snapshots, now, log };
  return { app: createApp(deps), config, deps };
}
