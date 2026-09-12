/** Builds the API from the environment. Shared by main.ts (API alone) and
 * ../server.ts (API next to the built SPA). */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import type { Deps } from "./deps.ts";

export function createServer(env: Record<string, string | undefined> = Deno.env.toObject()) {
  const config = loadConfig(env);
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
  const now = () => Math.floor(Date.now() / 1000);
  const deps: Deps = { config, now, log };
  return { app: createApp(deps), config, deps };
}
