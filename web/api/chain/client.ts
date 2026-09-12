/** One viem public client. Several RPC URLs become a fallback transport so a
 * flaky provider does not take the API down. Tests pass a custom transport. */
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type PublicClient,
  type Transport,
} from "viem";

export function createClient(
  opts: { rpcUrls: string[]; chainId: number; transport?: Transport },
): PublicClient {
  const chain = defineChain({
    id: opts.chainId,
    name: `chain-${opts.chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: opts.rpcUrls } },
  });
  const transport = opts.transport ??
    (opts.rpcUrls.length === 1
      ? http(opts.rpcUrls[0], { timeout: 10_000 })
      : fallback(opts.rpcUrls.map((u) => http(u, { timeout: 10_000 }))));
  return createPublicClient({ chain, transport });
}
