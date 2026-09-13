/** Build-time chain reads for prerendering (react-router.config.ts and the
 * routes' loaders). Runs under Node during `deno task build`; the browser
 * never imports the loaders because the routes also define clientLoader. */
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  isAddress,
  parseAbi,
  type Transport,
} from "viem";
import { privacyAbi, proposalAbi } from "./proposals";
import { decryptProposal, parsePrivateDescriptor, ZERO_KEY } from "./private-proposals";
import { parseContent } from "./swarm";
import type { ProjectMetaData, RoundMetaData } from "./meta";
import { networkDefaults } from "../../network";

const abi = parseAbi([
  "function projectCount() view returns (uint256)",
  "function cost(uint256) view returns (uint256)",
  "function contentRefOf(uint256) view returns (bytes32)",
  "function votingDeadline() view returns (uint64)",
  "function token() view returns (address)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface BuildPool {
  rpc: string;
  pool: Address;
}

function env(name: string): string | undefined {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return fromProcess || fromVite || undefined;
}

/** null when VITE_POOL_ADDRESS is unset: the build then prerenders only the fixed routes. */
export function buildPool(): BuildPool | null {
  const pool = env("VITE_POOL_ADDRESS");
  if (!pool || !isAddress(pool)) return null;
  return { rpc: env("VITE_RPC_URL") || networkDefaults(Number(env("VITE_CHAIN_ID") || 5042002)).rpcUrls.default.http[0], pool };
}

const client = (cfg: BuildPool, transport?: Transport) =>
  createPublicClient({ transport: transport ?? http(cfg.rpc, { timeout: 5_000 }) });

export async function projectIds(cfg: BuildPool, transport?: Transport): Promise<number[]> {
  const n = await client(cfg, transport).readContract({
    address: cfg.pool,
    abi,
    functionName: "projectCount",
  });
  return Array.from({ length: Number(n) }, (_, i) => i);
}

async function titleOf(
  ref: string,
  beeUrl: string | undefined,
  fetchFn: typeof fetch,
  publishedKey?: Hex,
): Promise<string | null> {
  if (!beeUrl || /^0x0{64}$/.test(ref)) return null;
  try {
    const res = await fetchFn(`${beeUrl.replace(/\/+$/, "")}/bytes/${ref.slice(2)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    const descriptor = parsePrivateDescriptor(data);
    if (!descriptor) return parseContent(data).title;
    if (!publishedKey || publishedKey === ZERO_KEY) return null;
    const decrypted = await decryptProposal(
      {
        downloadData: async (reference) => {
          const payload = await fetchFn(`${beeUrl.replace(/\/+$/, "")}/bytes/${reference}`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (!payload.ok) throw new Error("Proposal unavailable");
          return new Uint8Array(await payload.arrayBuffer());
        },
      },
      descriptor,
      publishedKey,
    );
    return parseContent(decrypted).title;
  } catch {
    return null;
  }
}

export async function projectFacts(
  id: number,
  cfg: BuildPool,
  transport?: Transport,
  beeUrl: string | undefined = env("VITE_BEE_URL") || env("BEE_URL"),
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMetaData> {
  const c = client(cfg, transport);
  const [cost, ref, token] = await Promise.all([
    c.readContract({ address: cfg.pool, abi, functionName: "cost", args: [BigInt(id)] }),
    c.readContract({ address: cfg.pool, abi, functionName: "contentRefOf", args: [BigInt(id)] }),
    c.readContract({ address: cfg.pool, abi, functionName: "token" }),
  ]);
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: token, abi, functionName: "symbol" }).catch(() => "tokens"),
    c.readContract({ address: token, abi, functionName: "decimals" }),
  ]);
  const privacy = await c.readContract({
    address: cfg.pool,
    abi: proposalAbi,
    functionName: "proposalPrivacy",
  }).catch(() => undefined);
  const key = privacy
    ? await c.readContract({
      address: privacy,
      abi: privacyAbi,
      functionName: "projectKey",
      args: [BigInt(id)],
    })
    : undefined;
  return {
    title: await titleOf(ref, beeUrl, fetchFn, key),
    cost: cost.toString(),
    decimals: Number(decimals),
    symbol,
  };
}

export async function roundFacts(
  cfg: BuildPool,
  transport?: Transport,
  name = env("VITE_ROUND_NAME") || "RankedShares round",
): Promise<RoundMetaData> {
  const deadline = await client(cfg, transport).readContract({
    address: cfg.pool,
    abi,
    functionName: "votingDeadline",
  });
  return { name, votingDeadline: Number(deadline) };
}
