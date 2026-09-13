/** Shared defaults keep browser, prerender and API on the same network. */
import { fallback, http } from "viem";
import { arcTestnet } from "viem/chains";

// Official Arc endpoints; independent providers also cover rate limits/outages.
// https://docs.arc.io/arc/references/rpc-endpoints
export const ARC_RPC_URLS = [
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.testnet.arc.network",
];

export function rpcTransport(urls: string[]) {
  const transports = urls.map(url => http(url, { timeout: 10_000, retryCount: 0 }));
  return transports.length === 1 ? transports[0] : fallback(transports, { retryCount: 1 });
}

export function rpcUrlsFor(id: number, configured?: string) {
  const urls = (configured || "").split(",").map(url => url.trim()).filter(Boolean);
  return urls.length ? urls : networkDefaults(id).rpcUrls.default.http;
}

export function networkDefaults(id = 5042002) {
  const arc = id === 5042002;
  return {
    id,
    name: arc ? "Arc Testnet" : id === 31337 ? "Anvil" : `Chain ${id}`,
    nativeCurrency: { name: arc ? "USDC" : "ETH", symbol: arc ? "USDC" : "ETH", decimals: 18 },
    rpcUrls: { default: { http: arc ? [...ARC_RPC_URLS] : ["http://127.0.0.1:8545"] } },
    ...(arc ? { contracts: arcTestnet.contracts, blockExplorers: arcTestnet.blockExplorers, testnet: true } : {}),
  };
}
