/** Environment into a typed config. Pure, so tests build their own. API
 * variables win; the VITE_ ones are read as fallbacks so one .env serves both. */
import { type Address, getAddress, isAddress } from "viem";
import { networkDefaults } from "../network.ts";

export interface Config {
  port: number;
  rpcUrls: string[];
  chainId: number;
  poolAddress: Address | null;
  webOrigins: string[];
  beeUrl: string | null;
  snapshotTtlMs: number;
  rosterPage: number;
  contentTimeoutMs: number;
}

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function positive(name: string, v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got ${v}`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const chainId = positive("CHAIN_ID", env.CHAIN_ID || env.VITE_CHAIN_ID, 5042002);
  const rpcUrls = list(env.RPC_URL || env.VITE_RPC_URL);
  if (rpcUrls.length === 0) rpcUrls.push(networkDefaults(chainId).rpcUrls.default.http[0]);
  const pool = env.POOL_ADDRESS || env.VITE_POOL_ADDRESS || "";
  if (pool && !isAddress(pool)) throw new Error(`POOL_ADDRESS is not an address: ${pool}`);
  const origins = list(env.WEB_ORIGIN);
  const bee = (env.BEE_URL ?? "").trim().replace(/\/+$/, "");
  return {
    port: positive("PORT", env.PORT, 8000),
    rpcUrls,
    chainId,
    poolAddress: pool ? getAddress(pool) : null,
    webOrigins: origins.length ? origins : ["http://localhost:5174"],
    beeUrl: bee || null,
    snapshotTtlMs: positive("SNAPSHOT_TTL_MS", env.SNAPSHOT_TTL_MS, 15_000),
    rosterPage: positive("ROSTER_PAGE", env.ROSTER_PAGE, 200),
    contentTimeoutMs: positive("CONTENT_TIMEOUT_MS", env.CONTENT_TIMEOUT_MS, 5_000),
  };
}
