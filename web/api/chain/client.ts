/** One viem public client. Several RPC URLs become a fallback transport so a
 * flaky provider does not take the API down. Tests pass a custom transport. */
import {
  createPublicClient,
  defineChain,
  type PublicClient,
  type Transport,
} from "viem";
import { networkDefaults, rpcTransport } from "../../network.ts";

export function createClient(
  opts: { rpcUrls: string[]; chainId: number; transport?: Transport },
): PublicClient {
  const chain = defineChain({
    ...networkDefaults(opts.chainId),
    rpcUrls: { default: { http: opts.rpcUrls } },
  });
  const transport = opts.transport ?? rpcTransport(opts.rpcUrls);
  return createPublicClient({ chain, transport, batch: { multicall: { wait: 16, batchSize: 8192 } } });
}
